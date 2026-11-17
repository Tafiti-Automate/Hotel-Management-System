import csv
import hashlib
import io
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone

from core.constants.choices import (
    GoodsReceiptStatus,
    LedgerReferenceType,
    POStatus,
    StockCountStatus,
    StockTransferStatus,
)
from core.mixins.models import BaseModel
from core.validators.quantities import validate_non_negative_decimal, validate_positive_decimal


class OutletAssignment(BaseModel):
    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="outlet_assignments"
    )
    outlet = models.ForeignKey(
        "inventory.StoreLocation", on_delete=models.CASCADE, related_name="outlet_assignments"
    )
    is_primary = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("employee", "outlet"), name="unique_employee_outlet_assignment"
            )
        ]
        ordering = ("outlet__name", "employee__user__username")

    def clean(self):
        super().clean()
        if (
            self.employee_id
            and self.outlet_id
            and self.employee.branch_id
            and self.outlet.branch_id
            and self.employee.branch_id != self.outlet.branch_id
        ):
            raise ValidationError(
                {"outlet": "The assigned outlet must belong to the employee's property."}
            )

    def __str__(self):
        return f"{self.employee} -> {self.outlet}"


class WasteRecord(BaseModel):
    STATUS_DRAFT = "draft"
    STATUS_SUBMITTED = "submitted"
    STATUS_REVIEWED = "reviewed"
    STATUS_FLAGGED = "flagged"
    STATUS_CHOICES = (
        (STATUS_DRAFT, "Draft"),
        (STATUS_SUBMITTED, "Submitted for review"),
        (STATUS_REVIEWED, "Reviewed"),
        (STATUS_FLAGGED, "Flagged for investigation"),
    )
    REASON_CHOICES = (
        ("broken_service", "Broken in service"),
        ("expired", "Expired"),
        ("prep_spoilage", "Kitchen prep spoilage"),
        ("vip_complimentary", "VIP complimentary"),
        ("staff_meal", "Staff meal"),
        ("quality_rejection", "Quality rejection"),
        ("other", "Other"),
    )

    outlet = models.ForeignKey(
        "inventory.StoreLocation", on_delete=models.PROTECT, related_name="waste_records"
    )
    department = models.ForeignKey(
        "departments.Department",
        on_delete=models.PROTECT,
        related_name="waste_records",
        null=True,
        blank=True,
    )
    item = models.ForeignKey(
        "inventory.Item", on_delete=models.PROTECT, related_name="waste_records"
    )
    unit = models.ForeignKey(
        "inventory.UnitOfMeasure",
        on_delete=models.PROTECT,
        related_name="waste_records",
        null=True,
        blank=True,
    )
    quantity = models.DecimalField(
        max_digits=12, decimal_places=2, validators=[validate_positive_decimal]
    )
    base_quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    reason_code = models.CharField(max_length=40, choices=REASON_CHOICES)
    note = models.TextField(blank=True)
    evidence = models.FileField(upload_to="waste_evidence/", null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    reported_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="reported_waste",
        null=True,
        blank=True,
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.SET_NULL,
        related_name="reviewed_waste",
        null=True,
        blank=True,
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)
    inventory_changes_applied = models.BooleanField(default=False)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def clean(self):
        super().clean()
        if self.item_id:
            self.base_quantity = self.item.quantity_in_base_units(
                self.quantity, self.unit
            ).quantize(Decimal("0.01"))
        if self.reason_code == "other" and not self.note.strip():
            raise ValidationError({"note": "Describe the reason when Other is selected."})

    def save(self, *args, **kwargs):
        if self.item_id:
            self.base_quantity = self.item.quantity_in_base_units(
                self.quantity, self.unit
            ).quantize(Decimal("0.01"))
        super().save(*args, **kwargs)

    def submit(self, actor):
        from apps.inventory.models import InventoryBalance, StockLedger

        if self.status != self.STATUS_DRAFT or self.inventory_changes_applied:
            raise ValidationError("Only a draft waste record can be submitted.")
        self.full_clean()
        with transaction.atomic():
            waste = WasteRecord.objects.select_for_update().get(pk=self.pk)
            # Recheck after locking: two workers can hold stale draft instances.
            if waste.status != self.STATUS_DRAFT or waste.inventory_changes_applied:
                raise ValidationError("Only a draft waste record can be submitted.")
            balance = (
                InventoryBalance.objects.select_for_update()
                .filter(item=waste.item, store=waste.outlet)
                .first()
            )
            available = balance.available_quantity if balance else Decimal("0.00")
            if available < waste.base_quantity:
                raise ValidationError(
                    f"Only {available} is available for {waste.item} in {waste.outlet}."
                )
            # Capture the original WAC before stock changes. A zero/unknown
            # WAC is not reliable cost evidence, so retain nullable snapshots.
            unit_cost = balance.weighted_average_cost
            valued = unit_cost > Decimal("0.0000")
            balance.quantity_in_stock -= waste.base_quantity
            balance.save(update_fields=("quantity_in_stock", "updated_at"))
            StockLedger.objects.create(
                item=waste.item,
                store=waste.outlet,
                quantity_out=waste.base_quantity,
                reference_type=LedgerReferenceType.WASTE,
                reference_id=waste.pk,
                unit_cost_snapshot=unit_cost if valued else None,
                total_cost_snapshot=(
                    waste.base_quantity * unit_cost
                ).quantize(Decimal("0.0001")) if valued else None,
                wac_before=unit_cost if valued else None,
                wac_after=unit_cost if valued else None,
                note=f"{waste.get_reason_code_display()}: {waste.note}".strip(": "),
                created_by=actor,
            )
            waste.status = self.STATUS_SUBMITTED
            waste.submitted_at = timezone.now()
            waste.inventory_changes_applied = True
            waste.save(
                update_fields=(
                    "status",
                    "submitted_at",
                    "inventory_changes_applied",
                    "updated_at",
                )
            )
            self.status = waste.status
            self.submitted_at = waste.submitted_at
            self.inventory_changes_applied = True

    def review(self, reviewer, *, flagged=False, note=""):
        if self.status not in (self.STATUS_SUBMITTED, self.STATUS_FLAGGED):
            raise ValidationError("Only submitted waste can be reviewed or flagged.")
        if flagged and not str(note).strip():
            raise ValidationError("Enter an investigation note before flagging waste.")
        self.status = self.STATUS_FLAGGED if flagged else self.STATUS_REVIEWED
        self.reviewed_by = reviewer
        self.reviewed_at = timezone.now()
        self.review_note = str(note).strip()
        self.save(
            update_fields=("status", "reviewed_by", "reviewed_at", "review_note", "updated_at")
        )

    def __str__(self):
        return f"{self.item} waste at {self.outlet}"


