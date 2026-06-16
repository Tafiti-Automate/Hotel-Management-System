from decimal import Decimal

from rest_framework import serializers

from apps.inventory.models import (
    Category,
    InventoryBalance,
    InventoryBatch,
    Item,
    ItemUnitPrice,
    ReorderRule,
    StockAdjustment,
    StockAdjustmentItem,
    StockCount,
    StockCountItem,
    StockIssue,
    StockIssueItem,
    StockLedger,
    StockTransfer,
    StockTransferItem,
    StoreLocation,
    StoreRequisition,
    StoreRequisitionItem,
    StoreReturn,
    StoreReturnItem,
    SupplierItemPrice,
    UnitOfMeasure,
)


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ("id", "name", "description", "created_at", "updated_at", "created_by")
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class UnitOfMeasureSerializer(serializers.ModelSerializer):
    class Meta:
        model = UnitOfMeasure
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class ItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = Item
        fields = (
            "id",
            "category",
            "name",
            "sku",
            "brand",
            "description",
            "barcode",
            "unit",
            "base_unit",
            "reorder_level",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class ItemUnitPriceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItemUnitPrice
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class StoreLocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = StoreLocation
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class InventoryBalanceSerializer(serializers.ModelSerializer):
    is_below_reorder = serializers.BooleanField(read_only=True)

    class Meta:
        model = InventoryBalance
        fields = "__all__"
        read_only_fields = ("id", "is_below_reorder", "created_at", "updated_at", "created_by")


class SupplierItemPriceSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierItemPrice
        fields = (
            "id",
            "supplier",
            "item",
            "unit",
            "unit_price",
            "lead_time_days",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class StockLedgerSerializer(serializers.ModelSerializer):
    net_quantity = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = StockLedger
        fields = (
            "id",
            "item",
            "store",
            "quantity_in",
            "quantity_out",
            "net_quantity",
            "reference_type",
            "reference_id",
            "note",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "net_quantity", "created_at", "updated_at", "created_by")

    def validate(self, attrs):
        quantity_in = attrs.get("quantity_in", getattr(self.instance, "quantity_in", Decimal("0")))
        quantity_out = attrs.get("quantity_out", getattr(self.instance, "quantity_out", Decimal("0")))
        if quantity_in > Decimal("0") and quantity_out > Decimal("0"):
            raise serializers.ValidationError(
                "A stock movement cannot be both inbound and outbound."
            )
        if quantity_in == Decimal("0") and quantity_out == Decimal("0"):
            raise serializers.ValidationError(
                "A stock movement must include quantity in or quantity out."
            )
        return attrs


class InventoryBatchSerializer(serializers.ModelSerializer):
    is_depleted = serializers.BooleanField(read_only=True)

    class Meta:
        model = InventoryBatch
        fields = "__all__"
        read_only_fields = ("id", "is_depleted", "created_at", "updated_at", "created_by")


class StockTransferItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockTransferItem
        fields = "__all__"
        read_only_fields = ("id", "base_quantity", "created_at", "updated_at", "created_by")


class StockTransferSerializer(serializers.ModelSerializer):
    total_quantity = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = StockTransfer
        fields = "__all__"
        read_only_fields = (
            "id",
            "total_quantity",
            "inventory_changes_applied",
            "created_at",
            "updated_at",
            "created_by",
        )


class StockAdjustmentItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockAdjustmentItem
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class StockAdjustmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockAdjustment
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")

class ReorderRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReorderRule
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class StoreRequisitionItemSerializer(serializers.ModelSerializer):
    outstanding_quantity = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = StoreRequisitionItem
        fields = "__all__"
        read_only_fields = (
            "id",
            "base_quantity_requested",
            "outstanding_quantity",
            "created_at",
            "updated_at",
            "created_by",
        )


class StoreRequisitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = StoreRequisition
        fields = "__all__"
        read_only_fields = (
            "id",
            "requisition_no",
            "status",
            "approved_at",
            "issued_at",
            "created_at",
            "updated_at",
            "created_by",
        )


class StockIssueItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockIssueItem
        fields = "__all__"
        read_only_fields = ("id", "item", "base_quantity", "created_at", "updated_at", "created_by")


class StockIssueSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockIssue
        fields = "__all__"
        read_only_fields = (
            "id",
            "issue_no",
            "issue_date",
            "inventory_changes_applied",
            "created_at",
            "updated_at",
            "created_by",
        )


class StoreReturnItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = StoreReturnItem
        fields = "__all__"
        read_only_fields = ("id", "base_quantity", "created_at", "updated_at", "created_by")


class StoreReturnSerializer(serializers.ModelSerializer):
    class Meta:
        model = StoreReturn
        fields = "__all__"
        read_only_fields = (
            "id",
            "return_no",
            "return_date",
            "inventory_changes_applied",
            "created_at",
            "updated_at",
            "created_by",
        )


class StockCountItemSerializer(serializers.ModelSerializer):
    variance = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = StockCountItem
        fields = "__all__"
        read_only_fields = ("id", "variance", "created_at", "updated_at", "created_by")


class StockCountSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockCount
        fields = "__all__"
        read_only_fields = (
            "id",
            "count_no",
            "count_date",
            "status",
            "inventory_changes_applied",
            "created_at",
            "updated_at",
            "created_by",
        )
