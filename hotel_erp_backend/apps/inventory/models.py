from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone

from core.constants.choices import (
    ArticleUnitRole,
    ItemBusinessType,
    LedgerReferenceType,
    StockAdjustmentStatus,
    StockCountStatus,
    StockTransferStatus,
    StoreRequisitionStatus,
)
from core.mixins.models import BaseModel
from core.validators.quantities import (
    validate_non_negative_decimal,
    validate_positive_decimal,
)


class Category(BaseModel):
    name = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=30, unique=True, blank=True)
    parent = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        related_name="children",
        null=True,
        blank=True,
    )
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        verbose_name_plural = "categories"
        ordering = ("name",)
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(id=models.F("parent_id")),
                name="category_cannot_parent_itself",
            )
        ]

    def clean(self):
        super().clean()
        ancestor = self.parent
        visited = {self.pk}
        while ancestor:
            if ancestor.pk in visited:
                raise ValidationError(
                    {"parent": "A category cannot be its own parent or descendant."}
                )
            visited.add(ancestor.pk)
            ancestor = ancestor.parent

    @classmethod
    def next_code(cls, name, exclude_id=None):
        base = "".join(character for character in name.upper() if character.isalnum())[:3]
        base = base or "CAT"
        candidate = base
        suffix = 2
        existing = cls.objects.all()
        if exclude_id:
            existing = existing.exclude(pk=exclude_id)
        while existing.filter(code=candidate).exists():
            candidate = f"{base}-{suffix}"
            suffix += 1
        return candidate

    def save(self, *args, **kwargs):
        self.code = (
            self.code.strip().upper()
            if self.code
            else self.next_code(self.name, exclude_id=self.pk)
        )
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class UnitOfMeasure(BaseModel):
    name = models.CharField(max_length=50, unique=True)
    abbreviation = models.CharField(max_length=10)
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        ordering = ("name",)

    def __str__(self):
        return self.name


class Item(BaseModel):
    category = models.ForeignKey(
        Category,
        on_delete=models.PROTECT,
        related_name="items",
    )
    name = models.CharField(max_length=255)
    sku = models.CharField(max_length=50, unique=True, blank=True)
    brand = models.CharField(max_length=80, blank=True)
    description = models.TextField(blank=True)
    barcode = models.CharField(max_length=100, unique=True, blank=True, null=True)
    unit = models.CharField(max_length=50)
    base_unit = models.ForeignKey(
        UnitOfMeasure,
        on_delete=models.PROTECT,
        related_name="base_items",
        null=True,
        blank=True,
    )
    reorder_level = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[validate_non_negative_decimal],
    )
    maximum_level = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[validate_non_negative_decimal],
        help_text="Optional maximum stock holding in base units.",
    )
    batch_tracking = models.BooleanField(default=False)
    expiry_tracking = models.BooleanField(default=False)
    business_type = models.CharField(
        max_length=30,
        choices=ItemBusinessType.choices,
        default=ItemBusinessType.CONSUMABLE_EXPENSE,
        help_text="Classifies whether the item is an operating expense, revenue/resale item, fixed asset, or service supply.",
    )
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        ordering = ("name",)

    def __str__(self):
        return f"{self.name} ({self.sku})"

    def save(self, *args, **kwargs):
        if not self.sku:
            prefix = "ITM"
            if self.category_id and self.category.name:
                prefix = self.category.name[:3].upper()
            last_item = (
                Item.objects.filter(sku__startswith=f"{prefix}-")
                .order_by("sku")
                .last()
            )
            next_number = 1
            if last_item and last_item.sku:
                try:
                    next_number = int(last_item.sku.split("-")[1]) + 1
                except (IndexError, ValueError):
                    next_number = 1
            self.sku = f"{prefix}-{next_number:04d}"
        super().save(*args, **kwargs)

    def clean(self):
        super().clean()
        if (
            self.maximum_level is not None
            and self.maximum_level < self.reorder_level
        ):
            raise ValidationError(
                {"maximum_level": "Maximum level cannot be lower than the reorder level."}
            )

    def has_base_unit_usage(self):
        """Return whether changing the counting unit would rewrite operational history."""
        if not self.pk:
            return False
        annotation_names = (
            "_has_unit_price_usage",
            "_has_inventory_balance_usage",
            "_has_purchase_requisition_usage",
            "_has_store_requisition_usage",
        )
        if all(hasattr(self, name) for name in annotation_names):
            return any(getattr(self, name) for name in annotation_names)
        return (
            self.unit_prices.exists()
            or self.inventory_balances.exists()
            or self.requisition_items.exists()
            or self.store_requisition_items.exists()
        )

    def conversion_factor_for_unit(self, unit):
        """Return an explicit, active conversion into this article's base stock unit."""
        if unit is None:
            return Decimal("1.0000")
        if not self.base_unit_id:
            raise ValidationError(
                {"unit": f"Configure a base stock unit for {self.name} before using another unit."}
            )
        if unit.pk == self.base_unit_id:
            return Decimal("1.0000")
        configured = self.unit_prices.filter(unit=unit, is_active=True).first()
        if not configured:
            raise ValidationError(
                {
                    "unit": (
                        f"{unit} is not an active configured unit for {self.name}. "
                        f"Add an Article unit conversion before using it."
                    )
                }
            )
        return configured.conversion_factor

    def quantity_in_base_units(self, quantity, unit=None):
        return (quantity or Decimal("0.00")) * self.conversion_factor_for_unit(unit)


class ItemUnitPrice(BaseModel):
    item = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        related_name="unit_prices",
    )
    unit = models.ForeignKey(
        UnitOfMeasure,
        on_delete=models.PROTECT,
        related_name="item_prices",
    )
    conversion_factor = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        default=Decimal("1.0000"),
        validators=[validate_positive_decimal],
        help_text="Number of base units represented by one selected unit.",
    )
    role = models.CharField(
        max_length=20,
        choices=ArticleUnitRole.choices,
        default=ArticleUnitRole.ALTERNATE,
    )
    selling_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_non_negative_decimal],
        default=Decimal("0.00"),
    )
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("item", "unit"),
                name="unique_item_unit_price",
            )
            ,
            models.UniqueConstraint(
                fields=("item", "role"),
                condition=models.Q(role__in=(ArticleUnitRole.PURCHASE, ArticleUnitRole.ISSUE)),
                name="unique_primary_article_unit_role",
            ),
        ]
        ordering = ("item__name", "conversion_factor")

    def __str__(self):
        return f"{self.item} - {self.unit} x {self.conversion_factor}"

    def is_used_in_transactions(self):
        if not self.item_id or not self.unit_id:
            return False
        related_names = (
            "requisition_items",
            "quotation_items",
            "purchase_order_items",
            "supplier_return_items",
            "stock_transfer_items",
            "stock_adjustment_items",
            "store_requisition_items",
            "stock_issue_items",
            "store_return_items",
            "sale_items",
        )
        for related_name in related_names:
            manager = getattr(self.item, related_name, None)
            if manager is not None and manager.filter(unit_id=self.unit_id).exists():
                return True
        return False

    def clean(self):
        super().clean()
        if not self.item_id or not self.unit_id:
            return
        if not self.item.base_unit_id:
            raise ValidationError(
                {"item": "Set the article base stock unit before adding purchase or issue conversions."}
            )
        is_base_unit = self.unit_id == self.item.base_unit_id
        if is_base_unit and self.conversion_factor != Decimal("1.0000"):
            raise ValidationError(
                {"conversion_factor": "The base unit conversion factor must be 1."}
            )
        if is_base_unit and self.role != ArticleUnitRole.BASE:
            raise ValidationError(
                {"role": "The article base stock unit must use the Base unit role."}
            )
        if not is_base_unit and self.role == ArticleUnitRole.BASE:
            raise ValidationError(
                {"role": "Only the article's configured base stock unit can use the Base unit role."}
            )
        if not is_base_unit and self.conversion_factor <= Decimal("1.0000"):
            raise ValidationError(
                {
                    "conversion_factor": (
                        "A purchase, issue, or alternate unit must contain more than one base unit. "
                        "If it is smaller, choose a smaller base stock unit first."
                    )
                }
            )


class StoreLocation(BaseModel):
    branch = models.ForeignKey(
        "departments.Branch",
        on_delete=models.PROTECT,
        related_name="store_locations",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=100)
    address = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("branch", "name"),
                name="unique_branch_store_location",
            )
        ]
        ordering = ("branch__name", "name")

    def __str__(self):
        if self.branch:
            return f"{self.name} ({self.branch.name})"
        return self.name