class Recipe(BaseModel):
    STATUS_DRAFT = "draft"
    STATUS_PUBLISHED = "published"
    STATUS_ARCHIVED = "archived"
    STATUS_CHOICES = (
        (STATUS_DRAFT, "Draft"),
        (STATUS_PUBLISHED, "Published"),
        (STATUS_ARCHIVED, "Archived"),
    )

    code = models.CharField(max_length=50, unique=True, blank=True)
    name = models.CharField(max_length=180)
    outlet = models.ForeignKey(
        "inventory.StoreLocation", on_delete=models.PROTECT, related_name="recipes"
    )
    yield_quantity = models.DecimalField(
        max_digits=12, decimal_places=2, validators=[validate_positive_decimal]
    )
    yield_unit = models.CharField(max_length=40, default="Portions")
    target_food_cost_percent = models.DecimalField(
        max_digits=5, decimal_places=2, validators=[validate_positive_decimal]
    )
    selling_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    is_sub_recipe = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="published_recipes",
        null=True,
        blank=True,
    )
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=("outlet", "name"), name="unique_outlet_recipe_name")
        ]
        ordering = ("name",)

    def save(self, *args, **kwargs):
        if not self.code:
            prefix = "SUB" if self.is_sub_recipe else "RCP"
            self.code = f"{prefix}-{timezone.now().strftime('%Y%m%d%H%M%S%f')}"
        super().save(*args, **kwargs)

    @property
    def total_cost(self):
        return sum((line.ingredient_cost for line in self.ingredients.all()), Decimal("0.00"))

    @property
    def cost_per_yield(self):
        if not self.yield_quantity:
            return Decimal("0.00")
        return (self.total_cost / self.yield_quantity).quantize(Decimal("0.01"))

    @property
    def suggested_selling_price(self):
        if not self.target_food_cost_percent:
            return Decimal("0.00")
        return (self.cost_per_yield / (self.target_food_cost_percent / Decimal("100"))).quantize(
            Decimal("0.01")
        )

    def publish(self, actor):
        if self.status == self.STATUS_ARCHIVED:
            raise ValidationError("An archived recipe cannot be published.")
        if not self.ingredients.exists():
            raise ValidationError("Add at least one ingredient before publishing the recipe.")
        self.status = self.STATUS_PUBLISHED
        self.published_at = timezone.now()
        self.published_by = actor
        self.save(update_fields=("status", "published_at", "published_by", "updated_at"))

    def __str__(self):
        return f"{self.code} - {self.name}"


