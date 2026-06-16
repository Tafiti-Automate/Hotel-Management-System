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
