from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count
from rest_framework import serializers

from apps.inventory.models import (
    Category,
    DepartmentConsumption,
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
from core.constants.choices import StoreRequisitionStatus


def validate_configured_item_unit(item, unit):
    if not item or not unit:
        return
    try:
        item.conversion_factor_for_unit(unit)
    except DjangoValidationError as error:
        detail = getattr(error, "message_dict", None) or getattr(error, "messages", None) or str(error)
        raise serializers.ValidationError(detail)


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
    base_unit_name = serializers.CharField(source="base_unit.name", read_only=True)

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
            "base_unit_name",
            "reorder_level",
            "maximum_level",
            "batch_tracking",
            "expiry_tracking",
            "business_type",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "created_at", "updated_at", "created_by")

    def validate(self, attrs):
        attrs = super().validate(attrs)
        base_unit = attrs.get("base_unit", getattr(self.instance, "base_unit", None))
        if not base_unit:
            raise serializers.ValidationError(
                {"base_unit": "Base unit is required."}
            )
        if self.instance and self.instance.base_unit_id and base_unit.pk != self.instance.base_unit_id:
            has_usage = (
                self.instance.unit_prices.exists()
                or self.instance.inventory_balances.exists()
                or self.instance.requisition_items.exists()
                or self.instance.store_requisition_items.exists()
            )
            if has_usage:
                raise serializers.ValidationError(
                    {"base_unit": "The base stock unit cannot change after conversions, stock, or transactions exist."}
                )
        attrs["unit"] = base_unit.abbreviation or base_unit.name
        return attrs


class ItemUnitPriceSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="item.name", read_only=True)
    item_sku = serializers.CharField(source="item.sku", read_only=True)
    unit_name = serializers.CharField(source="unit.name", read_only=True)
    unit_abbreviation = serializers.CharField(source="unit.abbreviation", read_only=True)
    base_unit_name = serializers.CharField(source="item.base_unit.name", read_only=True)
    base_equivalent = serializers.SerializerMethodField()

    class Meta:
        model = ItemUnitPrice
        fields = (
            "id", "item", "item_name", "item_sku", "unit", "unit_name",
            "unit_abbreviation", "base_unit_name", "conversion_factor", "role",
            "selling_price", "is_active", "base_equivalent", "created_at",
            "updated_at", "created_by",
        )
        read_only_fields = (
            "id", "item_name", "item_sku", "unit_name", "unit_abbreviation",
            "base_unit_name", "base_equivalent", "created_at", "updated_at", "created_by",
        )

    def get_base_equivalent(self, instance):
        factor = format(instance.conversion_factor, "f").rstrip("0").rstrip(".")
        base_unit = instance.item.base_unit
        if not base_unit:
            return "Invalid configuration: no base stock unit"
        return (
            f"1 {instance.unit.abbreviation or instance.unit.name} = "
            f"{factor} "
            f"{base_unit.abbreviation or base_unit.name}"
        )

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if self.instance and self.instance.is_used_in_transactions():
            protected = ("item", "unit", "conversion_factor", "role", "is_active")
            changed = any(
                field in attrs and attrs[field] != getattr(self.instance, field)
                for field in protected
            )
            if changed:
                raise serializers.ValidationError(
                    "This conversion is already used by a transaction and cannot be changed or deactivated. Add a new unit definition instead."
                )
        values = {
            "item": attrs.get("item", getattr(self.instance, "item", None)),
            "unit": attrs.get("unit", getattr(self.instance, "unit", None)),
            "conversion_factor": attrs.get("conversion_factor", getattr(self.instance, "conversion_factor", Decimal("1.0000"))),
            "role": attrs.get("role", getattr(self.instance, "role", "alternate")),
            "selling_price": attrs.get("selling_price", getattr(self.instance, "selling_price", Decimal("0.00"))),
            "is_active": attrs.get("is_active", getattr(self.instance, "is_active", True)),
        }
        candidate = ItemUnitPrice(**values)
        try:
            candidate.clean()
        except DjangoValidationError as error:
            detail = getattr(error, "message_dict", None) or getattr(error, "messages", None) or str(error)
            raise serializers.ValidationError(detail)
        return attrs


class StoreLocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = StoreLocation
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")

    def validate(self, attrs):
        branch = attrs.get("branch", getattr(self.instance, "branch", None))
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))
        is_default = attrs.get("is_default", getattr(self.instance, "is_default", False))
        if is_default and not branch:
            raise serializers.ValidationError(
                {"is_default": "A default issuing store must belong to a branch."}
            )
        if is_default and not is_active:
            raise serializers.ValidationError(
                {"is_default": "The default issuing store must be active."}
            )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        instance = super().create(validated_data)
        self._clear_other_defaults(instance)
        return instance

    @transaction.atomic
    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        self._clear_other_defaults(instance)
        return instance

    @staticmethod
    def _clear_other_defaults(instance):
        if not instance.is_default:
            return
        StoreLocation.objects.filter(
            branch=instance.branch,
            is_default=True,
        ).exclude(pk=instance.pk).update(is_default=False)


class InventoryBalanceSerializer(serializers.ModelSerializer):
    is_below_reorder = serializers.BooleanField(read_only=True)
    available_quantity = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = InventoryBalance
        fields = "__all__"
        read_only_fields = ("id", "is_below_reorder", "available_quantity", "created_at", "updated_at", "created_by")


class SupplierItemPriceSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    item_name = serializers.CharField(source="item.name", read_only=True)
    item_sku = serializers.CharField(source="item.sku", read_only=True)
    unit_name = serializers.CharField(source="unit.name", read_only=True)

    class Meta:
        model = SupplierItemPrice
        fields = (
            "id",
            "supplier",
            "supplier_name",
            "item",
            "item_name",
            "item_sku",
            "unit",
            "unit_name",
            "supplier_sku",
            "unit_price",
            "minimum_order_quantity",
            "lead_time_days",
            "is_preferred",
            "last_quoted_at",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = (
            "id", "supplier_name", "item_name", "item_sku", "unit_name",
            "created_at", "updated_at", "created_by",
        )

    def validate(self, attrs):
        attrs = super().validate(attrs)
        item = attrs.get("item", getattr(self.instance, "item", None))
        is_preferred = attrs.get(
            "is_preferred", getattr(self.instance, "is_preferred", False)
        )
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))
        if item and is_preferred and is_active:
            preferred = SupplierItemPrice.objects.filter(
                item=item, is_preferred=True, is_active=True
            )
            if self.instance:
                preferred = preferred.exclude(pk=self.instance.pk)
            if preferred.exists():
                raise serializers.ValidationError(
                    {"is_preferred": "This article already has an active preferred supplier."}
                )
        instance = self.instance or SupplierItemPrice(**attrs)
        for field, value in attrs.items():
            setattr(instance, field, value)
        instance.clean()
        return attrs


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

    def validate(self, attrs):
        attrs = super().validate(attrs)
        validate_configured_item_unit(
            attrs.get("item", getattr(self.instance, "item", None)),
            attrs.get("unit", getattr(self.instance, "unit", None)),
        )
        return attrs


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

    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = self.instance or StockAdjustmentItem(**attrs)
        for field, value in attrs.items():
            setattr(instance, field, value)
        try:
            instance.clean()
        except DjangoValidationError as error:
            detail = getattr(error, "message_dict", None) or getattr(error, "messages", None) or str(error)
            raise serializers.ValidationError(detail)
        return attrs


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
    category_name = serializers.CharField(source="item.category.name", read_only=True)
    item_name = serializers.CharField(source="item.name", read_only=True)
    shortage_quantity = serializers.SerializerMethodField()
    line_status = serializers.SerializerMethodField()

    def get_shortage_quantity(self, obj):
        approved = obj.quantity_approved or Decimal("0.00")
        issued = obj.quantity_issued or Decimal("0.00")
        remaining = max(Decimal("0.00"), approved - issued)
        if remaining <= 0:
            return Decimal("0.00")
        balance = InventoryBalance.objects.filter(
            item=obj.item,
            store=obj.requisition.store,
        ).first()
        available = balance.available_quantity if balance else Decimal("0.00")
        return max(Decimal("0.00"), remaining - available)

    def get_line_status(self, obj):
        requested = obj.base_quantity_requested or Decimal("0.00")
        approved = obj.quantity_approved or Decimal("0.00")
        issued = obj.quantity_issued or Decimal("0.00")
        request_status = obj.requisition.status
        if issued >= approved > 0:
            return "issued"
        if issued > 0:
            return "partially_issued"
        if request_status in (StoreRequisitionStatus.DRAFT, StoreRequisitionStatus.REJECTED):
            return "draft"
        if request_status == StoreRequisitionStatus.PENDING_DEPARTMENT_APPROVAL:
            return "pending_department_approval"
        if approved == 0 and request_status == StoreRequisitionStatus.SUBMITTED:
            return "pending_stores_review"
        if approved < requested:
            return "partially_approved"
        if approved > 0:
            return "approved"
        return str(request_status)

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

    def validate(self, attrs):
        requisition = attrs.get("requisition") or getattr(self.instance, "requisition", None)
        item = attrs.get("item") or getattr(self.instance, "item", None)
        validate_configured_item_unit(
            item,
            attrs.get("unit", getattr(self.instance, "unit", None)),
        )
        if not requisition:
            return attrs
        if self.instance and requisition.status == StoreRequisitionStatus.SUBMITTED:
            disallowed = set(attrs) - {"quantity_approved", "remarks"}
            if disallowed:
                raise serializers.ValidationError(
                    "Only the approved quantity and decision comment can change during approval."
                )
        elif requisition.status not in (
            StoreRequisitionStatus.DRAFT,
            StoreRequisitionStatus.REJECTED,
        ):
            raise serializers.ValidationError(
                "Store request lines can only be changed while draft or during submitted line approval."
            )
        duplicate = StoreRequisitionItem.objects.filter(
            requisition=requisition, item=item, unit=attrs.get("unit", getattr(self.instance, "unit", None))
        )
        if self.instance:
            duplicate = duplicate.exclude(pk=self.instance.pk)
        if item and duplicate.exists():
            raise serializers.ValidationError(
                {"item": "This Article is already on the store request. Edit the existing line instead."}
            )
        return attrs