class RecipeIngredient(BaseModel):
    recipe = models.ForeignKey(Recipe, on_delete=models.CASCADE, related_name="ingredients")
    item = models.ForeignKey(
        "inventory.Item", on_delete=models.PROTECT, related_name="recipe_ingredients",
        null=True, blank=True,
    )
    sub_recipe = models.ForeignKey(
        Recipe, on_delete=models.PROTECT, related_name="used_in_recipes",
        null=True, blank=True,
        help_text="Published sub-recipe, in its configured yield unit.",
    )
    unit = models.ForeignKey(
        "inventory.UnitOfMeasure",
        on_delete=models.PROTECT,
        related_name="recipe_ingredients",
        null=True,
        blank=True,
    )
    quantity = models.DecimalField(
        max_digits=12, decimal_places=4, validators=[validate_positive_decimal]
    )
    base_quantity = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        default=Decimal("0.0000"),
        validators=[validate_non_negative_decimal],
    )
    trim_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    note = models.CharField(max_length=200, blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("recipe", "item"), condition=models.Q(item__isnull=False),
                name="unique_recipe_ingredient",
            ),
            models.UniqueConstraint(
                fields=("recipe", "sub_recipe"), condition=models.Q(sub_recipe__isnull=False),
                name="unique_recipe_sub_recipe",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(item__isnull=False, sub_recipe__isnull=True)
                    | models.Q(item__isnull=True, sub_recipe__isnull=False)
                ),
                name="recipe_ingredient_exactly_one_source",
            ),
        ]
        ordering = ("item__name", "sub_recipe__name")

    def clean(self):
        super().clean()
        if bool(self.item_id) == bool(self.sub_recipe_id):
            raise ValidationError("Choose either one Article or one sub-recipe, never both.")
        if self.trim_percent >= Decimal("100"):
            raise ValidationError({"trim_percent": "Trim percentage must be below 100%."})
        if self.recipe_id and self.recipe.status != Recipe.STATUS_DRAFT:
            raise ValidationError("Only draft recipes can be edited; publish a new revision.")
        if self.sub_recipe_id:
            if self.unit_id:
                raise ValidationError({"unit": "Sub-recipes use their yield unit; leave Article unit blank."})
            if not self.recipe_id:
                raise ValidationError({"recipe": "Choose a parent recipe."})
            if self.recipe_id == self.sub_recipe_id:
                raise ValidationError({"sub_recipe": "A recipe cannot contain itself."})
            if self.sub_recipe.outlet_id != self.recipe.outlet_id:
                raise ValidationError({"sub_recipe": "Sub-recipes must belong to the same outlet."})
            if self.sub_recipe.status != Recipe.STATUS_PUBLISHED:
                raise ValidationError({"sub_recipe": "Only published sub-recipes can be included."})
            seen = set()
            pending = [self.sub_recipe_id]
            while pending:
                recipe_id = pending.pop()
                if recipe_id == self.recipe_id:
                    raise ValidationError({"sub_recipe": "Circular sub-recipe nesting is not permitted."})
                if recipe_id in seen:
                    continue
                seen.add(recipe_id)
                pending.extend(
                    RecipeIngredient.objects.filter(recipe_id=recipe_id)
                    .exclude(sub_recipe_id__isnull=True)
                    .values_list("sub_recipe_id", flat=True)
                )

    def save(self, *args, **kwargs):
        self.base_quantity = (
            self.item.quantity_in_base_units(self.quantity, self.unit)
            if self.item_id
            else self.quantity
        ).quantize(Decimal("0.0001"))
        self.full_clean()
        super().save(*args, **kwargs)

    @property
    def gross_base_quantity(self):
        retained = Decimal("1") - (self.trim_percent / Decimal("100"))
        if retained <= 0:
            return Decimal("0.00")
        return (self.base_quantity / retained).quantize(Decimal("0.0001"))

    @property
    def current_base_unit_cost(self):
        if self.sub_recipe_id:
            return self.sub_recipe.cost_per_yield
        from apps.inventory.models import InventoryBalance, InventoryBatch, SupplierItemPrice

        balance = InventoryBalance.objects.filter(
            item=self.item, store=self.recipe.outlet
        ).first()
        if balance and balance.weighted_average_cost > 0:
            return balance.weighted_average_cost.quantize(Decimal("0.01"))

        batches = InventoryBatch.objects.filter(
            item=self.item,
            store=self.recipe.outlet,
            remaining_quantity__gt=0,
        )
        quantity = sum((row.remaining_quantity for row in batches), Decimal("0.00"))
        value = sum(
            (row.remaining_quantity * row.unit_cost for row in batches), Decimal("0.00")
        )
        if quantity > 0:
            return (value / quantity).quantize(Decimal("0.01"))
        prices = [
            row.base_unit_price
            for row in SupplierItemPrice.objects.filter(item=self.item, is_active=True).select_related(
                "item__base_unit", "unit"
            )
        ]
        return min(prices) if prices else Decimal("0.00")

    @property
    def ingredient_cost(self):
        return (self.gross_base_quantity * self.current_base_unit_cost).quantize(
            Decimal("0.01")
        )

    def __str__(self):
        return f"{self.recipe} - {self.sub_recipe or self.item}"


class POSPLUMapping(BaseModel):
    outlet = models.ForeignKey(
        "inventory.StoreLocation", on_delete=models.PROTECT, related_name="pos_plu_mappings"
    )
    external_plu = models.CharField(max_length=100)
    external_name = models.CharField(max_length=180, blank=True)
    recipe = models.ForeignKey(Recipe, on_delete=models.PROTECT, related_name="pos_mappings")
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=("outlet", "external_plu"), name="unique_outlet_plu")
        ]
        ordering = ("outlet__name", "external_plu")

    def clean(self):
        super().clean()
        if self.recipe_id and self.outlet_id and self.recipe.outlet_id != self.outlet_id:
            raise ValidationError({"recipe": "The mapped recipe must belong to this outlet."})
        if self.recipe_id and self.recipe.status != Recipe.STATUS_PUBLISHED:
            raise ValidationError({"recipe": "Only published recipes can be mapped to a POS PLU."})

    def __str__(self):
        return f"{self.external_plu} -> {self.recipe}"


