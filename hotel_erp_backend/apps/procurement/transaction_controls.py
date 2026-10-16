"""Cross-role procurement controls that must hold regardless of the client UI.

This module keeps operational quantity decisions monotonic and aligns Finance / General
Management approval authority with the hotel-wide visibility already used by their LPO
queues. It deliberately leaves Procurement branch-scoped.
"""

from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.procurement.serializers import RequisitionItemSerializer as BaseRequisitionItemSerializer
from apps.procurement.views import (
    PurchaseOrderViewSet as BasePurchaseOrderViewSet,
    RequisitionItemViewSet as BaseRequisitionItemViewSet,
    user_has_role,
)
from core.constants.choices import ApprovalStatus


class RequisitionItemSerializer(BaseRequisitionItemSerializer):
    """Never allow an existing requisition line to be increased.

    The first saved quantity is the ceiling. Subsequent draft corrections may retain or
    reduce that quantity, including when the UOM changes, but may not increase the base
    quantity that entered the audit trail.
    """

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
                    # Legacy records without hotel ownership remain safely branch-scoped.
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