class StoreKeeperAssignment(BaseModel):
    """Explicit operational ownership for a store.

    Store access is intentionally assigned per employee rather than inferred
    from the Store Keeper role.  A hotel can therefore operate several stores
    without exposing one store's requests or balances to another keeper.
    """

    store = models.ForeignKey(
        StoreLocation,
        on_delete=models.CASCADE,
        related_name="keeper_assignments",
    )
    employee = models.ForeignKey(
        "employees.Employee",
        on_delete=models.CASCADE,
        related_name="store_keeper_assignments",
    )
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("store", "employee"),
                name="unique_store_keeper_assignment",
            )
        ]
        ordering = ("store__name", "employee__user__username")

    def clean(self):
        super().clean()
        if self.store_id and self.employee_id:
            if self.store.branch_id and self.employee.branch_id and self.store.branch_id != self.employee.branch_id:
                raise ValidationError(
                    {"employee": "The Store Keeper must belong to the same branch as the store."}
                )

    def __str__(self):
        return f"{self.employee} → {self.store}"


class InventoryBalance(BaseModel):
    item = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        related_name="inventory_balances",
    )
    store = models.ForeignKey(
        StoreLocation,
        on_delete=models.CASCADE,
        related_name="inventory_balances",
    )
    quantity_in_stock = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    quantity_reserved = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    reorder_level = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    last_updated = models.DateTimeField(auto_now=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("item", "store"),
                name="unique_item_store_inventory_balance",
            )
        ]
        ordering = ("store__name", "item__name")

    @property
    def is_below_reorder(self):
        return self.quantity_in_stock <= self.reorder_level

    @property
    def available_quantity(self):
        return max(self.quantity_in_stock - self.quantity_reserved, Decimal("0.00"))

    def __str__(self):
        return f"{self.item} @ {self.store}: {self.quantity_in_stock}"


class SupplierItemPrice(BaseModel):
    supplier = models.ForeignKey(
        "vendors.Supplier",
        on_delete=models.CASCADE,
        related_name="item_prices",
    )
    item = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        related_name="supplier_prices",
    )
    unit = models.ForeignKey(
        UnitOfMeasure,
        on_delete=models.PROTECT,
        related_name="supplier_item_prices",
        null=True,
        blank=True,
    )
    supplier_sku = models.CharField(
        max_length=80,
        blank=True,
        help_text="Supplier's own catalogue or product reference.",
    )
    unit_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    minimum_order_quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("1.00"),
        validators=[validate_positive_decimal],
    )
    lead_time_days = models.PositiveIntegerField(default=0)
    is_preferred = models.BooleanField(default=False)
    last_quoted_at = models.DateField(null=True, blank=True)
    quotation_reference = models.CharField(
        max_length=100,
        blank=True,
        help_text="Supplier quotation number or reference for this quoted price.",
    )
    quotation_valid_until = models.DateField(
        null=True,
        blank=True,
        help_text="Expiry date stated on the supplier quotation.",
    )
    effective_from = models.DateField(default=timezone.localdate)
    currency = models.CharField(max_length=10, default="UGX")
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("supplier", "item"),
                name="unique_supplier_item_price",
            ),
        ]
        ordering = ("item__name", "supplier__name")

    def __str__(self):
        return f"{self.supplier} - {self.item}: {self.unit_price}"

    def clean(self):
        super().clean()
        if self.unit_id and self.item_id:
            valid_unit = (
                self.item.base_unit_id == self.unit_id
                or ItemUnitPrice.objects.filter(
                    item_id=self.item_id,
                    unit_id=self.unit_id,
                    is_active=True,
                ).exists()
            )
            if not valid_unit:
                raise ValidationError(
                    {"unit": "Choose the article base unit or an active configured purchase unit."}
                )
        if (
            self.quotation_valid_until
            and self.effective_from
            and self.quotation_valid_until < self.effective_from
        ):
            raise ValidationError(
                {"quotation_valid_until": "The quotation expiry cannot be before its effective date."}
            )

    @property
    def base_unit_price(self):
        """Comparable price expressed in the article's base stock unit."""
        factor = self.item.conversion_factor_for_unit(self.unit)
        return (self.unit_price / factor).quantize(Decimal("0.01"))


class SupplierItemPriceHistory(BaseModel):
    """Immutable snapshot retained whenever a supplier catalogue price changes."""

    supplier_item_price = models.ForeignKey(
        SupplierItemPrice,
        on_delete=models.PROTECT,
        related_name="price_history",
    )
    supplier = models.ForeignKey("vendors.Supplier", on_delete=models.PROTECT)
    item = models.ForeignKey(Item, on_delete=models.PROTECT)
    unit = models.ForeignKey(UnitOfMeasure, on_delete=models.PROTECT, null=True, blank=True)
    unit_price = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=10, default="UGX")
    effective_from = models.DateField()
    effective_to = models.DateField()
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="supplier_price_changes",
    )
    source = models.CharField(max_length=30, default="manual")

    class Meta(BaseModel.Meta):
        ordering = ("-effective_to", "-created_at")

    def __str__(self):
        return f"{self.supplier} - {self.item}: {self.unit_price} until {self.effective_to}"


class StockLedger(BaseModel):
    item = models.ForeignKey(
        Item,
        on_delete=models.PROTECT,
        related_name="stock_movements",
    )
    store = models.ForeignKey(
        StoreLocation,
        on_delete=models.PROTECT,
        related_name="stock_movements",
        null=True,
        blank=True,
    )
    quantity_in = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    quantity_out = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    reference_type = models.CharField(
        max_length=50,
        choices=LedgerReferenceType.choices,
    )
    reference_id = models.UUIDField()
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    @property
    def net_quantity(self):
        return self.quantity_in - self.quantity_out

    def clean(self):
        super().clean()
        if self.quantity_in > Decimal("0") and self.quantity_out > Decimal("0"):
            raise ValidationError("A stock movement cannot be both inbound and outbound.")
        if self.quantity_in == Decimal("0") and self.quantity_out == Decimal("0"):
            raise ValidationError("A stock movement must include quantity in or quantity out.")

    def __str__(self):
        direction = "IN" if self.quantity_in else "OUT"
        quantity = self.quantity_in or self.quantity_out
        return f"{self.item} {direction} {quantity}"


class InventoryBatch(BaseModel):
    item = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        related_name="inventory_batches",
    )
    store = models.ForeignKey(
        StoreLocation,
        on_delete=models.CASCADE,
        related_name="inventory_batches",
    )
    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    remaining_quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[validate_non_negative_decimal],
    )
    unit_cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_non_negative_decimal],
    )
    received_date = models.DateField(auto_now_add=True)
    expiry_date = models.DateField(null=True, blank=True)
    purchase_order_item = models.ForeignKey(
        "procurement.PurchaseOrderItem",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inventory_batches",
    )

    class Meta(BaseModel.Meta):
        ordering = ("expiry_date", "received_date")

    @property
    def is_depleted(self):
        return self.remaining_quantity <= Decimal("0")

    def __str__(self):
        return f"{self.item} batch @ {self.store}: {self.remaining_quantity}/{self.quantity}"


