"""Inventory controls shared across role-specific workspaces.

The Department Head remains the Department Requisition originator. This module
also keeps Store Keeper hotel/property scoping and the monotonic quantity rules
used by the controlled requisition API.
"""

from rest_framework import serializers

from apps.inventory.department_request_api import (
    ControlledStoreRequisitionItemSerializer as BaseStoreRequisitionItemSerializer,
    StoreRequisitionItemViewSet as BaseStoreRequisitionItemViewSet,
)
from apps.inventory.models import StoreLocation
from apps.inventory.views import (
    InventoryBalanceViewSet as BaseInventoryBalanceViewSet,
    StoreLocationViewSet as BaseStoreLocationViewSet,
    has_role,
)


def operational_stores_for_user(user):
    """Return active stores in the user's operational property scope."""
    stores = StoreLocation.objects.select_related("branch", "branch__hotel").filter(is_active=True)
    if getattr(user, "is_superuser", False) or has_role(user, "System Administrator", "General Manager"):
        return stores

    employee = getattr(user, "employee_profile", None)
    if not employee or not employee.branch_id:
        return stores.none()

    if has_role(user, "Store Keeper") and getattr(employee.branch, "hotel_id", None):
        return stores.filter(branch__hotel_id=employee.branch.hotel_id)
    return stores.filter(branch_id=employee.branch_id)


class StoreRequisitionItemSerializer(BaseStoreRequisitionItemSerializer):
    def validate(self, attrs):
        attrs = super().validate(attrs)
        if not self.instance:
            return attrs
        if "quantity_requested" not in attrs and "unit" not in attrs:
            return attrs

        item = attrs.get("item", self.instance.item)
        unit = attrs.get("unit", self.instance.unit)
        quantity = attrs.get("quantity_requested", self.instance.quantity_requested)
        candidate_base = item.quantity_in_base_units(quantity, unit)
        current_base = self.instance.base_quantity_requested
        if candidate_base > current_base:
            raise serializers.ValidationError({
                "quantity_requested": (
                    "Requested quantity can only be retained or reduced after the line is created. "
                    f"The current ceiling is {self.instance.quantity_requested}."
                )
            })
        return attrs


class StoreRequisitionItemViewSet(BaseStoreRequisitionItemViewSet):
    serializer_class = StoreRequisitionItemSerializer


class StoreLocationViewSet(BaseStoreLocationViewSet):
    """Store Keepers can view every active store in their hotel/property scope."""

    def get_queryset(self):
        if has_role(self.request.user, "Store Keeper") and not has_role(
            self.request.user, "System Administrator", "General Manager"
        ):
            return operational_stores_for_user(self.request.user)
        return super().get_queryset()


class InventoryBalanceViewSet(BaseInventoryBalanceViewSet):
    """Expose SOH across the Store Keeper's hotel/property, not one assignment only."""

    def get_queryset(self):
        if has_role(self.request.user, "Store Keeper") and not has_role(
            self.request.user, "System Administrator", "General Manager"
        ):
            store_ids = operational_stores_for_user(self.request.user).values_list("id", flat=True)
            return self.queryset.filter(store_id__in=store_ids)
        return super().get_queryset()