class POSImportBatch(BaseModel):
    STATUS_PENDING = "pending"
    STATUS_UNMAPPED = "unmapped"
    STATUS_PROCESSED = "processed"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = (
        (STATUS_PENDING, "Pending"),
        (STATUS_UNMAPPED, "Unmapped PLUs"),
        (STATUS_PROCESSED, "Processed"),
        (STATUS_FAILED, "Failed"),
    )

    outlet = models.ForeignKey(
        "inventory.StoreLocation", on_delete=models.PROTECT, related_name="pos_imports"
    )
    business_date = models.DateField()
    source = models.CharField(max_length=80, default="POS")
    source_reference = models.CharField(max_length=120, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    processed_at = models.DateTimeField(null=True, blank=True)
    processed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="processed_pos_imports",
        null=True,
        blank=True,
    )
    error_message = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("outlet", "business_date", "source", "source_reference"),
                name="unique_pos_import_source_reference",
            )
        ]
        ordering = ("-business_date", "-created_at")

    def process(self, actor):
        from apps.inventory.models import InventoryBalance, StockLedger

        with transaction.atomic():
            batch = POSImportBatch.objects.select_for_update().get(pk=self.pk)
            lines = list(
                batch.lines.filter(inventory_changes_applied=False).select_for_update()
            )
            if not lines:
                if batch.lines.exists():
                    batch.status = self.STATUS_PROCESSED
                    batch.processed_at = batch.processed_at or timezone.now()
                    batch.processed_by = batch.processed_by or actor
                    batch.error_message = ""
                    batch.save(
                        update_fields=(
                            "status",
                            "processed_at",
                            "processed_by",
                            "error_message",
                            "updated_at",
                        )
                    )
                    self.status = batch.status
                    return
                raise ValidationError("Add at least one POS sale line before processing.")

            unmapped = []
            mapped = []
            demand_by_line = {}
            demand = {}
            for line in lines:
                mapping = POSPLUMapping.objects.filter(
                    outlet=batch.outlet,
                    external_plu=line.external_plu,
                    is_active=True,
                    recipe__status=Recipe.STATUS_PUBLISHED,
                ).select_related("recipe").first()
                if not mapping:
                    unmapped.append(line.external_plu)
                    continue
                line.mapping = mapping
                mapped.append(line)
                from apps.materials_control.recipe_costing import expand_recipe_demand
                expanded = expand_recipe_demand(
                    mapping.recipe, line.quantity, require_published=True
                )
                demand_by_line[line.pk] = expanded
                for item_id, required in expanded.items():
                    demand[item_id] = demand.get(item_id, Decimal("0.0000")) + required

            # Inventory balances and the stock ledger are intentionally held at
            # two decimal places. Aggregate the full recipe demand first, then
            # normalize once so many small POS sales are not rounded line by line.
            demand = {
                item_id: quantity.quantize(Decimal("0.01"))
                for item_id, quantity in demand.items()
                if quantity.quantize(Decimal("0.01")) > 0
            }

            balances = {
                row.item_id: row
                for row in InventoryBalance.objects.select_for_update().filter(
                    store=batch.outlet, item_id__in=demand
                )
            }
            for item_id, required in demand.items():
                balance = balances.get(item_id)
                available = balance.available_quantity if balance else Decimal("0.00")
                if available < required:
                    raise ValidationError(
                        f"POS depletion requires {required} of {balance.item if balance else item_id}, "
                        f"but only {available} is available."
                    )
            for item_id, required in demand.items():
                balance = balances[item_id]
                unit_cost = balance.weighted_average_cost
                valued = unit_cost > Decimal("0.0000")
                balance.quantity_in_stock -= required
                balance.save(update_fields=("quantity_in_stock", "updated_at"))
                StockLedger.objects.create(
                    item_id=item_id,
                    store=batch.outlet,
                    quantity_out=required,
                    reference_type=LedgerReferenceType.POS_DEPLETION,
                    reference_id=batch.pk,
                    unit_cost_snapshot=unit_cost if valued else None,
                    total_cost_snapshot=(
                        required * unit_cost
                    ).quantize(Decimal("0.0001")) if valued else None,
                    wac_before=unit_cost if valued else None,
                    wac_after=unit_cost if valued else None,
                    note=f"POS recipe depletion for {batch.business_date}",
                    created_by=actor,
                )
            for line in mapped:
                # Snapshot valuation while inventory balances are locked. Historic
                # profit must not change after a later supplier or WAC update.
                # Null explicitly means at least one Article had no reliable WAC.
                positions = demand_by_line[line.pk]
                if all(
                    item_id in balances and balances[item_id].weighted_average_cost > 0
                    for item_id in positions
                ):
                    line.cost_of_goods_sold = sum(
                        (qty * balances[item_id].weighted_average_cost
                         for item_id, qty in positions.items()),
                        Decimal("0.00"),
                    ).quantize(Decimal("0.01"))
                else:
                    line.cost_of_goods_sold = None
                line.inventory_changes_applied = True
                line.processed_at = timezone.now()
                line.save(
                    update_fields=(
                        "mapping",
                        "inventory_changes_applied",
                        "cost_of_goods_sold",
                        "processed_at",
                        "updated_at",
                    )
                )
            batch.status = self.STATUS_UNMAPPED if unmapped else self.STATUS_PROCESSED
            batch.processed_at = timezone.now()
            batch.processed_by = actor
            batch.error_message = (
                f"Map these PLUs, then re-run depletion: {', '.join(sorted(set(unmapped)))}"
                if unmapped
                else ""
            )
            batch.save(
                update_fields=(
                    "status",
                    "processed_at",
                    "processed_by",
                    "error_message",
                    "updated_at",
                )
            )
            self.status = batch.status
            self.processed_at = batch.processed_at
            self.processed_by = batch.processed_by
            self.error_message = batch.error_message

    def __str__(self):
        return f"{self.outlet} POS {self.business_date}"


class POSSaleLine(BaseModel):
    batch = models.ForeignKey(POSImportBatch, on_delete=models.CASCADE, related_name="lines")
    external_plu = models.CharField(max_length=100)
    external_name = models.CharField(max_length=180, blank=True)
    external_reference = models.CharField(max_length=120)
    quantity = models.DecimalField(
        max_digits=12, decimal_places=2, validators=[validate_positive_decimal]
    )
    net_sales = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    mapping = models.ForeignKey(
        POSPLUMapping,
        on_delete=models.PROTECT,
        related_name="sale_lines",
        null=True,
        blank=True,
    )
    inventory_changes_applied = models.BooleanField(default=False)
    cost_of_goods_sold = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
        help_text="Cost captured on first successful POS stock posting; null means unvalued.",
    )
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("batch", "external_reference"), name="unique_pos_sale_line_reference"
            )
        ]
        ordering = ("external_plu", "external_reference")

    def __str__(self):
        return f"{self.external_plu} x {self.quantity}"


class CostCenterBudget(BaseModel):
    branch = models.ForeignKey(
        "departments.Branch", on_delete=models.PROTECT, related_name="cost_center_budgets"
    )
    department = models.ForeignKey(
        "departments.Department", on_delete=models.PROTECT, related_name="budgets"
    )
    period_month = models.DateField(help_text="Use the first day of the budget month.")
    spending_cap = models.DecimalField(
        max_digits=15, decimal_places=2, validators=[validate_positive_decimal]
    )
    enforce_hard_block = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("branch", "department", "period_month"),
                name="unique_cost_center_monthly_budget",
            ),
            models.CheckConstraint(
                condition=models.Q(period_month__day=1), name="budget_period_starts_on_first"
            ),
        ]
        ordering = ("-period_month", "department__name")

    @property
    def committed_spend(self):
        from apps.procurement.models import PurchaseOrder

        orders = PurchaseOrder.objects.filter(
            requisition__branch=self.branch,
            requisition__department=self.department,
            created_at__year=self.period_month.year,
            created_at__month=self.period_month.month,
        ).exclude(status__in=(POStatus.REJECTED, POStatus.CANCELLED))
        return sum((order.total_amount for order in orders), Decimal("0.00"))

    @property
    def remaining_amount(self):
        return self.spending_cap - self.committed_spend

    def clean(self):
        super().clean()
        if self.period_month and self.period_month.day != 1:
            raise ValidationError({"period_month": "Choose the first day of the budget month."})

    def __str__(self):
        return f"{self.department} {self.period_month:%Y-%m}"


