from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models
from django.db import transaction
from django.utils import timezone

from core.constants.choices import GoodsInspectionStatus, POStatus, PRStatus, RequisitionType, SupplierReturnStatus
from core.mixins.models import BaseModel
from core.validators.quantities import validate_non_negative_decimal, validate_positive_decimal


class PurchaseRequisition(BaseModel):
    request_type = models.CharField(
        max_length=30,
        choices=RequisitionType.choices,
        default=RequisitionType.DEPARTMENT,
    )
    requester = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="purchase_requisitions",
        null=True,
        blank=True,
    )
    department = models.ForeignKey(
        "departments.Department",
        on_delete=models.PROTECT,
        related_name="purchase_requisitions",
        null=True,
        blank=True,
    )
    preferred_supplier = models.ForeignKey(
        "vendors.Supplier",
        on_delete=models.PROTECT,
        related_name="preferred_requisitions",
        null=True,
        blank=True,
    )
    status = models.CharField(
        max_length=30,
        choices=PRStatus.choices,
        default=PRStatus.DRAFT,
    )
    reason = models.TextField()
    expected_date = models.DateField(null=True, blank=True)
    control_notes = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def __str__(self):
        return f"PR-{self.id} ({self.get_request_type_display()})"

    def clean(self):
        super().clean()
        errors = {}
        if self.request_type == RequisitionType.DEPARTMENT:
            if not self.requester_id:
                errors["requester"] = "Department requisitions require a requester."
            if not self.department_id:
                errors["department"] = "Department requisitions require a department."
        if errors:
            raise ValidationError(errors)

    def submit(self):
        if self.status not in (PRStatus.DRAFT, PRStatus.REJECTED):
            raise ValidationError("Only draft or rejected requisitions can be submitted.")
        self.full_clean()
        if not self.items.exists():
            raise ValidationError("A requisition must include at least one item before submission.")
        if not self.approval_workflow.exists():
            raise ValidationError("A requisition must have approval stages before submission.")
        self.status = PRStatus.SUBMITTED
        self.save(update_fields=["status", "updated_at"])

    def cancel(self):
        if self.status == PRStatus.APPROVED:
            raise ValidationError("Approved requisitions cannot be cancelled.")
        self.status = PRStatus.CANCELLED
        self.save(update_fields=["status", "updated_at"])

    def sync_approval_status(self):
        approval_steps = list(self.approval_workflow.order_by("stage"))
        if not approval_steps:
            return

        from core.constants.choices import ApprovalStatus

        if any(step.status == ApprovalStatus.REJECTED for step in approval_steps):
            self.status = PRStatus.REJECTED
            self.save(update_fields=["status", "updated_at"])
            return

        completed_statuses = (ApprovalStatus.APPROVED, ApprovalStatus.SKIPPED)
        if all(step.status in completed_statuses for step in approval_steps):
            self.status = PRStatus.APPROVED
            self.save(update_fields=["status", "updated_at"])
            return

        completed_steps = [
            step.stage for step in approval_steps if step.status in completed_statuses
        ]
        if completed_steps:
            self.status = self._status_for_completed_stage(max(completed_steps))
            self.save(update_fields=["status", "updated_at"])

    def _status_for_completed_stage(self, stage):
        if stage <= 1:
            if self.request_type == RequisitionType.HOTEL_PURCHASE:
                return PRStatus.PROCUREMENT_APPROVED
            return PRStatus.HOD_APPROVED
        if stage == 2:
            return PRStatus.FINANCE_APPROVED
        return PRStatus.DIRECTOR_APPROVED


class RequisitionItem(BaseModel):
    requisition = models.ForeignKey(
        PurchaseRequisition,
        on_delete=models.CASCADE,
        related_name="items",
    )
    item = models.ForeignKey(
        "inventory.Item",
        on_delete=models.PROTECT,
        related_name="requisition_items",
    )
    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("requisition", "item"),
                name="unique_requisition_item",
            )
        ]
        ordering = ("item__name",)

    def __str__(self):
        return f"{self.requisition} - {self.item} x {self.quantity}"