class StockTransfer(BaseModel):
    from_store = models.ForeignKey(
        StoreLocation,
        on_delete=models.PROTECT,
        related_name="transfers_out",
    )
    to_store = models.ForeignKey(
        StoreLocation,
        on_delete=models.PROTECT,
        related_name="transfers_in",
    )
    requested_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="stock_transfer_requests",
        null=True,
        blank=True,
    )
    approved_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.SET_NULL,
        related_name="approved_stock_transfers",
        null=True,
        blank=True,
    )
    status = models.CharField(
        max_length=20,
        choices=StockTransferStatus.choices,
        default=StockTransferStatus.PENDING,
    )
    required_date = models.DateField(null=True, blank=True)
    note = models.TextField(blank=True)
    inventory_changes_applied = models.BooleanField(default=False)
    approved_at = models.DateTimeField(null=True, blank=True)
    dispatched_by = models.ForeignKey(
        "employees.Employee", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="dispatched_stock_transfers",
    )
    dispatched_at = models.DateTimeField(null=True, blank=True)
    received_by = models.ForeignKey(
        "employees.Employee", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="received_stock_transfers",
    )
    received_at = models.DateTimeField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    @property
    def total_quantity(self):
        return sum(item.base_quantity for item in self.items.all())

    def clean(self):
        super().clean()
        if self.from_store_id and self.to_store_id and self.from_store_id == self.to_store_id:
            raise ValidationError("Source and destination stores must be different.")

    def apply_inventory_changes(self):
        """Compatibility operation that dispatches and receives immediately."""
        if self.status == StockTransferStatus.PENDING:
            self.dispatch(require_approval=False)
        self.receive()

    def approve(self, approved_by=None):
        if self.status != StockTransferStatus.PENDING:
            raise ValidationError("Only a pending transfer can be approved.")
        if not self.items.exists():
            raise ValidationError("Add at least one item before approving the transfer.")
        self.approved_by = approved_by or self.approved_by
        if not self.approved_by_id:
            raise ValidationError("An approving employee is required.")
        self.approved_at = timezone.now()
        self.save(update_fields=["approved_by", "approved_at", "updated_at"])

    def dispatch(self, dispatched_by=None, require_approval=True):
        if self.inventory_changes_applied:
            raise ValidationError("Inventory changes have already been applied.")
        if self.status != StockTransferStatus.PENDING:
            raise ValidationError("Only a pending transfer can be dispatched.")
        if require_approval and not self.approved_by_id:
            raise ValidationError("The transfer must be approved before dispatch.")

        with transaction.atomic():
            transfer = StockTransfer.objects.select_for_update().get(pk=self.pk)
            items = list(transfer.items.select_related("item").all())
            if not items:
                raise ValidationError("Add at least one item before dispatching the transfer.")
            for item in items:
                source_balance, _ = InventoryBalance.objects.select_for_update().get_or_create(
                    item=item.item,
                    store=transfer.from_store,
                    defaults={"quantity_in_stock": Decimal("0.00")},
                )
                if source_balance.available_quantity < item.base_quantity:
                    raise ValidationError(
                        f"Insufficient stock for {item.item} in {transfer.from_store}."
                    )
                source_balance.quantity_in_stock -= item.base_quantity
                source_balance.save(update_fields=["quantity_in_stock", "updated_at"])

                StockLedger.objects.create(
                    item=item.item,
                    store=transfer.from_store,
                    quantity_out=item.base_quantity,
                    reference_type=LedgerReferenceType.STOCK_TRANSFER,
                    reference_id=transfer.id,
                    note=f"Transfer to {transfer.to_store}",
                    created_by=transfer.created_by,
                )

            transfer.status = StockTransferStatus.IN_TRANSIT
            transfer.dispatched_by = dispatched_by or transfer.dispatched_by
            transfer.dispatched_at = timezone.now()
            transfer.save(update_fields=["status", "dispatched_by", "dispatched_at", "updated_at"])
            self.status = StockTransferStatus.IN_TRANSIT

    def receive(self, received_by=None):
        if self.inventory_changes_applied:
            raise ValidationError("Inventory changes have already been applied.")
        if self.status != StockTransferStatus.IN_TRANSIT:
            raise ValidationError("Only an in-transit transfer can be received.")

        with transaction.atomic():
            transfer = StockTransfer.objects.select_for_update().get(pk=self.pk)
            if transfer.status != StockTransferStatus.IN_TRANSIT:
                raise ValidationError("Only an in-transit transfer can be received.")
            for item in transfer.items.select_related("item").all():
                destination_balance, _ = InventoryBalance.objects.select_for_update().get_or_create(
                    item=item.item,
                    store=transfer.to_store,
                    defaults={"quantity_in_stock": Decimal("0.00")},
                )
                destination_balance.quantity_in_stock += item.base_quantity
                destination_balance.save(update_fields=["quantity_in_stock", "updated_at"])
                StockLedger.objects.create(
                    item=item.item,
                    store=transfer.to_store,
                    quantity_in=item.base_quantity,
                    reference_type=LedgerReferenceType.STOCK_TRANSFER,
                    reference_id=transfer.id,
                    note=f"Transfer from {transfer.from_store}",
                    created_by=transfer.created_by,
                )

            transfer.inventory_changes_applied = True
            transfer.status = StockTransferStatus.COMPLETED
            transfer.received_by = received_by or transfer.received_by
            transfer.received_at = timezone.now()
            transfer.save(update_fields=["inventory_changes_applied", "status", "received_by", "received_at", "updated_at"])
            self.inventory_changes_applied = True
            self.status = StockTransferStatus.COMPLETED

    def __str__(self):
        return f"{self.from_store} to {self.to_store} ({self.status})"


class StockTransferItem(BaseModel):
    stock_transfer = models.ForeignKey(
        StockTransfer,
        on_delete=models.CASCADE,
        related_name="items",
    )
    item = models.ForeignKey(
        Item,
        on_delete=models.PROTECT,
        related_name="stock_transfer_items",
    )
    unit = models.ForeignKey(
        UnitOfMeasure,
        on_delete=models.PROTECT,
        related_name="stock_transfer_items",
        null=True,
        blank=True,
    )
    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    base_quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_positive_decimal],
    )

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("stock_transfer", "item", "unit"),
                name="unique_stock_transfer_item_unit",
            )
        ]
        ordering = ("item__name",)

    def save(self, *args, **kwargs):
        self.base_quantity = self.item.quantity_in_base_units(self.quantity, self.unit)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.item} x {self.base_quantity}"


class StockAdjustment(BaseModel):
    store = models.ForeignKey(
        StoreLocation,
        on_delete=models.PROTECT,
        related_name="stock_adjustments",
    )
    reference = models.CharField(max_length=100, blank=True, db_index=True)
    status = models.CharField(
        max_length=20,
        choices=StockAdjustmentStatus.choices,
        default=StockAdjustmentStatus.DRAFT,
    )
    reason = models.TextField(blank=True)
    note = models.TextField(blank=True)
    approved_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_stock_adjustments",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def submit(self):
        if self.status != StockAdjustmentStatus.DRAFT:
            raise ValidationError("Only a draft adjustment can be submitted.")
        if not self.items.exists():
            raise ValidationError("Add at least one adjustment line before submission.")
        self.status = StockAdjustmentStatus.PENDING
        self.save(update_fields=["status", "updated_at"])

    def approve(self, approved_by=None):
        if self.status != StockAdjustmentStatus.PENDING:
            raise ValidationError("Only a pending adjustment can be approved.")
        self.approved_by = approved_by or self.approved_by
        if not self.approved_by_id:
            raise ValidationError("An approving employee is required.")
        self.approved_at = timezone.now()
        self.status = StockAdjustmentStatus.APPROVED
        self.save(update_fields=["approved_by", "approved_at", "status", "updated_at"])

    def reject(self, reason=""):
        if self.status != StockAdjustmentStatus.PENDING:
            raise ValidationError("Only a pending adjustment can be rejected.")
        self.rejection_reason = reason
        self.status = StockAdjustmentStatus.CANCELLED
        self.save(update_fields=["rejection_reason", "status", "updated_at"])

    def apply(self):
        if self.status == StockAdjustmentStatus.APPLIED:
            raise ValidationError("Stock adjustment has already been applied.")
        if self.status != StockAdjustmentStatus.APPROVED:
            raise ValidationError("Only an approved stock adjustment can be applied.")

        with transaction.atomic():
            adjustment = StockAdjustment.objects.select_for_update().get(pk=self.pk)
            for item in adjustment.items.select_related("item").all():
                balance, _ = InventoryBalance.objects.select_for_update().get_or_create(
                    item=item.item,
                    store=adjustment.store,
                    defaults={"quantity_in_stock": Decimal("0.00")},
                )
                new_quantity = balance.quantity_in_stock + item.quantity_change
                if new_quantity < Decimal("0"):
                    raise ValidationError(f"Adjustment would make {item.item} stock negative.")
                if new_quantity < balance.quantity_reserved:
                    raise ValidationError(
                        f"Adjustment would reduce {item.item} to {new_quantity}, below "
                        f"{balance.quantity_reserved} reserved for approved department requests. "
                        "Cancel or fulfil those requests before reducing stock."
                    )
                balance.quantity_in_stock = new_quantity
                balance.save(update_fields=["quantity_in_stock", "updated_at"])

                StockLedger.objects.create(
                    item=item.item,
                    store=adjustment.store,
                    quantity_in=item.quantity_change if item.quantity_change > 0 else Decimal("0.00"),
                    quantity_out=abs(item.quantity_change) if item.quantity_change < 0 else Decimal("0.00"),
                    reference_type=LedgerReferenceType.STOCK_ADJUSTMENT,
                    reference_id=adjustment.id,
                    note=item.reason or adjustment.reason,
                    created_by=adjustment.created_by,
                )

            adjustment.status = StockAdjustmentStatus.APPLIED
            adjustment.save(update_fields=["status", "updated_at"])
            self.status = StockAdjustmentStatus.APPLIED

    def __str__(self):
        return self.reference or f"Adjustment {self.id}"