class BudgetOverride(BaseModel):
    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"
    STATUS_CHOICES = (
        (STATUS_PENDING, "Pending"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
    )

    budget = models.ForeignKey(CostCenterBudget, on_delete=models.PROTECT, related_name="overrides")
    requisition = models.OneToOneField(
        "procurement.PurchaseRequisition",
        on_delete=models.PROTECT,
        related_name="budget_override",
    )
    requested_amount = models.DecimalField(max_digits=15, decimal_places=2)
    overage_amount = models.DecimalField(max_digits=15, decimal_places=2)
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="decided_budget_overrides",
        null=True,
        blank=True,
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def decide(self, actor, *, approve, note):
        if self.status != self.STATUS_PENDING:
            raise ValidationError("This budget override already has a final decision.")
        if not str(note).strip():
            raise ValidationError("Enter a financial decision note.")
        self.status = self.STATUS_APPROVED if approve else self.STATUS_REJECTED
        self.decided_by = actor
        self.decided_at = timezone.now()
        self.decision_note = str(note).strip()
        self.save(
            update_fields=("status", "decided_by", "decided_at", "decision_note", "updated_at")
        )

    def __str__(self):
        return f"{self.requisition} - {self.status}"


class FiscalPeriod(BaseModel):
    STATUS_OPEN = "open"
    STATUS_CLOSED = "closed"
    STATUS_CHOICES = ((STATUS_OPEN, "Open"), (STATUS_CLOSED, "Closed"))

    branch = models.ForeignKey(
        "departments.Branch", on_delete=models.PROTECT, related_name="fiscal_periods"
    )
    name = models.CharField(max_length=80)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_OPEN)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="closed_fiscal_periods",
        null=True,
        blank=True,
    )
    close_note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("branch", "start_date", "end_date"), name="unique_branch_fiscal_period"
            )
        ]
        ordering = ("-start_date",)

    def clean(self):
        super().clean()
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValidationError({"end_date": "The period end cannot precede its start."})
        overlap = FiscalPeriod.objects.filter(
            branch=self.branch,
            start_date__lte=self.end_date,
            end_date__gte=self.start_date,
        )
        if self.pk:
            overlap = overlap.exclude(pk=self.pk)
        if self.branch_id and self.start_date and self.end_date and overlap.exists():
            raise ValidationError("Fiscal periods for one property cannot overlap.")

    def pre_close_checklist(self):
        from apps.inventory.models import StockCount, StockTransfer, StockIssue
        from apps.procurement.models import GoodsReceiptNote
        from apps.finance.models import SupplierInvoice, SupplierCreditNote

        open_grns = GoodsReceiptNote.objects.filter(
            purchase_order__requisition__branch=self.branch,
            received_date__range=(self.start_date, self.end_date),
        ).exclude(status__in=(GoodsReceiptStatus.POSTED, GoodsReceiptStatus.CANCELLED))
        open_transfers = StockTransfer.objects.filter(
            from_store__branch=self.branch,
            created_at__date__range=(self.start_date, self.end_date),
        ).exclude(status__in=(StockTransferStatus.COMPLETED, StockTransferStatus.CANCELLED))
        transit_issues = StockIssue.objects.filter(
            store__branch=self.branch,
            issue_date__lte=self.end_date,
            fulfillment_status=StockIssue.STATUS_TRANSIT,
        )
        open_counts = StockCount.objects.filter(
            store__branch=self.branch,
            count_date__range=(self.start_date, self.end_date),
        ).exclude(status__in=(StockCountStatus.APPLIED, StockCountStatus.CANCELLED))
        unresolved_invoices = SupplierInvoice.objects.filter(
            purchase_order__requisition__branch=self.branch,
            invoice_date__range=(self.start_date, self.end_date),
            status__in=(SupplierInvoice.STATUS_DRAFT, SupplierInvoice.STATUS_EXCEPTION),
        )
        unresolved_credits = SupplierCreditNote.objects.filter(
            invoice__purchase_order__requisition__branch=self.branch,
            credit_date__range=(self.start_date, self.end_date),
            status__in=(SupplierCreditNote.STATUS_DRAFT, SupplierCreditNote.STATUS_APPROVED),
        )
        unresolved_pos = POSImportBatch.objects.filter(
            outlet__branch=self.branch,
            business_date__range=(self.start_date, self.end_date),
        ).exclude(status=POSImportBatch.STATUS_PROCESSED)
        blockers = []
        if unresolved_invoices.exists():
            blockers.append(f"{unresolved_invoices.count()} supplier invoice(s) need matching or cancellation.")
        if unresolved_credits.exists():
            blockers.append(f"{unresolved_credits.count()} supplier credit note(s) need posting or resolution.")
        if unresolved_pos.exists():
            blockers.append(f"{unresolved_pos.count()} POS import(s) need depletion.")
        if open_grns.exists():
            blockers.append(f"{open_grns.count()} GRN(s) are not posted or cancelled.")
        if open_transfers.exists():
            blockers.append(f"{open_transfers.count()} stock transfer(s) are still open.")
        if transit_issues.exists():
            blockers.append(f"{transit_issues.count()} internal issue(s) remain in virtual transit.")
        if open_counts.exists():
            blockers.append(f"{open_counts.count()} stock count sheet(s) are still open.")
        return {
            "can_close": not blockers,
            "blockers": blockers,
            "open_grns": open_grns.count(),
            "open_transfers": open_transfers.count(),
            "open_issue_transits": transit_issues.count(),
            "open_stock_counts": open_counts.count(),
            "unresolved_invoices": unresolved_invoices.count(),
            "unresolved_credits": unresolved_credits.count(),
            "unresolved_pos_imports": unresolved_pos.count(),
        }

    def inventory_valuation_reconciliation(self):
        """Read-only inventory movement valuation evidence for Finance review.

        Never infer missing historical costs or post inventory journals here:
        invoiced GRNs and supplier credits may already impact asset accounts.
        """
        from apps.inventory.models import StockLedger
        from core.constants.choices import LedgerReferenceType

        movements = StockLedger.objects.filter(
            store__branch=self.branch,
            created_at__date__range=(self.start_date, self.end_date),
        ).order_by("created_at", "pk").values(
            "reference_type", "reference_id", "quantity_in", "quantity_out",
            "total_cost_snapshot", "unit_cost_snapshot", "store_id",
        )
        categories = {}
        transfer_pairs = {}
        missing = 0
        movement_count = 0
        for movement in movements.iterator():
            movement_count += 1
            source = movement["reference_type"]
            record = categories.setdefault(source, {
                "movement_count": 0, "valued_count": 0,
                "unvalued_count": 0,
                "value_in": Decimal("0.0000"),
                "value_out": Decimal("0.0000"),
            })
            record["movement_count"] += 1
            inbound = movement["quantity_in"] > 0
            total = movement["total_cost_snapshot"]
            if total is None or movement["unit_cost_snapshot"] is None:
                missing += 1
                record["unvalued_count"] += 1
            else:
                record["valued_count"] += 1
                field = "value_in" if inbound else "value_out"
                record[field] += total
            if source == LedgerReferenceType.STOCK_TRANSFER:
                key = str(movement["reference_id"])
                paired = transfer_pairs.setdefault(key, {
                    "quantity_in": Decimal("0.00"),
                    "quantity_out": Decimal("0.00"),
                    "value_in": Decimal("0.0000"),
                    "value_out": Decimal("0.0000"),
                    "unvalued_count": 0,
                })
                direction = "in" if inbound else "out"
                paired[f"quantity_{direction}"] += (
                    movement["quantity_in"] if inbound else movement["quantity_out"]
                )
                if total is not None:
                    paired[f"value_{direction}"] += total
                else:
                    paired["unvalued_count"] += 1

        transfer_warnings = []
        for reference, pair in transfer_pairs.items():
            if pair["quantity_in"] != pair["quantity_out"] or (
                pair["unvalued_count"] == 0
                and abs(pair["value_in"] - pair["value_out"]) > Decimal("0.01")
            ):
                transfer_warnings.append({
                    "reference": reference,
                    "quantity_in": str(pair["quantity_in"]),
                    "quantity_out": str(pair["quantity_out"]),
                    "value_in": str(pair["value_in"]),
                    "value_out": str(pair["value_out"]),
                })

        # Transfers may legitimately dispatch and arrive in different months.
        # A warning is not automatic proof of a broken transfer.
        return {
            "period_id": str(self.pk),
            "branch_id": str(self.branch_id),
            "movement_count": movement_count,
            "unvalued_count": missing,
            "categories": {
                source: {key: str(value) if isinstance(value, Decimal) else value
                         for key, value in info.items()}
                for source, info in sorted(categories.items())
            },
            "transfer_period_warnings": transfer_warnings,
            "ready_for_gl_mapping_review": missing == 0 and not transfer_warnings,
            "gl_journals_posted": False,
            "note": (
                "Read-only valuation evidence. No stock GL journal has been "
                "created. Historical unknown costs remain unvalued. "
                "Transfer dispatch and receipt may cross periods."
            ),
        }

    def inventory_gl_journal_preview(self):
        """Read-only proposed journal entries. No financial postings occur."""
        from apps.inventory.models import StockLedger
        from core.constants.choices import LedgerReferenceType
        sources = {
            LedgerReferenceType.STOCK_ISSUE: GLAccountMapping.SOURCE_CONSUMPTION,
            LedgerReferenceType.POS_DEPLETION: GLAccountMapping.SOURCE_POS_COGS,
            LedgerReferenceType.WASTE: GLAccountMapping.SOURCE_WASTE,
            LedgerReferenceType.STOCK_COUNT: GLAccountMapping.SOURCE_VARIANCE,
            LedgerReferenceType.STOCK_ADJUSTMENT: GLAccountMapping.SOURCE_VARIANCE,
        }
        configured = {m.source_type: m for m in GLAccountMapping.objects.filter(
            branch=self.branch, is_active=True
        )}
        movements = StockLedger.objects.filter(
            store__branch=self.branch,
            created_at__date__range=(self.start_date, self.end_date),
        ).values("pk", "created_at", "reference_type", "reference_id",
                 "quantity_in", "quantity_out", "unit_cost_snapshot", "total_cost_snapshot")
        draft, blockers, excluded = [], [], {}
        debits = credits = Decimal("0.00")
        for movement in movements.iterator():
            source = movement["reference_type"]
            if source not in sources:
                excluded[source] = excluded.get(source, 0) + 1
                continue
            amount = movement["total_cost_snapshot"]
            if amount is None or movement["unit_cost_snapshot"] is None:
                blockers.append(f"Missing historical cost for {source} movement {movement['pk']}.")
                continue
            amount = amount.quantize(Decimal("0.01"))
            if amount <= 0:
                blockers.append(f"Nonpositive GL amount for {source} movement {movement['pk']}.")
                continue
            mapping = configured.get(sources[source])
            if mapping is None:
                blockers.append(f"Missing active GL mapping for {sources[source]}.")
                continue
            if mapping.debit_account == mapping.credit_account:
                blockers.append(f"Conflicting debit and credit accounts for {sources[source]}.")
                continue
            outgoing = movement["quantity_out"] > 0
            dr = mapping.debit_account if outgoing else mapping.credit_account
            cr = mapping.credit_account if outgoing else mapping.debit_account
            common = {
                "date": movement["created_at"].date().isoformat(),
                "source": source,
                "reference": str(movement["reference_id"]),
                "movement_id": str(movement["pk"]),
            }
            draft.append({**common, "account": dr, "debit": str(amount), "credit": "0.00"})
            draft.append({**common, "account": cr, "debit": "0.00", "credit": str(amount)})
            debits += amount
            credits += amount
        return {
            "period_id": str(self.pk), "branch_id": str(self.branch_id),
            "ready_for_finance_review": not blockers,
            "blockers": list(dict.fromkeys(blockers)),
            "draft_rows": draft if not blockers else [],
            "candidate_row_count": len(draft),
            "debit_total": str(debits), "credit_total": str(credits),
            "excluded_source_counts": dict(sorted(excluded.items())),
            "posted": False,
            "note": "Preview only: no GL journal posted. Invoice-side receipts/credits and transfers are excluded to avoid double counting.",
        }

    def close(self, actor, note):
        if self.status == self.STATUS_CLOSED:
            raise ValidationError("This fiscal period is already closed.")
        checklist = self.pre_close_checklist()
        if not checklist["can_close"]:
            raise ValidationError(checklist["blockers"])
        if not str(note).strip():
            raise ValidationError("Enter a period-close note.")
        self.status = self.STATUS_CLOSED
        self.closed_at = timezone.now()
        self.closed_by = actor
        self.close_note = str(note).strip()
        self.save(
            update_fields=("status", "closed_at", "closed_by", "close_note", "updated_at")
        )

    def __str__(self):
        return f"{self.branch} - {self.name}"