class VendorQuotation(BaseModel):
    requisition = models.ForeignKey(
        PurchaseRequisition,
        on_delete=models.CASCADE,
        related_name="vendor_quotations",
    )
    supplier = models.ForeignKey(
        "vendors.Supplier",
        on_delete=models.PROTECT,
        related_name="quotations",
    )
    total_amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("requisition", "supplier"),
                name="unique_requisition_supplier_quotation",
            )
        ]
        ordering = ("total_amount",)

    def __str__(self):
        return f"{self.supplier} quote for {self.requisition}"


class PurchaseOrder(BaseModel):
    requisition = models.ForeignKey(
        PurchaseRequisition,
        on_delete=models.PROTECT,
        related_name="purchase_orders",
    )
    supplier = models.ForeignKey(
        "vendors.Supplier",
        on_delete=models.PROTECT,
        related_name="purchase_orders",
    )
    ordered_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="purchase_orders",
    )
    store = models.ForeignKey(
        "inventory.StoreLocation",
        on_delete=models.PROTECT,
        related_name="purchase_orders",
        null=True,
        blank=True,
    )
    po_number = models.CharField(max_length=50, unique=True)
    status = models.CharField(
        max_length=30,
        choices=POStatus.choices,
        default=POStatus.DRAFT,
    )
    expected_date = models.DateField(null=True, blank=True)
    note = models.TextField(blank=True)
    total_amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def __str__(self):
        return self.po_number

    def clean(self):
        super().clean()
        if self.requisition_id and self.requisition.status != PRStatus.APPROVED:
            raise ValidationError("Purchase order can only be created from an approved requisition.")

    def update_total_amount(self):
        self.total_amount = sum(item.line_total for item in self.items.all())
        self.save(update_fields=["total_amount", "updated_at"])

    def update_receipt_status(self):
        ordered_total = sum(
            (item.base_quantity for item in self.items.all()),
            Decimal("0.00"),
        )
        if ordered_total <= Decimal("0.00"):
            return

        received_total = sum(
            (
                item.base_quantity
                for item in GoodsReceiptItem.objects.filter(
                    goods_receipt__purchase_order=self,
                    inventory_changes_applied=True,
                )
            ),
            Decimal("0.00"),
        )
        if received_total >= ordered_total:
            status = POStatus.RECEIVED
        elif received_total > Decimal("0.00"):
            status = POStatus.PARTIALLY_RECEIVED
        else:
            return

        if self.status != status:
            self.status = status
            self.save(update_fields=["status", "updated_at"])


class PurchaseOrderItem(BaseModel):
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.CASCADE,
        related_name="items",
    )
    item = models.ForeignKey(
        "inventory.Item",
        on_delete=models.PROTECT,
        related_name="purchase_order_items",
    )
    unit = models.ForeignKey(
        "inventory.UnitOfMeasure",
        on_delete=models.PROTECT,
        related_name="purchase_order_items",
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
    unit_cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    expiry_date = models.DateField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("purchase_order", "item", "unit"),
                name="unique_purchase_order_item_unit",
            )
        ]
        ordering = ("item__name",)

    @property
    def line_total(self):
        return (self.base_quantity or Decimal("0.00")) * (self.unit_cost or Decimal("0.00"))

    def save(self, *args, **kwargs):
        if self.unit_id:
            from apps.inventory.models import ItemUnitPrice

            item_unit = ItemUnitPrice.objects.filter(item=self.item, unit=self.unit).first()
            self.base_quantity = self.quantity * item_unit.conversion_factor if item_unit else self.quantity
        else:
            self.base_quantity = self.quantity
        super().save(*args, **kwargs)
        self.purchase_order.update_total_amount()

    def __str__(self):
        return f"{self.purchase_order} - {self.item} x {self.base_quantity}"


class GoodsReceiptNote(BaseModel):
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.PROTECT,
        related_name="goods_receipt_notes",
    )
    received_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="goods_receipt_notes",
    )
    received_date = models.DateField(default=timezone.localdate)
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-received_date", "-created_at")

    def __str__(self):
        return f"GRN-{self.id}"

    def post_to_inventory(self):
        receipt_items = list(
            self.items.select_related("purchase_order_item", "item", "store")
        )
        if not receipt_items:
            raise ValidationError("Goods receipt must include at least one item.")

        for receipt_item in receipt_items:
            receipt_item.post_to_inventory()

        self.purchase_order.update_receipt_status()


