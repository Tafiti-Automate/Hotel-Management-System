from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.sales.models import Sale, SaleItem


class SaleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Sale
        fields = "__all__"
        read_only_fields = (
            "id",
            "receipt_no",
            "balance",
            "inventory_changes_applied",
            "created_at",
            "updated_at",
            "created_by",
        )


class SaleItemSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = SaleItem
        fields = "__all__"
        read_only_fields = ("id", "base_quantity", "line_total", "created_at", "updated_at", "created_by")

    def validate(self, attrs):
        attrs = super().validate(attrs)
        item = attrs.get("item", getattr(self.instance, "item", None))
        unit = attrs.get("unit", getattr(self.instance, "unit", None))
        if item and unit:
            try:
                item.conversion_factor_for_unit(unit)
            except DjangoValidationError as error:
                detail = getattr(error, "message_dict", None) or getattr(error, "messages", None) or str(error)
                raise serializers.ValidationError(detail)
        return attrs
