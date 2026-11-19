"""Reported supplier returns: identify -> quarantine -> controller review -> dispatch.

Receiving rejections do not enter stock and therefore must never create a
stock-out movement. Posted-store returns consume held physical inventory once.
"""
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.inventory.models import InventoryBalance, StoreKeeperAssignment
from apps.notifications.services import notify_employee, notify_roles
from apps.procurement.models import (
    GoodsInspectionItem, GoodsReceiptNote, SupplierReturn,
    SupplierReturnItem, SupplierReturnRequest,
)
from apps.procurement.serializers import SupplierReturnRequestSerializer


def _has_role(user, role):
    return bool(user.is_authenticated and user.is_active
                and not user.is_superuser and user.groups.filter(name=role).exists())


class SupplierReturnRequestViewSet(ModelViewSet):
    serializer_class = SupplierReturnRequestSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]
    queryset = SupplierReturnRequest.objects.select_related(
        "goods_receipt", "goods_receipt__purchase_order__supplier",
        "goods_receipt_item__item", "store", "reported_by__user", "supplier_return",
    )
    filterset_fields = ("status", "source", "store", "goods_receipt", "reported_by")
    ordering_fields = ("created_at", "status")

    def _employee(self):
        user = self.request.user
        employee = getattr(user, "employee_profile", None)
        if not employee or not employee.is_active or not employee.branch_id or not employee.branch.hotel_id:
            raise PermissionDenied("An active employee assigned to a hotel is required.")
        return employee

    def get_queryset(self):
        try:
            employee = self._employee()
        except PermissionDenied:
            return self.queryset.none()
        qs = self.queryset.filter(store__branch__hotel_id=employee.branch.hotel_id)
        user = self.request.user
        if _has_role(user, "Cost Controller"):
            return qs
        if _has_role(user, "Receiving Clerk"):
            return qs.filter(reported_by=employee)
        if _has_role(user, "Store Keeper"):
            assigned = StoreKeeperAssignment.objects.filter(
                employee=employee, is_active=True, store__is_active=True,
            ).values_list("store_id", flat=True)
            return qs.filter(store_id__in=assigned, reported_by=employee)
        return qs.none()

    @transaction.atomic
    def perform_create(self, serializer):
        employee = self._employee()
        user = self.request.user
        source = serializer.validated_data["source"]
        receipt = serializer.validated_data["goods_receipt"]
        line = serializer.validated_data["goods_receipt_item"]
        store = serializer.validated_data["store"]
        qty = serializer.validated_data["quantity"]
        # Lock GRN to serialize multiple reports against the same receipt.
        GoodsReceiptNote.objects.select_for_update().get(pk=receipt.pk)
        if line.goods_receipt_id != receipt.pk:
            raise ValidationError("The selected article does not belong to this GRN.")
        if store.pk != receipt.purchase_order.store_id or line.item_id is None:
            raise ValidationError("Return source store must match the original GRN.")
        if store.branch.hotel_id != employee.branch.hotel_id:
            raise PermissionDenied("Cannot report goods for a different hotel.")
        if qty <= Decimal("0"):
            raise ValidationError("Return quantity must be positive.")
        if source == SupplierReturnRequest.SOURCE_RECEIVING:
            if not _has_role(user, "Receiving Clerk") or receipt.received_by_id != employee.pk:
                raise PermissionDenied("Only the clerk who received this GRN may report a receiving rejection.")
            rejected = GoodsInspectionItem.objects.filter(
                goods_receipt_item=line
            ).aggregate(value=Sum("quantity_rejected"))["value"] or Decimal("0")
            claimed = SupplierReturnRequest.objects.filter(
                goods_receipt_item=line,
                source=source,
                status__in=["pending", "approved", "dispatched"],
            ).aggregate(value=Sum("quantity"))["value"] or Decimal("0")
            if qty > rejected - claimed:
                raise ValidationError("Reported quantity exceeds the unreported rejected quantity on the GRN.")
        elif source == SupplierReturnRequest.SOURCE_STOCK:
            if not _has_role(user, "Store Keeper") or not StoreKeeperAssignment.objects.filter(
                store=store, employee=employee, is_active=True,
                store__is_active=True,
            ).exists():
                raise PermissionDenied("Only the assigned Store Keeper may report on-hand goods for this store.")
            if receipt.status != "posted" or not line.inventory_changes_applied:
                raise ValidationError("Only accepted goods from a posted GRN can be returned from stock.")
            accepted = line.inventory_post_quantity()
            prior = SupplierReturnItem.objects.filter(
                supplier_return__goods_receipt=receipt,
                supplier_return__inventory_changes_applied=True,
                item_id=line.item_id,
            ).aggregate(value=Sum("base_quantity"))["value"] or Decimal("0")
            held = SupplierReturnRequest.objects.filter(
                goods_receipt_item=line, source=source,
                status__in=["pending", "approved"],
            ).aggregate(value=Sum("quantity"))["value"] or Decimal("0")
            if qty > accepted - prior - held:
                raise ValidationError("Return request exceeds accepted goods remaining on this GRN.")
            balance = InventoryBalance.objects.select_for_update().filter(
                item_id=line.item_id, store=store,
            ).first()
            if balance is None or qty > balance.available_quantity:
                raise ValidationError("Insufficient available stock to quarantine this return.")
            balance.quantity_quarantined += qty
            balance.save(update_fields=["quantity_quarantined", "updated_at"])
        else:
            raise ValidationError("Choose a valid supplier return report source.")
        obj = serializer.save(reported_by=employee, created_by=user)
        transaction.on_commit(lambda: notify_roles(
            ["Cost Controller"],
            title="Supplier return report awaiting review",
            message=f"{store.name}: {line.item.name}, {qty} base units. GRN {receipt.grn_number}. Reason: {obj.reason}",
            hotel=store.branch.hotel, created_by=user,
            deduplication_key=f"supplier-return-report:{obj.pk}",
        ))

    def _controller(self):
        employee = self._employee()
        if not _has_role(self.request.user, "Cost Controller"):
            raise PermissionDenied("Only the Cost Controller may review or dispatch a supplier return.")
        return employee

    def _reporter_notice(self, obj, stage):
        transaction.on_commit(lambda: notify_employee(
            obj.reported_by,
            title=f"Supplier return {stage}",
            message=f"GRN {obj.goods_receipt.grn_number}: {obj.goods_receipt_item.item.name} — {obj.quantity} base units. {obj.review_note}",
            created_by=self.request.user,
            deduplication_key=f"supplier-return-report:{obj.pk}:{stage}",
        ))

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def approve(self, request, pk=None):
        reviewer = self._controller()
        obj = self.get_object()
        obj = SupplierReturnRequest.objects.select_for_update().get(pk=obj.pk)
        if obj.status != obj.STATUS_PENDING:
            raise ValidationError("Only pending return reports can be approved.")
        if obj.reported_by_id == reviewer.pk:
            raise PermissionDenied("The person reporting goods cannot approve their own supplier return.")
        obj.status = obj.STATUS_APPROVED
        obj.review_note = str(request.data.get("note", "")).strip()
        obj.reviewed_by = reviewer
        obj.reviewed_at = timezone.now()
        obj.save(update_fields=["status", "review_note", "reviewed_by", "reviewed_at", "updated_at"])
        self._reporter_notice(obj, "approved")
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def reject(self, request, pk=None):
        reviewer = self._controller()
        obj = self.get_object()
        obj = SupplierReturnRequest.objects.select_for_update().get(pk=obj.pk)
        reason = str(request.data.get("note", "")).strip()
        if obj.status != obj.STATUS_PENDING:
            raise ValidationError("Only pending return reports can be rejected.")
        if obj.reported_by_id == reviewer.pk:
            raise PermissionDenied("The reporting employee cannot review their own supplier return.")
        if not reason:
            raise ValidationError("Provide a reason for rejecting the return request.")
        if obj.source == obj.SOURCE_STOCK:
            balance = InventoryBalance.objects.select_for_update().get(
                item=obj.goods_receipt_item.item, store=obj.store,
            )
            if balance.quantity_quarantined < obj.quantity:
                raise ValidationError("Quarantine ledger is inconsistent. Contact the inventory controller.")
            balance.quantity_quarantined -= obj.quantity
            balance.save(update_fields=["quantity_quarantined", "updated_at"])
        obj.status = obj.STATUS_REJECTED
        obj.review_note = reason
        obj.reviewed_by = reviewer
        obj.reviewed_at = timezone.now()
        obj.save(update_fields=["status", "review_note", "reviewed_by", "reviewed_at", "updated_at"])
        self._reporter_notice(obj, "rejected")
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def dispatch(self, request, pk=None):
        controller = self._controller()
        obj = self.get_object()
        obj = SupplierReturnRequest.objects.select_for_update().get(pk=obj.pk)
        if obj.status != obj.STATUS_APPROVED:
            raise ValidationError("Cost Controller approval is required before supplier dispatch.")
        if obj.source == obj.SOURCE_STOCK:
            # Release this report's hold inside the same transaction that posts
            # the single physical stock deduction and immutable ledger entry.
            GoodsReceiptNote.objects.select_for_update().get(pk=obj.goods_receipt_id)
            balance = InventoryBalance.objects.select_for_update().get(
                item=obj.goods_receipt_item.item, store=obj.store,
            )
            if balance.quantity_quarantined < obj.quantity:
                raise ValidationError("Quarantine quantity is inconsistent. Dispatch stopped.")
            balance.quantity_quarantined -= obj.quantity
            balance.save(update_fields=["quantity_quarantined", "updated_at"])
            ret = SupplierReturn.objects.create(
                supplier=obj.goods_receipt.purchase_order.supplier,
                goods_receipt=obj.goods_receipt, store=obj.store,
                returned_by=controller, reason=obj.reason, created_by=request.user,
            )
            SupplierReturnItem.objects.create(
                supplier_return=ret, item=obj.goods_receipt_item.item,
                quantity=obj.quantity, reason=obj.reason, created_by=request.user,
            )
            ret.apply_inventory_changes(dispatched_by=controller)
            obj.supplier_return = ret
        # Rejected-at-receipt goods were never counted in usable stock:
        # dispatch is an audit/physical-vendor-return event, not a stock-out.
        obj.status = obj.STATUS_DISPATCHED
        obj.dispatched_at = timezone.now()
        obj.dispatched_by = controller
        obj.save(update_fields=["supplier_return", "status", "dispatched_at", "dispatched_by", "updated_at"])
        self._reporter_notice(obj, "dispatched")
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def acknowledge(self, request, pk=None):
        self._controller()
        obj = self.get_object()
        obj = SupplierReturnRequest.objects.select_for_update().get(pk=obj.pk)
        representative = str(request.data.get("acknowledged_by", "")).strip()
        credit = str(request.data.get("credit_note_number", "")).strip()
        if obj.status != obj.STATUS_DISPATCHED or obj.supplier_acknowledged_at:
            raise ValidationError("Only an unacknowledged dispatched report can be acknowledged.")
        if not representative:
            raise ValidationError("Enter the supplier representative.")
        if credit and SupplierReturnRequest.objects.filter(
            goods_receipt__purchase_order__supplier_id=obj.goods_receipt.purchase_order.supplier_id,
            credit_note_number__iexact=credit,
        ).exclude(pk=obj.pk).exists():
            raise ValidationError("This supplier credit note reference is already recorded.")
        if credit and SupplierReturn.objects.filter(
            supplier_id=obj.goods_receipt.purchase_order.supplier_id,
            credit_note_number__iexact=credit,
        ).exclude(pk=obj.supplier_return_id).exists():
            raise ValidationError("This supplier credit note reference is already recorded.")
        if obj.supplier_return_id:
            obj.supplier_return.acknowledge(
                acknowledged_by=representative, credit_note_number=credit,
            )
        obj.supplier_acknowledged_at = timezone.now()
        obj.supplier_acknowledged_by = representative
        obj.credit_note_number = credit
        obj.save(update_fields=["supplier_acknowledged_at", "supplier_acknowledged_by", "credit_note_number", "updated_at"])
        self._reporter_notice(obj, "acknowledged")
        return Response(self.get_serializer(obj).data)