class GoodsReceiptItem(BaseModel):
    goods_receipt = models.ForeignKey(
        GoodsReceiptNote,
        on_delete=models.CASCADE,
        related_name="items",
    )
    purchase_order_item = models.ForeignKey(
        PurchaseOrderItem,
        on_delete=models.PROTECT,
        related_name="receipt_items",
    )
    item = models.ForeignKey(
        "inventory.Item",
        on_delete=models.PROTECT,
        related_name="goods_receipt_items",
    )
    store = models.ForeignKey(
        "inventory.StoreLocation",
        on_delete=models.PROTECT,
        related_name="goods_receipt_items",
        null=True,
        blank=True,
    )
    quantity_received = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    base_quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    unit_cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    expiry_date = models.DateField(null=True, blank=True)
    inventory_changes_applied = models.BooleanField(default=False)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("goods_receipt", "purchase_order_item"),
                name="unique_goods_receipt_purchase_order_item",
            )
        ]
        ordering = ("item__name",)

    def save(self, *args, **kwargs):
        self.item = self.purchase_order_item.item
        self.base_quantity = self.quantity_received
        if self.purchase_order_item.unit_id:
            from apps.inventory.models import ItemUnitPrice

            item_unit = ItemUnitPrice.objects.filter(
                item=self.purchase_order_item.item,
                unit=self.purchase_order_item.unit,
            ).first()
            if item_unit:
                self.base_quantity = self.quantity_received * item_unit.conversion_factor
        if not self.store_id:
            self.store = self.goods_receipt.purchase_order.store
        if not self.unit_cost:
            self.unit_cost = self.purchase_order_item.unit_cost
        if not self.expiry_date:
            self.expiry_date = self.purchase_order_item.expiry_date
        super().save(*args, **kwargs)

    def post_to_inventory(self):
        from apps.inventory.models import (
            InventoryBalance,
            InventoryBatch,
            StockLedger,
        )
        from core.constants.choices import LedgerReferenceType

        if self.inventory_changes_applied:
            raise ValidationError("Goods receipt item has already been posted.")

        with transaction.atomic():
            receipt_item = (
                GoodsReceiptItem.objects.select_for_update()
                .select_related(
                    "goods_receipt__purchase_order",
                    "purchase_order_item",
                    "item",
                    "store",
                )
                .get(pk=self.pk)
            )
            if receipt_item.inventory_changes_applied:
                raise ValidationError("Goods receipt item has already been posted.")
            if not receipt_item.store_id:
                raise ValidationError("Goods receipt item must have a store before posting.")

            balance, _ = InventoryBalance.objects.select_for_update().get_or_create(
                item=receipt_item.item,
                store=receipt_item.store,
                defaults={"quantity_in_stock": Decimal("0.00")},
            )
            balance.quantity_in_stock += receipt_item.base_quantity
            balance.save(update_fields=["quantity_in_stock", "updated_at"])

            InventoryBatch.objects.create(
                item=receipt_item.item,
                store=receipt_item.store,
                quantity=receipt_item.base_quantity,
                remaining_quantity=receipt_item.base_quantity,
                unit_cost=receipt_item.unit_cost,
                expiry_date=receipt_item.expiry_date,
                purchase_order_item=receipt_item.purchase_order_item,
                created_by=receipt_item.created_by,
            )
            StockLedger.objects.create(
                item=receipt_item.item,
                store=receipt_item.store,
                quantity_in=receipt_item.base_quantity,
                reference_type=LedgerReferenceType.GOODS_RECEIPT,
                reference_id=receipt_item.goods_receipt.id,
                note=f"Received against {receipt_item.goods_receipt}",
                created_by=receipt_item.created_by,
            )

            receipt_item.inventory_changes_applied = True
            receipt_item.save(update_fields=["inventory_changes_applied", "updated_at"])
            receipt_item.goods_receipt.purchase_order.update_receipt_status()
            self.inventory_changes_applied = True

    def __str__(self):
        return f"{self.goods_receipt} - {self.item} x {self.base_quantity}"

