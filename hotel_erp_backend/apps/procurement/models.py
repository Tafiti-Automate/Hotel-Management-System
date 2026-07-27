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
            self.generate_approval_workflow()
        if not self.approval_workflow.exists():
            raise ValidationError(
                "No approval matrix matches this requisition. Configure an approval route before submission."
            )
        self.status = PRStatus.SUBMITTED
        self.save(update_fields=["status", "updated_at"])

    @property
    def estimated_total(self):
        return sum(
            (line.estimated_total for line in self.items.all()),
            Decimal("0.00"),
        ).quantize(Decimal("0.01"))

    def submission_readiness(self):
        blockers = []
        warnings = []
        items = list(self.items.all())
        if not items:
            blockers.append("Add at least one Article.")
        if any(item.quantity <= 0 for item in items):
            blockers.append("Every Article must have a positive requested quantity.")
        if any(item.estimated_unit_cost <= 0 for item in items):
            blockers.append("Enter an estimated unit cost for every Article.")
        if self.request_type == RequisitionType.DEPARTMENT:
            if not self.department_id:
                blockers.append("Assign the requesting department.")
            if not self.requester_id:
                blockers.append("Assign the employee requesting the purchase.")
        if not self.approval_workflow.exists():
            from apps.approvals.models import ApprovalMatrixRule

            if not ApprovalMatrixRule.matching_requisition_rules(self).exists():
                blockers.append(
                    f"No approval matrix matches this requisition value ({self.estimated_total})."
                )
        if not self.expected_date:
            warnings.append("No required delivery date has been entered.")
        return {"can_proceed": not blockers, "blockers": blockers, "warnings": warnings}

    def generate_approval_workflow(self):
        from apps.approvals.models import ApprovalMatrixRule, ApprovalWorkflow

        rules = list(ApprovalMatrixRule.matching_requisition_rules(self))
        if not rules:
            return []
        with transaction.atomic():
            ApprovalWorkflow.objects.filter(requisition=self).delete()
            return [
                ApprovalWorkflow.objects.create(
                    requisition=self,
                    approver=rule.approver,
                    stage=rule.stage,
                    stage_name=rule.stage_name,
                    matrix_rule=rule,
                    created_by=self.created_by,
                )
                for rule in rules
            ]

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

    def create_purchase_order(
        self,
        *,
        supplier=None,
        ordered_by=None,
        store=None,
        po_number="",
        expected_date=None,
        note="",
        created_by=None,
    ):
        if self.status != PRStatus.APPROVED:
            raise ValidationError("Purchase order can only be created from an approved requisition.")
        if not ordered_by:
            raise ValidationError("An ordering employee is required.")

        supplier = supplier or self.preferred_supplier or self._selected_supplier()
        if not supplier:
            raise ValidationError("A supplier is required to create a purchase order.")

        requisition_items = list(self.items.select_related("item").all())
        if not requisition_items:
            raise ValidationError("A purchase order requires at least one requisition item.")

        with transaction.atomic():
            order = PurchaseOrder.objects.create(
                requisition=self,
                supplier=supplier,
                ordered_by=ordered_by,
                store=store,
                po_number=po_number,
                expected_date=expected_date or self.expected_date,
                note=note,
                created_by=created_by,
            )
            for requisition_item in requisition_items:
                quantity, unit, unit_cost = self._order_pricing_for_item(
                    requisition_item,
                    supplier,
                )
                PurchaseOrderItem.objects.create(
                    purchase_order=order,
                    item=requisition_item.item,
                    unit=unit,
                    quantity=quantity,
                    unit_cost=unit_cost,
                    created_by=created_by,
                )
            order.refresh_from_db()
            return order

    def _selected_supplier(self):
        selected_quotes = (
            VendorQuotation.objects.filter(
                requisition=self,
                items__selected=True,
            )
            .select_related("supplier")
            .distinct()
        )
        if selected_quotes.count() == 1:
            return selected_quotes.first().supplier
        return None

    def _order_pricing_for_item(self, requisition_item, supplier):
        quotation_item = (
            VendorQuotationItem.objects.filter(
                requisition_item=requisition_item,
                quotation__supplier=supplier,
                selected=True,
            )
            .select_related("unit")
            .order_by("unit_price")
            .first()
        )
        if not quotation_item:
            quotation_item = (
                VendorQuotationItem.objects.filter(
                    requisition_item=requisition_item,
                    quotation__supplier=supplier,
                )
                .select_related("unit")
                .order_by("unit_price")
                .first()
            )
        if quotation_item:
            return quotation_item.quantity, quotation_item.unit, quotation_item.unit_price

        from apps.inventory.models import SupplierItemPrice

        supplier_price = (
            SupplierItemPrice.objects.filter(
                supplier=supplier,
                item=requisition_item.item,
                is_active=True,
            )
            .select_related("unit")
            .first()
        )
        if supplier_price:
            return requisition_item.quantity, supplier_price.unit, supplier_price.unit_price

        raise ValidationError(
            f"No selected quotation or supplier price was found for {requisition_item.item}."
        )


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
    estimated_unit_cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
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

    @property
    def estimated_total(self):
        return self.quantity * self.estimated_unit_cost


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
    tax_amount = models.DecimalField(
        max_digits=15, decimal_places=2, default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    transport_cost = models.DecimalField(
        max_digits=15, decimal_places=2, default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    discount_amount = models.DecimalField(
        max_digits=15, decimal_places=2, default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    payment_terms = models.CharField(max_length=200, blank=True)
    delivery_date = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    evaluation_score = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    evaluation_notes = models.TextField(blank=True)

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

    @property
    def subtotal(self):
        return sum((item.line_total for item in self.items.all()), Decimal("0.00"))

    def update_total_amount(self):
        self.total_amount = max(
            Decimal("0.00"),
            self.subtotal + self.tax_amount + self.transport_cost - self.discount_amount,
        )
        self.save(update_fields=["total_amount", "updated_at"])


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
    po_number = models.CharField(max_length=50, unique=True, blank=True)
    status = models.CharField(
        max_length=30,
        choices=POStatus.choices,
        default=POStatus.DRAFT,
    )
    expected_date = models.DateField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    sent_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.SET_NULL,
        related_name="sent_purchase_orders",
        null=True,
        blank=True,
    )
    sent_to_email = models.EmailField(blank=True)
    email_status = models.CharField(max_length=20, default="not_sent")
    last_email_error = models.TextField(blank=True)
    supplier_acknowledged_at = models.DateTimeField(null=True, blank=True)
    supplier_acknowledged_by = models.CharField(max_length=150, blank=True)
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

    def save(self, *args, **kwargs):
        if not self.po_number:
            self.po_number = self.next_po_number()
        super().save(*args, **kwargs)

    @classmethod
    def next_po_number(cls):
        prefix = f"PO-{timezone.localdate().year}"
        last_order = cls.objects.filter(po_number__startswith=prefix).order_by("po_number").last()
        next_number = 1
        if last_order and last_order.po_number:
            try:
                next_number = int(last_order.po_number.split("-")[-1]) + 1
            except (IndexError, ValueError):
                next_number = 1
        return f"{prefix}-{next_number:05d}"

    def clean(self):
        super().clean()
        if self.requisition_id and self.requisition.status != PRStatus.APPROVED:
            raise ValidationError("Purchase order can only be created from an approved requisition.")

    def update_total_amount(self):
        self.total_amount = sum(
            (item.line_total for item in self.items.all()),
            Decimal("0.00"),
        ).quantize(Decimal("0.01"))
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
                item.inventory_post_quantity()
                for item in GoodsReceiptItem.objects.filter(
                    goods_receipt__purchase_order=self,
                    inventory_changes_applied=True,
                ).select_related("goods_receipt")
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

    def issue(self, *, sent_by=None, sent_to_email=""):
        if self.status != POStatus.DRAFT:
            raise ValidationError("Only draft purchase orders can be sent to suppliers.")
        self.full_clean()
        if not self.items.exists():
            raise ValidationError("Purchase order must include at least one item before sending.")

        self.status = POStatus.ISSUED
        self.sent_at = timezone.now()
        self.sent_by = sent_by or self.sent_by
        self.sent_to_email = sent_to_email or self.sent_to_email or self.supplier.email
        self.save(update_fields=["status", "sent_at", "sent_by", "sent_to_email", "updated_at"])

    def acknowledge(self, acknowledged_by):
        if self.status not in (POStatus.ISSUED, POStatus.PARTIALLY_RECEIVED, POStatus.RECEIVED):
            raise ValidationError("Only an issued LPO can be acknowledged by the supplier.")
        if not acknowledged_by:
            raise ValidationError("Enter the supplier representative who acknowledged the LPO.")
        self.supplier_acknowledged_at = timezone.now()
        self.supplier_acknowledged_by = acknowledged_by
        self.save(update_fields=["supplier_acknowledged_at", "supplier_acknowledged_by", "updated_at"])

    def issue_readiness(self):
        blockers = []
        warnings = []
        if self.status != POStatus.DRAFT:
            blockers.append("Only a draft LPO can be sent to a supplier.")
        if self.requisition.status != PRStatus.APPROVED:
            blockers.append("The source requisition must be fully approved.")
        if not self.supplier_id:
            blockers.append("Assign a supplier.")
        if not self.items.exists():
            blockers.append("Add at least one Article to the LPO.")
        if not self.store_id:
            warnings.append(
                "No receiving store is assigned; receipt lines must use direct department issue."
            )
        if not self.sent_to_email and not self.supplier.email:
            blockers.append("The supplier must have an email address before the LPO is sent.")
        return {"can_proceed": not blockers, "blockers": blockers, "warnings": warnings}


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
    grn_number = models.CharField(max_length=50, unique=True, blank=True)
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
    delivery_note_no = models.CharField(max_length=100, blank=True)
    note = models.TextField(blank=True)
    posted_at = models.DateTimeField(null=True, blank=True)
    posted_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.SET_NULL,
        related_name="posted_goods_receipts",
        null=True,
        blank=True,
    )

    class Meta(BaseModel.Meta):
        ordering = ("-received_date", "-created_at")

    def __str__(self):
        return self.grn_number or f"GRN-{self.id}"

    def save(self, *args, **kwargs):
        if not self.grn_number:
            prefix = f"GRN-{timezone.localdate().year}"
            last_receipt = GoodsReceiptNote.objects.filter(
                grn_number__startswith=prefix
            ).order_by("grn_number").last()
            next_number = 1
            if last_receipt and last_receipt.grn_number:
                try:
                    next_number = int(last_receipt.grn_number.split("-")[-1]) + 1
                except (IndexError, ValueError):
                    next_number = 1
            self.grn_number = f"{prefix}-{next_number:05d}"
        super().save(*args, **kwargs)

    def clean(self):
        super().clean()
        if self.purchase_order_id and self.purchase_order.status not in (
            POStatus.ISSUED,
            POStatus.PARTIALLY_RECEIVED,
        ):
            raise ValidationError("Goods can only be received against a sent purchase order.")
        if self.delivery_note_no:
            duplicate = GoodsReceiptNote.objects.filter(
                purchase_order__supplier=self.purchase_order.supplier,
                delivery_note_no__iexact=self.delivery_note_no.strip(),
            )
            if self.pk:
                duplicate = duplicate.exclude(pk=self.pk)
            if duplicate.exists():
                raise ValidationError(
                    {"delivery_note_no": "This supplier delivery note has already been received."}
                )

    def post_to_inventory(self, posted_by=None):
        receipt_items = list(
            self.items.select_related("purchase_order_item", "item", "store")
        )
        if not receipt_items:
            raise ValidationError("Goods receipt must include at least one item.")

        with transaction.atomic():
            for receipt_item in receipt_items:
                receipt_item.post_to_inventory()

            self.purchase_order.update_receipt_status()
            self.posted_at = timezone.now()
            self.posted_by = posted_by or self.posted_by
            self.save(update_fields=["posted_at", "posted_by", "updated_at"])

    def posting_readiness(self):
        blockers = []
        warnings = []
        if self.purchase_order.status not in (POStatus.ISSUED, POStatus.PARTIALLY_RECEIVED):
            blockers.append("The LPO must be issued before goods can be posted.")
        lines = list(self.items.all())
        if not lines:
            blockers.append("Add at least one delivered Article.")
        for line in lines:
            if not line.store_id and not line.direct_issue_department_id:
                blockers.append(f"Choose a store or direct-issue department for {line.item}.")
            try:
                line.inventory_post_quantity(require_accepted=True)
            except ValidationError as error:
                blockers.extend(error.messages)
        if not hasattr(self, "inspection"):
            blockers.append("Complete goods inspection before posting the GRN to inventory.")
        return {"can_proceed": not blockers, "blockers": blockers, "warnings": warnings}


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
    direct_issue_department = models.ForeignKey(
        "departments.Department",
        on_delete=models.PROTECT,
        related_name="direct_goods_receipts",
        null=True,
        blank=True,
        help_text="Use instead of a store when accepted goods go directly to a department.",
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
        if not self.store_id and not self.direct_issue_department_id:
            self.store = self.goods_receipt.purchase_order.store
        if not self.unit_cost:
            self.unit_cost = self.purchase_order_item.unit_cost
        if not self.expiry_date:
            self.expiry_date = self.purchase_order_item.expiry_date
        super().save(*args, **kwargs)

    def clean(self):
        super().clean()
        if self.store_id and self.direct_issue_department_id:
            raise ValidationError(
                "A receipt line cannot be posted to both a store and a department."
            )

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
            if not receipt_item.store_id and not receipt_item.direct_issue_department_id:
                raise ValidationError(
                    "Goods receipt item must have a store or direct-issue department before posting."
                )
            if receipt_item.goods_receipt.purchase_order.status not in (
                POStatus.ISSUED,
                POStatus.PARTIALLY_RECEIVED,
            ):
                raise ValidationError("Goods can only be posted against a sent purchase order.")

            post_quantity = receipt_item.inventory_post_quantity(require_accepted=True)

            if receipt_item.direct_issue_department_id:
                from apps.inventory.models import DepartmentConsumption

                DepartmentConsumption.objects.create(
                    department=receipt_item.direct_issue_department,
                    goods_receipt_item=receipt_item,
                    item=receipt_item.item,
                    quantity=post_quantity,
                    unit_cost=receipt_item.unit_cost,
                    consumed_on=receipt_item.goods_receipt.received_date,
                    purpose=f"Direct supplier issue against {receipt_item.goods_receipt.purchase_order}",
                    created_by=receipt_item.created_by,
                )
                receipt_item.inventory_changes_applied = True
                receipt_item.save(update_fields=["inventory_changes_applied", "updated_at"])
                receipt_item.goods_receipt.purchase_order.update_receipt_status()
                self.inventory_changes_applied = True
                return

            balance, _ = InventoryBalance.objects.select_for_update().get_or_create(
                item=receipt_item.item,
                store=receipt_item.store,
                defaults={"quantity_in_stock": Decimal("0.00")},
            )
            balance.quantity_in_stock += post_quantity
            balance.save(update_fields=["quantity_in_stock", "updated_at"])

            InventoryBatch.objects.create(
                item=receipt_item.item,
                store=receipt_item.store,
                quantity=post_quantity,
                remaining_quantity=post_quantity,
                unit_cost=receipt_item.unit_cost,
                expiry_date=receipt_item.expiry_date,
                purchase_order_item=receipt_item.purchase_order_item,
                created_by=receipt_item.created_by,
            )
            StockLedger.objects.create(
                item=receipt_item.item,
                store=receipt_item.store,
                quantity_in=post_quantity,
                reference_type=LedgerReferenceType.GOODS_RECEIPT,
                reference_id=receipt_item.goods_receipt.id,
                note=f"Received against {receipt_item.goods_receipt}",
                created_by=receipt_item.created_by,
            )

            receipt_item.inventory_changes_applied = True
            receipt_item.save(update_fields=["inventory_changes_applied", "updated_at"])
            receipt_item.goods_receipt.purchase_order.update_receipt_status()
            self.inventory_changes_applied = True

    def inventory_post_quantity(self, require_accepted=False):
        try:
            inspection = self.goods_receipt.inspection
        except GoodsInspection.DoesNotExist:
            inspection = None

        if not inspection:
            return self.base_quantity

        inspection_item = inspection.items.filter(goods_receipt_item=self).first()
        if not inspection_item:
            raise ValidationError("Inspected receipts must include an inspection line before posting.")
        if inspection_item.quantity_accepted <= Decimal("0.00"):
            raise ValidationError("Only accepted inspection quantities can be posted to inventory.")
        if require_accepted and inspection.status not in (
            GoodsInspectionStatus.ACCEPTED,
            GoodsInspectionStatus.PARTIALLY_ACCEPTED,
        ):
            raise ValidationError("Goods inspection must be accepted before posting to inventory.")
        return inspection_item.quantity_accepted

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
        self.quotation.update_total_amount()

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
    dispatched_at = models.DateTimeField(null=True, blank=True)
    dispatched_by = models.ForeignKey(
        "employees.Employee", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="dispatched_supplier_returns",
    )
    supplier_acknowledged_at = models.DateTimeField(null=True, blank=True)
    supplier_acknowledged_by = models.CharField(max_length=150, blank=True)
    credit_note_number = models.CharField(max_length=100, blank=True)
    replacement_expected_date = models.DateField(null=True, blank=True)
    replacement_received_at = models.DateTimeField(null=True, blank=True)
    replacement_notes = models.TextField(blank=True)

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

    def apply_inventory_changes(self, dispatched_by=None):
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
            supplier_return.dispatched_at = timezone.now()
            supplier_return.dispatched_by = dispatched_by or supplier_return.dispatched_by
            supplier_return.save(update_fields=["inventory_changes_applied", "status", "dispatched_at", "dispatched_by", "updated_at"])
            self.inventory_changes_applied = True
            self.status = SupplierReturnStatus.POSTED
            self.dispatched_at = supplier_return.dispatched_at

    def acknowledge(self, *, acknowledged_by, credit_note_number="", replacement_expected_date=None):
        if self.status != SupplierReturnStatus.POSTED:
            raise ValidationError("The return must be dispatched before supplier acknowledgement.")
        if not acknowledged_by:
            raise ValidationError("Enter the supplier representative who acknowledged the return.")
        self.supplier_acknowledged_at = timezone.now()
        self.supplier_acknowledged_by = acknowledged_by
        self.credit_note_number = credit_note_number
        self.replacement_expected_date = replacement_expected_date
        self.save(update_fields=[
            "supplier_acknowledged_at", "supplier_acknowledged_by",
            "credit_note_number", "replacement_expected_date", "updated_at",
        ])

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


class ProcurementAttachment(BaseModel):
    DOCUMENT_QUOTATION = "quotation"
    DOCUMENT_PURCHASE_ORDER = "purchase_order"
    DOCUMENT_GRN = "grn"
    DOCUMENT_INSPECTION = "inspection"
    DOCUMENT_SUPPLIER_RETURN = "supplier_return"
    DOCUMENT_CHOICES = (
        (DOCUMENT_QUOTATION, "Supplier quotation"),
        (DOCUMENT_PURCHASE_ORDER, "Purchase order"),
        (DOCUMENT_GRN, "Goods receipt"),
        (DOCUMENT_INSPECTION, "Inspection"),
        (DOCUMENT_SUPPLIER_RETURN, "Supplier return"),
    )
    CATEGORY_CHOICES = (
        ("quotation", "Quotation"),
        ("delivery_note", "Delivery note"),
        ("invoice", "Invoice"),
        ("inspection_photo", "Inspection photograph"),
        ("supporting", "Supporting document"),
    )

    document_type = models.CharField(max_length=30, choices=DOCUMENT_CHOICES)
    document_id = models.UUIDField(db_index=True)
    category = models.CharField(max_length=30, choices=CATEGORY_CHOICES, default="supporting")
    file = models.FileField(upload_to="procurement/%Y/%m/")
    original_name = models.CharField(max_length=255)
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.get_category_display()}: {self.original_name}"


class ProcurementCommunication(BaseModel):
    CHANNEL_EMAIL = "email"
    DIRECTION_OUTBOUND = "outbound"
    DIRECTION_INBOUND = "inbound"
    purchase_order = models.ForeignKey(
        PurchaseOrder, on_delete=models.CASCADE, related_name="communications",
        null=True, blank=True,
    )
    supplier = models.ForeignKey(
        "vendors.Supplier", on_delete=models.PROTECT, related_name="procurement_communications",
    )
    channel = models.CharField(max_length=20, default=CHANNEL_EMAIL)
    direction = models.CharField(max_length=20, default=DIRECTION_OUTBOUND)
    recipient = models.CharField(max_length=255, blank=True)
    subject = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, default="pending")
    sent_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)