class StockAdjustmentItem(BaseModel):
    stock_adjustment = models.ForeignKey(
        StockAdjustment,
        on_delete=models.CASCADE,
        related_name="items",
    )
    item = models.ForeignKey(
        Item,
        on_delete=models.PROTECT,
        related_name="stock_adjustment_items",
    )
    unit = models.ForeignKey(
        UnitOfMeasure,
        on_delete=models.PROTECT,
        related_name="stock_adjustment_items",
        null=True,
        blank=True,
    )
    quantity_change = models.DecimalField(max_digits=12, decimal_places=2)
    unit_cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[validate_non_negative_decimal],
    )
    reason = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("stock_adjustment", "item", "unit"),
                name="unique_stock_adjustment_item_unit",
            )
        ]
        ordering = ("item__name",)

    def clean(self):
        super().clean()
        if self.unit_id and self.item_id and self.unit_id != self.item.base_unit_id:
            raise ValidationError(
                {"unit": "Stock adjustments must be entered in the article's base stock unit."}
            )

    def __str__(self):
        return f"{self.item} {self.quantity_change}"

class ReorderRule(BaseModel):
    item = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        related_name="reorder_rules",
    )
    store = models.ForeignKey(
        StoreLocation,
        on_delete=models.CASCADE,
        related_name="reorder_rules",
        null=True,
        blank=True,
        help_text="Leave blank to use this rule as the default for all stores.",
    )
    minimum_level = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[validate_non_negative_decimal],
    )
    reorder_quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    preferred_supplier = models.ForeignKey(
        "vendors.Supplier",
        on_delete=models.PROTECT,
        related_name="preferred_reorder_rules",
        null=True,
        blank=True,
    )
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("item", "store"),
                name="unique_item_store_reorder_rule",
            )
        ]
        ordering = ("item__name", "store__name")

    def __str__(self):
        scope = self.store or "All stores"
        return f"{self.item} reorder rule - {scope}"

    @property
    def current_stock(self):
        balances = InventoryBalance.objects.filter(item=self.item)
        if self.store_id:
            balances = balances.filter(store=self.store)
        return sum(
            (balance.quantity_in_stock for balance in balances),
            Decimal("0.00"),
        )

    @property
    def needs_reorder(self):
        return self.is_active and self.current_stock <= self.minimum_level

    def create_purchase_requisition(
        self,
        *,
        requester=None,
        department=None,
        reason="",
        created_by=None,
    ):
        if not self.is_active:
            raise ValidationError("Inactive reorder rules cannot create purchase requisitions.")
        if not self.needs_reorder:
            raise ValidationError("Current stock is above the reorder minimum.")

        from apps.procurement.models import PurchaseRequisition, RequisitionItem
        from core.constants.choices import PRStatus, RequisitionType

        if RequisitionItem.objects.filter(
            item=self.item,
            requisition__status__in=(
                PRStatus.DRAFT,
                PRStatus.SUBMITTED,
                PRStatus.HOD_APPROVED,
                PRStatus.PROCUREMENT_APPROVED,
                PRStatus.FINANCE_APPROVED,
                PRStatus.DIRECTOR_APPROVED,
                PRStatus.APPROVED,
            ),
        ).exists():
            raise ValidationError(
                f"An open purchase requisition already exists for {self.item}."
            )

        supplier_price = SupplierItemPrice.objects.filter(
            item=self.item,
            supplier=self.preferred_supplier,
            is_active=True,
            effective_from__lte=timezone.localdate(),
        ).first()

        scope = self.store.name if self.store_id else "all stores"
        purchase_requisition = PurchaseRequisition.objects.create(
            request_type=RequisitionType.HOTEL_PURCHASE,
            requester=requester,
            department=department,
            preferred_supplier=self.preferred_supplier,
            reason=reason or f"Low stock reorder for {self.item} at {scope}.",
            created_by=created_by,
        )
        RequisitionItem.objects.create(
            requisition=purchase_requisition,
            item=self.item,
            quantity=self.reorder_quantity,
            estimated_unit_cost=(
                supplier_price.unit_price if supplier_price else Decimal("0.00")
            ),
            destination_type=RequisitionItem.DESTINATION_STORE,
            destination_store=self.store,
            created_by=created_by,
        )
        return purchase_requisition


