from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.inventory.models import (
    StoreKeeperAssignment,
    StoreRequisition,
    StoreRequisitionItem,
)
from apps.inventory.serializers import (
    StoreRequisitionItemSerializer as BaseStoreRequisitionItemSerializer,
)
from apps.inventory.views import (
    StoreRequisitionItemViewSet as BaseStoreRequisitionItemViewSet,
    StoreRequisitionViewSet as BaseStoreRequisitionViewSet,
    has_role,
    is_department_head,
    raise_drf_validation_error,
)
from core.constants.choices import StoreRequisitionStatus


def department_head_requisition_scope(queryset, user):
    """Return the Department Head's safe request scope, including their own drafts."""
    employee = getattr(user, "employee_profile", None)
    if not is_department_head(user) or not employee:
        return None
    return queryset.filter(
        department=employee.department,
        requested_by__branch=employee.branch,
    ).filter(
        Q(requested_by=employee) | ~Q(status=StoreRequisitionStatus.DRAFT)
    )


class ControlledStoreRequisitionItemSerializer(BaseStoreRequisitionItemSerializer):
    """Protect the original Department request and keep Stores quantities monotonic.

    Before submission, the Department Head may edit the draft normally. Once the
    requisition reaches Stores, the requested Article/UOM/quantity becomes audit
    history. Stores may decide the carried-forward quantity, but a later edit may
    only keep or reduce a quantity that Stores already decided; it can never raise it.
    """

    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = self.instance
        if not instance or instance.requisition.status != StoreRequisitionStatus.SUBMITTED:
            return attrs

        protected_values = {
            "requisition": instance.requisition_id,
            "item": instance.item_id,
            "unit": instance.unit_id,
            "quantity_requested": instance.quantity_requested,
            "quantity_issued": instance.quantity_issued,
            "remarks": instance.remarks,
        }
        protected_errors = {}
        for field, current_value in protected_values.items():
            if field not in attrs:
                continue
            incoming = attrs[field]
            if hasattr(incoming, "pk"):
                incoming = incoming.pk
            if field in {"requisition", "item", "unit"}:
                incoming = str(incoming or "")
                current = str(current_value or "")
            else:
                current = current_value
            if incoming != current:
                protected_errors[field] = (
                    "This value is locked after the Department Head submits the requisition. "
                    "The original request must remain unchanged in the audit trail."
                )
        if protected_errors:
            raise ValidationError(protected_errors)

        if "quantity_approved" not in attrs:
            return attrs

        incoming = attrs["quantity_approved"] or Decimal("0.00")
        current = instance.quantity_approved or Decimal("0.00")
        decision_recorded = bool(
            current > Decimal("0.00")
            or (instance.storekeeper_comment or "").strip()
            or (instance.rejection_stage or "").strip()
        )
        if decision_recorded and incoming > current:
            raise ValidationError(
                {
                    "quantity_approved": (
                        f"Quantity cannot be increased after Stores has decided this line. "
                        f"Current carried-forward quantity is {current}; keep it or reduce it."
                    )
                }
            )
        return attrs


