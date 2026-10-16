"""Cross-role procurement controls that must hold regardless of the client UI.

This module keeps operational quantity decisions monotonic, aligns Finance / General
Management approval authority with hotel-wide visibility, and moves final GRN stock
posting to Store Keeper verification. Receiving records the physical delivery; Stores
verifies the GRN and only then posts accepted quantities into Stock on Hand.
"""

from decimal import Decimal

from django.db import transaction
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.procurement.models import GoodsReceiptNote
from apps.procurement.serializers import RequisitionItemSerializer as BaseRequisitionItemSerializer
from apps.procurement.views import (
    GoodsReceiptItemViewSet as BaseGoodsReceiptItemViewSet,
    GoodsReceiptNoteViewSet as BaseGoodsReceiptNoteViewSet,
    PurchaseOrderViewSet as BasePurchaseOrderViewSet,
    RequisitionItemViewSet as BaseRequisitionItemViewSet,
    enforce_readiness,
    raise_drf_validation_error,
    user_has_role,
)
from core.constants.choices import ApprovalStatus


class RequisitionItemSerializer(BaseRequisitionItemSerializer):
    """Never allow an existing requisition line to be increased."""

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if not self.instance:
            return attrs
        if "quantity" not in attrs and "unit" not in attrs:
            return attrs

        item = attrs.get("item", self.instance.item)
        unit = attrs.get("unit", self.instance.unit)
        quantity = attrs.get("quantity", self.instance.quantity)
        candidate_base = item.quantity_in_base_units(quantity, unit)
        current_base = self.instance.requested_base_quantity
        if candidate_base > current_base:
            raise serializers.ValidationError({
                "quantity": (
                    "A requisition quantity can only be retained or reduced after the line is created. "
                    f"The current ceiling is {self.instance.quantity}."
                )
            })
        return attrs


class RequisitionItemViewSet(BaseRequisitionItemViewSet):
    serializer_class = RequisitionItemSerializer


class PurchaseOrderViewSet(BasePurchaseOrderViewSet):
    """Use hotel-wide management authority while retaining branch controls elsewhere."""

    def _current_approval_step(self, order, request):
        step = order.approval_workflow.filter(
            status=ApprovalStatus.PENDING,
        ).order_by("stage").first()
        if not step:
            raise ValidationError("This LPO has no pending approval stage.")
        if request.user.is_superuser:
            return step

        employee = getattr(request.user, "employee_profile", None)
        if not employee or not employee.is_active or not request.user.is_active:
            raise PermissionDenied("An active employee profile is required to approve this LPO.")

        order_branch = getattr(order.requisition, "branch", None)
        order_branch_id = getattr(order.requisition, "branch_id", None)
        management_role = user_has_role(request.user, "Financial Manager", "General Manager")
        if order_branch_id:
            if management_role:
                employee_branch = getattr(employee, "branch", None)
                employee_hotel_id = getattr(employee_branch, "hotel_id", None)
                order_hotel_id = getattr(order.requisition, "hotel_id", None) or getattr(order_branch, "hotel_id", None)
                if employee_hotel_id and order_hotel_id:
                    if employee_hotel_id != order_hotel_id:
                        raise PermissionDenied("This LPO belongs to a different hotel.")
                elif employee.branch_id != order_branch_id:
                    raise PermissionDenied("This LPO belongs to a different branch.")
            elif employee.branch_id != order_branch_id:
                raise PermissionDenied("This LPO belongs to a different branch.")

        if step.approver_id:
            if step.approver_id != employee.id:
                raise PermissionDenied(f"This stage is assigned to {step.approver}.")
            return step
        if step.approver_role_id:
            if not request.user.groups.filter(pk=step.approver_role_id).exists():
                raise PermissionDenied(
                    f"This stage requires the {step.approver_role.name} role."
                )
            return step
        raise PermissionDenied("This approval stage has no assigned role or employee.")

    @action(detail=True, methods=["post"], url_path="receive-delivery")
    def receive_delivery(self, request, pk=None):
        response = super().receive_delivery(request, pk)
        if getattr(response, "status_code", None) == 201 and isinstance(getattr(response, "data", None), dict):
            receipt_id = response.data.get("id")
            receipt = GoodsReceiptNote.objects.select_related(
                "purchase_order__store__branch__hotel",
                "purchase_order__supplier",
            ).filter(pk=receipt_id).first()
            if receipt and receipt.purchase_order.store_id:
                try:
                    from apps.notifications.services import notify_roles

                    branch = receipt.purchase_order.store.branch
                    notify_roles(
                        ("Store Keeper",),
                        title=f"GRN {receipt.grn_number} needs Stores verification",
                        message=(
                            f"Receiving recorded supplier delivery against LPO "
                            f"{receipt.purchase_order.lpo_number or receipt.purchase_order.po_number}. "
                            "Compare the GRN with the LPO and post accepted quantities to Stock on Hand."
                        ),
                        hotel=getattr(branch, "hotel", None) if getattr(branch, "hotel_id", None) else None,
                        branch=None if getattr(branch, "hotel_id", None) else branch,
                        created_by=request.user,
                    )
                except Exception:
                    pass
        return response