class StoreRequisitionSerializer(serializers.ModelSerializer):
    store = serializers.PrimaryKeyRelatedField(
        queryset=StoreLocation.objects.filter(is_active=True), required=False
    )
    class Meta:
        model = StoreRequisition
        fields = "__all__"
        read_only_fields = (
            "id",
            "requisition_no",
            "status",
            "approved_at",
            "issued_at",
            "department_approved_at",
            "department_approved_by",
            "procurement_requisition",
            "created_at",
            "updated_at",
            "created_by",
        )

    def validate(self, attrs):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return attrs

        user = request.user
        can_request_on_behalf = user.is_superuser or user.groups.filter(
            name__in=("System Administrator", "Stores Manager")
        ).exists()
        if can_request_on_behalf:
            if not attrs.get("store", getattr(self.instance, "store", None)):
                raise serializers.ValidationError({"store": "Select the issuing store."})
            return attrs

        employee = getattr(user, "employee_profile", None)
        if not employee:
            raise serializers.ValidationError(
                "Your account is not connected to an employee profile."
            )
        if not employee.department_id:
            raise serializers.ValidationError(
                "Your employee profile is not assigned to a department."
            )
        if not employee.branch_id:
            raise serializers.ValidationError(
                "Your employee profile is not assigned to a branch."
            )

        store = attrs.get("store", getattr(self.instance, "store", None))
        if self.instance is None:
            store = StoreLocation.objects.filter(
                branch=employee.branch, is_active=True, is_default=True
            ).first() or StoreLocation.objects.filter(
                branch=employee.branch, is_active=True
            ).order_by("name").first()
            if not store:
                raise serializers.ValidationError(
                    {"store": "No active issuing store is configured for your branch."}
                )
            attrs["store"] = store
        if store and employee.branch_id and store.branch_id != employee.branch_id:
            raise serializers.ValidationError(
                {"store": "Select a store in your assigned branch."}
            )
        attrs["department"] = employee.department
        attrs["requested_by"] = employee
        return attrs


class StockIssueItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockIssueItem
        fields = "__all__"
        read_only_fields = ("id", "item", "base_quantity", "created_at", "updated_at", "created_by")

    def validate(self, attrs):
        attrs = super().validate(attrs)
        requisition_item = attrs.get(
            "requisition_item", getattr(self.instance, "requisition_item", None)
        )
        item = requisition_item.item if requisition_item else None
        validate_configured_item_unit(
            item,
            attrs.get("unit", getattr(self.instance, "unit", None)),
        )
        return attrs


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

    def validate(self, attrs):
        attrs = super().validate(attrs)
        validate_configured_item_unit(
            attrs.get("item", getattr(self.instance, "item", None)),
            attrs.get("unit", getattr(self.instance, "unit", None)),
        )
        return attrs


class DepartmentConsumptionSerializer(serializers.ModelSerializer):
    total_cost = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = DepartmentConsumption
        fields = "__all__"
        read_only_fields = (
            "id", "total_cost", "created_at", "updated_at", "created_by",
        )


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
