from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models, transaction

from core.constants.choices import (
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
    description = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        verbose_name_plural = "categories"
        ordering = ("name",)

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
        ]
        ordering = ("item__name", "conversion_factor")

    def __str__(self):
        return f"{self.item} - {self.unit} x {self.conversion_factor}"


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
    unit_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    lead_time_days = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("supplier", "item"),
                name="unique_supplier_item_price",
            )
        ]
        ordering = ("item__name", "supplier__name")

    def __str__(self):
        return f"{self.supplier} - {self.item}: {self.unit_price}"


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
        if self.inventory_changes_applied:
            raise ValidationError("Inventory changes have already been applied.")

        with transaction.atomic():
            transfer = StockTransfer.objects.select_for_update().get(pk=self.pk)
            if transfer.inventory_changes_applied:
                raise ValidationError("Inventory changes have already been applied.")

            for item in transfer.items.select_related("item").all():
                source_balance, _ = InventoryBalance.objects.select_for_update().get_or_create(
                    item=item.item,
                    store=transfer.from_store,
                    defaults={"quantity_in_stock": Decimal("0.00")},
                )
                destination_balance, _ = InventoryBalance.objects.select_for_update().get_or_create(
                    item=item.item,
                    store=transfer.to_store,
                    defaults={"quantity_in_stock": Decimal("0.00")},
                )
                if source_balance.quantity_in_stock < item.base_quantity:
                    raise ValidationError(
                        f"Insufficient stock for {item.item} in {transfer.from_store}."
                    )
                source_balance.quantity_in_stock -= item.base_quantity
                destination_balance.quantity_in_stock += item.base_quantity
                source_balance.save(update_fields=["quantity_in_stock", "updated_at"])
                destination_balance.save(update_fields=["quantity_in_stock", "updated_at"])

                StockLedger.objects.create(
                    item=item.item,
                    store=transfer.from_store,
                    quantity_out=item.base_quantity,
                    reference_type=LedgerReferenceType.STOCK_TRANSFER,
                    reference_id=transfer.id,
                    note=f"Transfer to {transfer.to_store}",
                    created_by=transfer.created_by,
                )
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
            transfer.save(update_fields=["inventory_changes_applied", "status", "updated_at"])
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
        if self.unit_id:
            unit_price = ItemUnitPrice.objects.filter(item=self.item, unit=self.unit).first()
            if unit_price:
                self.base_quantity = self.quantity * unit_price.conversion_factor
            else:
                self.base_quantity = self.quantity
        else:
            self.base_quantity = self.quantity
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

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def apply(self):
        if self.status == StockAdjustmentStatus.APPLIED:
            raise ValidationError("Stock adjustment has already been applied.")

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
        help_text="Store expected to issue the requested stock.",
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
    status = models.CharField(
        max_length=20,
        choices=StoreRequisitionStatus.choices,
        default=StoreRequisitionStatus.DRAFT,
    )
    required_date = models.DateField(null=True, blank=True)
    purpose = models.TextField(blank=True)
    rejection_reason = models.TextField(blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    issued_at = models.DateTimeField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def __str__(self):
        return self.requisition_no or f"Store requisition {self.id}"

    def save(self, *args, **kwargs):
        if not self.requisition_no:
            from django.utils import timezone
            prefix = f"SR-{timezone.localdate().year}"
            last_request = (
                StoreRequisition.objects.filter(requisition_no__startswith=prefix)
                .order_by("requisition_no")
                .last()
            )
            next_number = 1
            if last_request and last_request.requisition_no:
                try:
                    next_number = int(last_request.requisition_no.split("-")[-1]) + 1
                except (IndexError, ValueError):
                    next_number = 1
            self.requisition_no = f"{prefix}-{next_number:05d}"
        super().save(*args, **kwargs)

    def submit(self):
        if self.status not in (StoreRequisitionStatus.DRAFT, StoreRequisitionStatus.REJECTED):
            raise ValidationError("Only draft or rejected store requisitions can be submitted.")
        if not self.items.exists():
            raise ValidationError("Store requisition must include at least one item.")
        self.status = StoreRequisitionStatus.SUBMITTED
        self.save(update_fields=["status", "updated_at"])

    def approve(self, approved_by=None):
        if self.status not in (StoreRequisitionStatus.SUBMITTED, StoreRequisitionStatus.PARTIALLY_APPROVED):
            raise ValidationError("Only submitted requisitions can be approved.")
        items = list(self.items.select_related("item", "unit").all())
        if not items:
            raise ValidationError("Store requisition must include at least one item.")
        for line in items:
            if line.quantity_approved <= Decimal("0.00"):
                line.quantity_approved = line.base_quantity_requested
                line.save(update_fields=["quantity_approved", "updated_at"])
        from django.utils import timezone
        self.approved_by = approved_by or self.approved_by
        self.approved_at = timezone.now()
        self.status = StoreRequisitionStatus.APPROVED
        self.save(update_fields=["approved_by", "approved_at", "status", "updated_at"])

    def reject(self, reason=""):
        if self.status not in (StoreRequisitionStatus.SUBMITTED, StoreRequisitionStatus.PARTIALLY_APPROVED):
            raise ValidationError("Only submitted requisitions can be rejected.")
        self.status = StoreRequisitionStatus.REJECTED
        self.rejection_reason = reason
        self.save(update_fields=["status", "rejection_reason", "updated_at"])

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

    def save(self, *args, **kwargs):
        if self.unit_id:
            unit_price = ItemUnitPrice.objects.filter(item=self.item, unit=self.unit).first()
            self.base_quantity_requested = self.quantity_requested * unit_price.conversion_factor if unit_price else self.quantity_requested
        else:
            self.base_quantity_requested = self.quantity_requested
        if self.quantity_approved > self.base_quantity_requested:
            raise ValidationError("Approved quantity cannot exceed requested quantity.")
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
                balance.quantity_in_stock -= line.base_quantity
                balance.save(update_fields=["quantity_in_stock", "updated_at"])
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
            issue.inventory_changes_applied = True
            issue.save(update_fields=["inventory_changes_applied", "updated_at"])
            issue.requisition.mark_issued_if_complete()
            self.inventory_changes_applied = True


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
        if self.unit_id:
            unit_price = ItemUnitPrice.objects.filter(item=self.item, unit=self.unit).first()
            self.base_quantity = self.quantity * unit_price.conversion_factor if unit_price else self.quantity
        else:
            self.base_quantity = self.quantity
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.issue} - {self.item} x {self.base_quantity}"


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
        if self.unit_id:
            unit_price = ItemUnitPrice.objects.filter(item=self.item, unit=self.unit).first()
            self.base_quantity = self.quantity * unit_price.conversion_factor if unit_price else self.quantity
        else:
            self.base_quantity = self.quantity
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