class VendorQuotationItem(BaseModel):
    quotation = models.ForeignKey(
        VendorQuotation,
        on_delete=models.CASCADE,
        related_name="items",
    )
    requisition_item = models.ForeignKey(
        RequisitionItem,
        on_delete=models.PROTECT,
        related_name="quotation_items",
    )
    item = models.ForeignKey(
        "inventory.Item",
        on_delete=models.PROTECT,
        related_name="quotation_items",
    )
    unit = models.ForeignKey(
        "inventory.UnitOfMeasure",
        on_delete=models.PROTECT,
        related_name="quotation_items",
        null=True,
        blank=True,
    )
    quantity = models.DecimalField(max_digits=12, decimal_places=2, validators=[validate_positive_decimal])
    unit_price = models.DecimalField(max_digits=15, decimal_places=2, validators=[validate_positive_decimal])
    delivery_days = models.PositiveIntegerField(default=0)
    selected = models.BooleanField(default=False)
    selection_reason = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("quotation", "requisition_item", "unit"),
                name="unique_quotation_requisition_item_unit",
            )
        ]
        ordering = ("item__name",)

    @property
    def line_total(self):
        return (self.quantity or Decimal("0.00")) * (self.unit_price or Decimal("0.00"))

    def save(self, *args, **kwargs):
        self.item = self.requisition_item.item
        super().save(*args, **kwargs)
        self.quotation.total_amount = sum(
            (item.line_total for item in self.quotation.items.all()),
            Decimal("0.00"),
        )
        self.quotation.save(update_fields=["total_amount", "updated_at"])

    def __str__(self):
        return f"{self.quotation} - {self.item} x {self.quantity}"


class GoodsInspection(BaseModel):
    goods_receipt = models.OneToOneField(
        GoodsReceiptNote,
        on_delete=models.CASCADE,
        related_name="inspection",
    )
    inspected_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="goods_inspections",
    )
    inspection_date = models.DateField(default=timezone.localdate)
    status = models.CharField(
        max_length=30,
        choices=GoodsInspectionStatus.choices,
        default=GoodsInspectionStatus.PENDING,
    )
    delivery_note_no = models.CharField(max_length=100, blank=True)
    remarks = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-inspection_date", "-created_at")

    def update_status(self):
        from core.constants.choices import GoodsInspectionStatus
        items = list(self.items.all())
        if not items:
            return
        accepted = sum((item.quantity_accepted for item in items), Decimal("0.00"))
        rejected = sum((item.quantity_rejected for item in items), Decimal("0.00"))
        received = sum((item.quantity_received for item in items), Decimal("0.00"))
        if accepted >= received and rejected == Decimal("0.00"):
            self.status = GoodsInspectionStatus.ACCEPTED
        elif accepted > Decimal("0.00") and rejected > Decimal("0.00"):
            self.status = GoodsInspectionStatus.PARTIALLY_ACCEPTED
        elif rejected >= received:
            self.status = GoodsInspectionStatus.REJECTED
        self.save(update_fields=["status", "updated_at"])

    def __str__(self):
        return f"Inspection for {self.goods_receipt}"


class GoodsInspectionItem(BaseModel):
    inspection = models.ForeignKey(
        GoodsInspection,
        on_delete=models.CASCADE,
        related_name="items",
    )
    goods_receipt_item = models.ForeignKey(
        GoodsReceiptItem,
        on_delete=models.PROTECT,
        related_name="inspection_items",
    )
    item = models.ForeignKey(
        "inventory.Item",
        on_delete=models.PROTECT,
        related_name="inspection_items",
    )
    quantity_received = models.DecimalField(max_digits=12, decimal_places=2, validators=[validate_positive_decimal])
    quantity_accepted = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    quantity_rejected = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    rejection_reason = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("inspection", "goods_receipt_item"),
                name="unique_inspection_receipt_item",
            )
        ]
        ordering = ("item__name",)

    def clean(self):
        super().clean()
        if self.quantity_accepted + self.quantity_rejected > self.quantity_received:
            raise ValidationError("Accepted plus rejected quantity cannot exceed received quantity.")

    def save(self, *args, **kwargs):
        self.item = self.goods_receipt_item.item
        if not self.quantity_received:
            self.quantity_received = self.goods_receipt_item.base_quantity
        self.full_clean()
        super().save(*args, **kwargs)
        self.inspection.update_status()

    def __str__(self):
        return f"{self.inspection} - {self.item}"