def _store_keeper_receipt_scope(queryset, user, *, receipt_path="purchase_order"):
    employee = getattr(user, "employee_profile", None)
    if not employee or not employee.branch_id:
        return queryset.none()
    branch = employee.branch
    if getattr(branch, "hotel_id", None):
        return queryset.filter(**{f"{receipt_path}__store__branch__hotel_id": branch.hotel_id})
    return queryset.filter(**{f"{receipt_path}__store__branch_id": employee.branch_id})


class GoodsReceiptNoteViewSet(BaseGoodsReceiptNoteViewSet):
    """Receiving records a GRN; Store Keeper verifies and posts it to SOH."""

    def get_permissions(self):
        if self.action in ("verification", "post_to_inventory"):
            return [IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if user_has_role(self.request.user, "Store Keeper") and not user_has_role(
            self.request.user,
            "System Administrator",
            "Procurement Manager",
            "Financial Manager",
            "General Manager",
        ):
            # Start from the class queryset because the base Store Keeper branch did
            # not historically scope GRNs at all.
            return _store_keeper_receipt_scope(
                BaseGoodsReceiptNoteViewSet.queryset.all(),
                self.request.user,
            ).distinct()
        return queryset

    def _require_store_keeper(self, request, receipt):
        if user_has_role(request.user, "System Administrator"):
            employee = getattr(request.user, "employee_profile", None)
            if not employee:
                raise PermissionDenied("An employee profile is required to verify a GRN.")
            return employee
        employee = getattr(request.user, "employee_profile", None)
        if not user_has_role(request.user, "Store Keeper") or not employee or not employee.is_active:
            raise PermissionDenied("Only the Store Keeper can verify and post a received GRN to Stock on Hand.")
        allowed = _store_keeper_receipt_scope(
            GoodsReceiptNote.objects.filter(pk=receipt.pk),
            request.user,
        ).exists()
        if not allowed:
            raise PermissionDenied("This GRN belongs to a store outside your hotel/property scope.")
        return employee

    @action(detail=True, methods=["get"])
    def verification(self, request, pk=None):
        receipt = self.get_object()
        self._require_store_keeper(request, receipt)
        return Response(self._verification_payload(receipt))

    @action(detail=True, methods=["post"], url_path="post-to-inventory")
    def post_to_inventory(self, request, pk=None):
        receipt = self.get_object()
        keeper = self._require_store_keeper(request, receipt)
        enforce_readiness(receipt.posting_readiness())
        try:
            with transaction.atomic():
                locked = GoodsReceiptNote.objects.select_for_update().get(pk=receipt.pk)
                locked.post_to_inventory(posted_by=keeper)
                locked.refresh_from_db()
                receipt = locked
        except Exception as error:
            if hasattr(error, "messages") or hasattr(error, "message_dict"):
                raise_drf_validation_error(error)
            raise

        try:
            from apps.audit_logs.models import AuditLog

            AuditLog.objects.create(
                actor=request.user,
                action="grn_verified_and_posted_by_store_keeper",
                entity_type="procurement.GoodsReceiptNote",
                entity_id=receipt.pk,
                metadata={
                    "grn_number": receipt.grn_number,
                    "lpo_number": receipt.purchase_order.lpo_number,
                    "store": str(receipt.purchase_order.store_id or ""),
                },
                created_by=request.user,
            )
        except Exception:
            pass

        try:
            from apps.notifications.services import notify_employee

            notify_employee(
                receipt.received_by,
                title=f"GRN {receipt.grn_number} verified by Stores",
                message=(
                    f"The Store Keeper verified the received quantities and posted accepted stock "
                    f"into {receipt.purchase_order.store or 'inventory'}."
                ),
                created_by=request.user,
            )
        except Exception:
            pass
        return Response(self._verification_payload(receipt))

    @staticmethod
    def _verification_payload(receipt):
        lines = []
        for item in receipt.items.select_related(
            "item__base_unit",
            "store",
            "purchase_order_item__unit",
        ).prefetch_related("inspection_items"):
            order_line = item.purchase_order_item
            previous = order_line.receipt_items.exclude(pk=item.pk).exclude(
                goods_receipt__status="cancelled"
            )
            previous_received = sum(
                (other.committed_purchase_quantity for other in previous),
                Decimal("0.00"),
            )
            ordered = order_line.approved_quantity or Decimal("0.00")
            due_before = max(ordered - previous_received, Decimal("0.00"))
            inspection_item = item.inspection_items.first()
            accepted_base = inspection_item.quantity_accepted if inspection_item else item.base_quantity
            factor = order_line.conversion_factor or Decimal("1.00")
            accepted = accepted_base / factor if factor else Decimal("0.00")
            lines.append({
                "id": str(item.pk),
                "item": str(item.item_id),
                "item_name": item.item.name,
                "sku": item.item.sku,
                "store": str(item.store_id or ""),
                "store_name": str(item.store or ""),
                "ordered_quantity": ordered,
                "previously_received_quantity": previous_received,
                "due_before_delivery": due_before,
                "received_quantity": item.quantity_received,
                "accepted_quantity": accepted,
                "difference": item.quantity_received - due_before,
                "matches_lpo_limit": item.quantity_received <= due_before,
                "unit_name": (
                    order_line.unit.abbreviation or order_line.unit.name
                    if order_line.unit_id
                    else (
                        item.item.base_unit.abbreviation or item.item.base_unit.name
                        if item.item.base_unit_id
                        else item.item.unit
                    )
                ),
                "expiry_date": item.expiry_date,
                "inventory_changes_applied": item.inventory_changes_applied,
            })
        return {
            "id": str(receipt.pk),
            "grn_number": receipt.grn_number,
            "lpo_number": receipt.purchase_order.lpo_number or receipt.purchase_order.po_number,
            "supplier_name": receipt.purchase_order.supplier.name,
            "supplier_invoice_no": receipt.supplier_invoice_no,
            "delivery_note_no": receipt.delivery_note_no,
            "received_date": receipt.received_date,
            "received_by_name": (
                receipt.received_by.user.get_full_name()
                or receipt.received_by.user.username
            ),
            "store": str(receipt.purchase_order.store_id or ""),
            "store_name": str(receipt.purchase_order.store or ""),
            "status": receipt.status,
            "posted_at": receipt.posted_at,
            "posted_by": str(receipt.posted_by_id or ""),
            "lines": lines,
        }


class GoodsReceiptItemViewSet(BaseGoodsReceiptItemViewSet):
    """Give Store Keepers read access only to GRN lines in their hotel/property."""

    def get_queryset(self):
        queryset = super().get_queryset()
        if user_has_role(self.request.user, "Store Keeper") and not user_has_role(
            self.request.user,
            "System Administrator",
            "Procurement Manager",
            "Financial Manager",
            "General Manager",
        ):
            return _store_keeper_receipt_scope(
                BaseGoodsReceiptItemViewSet.queryset.all(),
                self.request.user,
                receipt_path="goods_receipt__purchase_order",
            ).distinct()
        return queryset