class GLAccountMapping(BaseModel):
    SOURCE_INVOICE = "supplier_invoice"
    SOURCE_EXPENSE = "expense"
    SOURCE_PAYMENT = "supplier_payment"
    SOURCE_CONSUMPTION = "stock_consumption"
    SOURCE_POS_COGS = "pos_cogs"
    SOURCE_WASTE = "stock_waste"
    SOURCE_VARIANCE = "stock_variance"
    SOURCE_CHOICES = (
        (SOURCE_INVOICE, "Supplier invoices"),
        (SOURCE_EXPENSE, "Expenses"),
        (SOURCE_PAYMENT, "Supplier payments (AP debit / bank clearing credit)"),
        (SOURCE_CONSUMPTION, "Department stock consumption"),
        (SOURCE_POS_COGS, "POS cost of goods sold"),
        (SOURCE_WASTE, "Waste and spoilage expense"),
        (SOURCE_VARIANCE, "Physical counts and stock adjustments"),
    )

    branch = models.ForeignKey(
        "departments.Branch", on_delete=models.PROTECT, related_name="gl_account_mappings"
    )
    source_type = models.CharField(max_length=40, choices=SOURCE_CHOICES)
    debit_account = models.CharField(max_length=50)
    credit_account = models.CharField(max_length=50)
    tax_account = models.CharField(
        max_length=50, blank=True, help_text="Input VAT account for taxable supplier invoices."
    )
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("branch", "source_type"), name="unique_branch_gl_source_mapping"
            )
        ]
        ordering = ("branch__name", "source_type")

    def clean(self):
        super().clean()
        if self.debit_account and self.debit_account == self.credit_account:
            raise ValidationError("Debit and credit accounts must be different.")

    def __str__(self):
        return f"{self.branch} - {self.get_source_type_display()}"