class SupplierReturn(BaseModel):
    return_no = models.CharField(max_length=50, unique=True, blank=True)
    supplier = models.ForeignKey(
        "vendors.Supplier",
        on_delete=models.PROTECT,
        related_name="supplier_returns",
    )
    goods_receipt = models.ForeignKey(
        GoodsReceiptNote,
        on_delete=models.PROTECT,
        related_name="supplier_returns",
    )
    store = models.ForeignKey(
        "inventory.StoreLocation",
        on_delete=models.PROTECT,
        related_name="supplier_returns",
    )
    returned_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="supplier_returns",
    )
    return_date = models.DateField(default=timezone.localdate)
    status = models.CharField(
        max_length=20,
        choices=SupplierReturnStatus.choices,
        default=SupplierReturnStatus.DRAFT,
    )
    reason = models.TextField()
    inventory_changes_applied = models.BooleanField(default=False)

    class Meta(BaseModel.Meta):
        ordering = ("-return_date", "-created_at")

    def save(self, *args, **kwargs):
        if not self.return_no:
            prefix = f"SRV-{timezone.localdate().year}"
            last_return = SupplierReturn.objects.filter(return_no__startswith=prefix).order_by("return_no").last()
            next_number = 1
            if last_return and last_return.return_no:
                try:
                    next_number = int(last_return.return_no.split("-")[-1]) + 1
                except (IndexError, ValueError):
                    next_number = 1
            self.return_no = f"{prefix}-{next_number:05d}"
        super().save(*args, **kwargs)

    def apply_inventory_changes(self):
        from apps.inventory.models import InventoryBalance, StockLedger
        from core.constants.choices import LedgerReferenceType, SupplierReturnStatus
        if self.inventory_changes_applied:
            raise ValidationError("Supplier return has already been applied.")
        with transaction.atomic():
            supplier_return = SupplierReturn.objects.select_for_update().get(pk=self.pk)
            items = list(supplier_return.items.select_related("item").all())
            if not items:
                raise ValidationError("Supplier return must include at least one item.")
            for line in items:
                balance = InventoryBalance.objects.select_for_update().filter(item=line.item, store=supplier_return.store).first()
                stock_on_hand = balance.quantity_in_stock if balance else Decimal("0.00")
                if stock_on_hand < line.base_quantity:
                    raise ValidationError(f"Insufficient stock to return {line.item}.")
            for line in items:
                balance = InventoryBalance.objects.select_for_update().get(item=line.item, store=supplier_return.store)
                balance.quantity_in_stock -= line.base_quantity
                balance.save(update_fields=["quantity_in_stock", "updated_at"])
                StockLedger.objects.create(
                    item=line.item,
                    store=supplier_return.store,
                    quantity_out=line.base_quantity,
                    reference_type=LedgerReferenceType.RETURN_TO_VENDOR,
                    reference_id=supplier_return.id,
                    note=f"Return to supplier {supplier_return.return_no}",
                    created_by=supplier_return.created_by,
                )
            supplier_return.inventory_changes_applied = True
            supplier_return.status = SupplierReturnStatus.POSTED
            supplier_return.save(update_fields=["inventory_changes_applied", "status", "updated_at"])
            self.inventory_changes_applied = True
            self.status = SupplierReturnStatus.POSTED

    def __str__(self):
        return self.return_no or f"Supplier return {self.id}"


class SupplierReturnItem(BaseModel):
    supplier_return = models.ForeignKey(SupplierReturn, on_delete=models.CASCADE, related_name="items")
    item = models.ForeignKey("inventory.Item", on_delete=models.PROTECT, related_name="supplier_return_items")
    unit = models.ForeignKey("inventory.UnitOfMeasure", on_delete=models.PROTECT, related_name="supplier_return_items", null=True, blank=True)
    quantity = models.DecimalField(max_digits=12, decimal_places=2, validators=[validate_positive_decimal])
    base_quantity = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    reason = models.TextField(blank=True)

    def save(self, *args, **kwargs):
        if self.unit_id:
            from apps.inventory.models import ItemUnitPrice
            item_unit = ItemUnitPrice.objects.filter(item=self.item, unit=self.unit).first()
            self.base_quantity = self.quantity * item_unit.conversion_factor if item_unit else self.quantity
        else:
            self.base_quantity = self.quantity
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.supplier_return} - {self.item} x {self.base_quantity}"
