"""Monotonic Department Requisition quantity controls.

The original saved Department request is the ceiling for later edits. A Department Head
or any downstream role may retain or reduce quantity, never increase it.
"""

from rest_framework import serializers

from apps.inventory.department_request_api import (
    ControlledStoreRequisitionItemSerializer as BaseStoreRequisitionItemSerializer,
    StoreRequisitionItemViewSet as BaseStoreRequisitionItemViewSet,
)


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