class GLExport(BaseModel):
    period = models.ForeignKey(FiscalPeriod, on_delete=models.PROTECT, related_name="gl_exports")
    format = models.CharField(max_length=10, default="csv")
    generated_at = models.DateTimeField(default=timezone.now)
    generated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="generated_gl_exports",
        null=True,
        blank=True,
    )
    row_count = models.PositiveIntegerField(default=0)
    checksum = models.CharField(max_length=64, blank=True)
    payload = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-generated_at",)

    @classmethod
    def generate(cls, period, actor):
        from apps.finance.models import Expense, SupplierInvoice, SupplierCreditNote, SupplierPayment

        if period.status != FiscalPeriod.STATUS_CLOSED:
            raise ValidationError("Close the fiscal period before generating its GL export.")

        postings = []
        debit_total = Decimal("0.00")
        credit_total = Decimal("0.00")
        mappings = {
            mapping.source_type: mapping
            for mapping in GLAccountMapping.objects.filter(branch=period.branch, is_active=True)
        }

        def mapping_for(source):
            mapping = mappings.get(source)
            if mapping is None:
                raise ValidationError(
                    f"Configure an active GL account mapping for {source} in {period.branch}."
                )
            return mapping

        def add_entry(date, source, ref, department, description, account, debit, credit):
            nonlocal debit_total, credit_total
            debit = Decimal(debit).quantize(Decimal("0.01"))
            credit = Decimal(credit).quantize(Decimal("0.01"))
            if (debit > 0) == (credit > 0):
                raise ValidationError("Each GL journal entry needs exactly one positive side.")
            postings.append((date, source, ref, department, description, account, debit, credit))
            debit_total += debit
            credit_total += credit

        invoices = SupplierInvoice.objects.filter(
            purchase_order__requisition__branch=period.branch,
            invoice_date__range=(period.start_date, period.end_date),
            status__in=(
                SupplierInvoice.STATUS_MATCHED,
                SupplierInvoice.STATUS_APPROVED,
                SupplierInvoice.STATUS_PARTIALLY_PAID,
                SupplierInvoice.STATUS_PAID,
            ),
        ).select_related("purchase_order__requisition__department")
        for invoice in invoices:
            amount = invoice.total_amount
            if amount <= 0:
                continue
            mapping = mapping_for(GLAccountMapping.SOURCE_INVOICE)
            department = getattr(invoice.purchase_order.requisition.department, "name", "")
            ref = invoice.invoice_number
            description = f"Supplier invoice {ref}"
            if invoice.subtotal > 0:
                add_entry(invoice.invoice_date, "supplier_invoice", ref, department,
                          description, mapping.debit_account, invoice.subtotal, 0)
            if invoice.tax_amount > 0:
                if not mapping.tax_account:
                    raise ValidationError("Configure an input VAT account for taxable supplier invoices.")
                add_entry(invoice.invoice_date, "supplier_invoice", ref, department,
                          "Input VAT " + ref, mapping.tax_account, invoice.tax_amount, 0)
            add_entry(invoice.invoice_date, "supplier_invoice", ref, department,
                      description, mapping.credit_account, 0, amount)

        # A posted supplier credit reverses the invoice AP liability and
        # its original expense/inventory and input tax accounts. Monetary
        # valuation comes from the approved credit, never current item prices.
        credits = SupplierCreditNote.objects.filter(
            invoice__purchase_order__requisition__branch=period.branch,
            credit_date__range=(period.start_date, period.end_date),
            status=SupplierCreditNote.STATUS_POSTED,
        ).select_related("invoice__purchase_order__requisition__department", "supplier_return")
        for credit in credits:
            mapping = mapping_for(GLAccountMapping.SOURCE_INVOICE)
            ref = credit.supplier_return.credit_note_number
            department = getattr(credit.invoice.purchase_order.requisition.department, "name", "")
            description = f"Supplier credit note {ref} against invoice {credit.invoice.invoice_number}"
            add_entry(credit.credit_date, "supplier_credit_note", ref, department,
                      description, mapping.credit_account, credit.total_amount, 0)
            if credit.subtotal > 0:
                add_entry(credit.credit_date, "supplier_credit_note", ref, department,
                          description, mapping.debit_account, 0, credit.subtotal)
            if credit.tax_amount > 0:
                if not mapping.tax_account:
                    raise ValidationError("Configure an input VAT account for taxable supplier credits.")
                add_entry(credit.credit_date, "supplier_credit_note", ref, department,
                          "Input VAT reversal " + ref, mapping.tax_account, 0, credit.tax_amount)

        # Export only posted supplier payments from this fiscal period. This
        # settles AP, not an invented historical stock valuation; bank-level
        # settlement must be reconciled separately against provider statements.
        payments = SupplierPayment.objects.filter(
            invoice__purchase_order__requisition__branch=period.branch,
            payment_date__range=(period.start_date, period.end_date),
            status=SupplierPayment.STATUS_POSTED,
        ).select_related("invoice__purchase_order__requisition__department", "bank_account")
        for payment in payments:
            mapping = mapping_for(GLAccountMapping.SOURCE_PAYMENT)
            department = getattr(payment.invoice.purchase_order.requisition.department, "name", "")
            ref = payment.reference or str(payment.pk)
            description = f"Supplier payment {ref} for invoice {payment.invoice.invoice_number}"
            if payment.bank_account_id:
                description += f" ({payment.bank_account.name})"
            add_entry(payment.payment_date, "supplier_payment", ref, department,
                      description, mapping.debit_account, payment.amount, 0)
            add_entry(payment.payment_date, "supplier_payment", ref, department,
                      description, mapping.credit_account, 0, payment.amount)

        expenses = Expense.objects.filter(
            store__branch=period.branch,
            date__range=(period.start_date, period.end_date),
        ).select_related("category")
        for expense in expenses:
            if expense.amount <= 0:
                continue
            mapping = mapping_for(GLAccountMapping.SOURCE_EXPENSE)
            ref = expense.reference or str(expense.pk)
            description = expense.description or getattr(expense.category, "name", "Expense")
            add_entry(expense.date, "expense", ref, "",
                      description, mapping.debit_account, expense.amount, 0)
            add_entry(expense.date, "expense", ref, "",
                      description, mapping.credit_account, 0, expense.amount)

        if debit_total != credit_total:
            raise ValidationError("Unbalanced GL export cannot be generated.")

        # No historical monetary valuation is held on StockLedger. Do not
        # fabricate stock/COGS journal amounts using present-day unit prices.
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["date", "source", "reference", "department", "description",
                         "account", "debit", "credit"])
        writer.writerows(postings)
        payload = output.getvalue()
        checksum = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        existing = cls.objects.filter(period=period, checksum=checksum).first()
        if existing:
            return existing
        return cls.objects.create(
            period=period, generated_by=actor, row_count=len(postings),
            checksum=checksum, payload=payload, created_by=actor,
        )

    def __str__(self):
        return f"{self.period} GL export {self.generated_at:%Y-%m-%d %H:%M}"