class StoreRequisition(BaseModel):
    requisition_no = models.CharField(max_length=50, unique=True, blank=True)
    department = models.ForeignKey(
        "departments.Department",
        on_delete=models.PROTECT,
        related_name="store_requisitions",
    )
    store = models.ForeignKey(
        StoreLocation,
        on_delete=models.PROTECT,
        related_name="store_requisitions",
        null=True,
        blank=True,
        help_text="Destination store selected by the Store Keeper after Department Head approval.",
    )
    requested_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="store_requisitions",
    )
    approved_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_store_requisitions",
    )
    department_approved_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="department_approved_store_requisitions",
    )
    department_approved_at = models.DateTimeField(null=True, blank=True)
    department_approval_comments = models.TextField(blank=True)
    procurement_requisition = models.OneToOneField(
        "procurement.PurchaseRequisition",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="linked_store_requisition",
    )
    status = models.CharField(
        max_length=30,
        choices=StoreRequisitionStatus.choices,
        default=StoreRequisitionStatus.DRAFT,
    )
    required_date = models.DateField(null=True, blank=True)
    purpose = models.TextField(blank=True)
    rejection_reason = models.TextField(blank=True)
    approval_comments = models.TextField(blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    issued_at = models.DateTimeField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def __str__(self):
        return self.requisition_no or f"Store requisition {self.id}"

    def save(self, *args, **kwargs):
        if not self.requisition_no:
            from apps.procurement.models import ProcurementDocumentSequence

            sequence_value = ProcurementDocumentSequence.next_number("store_requisition")
            self.requisition_no = f"R-{int(sequence_value):05d}"
        super().save(*args, **kwargs)

    def submit(self, actor=None):
        if self.status not in (StoreRequisitionStatus.DRAFT, StoreRequisitionStatus.REJECTED):
            raise ValidationError("Only draft or rejected store requisitions can be submitted.")
        if not self.items.exists():
            raise ValidationError("Store requisition must include at least one item.")
        self.status = StoreRequisitionStatus.PENDING_DEPARTMENT_APPROVAL
        self.department_approved_by = None
        self.department_approved_at = None
        self.department_approval_comments = ""
        self.rejection_reason = ""
        self.approved_by = None
        self.approved_at = None
        self.approval_comments = ""
        self.save(update_fields=[
            "status",
            "department_approved_by",
            "department_approved_at",
            "department_approval_comments",
            "rejection_reason",
            "approved_by",
            "approved_at",
            "approval_comments",
            "updated_at",
        ])
        self.items.update(
            hod_approved_quantity=None,
            quantity_approved=Decimal("0.00"),
            storekeeper_comment="",
        )
        from apps.notifications.services import notify_roles

        notify_roles(
            ("Department Head",),
            title=f"{self.requisition_no} needs department approval",
            message=(
                f"{self.requested_by} submitted a store request for {self.department}. "
                "Review the requested articles, quantities, and notes."
            ),
            branch=getattr(self.requested_by, "branch", None),
            department=self.department,
            created_by=actor,
            exclude_employee=self.requested_by,
        )

    def approve_department(self, approved_by, comments="", item_quantities=None):
        if self.status != StoreRequisitionStatus.PENDING_DEPARTMENT_APPROVAL:
            raise ValidationError(
                "Only requests awaiting Department Head approval can be approved here."
            )
        if not approved_by or approved_by.department_id != self.department_id:
            raise ValidationError(
                "The approver must be a Department Head in the requesting department."
            )
        requester_branch_id = getattr(self.requested_by, "branch_id", None)
        if requester_branch_id and approved_by.branch_id != requester_branch_id:
            raise ValidationError(
                "The approver must belong to the same branch as the requester."
            )
        if approved_by.pk == self.requested_by_id:
            raise ValidationError("A requester cannot approve their own store request.")

        with transaction.atomic():
            lines = list(self.items.select_for_update().order_by("pk"))
            if not lines:
                raise ValidationError("The requisition has no items to approve.")

            supplied = item_quantities is not None
            quantity_map = {}
            if supplied:
                if not isinstance(item_quantities, (list, tuple)):
                    raise ValidationError("Item quantities must be supplied as a list.")
                for decision in item_quantities:
                    if not isinstance(decision, dict) or not decision.get("id"):
                        raise ValidationError("Each item decision must include the requisition item id.")
                    try:
                        quantity_map[str(decision["id"])] = Decimal(str(decision.get("approved_quantity", "0")))
                    except Exception as exc:
                        raise ValidationError("Department Head quantities must be valid numbers.") from exc

            positive = False
            for line in lines:
                if supplied:
                    if str(line.pk) not in quantity_map:
                        raise ValidationError(f"Confirm the approved quantity for {line.item}.")
                    quantity = quantity_map[str(line.pk)]
                else:
                    # Backward-compatible default for older clients/tests.
                    quantity = line.base_quantity_requested
                if quantity < 0 or quantity > line.base_quantity_requested:
                    raise ValidationError(
                        f"Department Head quantity for {line.item} must be between 0 and {line.base_quantity_requested}."
                    )
                # HOD approval changes only the HOD decision fields. Do not route this
                # through StoreRequisitionItem.save(), because that method recalculates
                # article/UOM base quantities and can make an otherwise valid approval
                # fail because of unrelated master-data changes. The requester's
                # original quantity remains immutable.
                line.hod_approved_quantity = quantity
                line.quantity_approved = Decimal("0.00")
                line.storekeeper_comment = ""
                type(line).objects.filter(pk=line.pk).update(
                    hod_approved_quantity=quantity,
                    quantity_approved=Decimal("0.00"),
                    storekeeper_comment="",
                    updated_at=timezone.now(),
                )
                positive = positive or quantity > 0

            if not positive:
                raise ValidationError("Approve at least one item quantity, or reject the requisition instead.")

            approved_at = timezone.now()
            # Use a direct UPDATE for the requisition decision as well.  The normal
            # model save path emits document-wide post_save audit signals.  Those
            # signals are useful, but they are secondary to the HOD decision and
            # must never be able to roll back a valid approval in production.
            updated = type(self).objects.filter(
                pk=self.pk,
                status=StoreRequisitionStatus.PENDING_DEPARTMENT_APPROVAL,
            ).update(
                status=StoreRequisitionStatus.SUBMITTED,
                department_approved_by_id=approved_by.pk,
                department_approved_at=approved_at,
                department_approval_comments=comments or "",
                updated_at=approved_at,
            )
            if updated != 1:
                raise ValidationError(
                    "This requisition is no longer awaiting Department Head approval. Refresh and try again."
                )

            self.status = StoreRequisitionStatus.SUBMITTED
            self.department_approved_by = approved_by
            self.department_approved_at = approved_at
            self.department_approval_comments = comments or ""
            self.updated_at = approved_at

        # Audit and notifications are deliberately best-effort side effects.
        # They execute only after the approval transaction has committed and can
        # never change the success/failure of the business decision.
        try:
            from apps.audit_logs.models import AuditLog

            AuditLog.objects.create(
                actor=approved_by.user,
                action="department_requisition_hod_approved",
                entity_type="inventory.StoreRequisition",
                entity_id=self.pk,
                metadata={
                    "requisition_no": self.requisition_no,
                    "approved_by": str(approved_by.pk),
                    "item_quantities": {
                        str(line.pk): str(line.hod_approved_quantity) for line in lines
                    },
                    "comments": comments or "",
                },
                created_by=approved_by.user,
            )
        except Exception:
            import logging
            logging.getLogger(__name__).exception(
                "Audit logging failed after HOD approval for requisition %s",
                self.pk,
            )

        try:
            self._notify_stores(
                title=f"{self.requisition_no} needs Store Keeper action",
                message=(
                    f"The Department Head approved {self.department}'s request. "
                    "Confirm the destination store and the quantities to forward to Procurement."
                ),
                created_by=approved_by.user,
            )
        except Exception:
            import logging
            logging.getLogger(__name__).exception(
                "Store Keeper notification failed after approving requisition %s",
                self.pk,
            )

    def create_procurement_requisition(self, created_by=None, reason=""):
        """Create the Store Keeper predecessor document sent to Procurement.

        The client workflow does not procure only the calculated stock shortage.
        The Store Keeper confirms a quantity for each Department-request line and
        sends those confirmed quantities to Procurement. The original Department
        quantity remains immutable for audit.
        """
        if self.status != StoreRequisitionStatus.SUBMITTED:
            raise ValidationError("Only an HOD-approved Department request can be sent to Procurement.")
        if self.procurement_requisition_id:
            raise ValidationError("A Store Keeper requisition already exists for this Department request.")
        if not self.items.exists():
            raise ValidationError("The Department request has no items.")
        if not self.store_id:
            raise ValidationError("Select the destination store before sending the requisition to Procurement.")

        from apps.procurement.models import PurchaseRequisition, RequisitionItem
        from core.constants.choices import ProcurementSource, RequisitionType

        decided_lines = []
        for line in self.items.select_related("item", "unit"):
            quantity = line.quantity_approved or Decimal("0.00")
            hod_limit = line.department_approved_limit
            if quantity < 0 or quantity > hod_limit:
                raise ValidationError(
                    f"Store Keeper quantity for {line.item} must be between 0 and the HOD-approved quantity {hod_limit}."
                )
            if hod_limit > 0 and quantity == 0 and not (line.storekeeper_comment or "").strip():
                raise ValidationError(
                    f"Enter a note if none of the HOD-approved quantity for {line.item} will be forwarded."
                )
            if quantity > 0:
                decided_lines.append((line, quantity))
        if not decided_lines:
            raise ValidationError("Confirm at least one item quantity before forwarding to Procurement.")

        purchase = PurchaseRequisition.objects.create(
            request_type=RequisitionType.DEPARTMENT,
            procurement_source=ProcurementSource.STORE_REQUISITION,
            source_store_requisition=self,
            requester=self.requested_by,
            department=self.department,
            branch=self.store.branch,
            expected_date=self.required_date,
            reason=reason or f"Store Keeper requisition from Department request {self.requisition_no}.",
            control_notes=(
                f"Predecessor Department request: {self.requisition_no}. "
                f"Destination store: {self.store}. Department quantities remain unchanged."
            ),
            created_by=created_by,
        )
        for line, quantity in decided_lines:
            RequisitionItem.objects.create(
                requisition=purchase,
                item=line.item,
                unit=line.item.base_unit,
                quantity=quantity,
                approved_quantity=quantity,
                estimated_unit_cost=Decimal("0.00"),
                description=(
                    f"Department requested {line.base_quantity_requested}; "
                    f"HOD approved {line.department_approved_limit}; "
                    f"Store Keeper forwarded {quantity}. "
                    f"{line.storekeeper_comment or ''}"
                ).strip(),
                destination_type=RequisitionItem.DESTINATION_STORE,
                destination_store=self.store,
                created_by=created_by,
            )
        purchase.status = "approved"
        purchase.approved_at = timezone.now()
        purchase.save(update_fields=["status", "approved_at", "updated_at"])
        purchase.record_history(
            action="store_keeper_sent_to_procurement",
            previous_status="draft",
            actor=created_by,
            comments="Store Keeper confirmed destination and quantities and sent the linked requisition to Procurement.",
            metadata={"department_request": self.requisition_no, "destination_store": str(self.store_id)},
        )
        self.procurement_requisition = purchase
        self.status = StoreRequisitionStatus.AWAITING_PROCUREMENT
        self.approved_by = getattr(created_by, "employee_profile", None) if created_by else self.approved_by
        self.approved_at = timezone.now()
        self.approval_comments = reason or self.approval_comments
        self.save(update_fields=["procurement_requisition", "status", "approved_by", "approved_at", "approval_comments", "updated_at"])

        from apps.notifications.services import notify_roles
        notify_roles(
            ("Procurement Manager", "Procurement Officer"),
            title=f"{purchase.requisition_number} is ready for Procurement",
            message=(
                f"Store Keeper forwarded {self.requisition_no} for {self.department}. "
                "Select the vetted supplier, confirm current price, and prepare the LPO."
            ),
            branch=self.store.branch,
            created_by=created_by,
        )
        return purchase

    def create_shortage_purchase_requisition(self, created_by=None, reason=""):
        """Backward-compatible alias for older API/tests."""
        return self.create_procurement_requisition(created_by=created_by, reason=reason)

    def resume_after_procurement(self, actor=None):
        if self.status != StoreRequisitionStatus.AWAITING_PROCUREMENT:
            raise ValidationError("Only requests awaiting Procurement can be resumed.")
        shortages = []
        for line in self.items.select_related("item"):
            balance = InventoryBalance.objects.filter(item=line.item, store=self.store).first()
            available = balance.available_quantity if balance else Decimal("0.00")
            required = line.quantity_approved if line.quantity_approved > Decimal("0.00") else line.base_quantity_requested
            if available < required:
                shortages.append(
                    f"{line.item}: {available} available, {required} required from the Store Keeper decision"
                )
        if shortages:
            raise ValidationError(
                "Purchased stock has not yet been posted to the issuing store: " + "; ".join(shortages)
            )
        self.status = StoreRequisitionStatus.SUBMITTED
        self.save(update_fields=["status", "updated_at"])
        self._notify_stores(
            title=f"{self.requisition_no} is ready for a stock decision",
            message=(
                "Purchased stock is now available in the issuing store. "
                "Review and reserve the request quantities."
            ),
            created_by=actor,
        )

    def approve(self, approved_by=None, comments=""):
        if self.status not in (StoreRequisitionStatus.SUBMITTED, StoreRequisitionStatus.PARTIALLY_APPROVED):
            raise ValidationError("Only submitted requisitions can be approved.")
        items = list(self.items.select_related("item", "unit").all())
        if not items:
            raise ValidationError("Store requisition must include at least one item.")
        with transaction.atomic():
            explicit_decisions = any(
                line.quantity_approved > Decimal("0.00") for line in items
            )
            for line in items:
                if not explicit_decisions:
                    line.quantity_approved = line.base_quantity_requested
                    line.save(update_fields=["quantity_approved", "updated_at"])
                if line.quantity_approved <= Decimal("0.00"):
                    continue
                balance, _ = InventoryBalance.objects.select_for_update().get_or_create(
                    item=line.item,
                    store=self.store,
                    defaults={"quantity_in_stock": Decimal("0.00")},
                )
                if balance.available_quantity < line.quantity_approved:
                    raise ValidationError(
                        f"Insufficient available stock to reserve {line.item}: "
                        f"{balance.available_quantity} available, {line.quantity_approved} requested."
                    )
                balance.quantity_reserved += line.quantity_approved
                balance.save(update_fields=["quantity_reserved", "updated_at"])
            from django.utils import timezone
            self.approved_by = approved_by or self.approved_by
            self.approved_at = timezone.now()
            self.approval_comments = comments
            fully_approved = all(
                line.quantity_approved == line.department_approved_limit for line in items
            )
            self.status = (
                StoreRequisitionStatus.APPROVED
                if fully_approved
                else StoreRequisitionStatus.PARTIALLY_APPROVED
            )
            self.save(update_fields=["approved_by", "approved_at", "approval_comments", "status", "updated_at"])

        from apps.notifications.services import notify_employee, notify_roles

        actor = approved_by.user if approved_by else None
        notify_employee(
            self.requested_by,
            title=f"{self.requisition_no} was approved by Stores",
            message="Stock has been reserved and the request is waiting to be picked and issued.",
            created_by=actor,
        )
        notify_roles(
            ("Store Keeper",),
            title=f"{self.requisition_no} is ready to pick and issue",
            message=f"Reserved stock for {self.department} is ready for picking and handover.",
            branch=self.store.branch,
            created_by=actor,
            exclude_employee=approved_by,
        )

    def reject(self, reason="", actor=None):
        if self.status not in (
            StoreRequisitionStatus.PENDING_DEPARTMENT_APPROVAL,
            StoreRequisitionStatus.SUBMITTED,
            StoreRequisitionStatus.PARTIALLY_APPROVED,
        ):
            raise ValidationError("Only submitted requisitions can be rejected.")
        self.status = StoreRequisitionStatus.REJECTED
        self.rejection_reason = reason
        self.save(update_fields=["status", "rejection_reason", "updated_at"])
        from apps.notifications.services import notify_employee

        notify_employee(
            self.requested_by,
            title=f"{self.requisition_no} was rejected",
            message=reason or "Open the request to review the decision and make corrections.",
            created_by=actor,
        )

    def cancel(self, actor=None):
        if self.status in (StoreRequisitionStatus.ISSUED, StoreRequisitionStatus.CANCELLED):
            raise ValidationError("Issued or already-cancelled requisitions cannot be cancelled.")
        with transaction.atomic():
            if self.status in (
                StoreRequisitionStatus.APPROVED,
                StoreRequisitionStatus.PARTIALLY_APPROVED,
                StoreRequisitionStatus.PARTIALLY_ISSUED,
            ):
                for line in self.items.select_related("item"):
                    outstanding = line.outstanding_quantity
                    if outstanding <= 0:
                        continue
                    balance = InventoryBalance.objects.select_for_update().filter(
                        item=line.item, store=self.store
                    ).first()
                    if balance:
                        balance.quantity_reserved = max(
                            Decimal("0.00"), balance.quantity_reserved - outstanding
                        )
                        balance.save(update_fields=["quantity_reserved", "updated_at"])
            self.status = StoreRequisitionStatus.CANCELLED
            self.save(update_fields=["status", "updated_at"])

    def _notify_stores(self, *, title, message, created_by=None):
        from apps.notifications.services import notify_employee, notify_roles

        branch = self.store.branch if self.store_id else getattr(self.requested_by, "branch", None)
        assignments = StoreKeeperAssignment.objects.select_related(
            "employee", "employee__user", "store"
        ).filter(
            is_active=True,
            store__is_active=True,
            employee__is_active=True,
            employee__user__is_active=True,
        )
        if branch is not None:
            assignments = assignments.filter(store__branch=branch)
        notifications = [
            notification
            for notification in (
                notify_employee(
                    assignment.employee,
                    title=title,
                    message=message,
                    created_by=created_by,
                )
                for assignment in assignments
            )
            if notification
        ]
        if notifications:
            return notifications
        return notify_roles(
            ("Store Keeper",),
            title=title,
            message=message,
            branch=branch,
            created_by=created_by,
        )

    def mark_issued_if_complete(self):
        items = list(self.items.all())
        if items and all(item.quantity_issued >= item.quantity_approved for item in items):
            from django.utils import timezone
            self.status = StoreRequisitionStatus.ISSUED
            self.issued_at = timezone.now()
            self.save(update_fields=["status", "issued_at", "updated_at"])
        elif any(item.quantity_issued > Decimal("0.00") for item in items):
            self.status = StoreRequisitionStatus.PARTIALLY_ISSUED
            self.save(update_fields=["status", "updated_at"])


class StoreRequisitionItem(BaseModel):
    requisition = models.ForeignKey(
        StoreRequisition,
        on_delete=models.CASCADE,
        related_name="items",
    )
    item = models.ForeignKey(
        Item,
        on_delete=models.PROTECT,
        related_name="store_requisition_items",
    )
    unit = models.ForeignKey(
        UnitOfMeasure,
        on_delete=models.PROTECT,
        related_name="store_requisition_items",
        null=True,
        blank=True,
    )
    quantity_requested = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    base_quantity_requested = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    hod_approved_quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[validate_non_negative_decimal],
        help_text="Quantity approved by the Department Head; requester quantity remains unchanged.",
    )
    quantity_approved = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    quantity_issued = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    remarks = models.TextField(blank=True)
    storekeeper_comment = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("requisition", "item", "unit"),
                name="unique_store_requisition_item_unit",
            )
        ]
        ordering = ("item__name",)

    @property
    def outstanding_quantity(self):
        return max(Decimal("0.00"), self.quantity_approved - self.quantity_issued)

    @property
    def department_approved_limit(self):
        """Maximum quantity Stores may carry forward after the HOD decision."""
        if self.hod_approved_quantity is None:
            return self.base_quantity_requested
        return self.hod_approved_quantity

    def save(self, *args, **kwargs):
        self.base_quantity_requested = self.item.quantity_in_base_units(
            self.quantity_requested,
            self.unit,
        )
        if (
            self.hod_approved_quantity is not None
            and self.hod_approved_quantity > self.base_quantity_requested
        ):
            raise ValidationError("Department Head quantity cannot exceed the requester quantity.")
        if self.quantity_approved > self.department_approved_limit:
            raise ValidationError("Store Keeper quantity cannot exceed the Department Head approved quantity.")
        if self.quantity_issued > self.quantity_approved:
            raise ValidationError("Issued quantity cannot exceed approved quantity.")
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.requisition} - {self.item} x {self.base_quantity_requested}"


