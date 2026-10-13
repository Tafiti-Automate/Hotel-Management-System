"""Production-safe Department Head draft persistence.

The Department Requisition business rules remain in ``department_request_api``.
This wrapper only makes draft PATCH operations resilient to non-critical audit
side effects. A draft save must not fail just because an audit write fails.
"""

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.inventory.department_request_api import (
    StoreRequisitionItemViewSet,
    StoreRequisitionViewSet as ControlledStoreRequisitionViewSet,
)
from apps.inventory.models import StoreRequisition
from apps.inventory.views import has_role, is_department_head
from core.constants.choices import StoreRequisitionStatus


class StoreRequisitionViewSet(ControlledStoreRequisitionViewSet):
    def perform_update(self, serializer):
        requisition = serializer.instance
        self._enforce_requester_edit(requisition)

        # Keep System Administrator behavior unchanged. The production issue is
        # specific to a Department Head saving their own editable draft.
        if has_role(self.request.user, "System Administrator"):
            return super().perform_update(serializer)

        employee = getattr(self.request.user, "employee_profile", None)
        if not (
            is_department_head(self.request.user)
            and employee
            and requisition.requested_by_id == employee.id
            and requisition.status in (
                StoreRequisitionStatus.DRAFT,
                StoreRequisitionStatus.REJECTED,
            )
        ):
            return super().perform_update(serializer)

        values = serializer.validated_data
        store = values.get("store", requisition.store)
        if store and employee.branch_id and store.branch_id != employee.branch_id:
            raise ValidationError({"store": "Choose an issuing store from your assigned branch."})

        purpose = values.get("purpose", requisition.purpose)
        required_date = values.get("required_date", requisition.required_date)
        now = timezone.now()

        updated = StoreRequisition.objects.filter(
            pk=requisition.pk,
            status__in=(
                StoreRequisitionStatus.DRAFT,
                StoreRequisitionStatus.REJECTED,
            ),
            requested_by=employee,
        ).update(
            purpose=purpose,
            required_date=required_date,
            store=store,
            department=employee.department,
            requested_by=employee,
            updated_at=now,
        )
        if updated != 1:
            raise ValidationError(
                "This requisition changed while you were saving it. Refresh and try again."
            )

        requisition.refresh_from_db()
        serializer.instance = requisition

        # Audit is evidence, but a temporary audit-table/problem must never turn
        # a valid editable draft save into an HTTP 500. Submission still records
        # its own business audit in the controlled workflow.
        try:
            from apps.audit_logs.models import AuditLog

            AuditLog.objects.create(
                actor=self.request.user,
                action="department_requisition_draft_saved",
                entity_type="inventory.StoreRequisition",
                entity_id=requisition.pk,
                metadata={
                    "requisition_no": requisition.requisition_no,
                    "department": str(requisition.department_id),
                    "store": str(requisition.store_id) if requisition.store_id else None,
                },
                created_by=self.request.user,
            )
        except Exception:
            # Draft persistence is the primary transaction. Audit remains
            # best-effort, matching the HOD submission path.
            pass