class IntegrationConfig(BaseModel):
    TYPE_POS = "pos"
    TYPE_ACCOUNTING = "accounting"
    TYPE_CHOICES = ((TYPE_POS, "POS import"), (TYPE_ACCOUNTING, "Accounting export"))
    HEALTH_UNKNOWN = "unknown"
    HEALTH_HEALTHY = "healthy"
    HEALTH_WARNING = "warning"
    HEALTH_FAILED = "failed"
    HEALTH_CHOICES = (
        (HEALTH_UNKNOWN, "Unknown"),
        (HEALTH_HEALTHY, "Healthy"),
        (HEALTH_WARNING, "Warning"),
        (HEALTH_FAILED, "Failed"),
    )

    branch = models.ForeignKey(
        "departments.Branch",
        on_delete=models.PROTECT,
        related_name="integration_configs",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=120)
    integration_type = models.CharField(max_length=30, choices=TYPE_CHOICES)
    provider = models.CharField(max_length=100)
    endpoint_hint = models.CharField(max_length=255, blank=True)
    secret_environment_variable = models.CharField(
        max_length=120,
        blank=True,
        help_text="Environment-variable name only. Secrets are never stored in this table.",
    )
    schedule = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)
    health = models.CharField(max_length=20, choices=HEALTH_CHOICES, default=HEALTH_UNKNOWN)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_message = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=("branch", "name"), name="unique_branch_integration_name")
        ]
        ordering = ("integration_type", "name")

    def __str__(self):
        return self.name