class StockIssue(BaseModel):
    issue_no = models.CharField(max_length=50, unique=True, blank=True)
    requisition = models.ForeignKey(
        StoreRequisition,
        on_delete=models.PROTECT,
        related_name="stock_issues",
    )
    store = models.ForeignKey(
        StoreLocation,
        on_delete=models.PROTECT,
        related_name="stock_issues",
    )
    issued_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="stock_issues",
    )
    received_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="received_stock_issues",
    )
    received_by_name = models.CharField(max_length=150, blank=True)
    issue_date = models.DateField(auto_now_add=True)
    note = models.TextField(blank=True)
    inventory_changes_applied = models.BooleanField(default=False)

    class Meta(BaseModel.Meta):
        ordering = ("-issue_date", "-created_at")

    def __str__(self):
        return self.issue_no or f"Stock issue {self.id}"

    def save(self, *args, **kwargs):
        if not self.issue_no:
            from django.utils import timezone
            prefix = f"SI-{timezone.localdate().year}"
            last_issue = StockIssue.objects.filter(issue_no__startswith=prefix).order_by("issue_no").last()
            next_number = 1
            if last_issue and last_issue.issue_no:
                try:
                    next_number = int(last_issue.issue_no.split("-")[-1]) + 1
                except (IndexError, ValueError):
                    next_number = 1
            self.issue_no = f"{prefix}-{next_number:05d}"
        super().save(*args, **kwargs)

    def clean(self):
        super().clean()
        if self.requisition_id and self.requisition.status not in (
            StoreRequisitionStatus.APPROVED,
            StoreRequisitionStatus.PARTIALLY_APPROVED,
            StoreRequisitionStatus.PARTIALLY_ISSUED,
        ):
            raise ValidationError("Stock can only be issued against an approved requisition.")
        if self.requisition_id and self.store_id and self.requisition.store_id != self.store_id:
            raise ValidationError("Issue store must match the requisition issuing store.")

    def apply_inventory_changes(self):
        if self.inventory_changes_applied:
            raise ValidationError("Stock issue has already been applied.")
        with transaction.atomic():
            issue = StockIssue.objects.select_for_update().select_related("requisition", "store").get(pk=self.pk)
            if issue.inventory_changes_applied:
                raise ValidationError("Stock issue has already been applied.")
            issue.full_clean()
            issue_items = list(issue.items.select_related("item", "requisition_item").all())
            if not issue_items:
                raise ValidationError("Stock issue must include at least one item.")

            for line in issue_items:
                available = InventoryBalance.objects.select_for_update().filter(item=line.item, store=issue.store).first()
                stock_on_hand = available.quantity_in_stock if available else Decimal("0.00")
                if stock_on_hand < line.base_quantity:
                    raise ValidationError(f"Insufficient stock for {line.item} in {issue.store}.")
                if line.base_quantity > line.requisition_item.outstanding_quantity:
                    raise ValidationError(f"Issue quantity for {line.item} exceeds outstanding approved quantity.")

            for line in issue_items:
                balance = InventoryBalance.objects.select_for_update().get(item=line.item, store=issue.store)
                issue_cost = self._consume_batches(
                    item=line.item,
                    store=issue.store,
                    quantity=line.base_quantity,
                )
                balance.quantity_in_stock -= line.base_quantity
                balance.quantity_reserved = max(
                    Decimal("0.00"),
                    balance.quantity_reserved - line.base_quantity,
                )
                balance.save(update_fields=["quantity_in_stock", "quantity_reserved", "updated_at"])
                line.requisition_item.quantity_issued += line.base_quantity
                line.requisition_item.save(update_fields=["quantity_issued", "updated_at"])
                StockLedger.objects.create(
                    item=line.item,
                    store=issue.store,
                    quantity_out=line.base_quantity,
                    reference_type=LedgerReferenceType.STOCK_ISSUE,
                    reference_id=issue.id,
                    note=f"Stock issue {issue.issue_no} for {issue.requisition.requisition_no}",
                    created_by=issue.created_by,
                )
                DepartmentConsumption.objects.create(
                    department=issue.requisition.department,
                    stock_issue_item=line,
                    item=line.item,
                    quantity=line.base_quantity,
                    unit_cost=(
                        issue_cost / line.base_quantity
                        if line.base_quantity
                        else Decimal("0.00")
                    ),
                    purpose=issue.requisition.purpose,
                    consumed_on=issue.issue_date,
                    created_by=issue.created_by,
                )
            issue.inventory_changes_applied = True
            issue.save(update_fields=["inventory_changes_applied", "updated_at"])
            issue.requisition.mark_issued_if_complete()
            from apps.notifications.services import notify_employee

            notify_employee(
                issue.requisition.requested_by,
                title=f"{issue.requisition.requisition_no} stock was issued",
                message=(
                    f"{issue.issue_no} was posted for {issue.requisition.department}. "
                    "The requested articles are ready for department handover."
                ),
                created_by=issue.created_by,
            )
            self.inventory_changes_applied = True

    def posting_readiness(self):
        blockers = []
        warnings = []
        if self.inventory_changes_applied:
            blockers.append("This stock issue has already been posted.")
        if self.requisition.status not in (
            StoreRequisitionStatus.APPROVED,
            StoreRequisitionStatus.PARTIALLY_APPROVED,
            StoreRequisitionStatus.PARTIALLY_ISSUED,
        ):
            blockers.append("The department requisition must be approved before stock is issued.")
        lines = list(self.items.select_related("item", "requisition_item"))
        if not lines:
            blockers.append("Add at least one Article to the issue voucher.")
        for line in lines:
            balance = InventoryBalance.objects.filter(item=line.item, store=self.store).first()
            available = balance.quantity_in_stock if balance else Decimal("0.00")
            if available < line.base_quantity:
                blockers.append(
                    f"Insufficient {line.item} in {self.store}: {available} available, {line.base_quantity} required."
                )
            if line.base_quantity > line.requisition_item.outstanding_quantity:
                blockers.append(f"{line.item} exceeds the outstanding approved quantity.")
        if not self.received_by_id and not self.received_by_name:
            warnings.append("The department receiver has not been recorded.")
        return {"can_proceed": not blockers, "blockers": blockers, "warnings": warnings}

    @staticmethod
    def _consume_batches(*, item, store, quantity):
        remaining = quantity
        total_cost = Decimal("0.00")
        batches = (
            InventoryBatch.objects.select_for_update()
            .filter(item=item, store=store, remaining_quantity__gt=0)
            .order_by(models.F("expiry_date").asc(nulls_last=True), "received_date", "created_at")
        )
        for batch in batches:
            if remaining <= 0:
                break
            consumed = min(batch.remaining_quantity, remaining)
            batch.remaining_quantity -= consumed
            batch.save(update_fields=("remaining_quantity", "updated_at"))
            total_cost += consumed * batch.unit_cost
            remaining -= consumed
        return total_cost


