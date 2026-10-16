"""Inventory controls shared across role-specific workspaces.

The Department Head remains the Department Requisition originator. This module
also keeps Store Keeper hotel/property scoping, monotonic requisition quantities,
and read-only Stock on Hand valuation fields used by the Stores workspace.
"""

from decimal import Decimal

from django.db.models import Prefetch
from rest_framework import serializers

from apps.inventory.department_request_api import (
    ControlledStoreRequisitionItemSerializer as BaseStoreRequisitionItemSerializer,
    StoreRequisitionItemViewSet as BaseStoreRequisitionItemViewSet,
)
from apps.inventory.models import InventoryBatch, StoreLocation
from apps.inventory.serializers import (
    InventoryBalanceSerializer as BaseInventoryBalanceSerializer,
)
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


class StoreKeeperInventoryBalanceSerializer(BaseInventoryBalanceSerializer):
    """Enrich a balance with the labels and monetary valuation needed by SOH."""

    item_name = serializers.CharField(source="item.name", read_only=True)
    item_sku = serializers.CharField(source="item.sku", read_only=True)
    category_name = serializers.CharField(source="item.category.name", read_only=True)
    store_name = serializers.CharField(source="store.name", read_only=True)
    branch_name = serializers.CharField(source="store.branch.name", read_only=True)
    base_unit_name = serializers.SerializerMethodField()
    unit_amount = serializers.SerializerMethodField()
    total_value = serializers.SerializerMethodField()
    available_value = serializers.SerializerMethodField()
    last_received_date = serializers.SerializerMethodField()

    def _valuation(self, balance):
        cache = getattr(self, "_soh_valuation_cache", {})
        key = (balance.item_id, balance.store_id)
        if key in cache:
            return cache[key]

        prefetched = getattr(balance.item, "_soh_batches", None)
        if prefetched is None:
            prefetched = list(
                InventoryBatch.objects.filter(
                    item_id=balance.item_id,
                    store_id=balance.store_id,
                    remaining_quantity__gt=0,
                ).order_by("received_date", "created_at")
            )
        else:
            prefetched = [
                batch for batch in prefetched
                if batch.store_id == balance.store_id and batch.remaining_quantity > 0
            ]

        quantity_basis = sum(
            (batch.remaining_quantity for batch in prefetched),
            Decimal("0.00"),
        )
        value_basis = sum(
            (batch.remaining_quantity * batch.unit_cost for batch in prefetched),
            Decimal("0.00"),
        )

        if quantity_basis > 0:
            unit_amount = value_basis / quantity_basis
        else:
            latest = (
                InventoryBatch.objects.filter(
                    item_id=balance.item_id,
                    store_id=balance.store_id,
                )
                .order_by("-received_date", "-created_at")
                .only("unit_cost", "received_date")
                .first()
            )
            unit_amount = latest.unit_cost if latest else Decimal("0.00")

        last_received = max(
            (batch.received_date for batch in prefetched if batch.received_date),
            default=None,
        )
        result = {
            "unit_amount": unit_amount.quantize(Decimal("0.01")),
            "total_value": (unit_amount * balance.quantity_in_stock).quantize(Decimal("0.01")),
            "available_value": (unit_amount * balance.available_quantity).quantize(Decimal("0.01")),
            "last_received_date": last_received,
        }
        cache[key] = result
        self._soh_valuation_cache = cache
        return result

    def get_base_unit_name(self, balance):
        unit = getattr(balance.item, "base_unit", None)
        return (getattr(unit, "abbreviation", "") or getattr(unit, "name", "") or balance.item.unit)

    def get_unit_amount(self, balance):
        return str(self._valuation(balance)["unit_amount"])

    def get_total_value(self, balance):
        return str(self._valuation(balance)["total_value"])

    def get_available_value(self, balance):
        return str(self._valuation(balance)["available_value"])

    def get_last_received_date(self, balance):
        value = self._valuation(balance)["last_received_date"]
        return value.isoformat() if value else None


class InventoryBalanceViewSet(BaseInventoryBalanceViewSet):
    """Expose hotel-wide Store Keeper SOH with current batch-cost valuation."""

    serializer_class = StoreKeeperInventoryBalanceSerializer

    @staticmethod
    def _with_valuation(queryset):
        active_batches = InventoryBatch.objects.filter(
            remaining_quantity__gt=0,
        ).only(
            "item_id", "store_id", "remaining_quantity", "unit_cost", "received_date", "created_at"
        ).order_by("received_date", "created_at")
        return queryset.select_related(
            "item", "item__base_unit", "item__category", "store", "store__branch"
        ).prefetch_related(
            Prefetch("item__inventory_batches", queryset=active_batches, to_attr="_soh_batches")
        )

    def get_queryset(self):
        if has_role(self.request.user, "Store Keeper") and not has_role(
            self.request.user, "System Administrator", "General Manager"
        ):
            store_ids = operational_stores_for_user(self.request.user).values_list("id", flat=True)
            queryset = self.queryset.filter(store_id__in=store_ids)
        else:
            queryset = super().get_queryset()
        return self._with_valuation(queryset)
