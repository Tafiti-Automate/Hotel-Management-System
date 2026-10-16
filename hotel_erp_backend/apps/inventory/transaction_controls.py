"""Inventory controls shared across role-specific workspaces."""

from apps.inventory.department_request_v2 import operational_stores_for_user
from apps.inventory.views import (
    InventoryBalanceViewSet as BaseInventoryBalanceViewSet,
    StoreLocationViewSet as BaseStoreLocationViewSet,
    has_role,
)


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