class StoreRequisitionViewSet(BaseStoreRequisitionViewSet):
    """Department request workflow with Department Head as the originator.

    Existing historical requester records remain readable and legacy pending HOD
    decisions can still be completed, but new Department requests are created by
    the Department Head and move directly to Stores on submission.
    """

    def get_queryset(self):
        scoped = department_head_requisition_scope(BaseStoreRequisitionViewSet.queryset.all(), self.request.user)
        if scoped is not None:
            return scoped
        return super().get_queryset()

    def perform_create(self, serializer):
        if not has_role(self.request.user, "System Administrator", "Department Head"):
            raise PermissionDenied("Only the Department Head can create a Department requisition.")
        serializer.save(created_by=self.request.user)

    def _enforce_requester_edit(self, requisition):
        if has_role(self.request.user, "System Administrator"):
            return
        employee = getattr(self.request.user, "employee_profile", None)
        if (
            is_department_head(self.request.user)
            and employee
            and requisition.requested_by_id == employee.id
            and requisition.status in (
                StoreRequisitionStatus.DRAFT,
                StoreRequisitionStatus.REJECTED,
            )
        ):
            return
        raise PermissionDenied(
            "Only the Department Head who created this requisition can edit its draft."
        )

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        requisition = self.get_object()
        self._enforce_requester_edit(requisition)
        employee = getattr(request.user, "employee_profile", None)

        if is_department_head(request.user) and employee and requisition.requested_by_id == employee.id:
            try:
                self._submit_department_head_request(requisition, employee, request.user)
            except Exception as error:
                if hasattr(error, "messages") or hasattr(error, "message_dict"):
                    raise_drf_validation_error(error)
                raise
        else:
            # System Administrator and historical workflows retain the original
            # submit behavior, which can still route an old requester record to HOD.
            try:
                requisition.submit(actor=request.user)
            except Exception as error:
                if hasattr(error, "messages") or hasattr(error, "message_dict"):
                    raise_drf_validation_error(error)
                raise

        return Response(self.get_serializer(requisition).data)

    @staticmethod
    def _submit_department_head_request(requisition, employee, actor):
        if requisition.status not in (
            StoreRequisitionStatus.DRAFT,
            StoreRequisitionStatus.REJECTED,
        ):
            raise ValidationError("Only draft or rejected requisitions can be submitted.")
        if not requisition.store_id:
            raise ValidationError({"store": "Select the issuing store before submitting this requisition."})
        if not requisition.store.is_active:
            raise ValidationError({"store": "The selected issuing store is not active."})
        if employee.branch_id and requisition.store.branch_id != employee.branch_id:
            raise ValidationError({"store": "Choose an issuing store from your assigned branch."})

        with transaction.atomic():
            locked = (
                StoreRequisition.objects.select_for_update()
                .select_related("store", "requested_by", "department")
                .get(pk=requisition.pk)
            )
            lines = list(
                StoreRequisitionItem.objects.select_for_update()
                .filter(requisition=locked)
                .select_related("item")
                .order_by("pk")
            )
            if not lines:
                raise ValidationError("Add at least one Article before submitting the requisition.")

            now = timezone.now()
            for line in lines:
                StoreRequisitionItem.objects.filter(pk=line.pk).update(
                    hod_approved_quantity=line.base_quantity_requested,
                    quantity_approved=Decimal("0.00"),
                    storekeeper_comment="",
                    rejection_stage="",
                    rejection_reason="",
                    rejected_at=None,
                    rejected_by=None,
                    updated_at=now,
                )

            updated = StoreRequisition.objects.filter(
                pk=locked.pk,
                status__in=(
                    StoreRequisitionStatus.DRAFT,
                    StoreRequisitionStatus.REJECTED,
                ),
            ).update(
                status=StoreRequisitionStatus.SUBMITTED,
                department_approved_by_id=employee.pk,
                department_approved_at=now,
                department_approval_comments="Created and submitted by the Department Head.",
                rejection_reason="",
                approved_by=None,
                approved_at=None,
                approval_comments="",
                updated_at=now,
            )
            if updated != 1:
                raise ValidationError(
                    "This requisition changed while you were submitting it. Refresh and try again."
                )

        requisition.refresh_from_db()

        try:
            from apps.audit_logs.models import AuditLog

            AuditLog.objects.create(
                actor=actor,
                action="department_requisition_submitted_by_hod",
                entity_type="inventory.StoreRequisition",
                entity_id=requisition.pk,
                metadata={
                    "requisition_no": requisition.requisition_no,
                    "department": str(requisition.department_id),
                    "store": str(requisition.store_id),
                    "item_count": len(lines),
                },
                created_by=actor,
            )
        except Exception:
            # Audit is secondary to the business transaction and must not roll it back.
            pass

        try:
            requisition._notify_stores(
                title=f"{requisition.requisition_no} needs Store Keeper action",
                message=(
                    f"The Department Head submitted {requisition.department}'s requisition. "
                    "Review the requested quantities and continue the Stores workflow."
                ),
                created_by=actor,
            )
        except Exception:
            # Notifications are best-effort and must not invalidate a valid request.
            pass


class StoreRequisitionItemViewSet(BaseStoreRequisitionItemViewSet):
    serializer_class = ControlledStoreRequisitionItemSerializer

    def get_queryset(self):
        # The original item view inherits the legacy HOD scope that excluded all
        # draft requests. HOD-originated requests need their own draft lines to be
        # listable/editable while retaining the same department/branch isolation.
        scoped_requests = department_head_requisition_scope(StoreRequisition.objects.all(), self.request.user)
        if scoped_requests is not None:
            return BaseStoreRequisitionItemViewSet.queryset.filter(requisition__in=scoped_requests)
        return super().get_queryset()

    def _enforce_line_edit(self, requisition):
        if has_role(self.request.user, "System Administrator"):
            return
        employee = getattr(self.request.user, "employee_profile", None)
        hod_edit = (
            is_department_head(self.request.user)
            and employee
            and requisition.requested_by_id == employee.id
            and requisition.status in (
                StoreRequisitionStatus.DRAFT,
                StoreRequisitionStatus.REJECTED,
            )
        )
        keeper_edit = (
            has_role(self.request.user, "Store Keeper")
            and requisition.status == StoreRequisitionStatus.SUBMITTED
            and StoreKeeperAssignment.objects.filter(
                store=requisition.store,
                employee=employee,
                is_active=True,
            ).exists()
        )
        if hod_edit or keeper_edit:
            return
        raise PermissionDenied("You cannot change lines on this Department requisition.")