class StockIssueItem(BaseModel):
    issue = models.ForeignKey(
        StockIssue,
        on_delete=models.CASCADE,
        related_name="items",
    )
    requisition_item = models.ForeignKey(
        StoreRequisitionItem,
        on_delete=models.PROTECT,
        related_name="stock_issue_items",
    )
    item = models.ForeignKey(
        Item,
        on_delete=models.PROTECT,
        related_name="stock_issue_items",
    )
    unit = models.ForeignKey(
        UnitOfMeasure,
        on_delete=models.PROTECT,
        related_name="stock_issue_items",
        null=True,
        blank=True,
    )
    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    base_quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("issue", "requisition_item", "unit"),
                name="unique_stock_issue_requisition_item_unit",
            )
        ]
        ordering = ("item__name",)

    def save(self, *args, **kwargs):
        self.item = self.requisition_item.item
        self.base_quantity = self.item.quantity_in_base_units(self.quantity, self.unit)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.issue} - {self.item} x {self.base_quantity}"


class DepartmentConsumption(BaseModel):
    department = models.ForeignKey(
        "departments.Department",
        on_delete=models.PROTECT,
        related_name="inventory_consumption",
    )
    stock_issue_item = models.OneToOneField(
        StockIssueItem,
        on_delete=models.PROTECT,
        related_name="consumption_posting",
        null=True,
        blank=True,
    )
    goods_receipt_item = models.OneToOneField(
        "procurement.GoodsReceiptItem",
        on_delete=models.PROTECT,
        related_name="direct_consumption_posting",
        null=True,
        blank=True,
    )
    item = models.ForeignKey(
        Item,
        on_delete=models.PROTECT,
        related_name="department_consumption",
    )
    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    unit_cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_non_negative_decimal],
    )
    consumed_on = models.DateField()
    purpose = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-consumed_on", "-created_at")
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(stock_issue_item__isnull=False, goods_receipt_item__isnull=True)
                    | models.Q(stock_issue_item__isnull=True, goods_receipt_item__isnull=False)
                ),
                name="consumption_has_one_source",
            )
        ]

    @property
    def total_cost(self):
        return self.quantity * self.unit_cost

    def __str__(self):
        return f"{self.department}: {self.item} x {self.quantity}"


