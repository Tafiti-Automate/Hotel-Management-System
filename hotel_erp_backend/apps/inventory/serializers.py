from decimal import Decimal

from django.db.models import Count
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
    parent_name = serializers.CharField(source="parent.name", read_only=True)
    children_count = serializers.SerializerMethodField()
    item_count = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = (
            "id",
            "name",
            "code",
            "parent",
            "parent_name",
            "description",
            "is_active",
            "children_count",
            "item_count",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = (
            "id",
            "parent_name",
            "children_count",
            "item_count",
            "created_at",
            "updated_at",
            "created_by",
        )

    def _category_stats(self):
        if hasattr(self, "_cached_category_stats"):
            return self._cached_category_stats

        parent_by_id = dict(Category.objects.values_list("id", "parent_id"))
        children_by_id = {category_id: [] for category_id in parent_by_id}
        for category_id, parent_id in parent_by_id.items():
            if parent_id in children_by_id:
                children_by_id[parent_id].append(category_id)

        direct_counts = dict(
            Item.objects.values("category_id")
            .annotate(total=Count("id"))
            .values_list("category_id", "total")
        )
        totals = {}

        def total_for(category_id, path=None):
            if category_id in totals:
                return totals[category_id]
            path = set(path or ())
            if category_id in path:
                return direct_counts.get(category_id, 0)
            path.add(category_id)
            total = direct_counts.get(category_id, 0) + sum(
                total_for(child_id, path) for child_id in children_by_id[category_id]
            )
            totals[category_id] = total
            return total

        for category_id in parent_by_id:
            total_for(category_id)

        self._cached_category_stats = (children_by_id, totals)
        return self._cached_category_stats

    def get_children_count(self, category):
        children_by_id, _ = self._category_stats()
        return len(children_by_id.get(category.id, ()))

    def get_item_count(self, category):
        _, totals = self._category_stats()
        return totals.get(category.id, 0)

    def validate_code(self, value):
        code = value.strip().upper()
        matching_codes = Category.objects.filter(code__iexact=code)
        if self.instance:
            matching_codes = matching_codes.exclude(pk=self.instance.pk)
        if code and matching_codes.exists():
            raise serializers.ValidationError("A category with this code already exists.")
        return code

    def validate(self, attrs):
        attrs = super().validate(attrs)
        parent = attrs.get("parent", getattr(self.instance, "parent", None))
        if not self.instance or not parent:
            return attrs

        ancestor = parent
        visited = set()
        while ancestor and ancestor.pk not in visited:
            if ancestor.pk == self.instance.pk:
                raise serializers.ValidationError(
                    {"parent": "A category cannot be its own parent or descendant."}
                )
            visited.add(ancestor.pk)
            ancestor = ancestor.parent
        return attrs


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
            "business_type",
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
    current_stock = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    needs_reorder = serializers.BooleanField(read_only=True)

    class Meta:
        model = ReorderRule
        fields = "__all__"
        read_only_fields = (
            "id",
            "current_stock",
            "needs_reorder",
            "created_at",
            "updated_at",
            "created_by",
        )


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
