from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import models, transaction
from django.db.models import Count
from django.utils import timezone
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
    SupplierItemPriceHistory,
    StoreKeeperAssignment,
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
    hierarchy_level = serializers.IntegerField(read_only=True)
    group_type = serializers.CharField(read_only=True)
    hierarchy_path = serializers.CharField(read_only=True)
    children_count = serializers.SerializerMethodField()
    direct_item_count = serializers.SerializerMethodField()
    item_count = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = (
            "id",
            "name",
            "code",
            "parent",
            "parent_name",
            "hierarchy_level",
            "group_type",
            "hierarchy_path",
            "description",
            "is_active",
            "children_count",
            "direct_item_count",
            "item_count",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = (
            "id",
            "parent_name",
            "hierarchy_level",
            "group_type",
            "hierarchy_path",
            "children_count",
            "direct_item_count",
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

        self._cached_category_stats = (children_by_id, direct_counts, totals)
        return self._cached_category_stats

    def get_children_count(self, category):
        children_by_id, _, _ = self._category_stats()
        return len(children_by_id.get(category.id, ()))

    def get_direct_item_count(self, category):
        _, direct_counts, _ = self._category_stats()
        return direct_counts.get(category.id, 0)

    def get_item_count(self, category):
        _, _, totals = self._category_stats()
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
        if parent and parent.parent_id:
            raise serializers.ValidationError(
                {
                    "parent": (
                        "Choose a major group as the parent. "
                        "The catalogue supports Major Group → Item Group → Items."
                    )
                }
            )
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
    base_unit_locked = serializers.SerializerMethodField()

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
            "base_unit_locked",
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
        read_only_fields = (
            "id",
            "base_unit_locked",
            "created_at",
            "updated_at",
            "created_by",
        )

    def get_base_unit_locked(self, instance):
        return instance.has_base_unit_usage()

    def validate(self, attrs):
        attrs = super().validate(attrs)
        category = attrs.get("category", getattr(self.instance, "category", None))
        if not category:
            raise serializers.ValidationError(
                {"category": "Choose an Item Group before saving this item."}
            )
        if not category.parent_id:
            raise serializers.ValidationError(
                {
                    "category": (
                        "Items cannot be attached directly to a Major Group. "
                        "Choose an Item Group under the required Major Group."
                    )
                }
            )
        base_unit = attrs.get("base_unit", getattr(self.instance, "base_unit", None))
        if not base_unit:
            raise serializers.ValidationError(
                {"base_unit": "Base unit is required."}
            )
        if self.instance and self.instance.base_unit_id and base_unit.pk != self.instance.base_unit_id:
            if self.instance.has_base_unit_usage():
                raise serializers.ValidationError(
                    {
                        "base_unit": (
                            "The base stock unit cannot change after conversions, stock, or transactions exist. "
                            "Configure a purchase, issue, or alternate unit under Article Unit Conversions instead."
                        )
                    }
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


class StoreKeeperAssignmentSerializer(serializers.ModelSerializer):
    store_name = serializers.CharField(source="store.name", read_only=True)
    employee_name = serializers.SerializerMethodField()

    class Meta:
        model = StoreKeeperAssignment
        fields = (
            "id", "store", "store_name", "employee", "employee_name", "is_active",
            "created_at", "updated_at", "created_by",
        )
        read_only_fields = ("id", "store_name", "employee_name", "created_at", "updated_at", "created_by")

    def get_employee_name(self, assignment):
        return assignment.employee.user.get_full_name() or assignment.employee.user.username

    def validate(self, attrs):
        instance = self.instance or StoreKeeperAssignment(**attrs)
        for field, value in attrs.items():
            setattr(instance, field, value)
        try:
            instance.clean()
        except DjangoValidationError as error:
            detail = getattr(error, "message_dict", None) or getattr(error, "messages", None) or str(error)
            raise serializers.ValidationError(detail)
        return attrs


class InventoryBalanceSerializer(serializers.ModelSerializer):
    is_below_reorder = serializers.BooleanField(read_only=True)
    available_quantity = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    reserved_allocations = serializers.SerializerMethodField()
    calculated_reserved_quantity = serializers.SerializerMethodField()
    reservation_variance = serializers.SerializerMethodField()

    def get_reserved_allocations(self, balance):
        cache = getattr(self, "_reserved_allocations_cache", {})
        if balance.pk in cache:
            return cache[balance.pk]
        lines = StoreRequisitionItem.objects.filter(
            item=balance.item,
            requisition__store=balance.store,
            requisition__status__in=(
                StoreRequisitionStatus.APPROVED,
                StoreRequisitionStatus.PARTIALLY_APPROVED,
                StoreRequisitionStatus.PARTIALLY_ISSUED,
            ),
            quantity_approved__gt=models.F("quantity_issued"),
        ).select_related("requisition", "requisition__department", "requisition__requested_by")
        allocations = [
            {
                "request_id": str(line.requisition_id),
                "request_number": line.requisition.requisition_no,
                "department": line.requisition.department.name,
                "requester": str(line.requisition.requested_by),
                "approved_quantity": line.quantity_approved,
                "issued_quantity": line.quantity_issued,
                "outstanding_quantity": line.outstanding_quantity,
                "status": line.requisition.status,
            }
            for line in lines
        ]
        cache[balance.pk] = allocations
        self._reserved_allocations_cache = cache
        return allocations

    def get_calculated_reserved_quantity(self, balance):
        return sum(
            (row["outstanding_quantity"] for row in self.get_reserved_allocations(balance)),
            Decimal("0.00"),
        )

    def get_reservation_variance(self, balance):
        return balance.quantity_reserved - self.get_calculated_reserved_quantity(balance)

    class Meta:
        model = InventoryBalance
        fields = "__all__"
        read_only_fields = ("id", "is_below_reorder", "available_quantity", "reserved_allocations", "calculated_reserved_quantity", "reservation_variance", "created_at", "updated_at", "created_by")


class SupplierItemPriceSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    item_name = serializers.CharField(source="item.name", read_only=True)
    item_sku = serializers.CharField(source="item.sku", read_only=True)
    unit_name = serializers.CharField(source="unit.name", read_only=True)
    category_id = serializers.UUIDField(source="item.category_id", read_only=True)
    category_name = serializers.CharField(source="item.category.name", read_only=True)
    base_unit_price = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    is_lowest = serializers.SerializerMethodField()
    history_count = serializers.IntegerField(source="price_history.count", read_only=True)

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
            "category_id",
            "category_name",
            "supplier_sku",
            "unit_price",
            "base_unit_price",
            "currency",
            "effective_from",
            "minimum_order_quantity",
            "lead_time_days",
            "is_preferred",
            "is_lowest",
            "history_count",
            "last_quoted_at",
            "quotation_reference",
            "quotation_valid_until",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = (
            "id", "supplier_name", "item_name", "item_sku", "unit_name",
            "category_id", "category_name", "base_unit_price", "is_lowest", "history_count",
            "created_at", "updated_at", "created_by",
        )

    def validate(self, attrs):
        attrs = super().validate(attrs)
        supplier = attrs.get("supplier", getattr(self.instance, "supplier", None))
        item = attrs.get("item", getattr(self.instance, "item", None))
        if supplier and item:
            duplicate = SupplierItemPrice.objects.filter(supplier=supplier, item=item)
            if self.instance:
                duplicate = duplicate.exclude(pk=self.instance.pk)
            if duplicate.exists():
                raise serializers.ValidationError({
                    "item": "This supplier already has a quotation for this article. Edit the existing quotation instead."
                })
        instance = self.instance or SupplierItemPrice(**attrs)
        for field, value in attrs.items():
            setattr(instance, field, value)
        instance.clean()
        return attrs

    def get_is_lowest(self, obj):
        if not obj.is_active:
            return False
        candidates = SupplierItemPrice.objects.filter(item=obj.item, is_active=True).select_related("item", "unit")
        return obj.base_unit_price == min(price.base_unit_price for price in candidates)

    @transaction.atomic
    def update(self, instance, validated_data):
        old_price = instance.unit_price
        price_changed = "unit_price" in validated_data and validated_data["unit_price"] != old_price
        if price_changed:
            request = self.context.get("request")
            SupplierItemPriceHistory.objects.create(
                supplier_item_price=instance,
                supplier=instance.supplier,
                item=instance.item,
                unit=instance.unit,
                unit_price=old_price,
                currency=instance.currency,
                effective_from=instance.effective_from,
                effective_to=timezone.localdate(),
                changed_by=request.user if request and request.user.is_authenticated else None,
            )
            validated_data.setdefault("effective_from", timezone.localdate())
        return super().update(instance, validated_data)


class SupplierItemPriceHistorySerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    item_name = serializers.CharField(source="item.name", read_only=True)
    unit_name = serializers.CharField(source="unit.name", read_only=True)
    changed_by_name = serializers.CharField(source="changed_by.get_full_name", read_only=True)

    class Meta:
        model = SupplierItemPriceHistory
        fields = "__all__"
        read_only_fields = tuple(field.name for field in SupplierItemPriceHistory._meta.fields)


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
        requested = obj.department_approved_limit or Decimal("0.00")
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
            "hod_approved_quantity",
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
            disallowed = set(attrs) - {"quantity_approved", "storekeeper_comment"}
            if disallowed:
                raise serializers.ValidationError(
                    "Only the Store Keeper quantity and note can change at this stage."
                )
            if "quantity_approved" in attrs:
                hod_limit = self.instance.department_approved_limit
                if attrs["quantity_approved"] > hod_limit:
                    raise serializers.ValidationError({
                        "quantity_approved": f"Quantity cannot exceed the HOD-approved quantity ({hod_limit})."
                    })
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
        queryset=StoreLocation.objects.filter(is_active=True), required=False, allow_null=True
    )
    store_name = serializers.SerializerMethodField()
    store_address = serializers.SerializerMethodField()

    def get_store_name(self, obj):
        return obj.store.name if obj.store_id else ""

    def get_store_address(self, obj):
        return obj.store.address if obj.store_id else ""

    class Meta:
        model = StoreRequisition
        fields = "__all__"
        extra_kwargs = {
            # Department requesters are always resolved from the authenticated
            # employee profile in validate(); clients must not have to submit
            # (or be able to impersonate) either relationship.
            "department": {"required": False},
            "requested_by": {"required": False},
        }
        read_only_fields = (
            "id",
            "requisition_no",
            "status",
            "approved_by",
            "approved_at",
            "issued_at",
            "department_approved_at",
            "department_approved_by",
            "department_approval_comments",
            "approval_comments",
            "rejection_reason",
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
            name="System Administrator"
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
        if store and store.branch_id != employee.branch_id:
            raise serializers.ValidationError(
                {"store": "Choose an issuing store from your assigned branch."}
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