class StoreReturn(BaseModel):
    return_no = models.CharField(max_length=50, unique=True, blank=True)
    department = models.ForeignKey(
        "departments.Department",
        on_delete=models.PROTECT,
        related_name="store_returns",
    )
    store = models.ForeignKey(
        StoreLocation,
        on_delete=models.PROTECT,
        related_name="department_returns",
    )
    received_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="received_store_returns",
    )
    return_date = models.DateField(auto_now_add=True)
    reason = models.TextField(blank=True)
    inventory_changes_applied = models.BooleanField(default=False)

    class Meta(BaseModel.Meta):
        ordering = ("-return_date", "-created_at")

    def save(self, *args, **kwargs):
        if not self.return_no:
            from django.utils import timezone
            prefix = f"DR-{timezone.localdate().year}"
            last_return = StoreReturn.objects.filter(return_no__startswith=prefix).order_by("return_no").last()
            next_number = 1
            if last_return and last_return.return_no:
                try:
                    next_number = int(last_return.return_no.split("-")[-1]) + 1
                except (IndexError, ValueError):
                    next_number = 1
            self.return_no = f"{prefix}-{next_number:05d}"
        super().save(*args, **kwargs)

    def apply_inventory_changes(self):
        if self.inventory_changes_applied:
            raise ValidationError("Store return has already been applied.")
        with transaction.atomic():
            store_return = StoreReturn.objects.select_for_update().get(pk=self.pk)
            items = list(store_return.items.select_related("item").all())
            if not items:
                raise ValidationError("Store return must include at least one item.")
            for line in items:
                balance, _ = InventoryBalance.objects.select_for_update().get_or_create(
                    item=line.item,
                    store=store_return.store,
                    defaults={"quantity_in_stock": Decimal("0.00")},
                )
                balance.quantity_in_stock += line.base_quantity
                balance.save(update_fields=["quantity_in_stock", "updated_at"])
                StockLedger.objects.create(
                    item=line.item,
                    store=store_return.store,
                    quantity_in=line.base_quantity,
                    reference_type=LedgerReferenceType.STORE_RETURN,
                    reference_id=store_return.id,
                    note=f"Department return {store_return.return_no}",
                    created_by=store_return.created_by,
                )
            store_return.inventory_changes_applied = True
            store_return.save(update_fields=["inventory_changes_applied", "updated_at"])
            self.inventory_changes_applied = True

    def __str__(self):
        return self.return_no or f"Store return {self.id}"


class StoreReturnItem(BaseModel):
    store_return = models.ForeignKey(
        StoreReturn,
        on_delete=models.CASCADE,
        related_name="items",
    )
    item = models.ForeignKey(
        Item,
        on_delete=models.PROTECT,
        related_name="store_return_items",
    )
    unit = models.ForeignKey(
        UnitOfMeasure,
        on_delete=models.PROTECT,
        related_name="store_return_items",
        null=True,
        blank=True,
    )
    quantity = models.DecimalField(max_digits=12, decimal_places=2, validators=[validate_positive_decimal])
    base_quantity = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    condition_note = models.TextField(blank=True)

    def save(self, *args, **kwargs):
        self.base_quantity = self.item.quantity_in_base_units(self.quantity, self.unit)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.store_return} - {self.item} x {self.base_quantity}"


class StockCount(BaseModel):
    count_no = models.CharField(max_length=50, unique=True, blank=True)
    store = models.ForeignKey(StoreLocation, on_delete=models.PROTECT, related_name="stock_counts")
    conducted_by = models.ForeignKey("employees.Employee", on_delete=models.PROTECT, related_name="stock_counts")
    approved_by = models.ForeignKey("employees.Employee", on_delete=models.SET_NULL, null=True, blank=True, related_name="approved_stock_counts")
    count_date = models.DateField(auto_now_add=True)
    status = models.CharField(max_length=20, choices=StockCountStatus.choices, default=StockCountStatus.DRAFT)
    note = models.TextField(blank=True)
    inventory_changes_applied = models.BooleanField(default=False)

    class Meta(BaseModel.Meta):
        ordering = ("-count_date", "-created_at")

    def save(self, *args, **kwargs):
        if not self.count_no:
            from django.utils import timezone
            prefix = f"SC-{timezone.localdate().year}"
            last_count = StockCount.objects.filter(count_no__startswith=prefix).order_by("count_no").last()
            next_number = 1
            if last_count and last_count.count_no:
                try:
                    next_number = int(last_count.count_no.split("-")[-1]) + 1
                except (IndexError, ValueError):
                    next_number = 1
            self.count_no = f"{prefix}-{next_number:05d}"
        super().save(*args, **kwargs)

    def populate_from_system_balances(self):
        for balance in InventoryBalance.objects.filter(store=self.store).select_related("item"):
            StockCountItem.objects.get_or_create(
                stock_count=self,
                item=balance.item,
                defaults={"system_quantity": balance.quantity_in_stock, "physical_quantity": balance.quantity_in_stock},
            )

    def submit(self):
        if self.status not in (StockCountStatus.DRAFT, StockCountStatus.IN_PROGRESS):
            raise ValidationError("Only draft or in-progress stock counts can be submitted.")
        if not self.items.exists():
            raise ValidationError("Stock count must include at least one item.")
        self.status = StockCountStatus.SUBMITTED
        self.save(update_fields=["status", "updated_at"])

    def approve(self, approved_by=None):
        if self.status != StockCountStatus.SUBMITTED:
            raise ValidationError("Only submitted stock counts can be approved.")
        self.approved_by = approved_by or self.approved_by
        self.status = StockCountStatus.APPROVED
        self.save(update_fields=["approved_by", "status", "updated_at"])

    def cancel(self):
        if self.inventory_changes_applied:
            raise ValidationError("Applied stock counts cannot be cancelled.")
        self.status = StockCountStatus.CANCELLED
        self.save(update_fields=["status", "updated_at"])

    def apply_variances(self):
        if self.inventory_changes_applied:
            raise ValidationError("Stock count variances have already been applied.")
        with transaction.atomic():
            stock_count = StockCount.objects.select_for_update().get(pk=self.pk)
            if stock_count.status != StockCountStatus.APPROVED:
                raise ValidationError("Only approved stock counts can be applied.")
            items = list(stock_count.items.select_related("item").all())
            if not items:
                raise ValidationError("Stock count must include at least one item.")
            for line in items:
                balance, _ = InventoryBalance.objects.select_for_update().get_or_create(
                    item=line.item,
                    store=stock_count.store,
                    defaults={"quantity_in_stock": Decimal("0.00")},
                )
                variance = line.physical_quantity - balance.quantity_in_stock
                if variance == Decimal("0.00"):
                    continue
                if line.physical_quantity < balance.quantity_reserved:
                    raise ValidationError(
                        f"Counted quantity for {line.item} is {line.physical_quantity}, below "
                        f"{balance.quantity_reserved} reserved for approved department requests. "
                        "Investigate the variance and release or fulfil the reservations first."
                    )
                balance.quantity_in_stock = line.physical_quantity
                balance.save(update_fields=["quantity_in_stock", "updated_at"])
                StockLedger.objects.create(
                    item=line.item,
                    store=stock_count.store,
                    quantity_in=variance if variance > 0 else Decimal("0.00"),
                    quantity_out=abs(variance) if variance < 0 else Decimal("0.00"),
                    reference_type=LedgerReferenceType.STOCK_COUNT,
                    reference_id=stock_count.id,
                    note=f"Stock count adjustment {stock_count.count_no}",
                    created_by=stock_count.created_by,
                )
            stock_count.inventory_changes_applied = True
            stock_count.status = StockCountStatus.APPLIED
            stock_count.save(update_fields=["inventory_changes_applied", "status", "updated_at"])
            self.inventory_changes_applied = True
            self.status = StockCountStatus.APPLIED

    def __str__(self):
        return self.count_no or f"Stock count {self.id}"


class StockCountItem(BaseModel):
    stock_count = models.ForeignKey(StockCount, on_delete=models.CASCADE, related_name="items")
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name="stock_count_items")
    system_quantity = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"), validators=[validate_non_negative_decimal])
    physical_quantity = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"), validators=[validate_non_negative_decimal])
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=("stock_count", "item"), name="unique_stock_count_item")
        ]
        ordering = ("item__name",)

    @property
    def variance(self):
        return self.physical_quantity - self.system_quantity

    def __str__(self):
        return f"{self.stock_count} - {self.item}"
