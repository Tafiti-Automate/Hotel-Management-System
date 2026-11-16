from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.utils import timezone

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import (
    Category,
    InventoryBalance,
    Item,
    StockLedger,
    StoreLocation,
    UnitOfMeasure,
)
from apps.materials_control.models import (
    GLAccountMapping,
    BudgetOverride,
    CostCenterBudget,
    FiscalPeriod,
    GLExport,
    OutletAssignment,
    POSImportBatch,
    POSPLUMapping,
    POSSaleLine,
    Recipe,
    RecipeIngredient,
    WasteRecord,
)
from apps.materials_control.services import enforce_requisition_budget
from apps.procurement.models import PurchaseRequisition, RequisitionItem
from apps.finance.models import Expense
from rest_framework.test import APIClient
from apps.materials_control.views import RecipeViewSet
from types import SimpleNamespace
import csv
import io


@pytest.fixture
def materials_context():
    user = get_user_model().objects.create_user(
        username="outlet-supervisor",
        employee_code="OUTLET-001",
        password="test-pass-123",
    )
    department = Department.objects.create(name="Food and Beverage")
    branch = Branch.objects.create(name="Materials Control Property")
    employee = Employee.objects.create(
        user=user,
        department=department,
        branch=branch,
        designation="Outlet Supervisor",
    )
    outlet = StoreLocation.objects.create(branch=branch, name="Pool Bar")
    unit = UnitOfMeasure.objects.create(name="Materials Bottle", abbreviation="mbtl")
    category = Category.objects.create(name="Materials Beverages")
    item = Item.objects.create(
        category=category,
        name="Materials House Wine",
        sku="MAT-WINE-001",
        unit="bottle",
        base_unit=unit,
        reorder_level=Decimal("2.00"),
    )
    OutletAssignment.objects.create(employee=employee, outlet=outlet, is_primary=True)
    InventoryBalance.objects.create(
        item=item,
        store=outlet,
        quantity_in_stock=Decimal("20.00"),
    )
    return user, employee, department, branch, outlet, unit, item


@pytest.mark.django_db
def test_waste_submission_posts_inventory_once(materials_context):
    user, employee, department, _branch, outlet, unit, item = materials_context
    waste = WasteRecord.objects.create(
        outlet=outlet,
        department=department,
        item=item,
        unit=unit,
        quantity=Decimal("2.00"),
        reason_code="broken_service",
        reported_by=employee,
        created_by=user,
    )

    waste.submit(user)

    balance = InventoryBalance.objects.get(item=item, store=outlet)
    assert balance.quantity_in_stock == Decimal("18.00")
    assert waste.status == WasteRecord.STATUS_SUBMITTED
    assert waste.inventory_changes_applied is True
    assert StockLedger.objects.get(reference_id=waste.pk).reference_type == "waste"
    with pytest.raises(ValidationError, match="Only a draft"):
        waste.submit(user)


@pytest.mark.django_db
def test_stale_waste_submission_does_not_double_deduct(materials_context):
    user, employee, department, _branch, outlet, unit, item = materials_context
    waste = WasteRecord.objects.create(
        outlet=outlet,
        department=department,
        item=item,
        unit=unit,
        quantity=Decimal("2.00"),
        reason_code="broken_service",
        reported_by=employee,
        created_by=user,
    )
    second_request_copy = WasteRecord.objects.get(pk=waste.pk)

    waste.submit(user)
    with pytest.raises(ValidationError, match="Only a draft"):
        second_request_copy.submit(user)

    assert InventoryBalance.objects.get(item=item, store=outlet).quantity_in_stock == Decimal("18.00")
    assert StockLedger.objects.filter(reference_id=waste.pk, reference_type="waste").count() == 1


@pytest.mark.django_db
def test_recipe_costing_and_pos_depletion_are_idempotent(materials_context):
    user, _employee, _department, _branch, outlet, unit, item = materials_context
    recipe = Recipe.objects.create(
        name="Wine tasting flight",
        outlet=outlet,
        yield_quantity=Decimal("2.00"),
        yield_unit="Portions",
        target_food_cost_percent=Decimal("30.00"),
        created_by=user,
    )
    RecipeIngredient.objects.create(
        recipe=recipe,
        item=item,
        unit=unit,
        quantity=Decimal("2.00"),
        trim_percent=Decimal("0.00"),
        created_by=user,
    )
    recipe.publish(user)
    mapping = POSPLUMapping.objects.create(
        outlet=outlet,
        external_plu="PLU-WINE",
        external_name="Wine tasting flight",
        recipe=recipe,
        created_by=user,
    )
    batch = POSImportBatch.objects.create(
        outlet=outlet,
        business_date=timezone.localdate(),
        source="Simphony",
        source_reference="NIGHT-AUDIT-001",
        created_by=user,
    )
    line = POSSaleLine.objects.create(
        batch=batch,
        external_plu=mapping.external_plu,
        external_reference="CHECK-001",
        quantity=Decimal("3.00"),
        net_sales=Decimal("90000.00"),
        created_by=user,
    )

    batch.process(user)
    first_balance = InventoryBalance.objects.get(item=item, store=outlet).quantity_in_stock
    batch.process(user)
    second_balance = InventoryBalance.objects.get(item=item, store=outlet).quantity_in_stock

    line.refresh_from_db()
    assert first_balance == Decimal("17.00")
    assert second_balance == first_balance
    assert line.inventory_changes_applied is True
    assert line.mapping == mapping
    assert StockLedger.objects.filter(
        reference_id=batch.pk, reference_type="pos_depletion"
    ).count() == 1


@pytest.mark.django_db
def test_unmapped_pos_line_can_be_mapped_and_rerun(materials_context):
    user, _employee, _department, _branch, outlet, unit, item = materials_context
    recipe = Recipe.objects.create(
        name="Unmapped recipe",
        outlet=outlet,
        yield_quantity=Decimal("1.00"),
        target_food_cost_percent=Decimal("30.00"),
    )
    RecipeIngredient.objects.create(
        recipe=recipe,
        item=item,
        unit=unit,
        quantity=Decimal("1.00"),
    )
    recipe.publish(user)
    batch = POSImportBatch.objects.create(
        outlet=outlet,
        business_date=timezone.localdate(),
        source_reference="NIGHT-AUDIT-UNMAPPED",
    )
    POSSaleLine.objects.create(
        batch=batch,
        external_plu="NEW-PLU",
        external_reference="CHECK-NEW",
        quantity=Decimal("1.00"),
    )

    batch.process(user)
    assert batch.status == POSImportBatch.STATUS_UNMAPPED
    assert "NEW-PLU" in batch.error_message

    POSPLUMapping.objects.create(outlet=outlet, external_plu="NEW-PLU", recipe=recipe)
    batch.process(user)
    assert batch.status == POSImportBatch.STATUS_PROCESSED
    assert InventoryBalance.objects.get(item=item, store=outlet).quantity_in_stock == Decimal("19.00")


@pytest.mark.django_db
def test_over_budget_requisition_requires_controller_override(materials_context):
    user, employee, department, branch, _outlet, unit, item = materials_context
    budget = CostCenterBudget.objects.create(
        branch=branch,
        department=department,
        period_month=timezone.localdate().replace(day=1),
        spending_cap=Decimal("1000.00"),
        enforce_hard_block=False,
    )
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        branch=branch,
        reason="Over-budget specialty order",
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        unit=unit,
        quantity=Decimal("2.00"),
        estimated_unit_cost=Decimal("750.00"),
    )

    with pytest.raises(ValidationError, match="requires Financial Controller override"):
        enforce_requisition_budget(requisition)

    override = BudgetOverride.objects.get(requisition=requisition, budget=budget)
    override.decide(user, approve=True, note="Approved for a confirmed VIP function.")
    assert enforce_requisition_budget(requisition) == override


@pytest.mark.django_db
def test_closed_period_generates_checksum_gl_export(materials_context):
    user, _employee, _department, branch, _outlet, _unit, _item = materials_context
    today = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=branch,
        name=f"{today:%B %Y}",
        start_date=today.replace(day=1),
        end_date=today,
    )

    period.close(user, "All operational checklists completed.")
    export = GLExport.generate(period, user)

    assert period.status == FiscalPeriod.STATUS_CLOSED
    assert export.checksum
    assert "date,source,reference" in export.payload


@pytest.mark.django_db
def test_role_templates_include_accounts_payable_and_separate_system_admin_posting():
    call_command("setup_hotel_roles", verbosity=0)

    ap = Group.objects.get(name="Accounts Payable Clerk")
    system_admin = Group.objects.get(name="System Administrator")
    assert ap.permissions.filter(codename="add_supplierinvoice").exists()
    assert ap.permissions.filter(codename="change_supplierinvoiceitem").exists()
    assert not ap.permissions.filter(codename="change_purchaseorder").exists()
    assert system_admin.permissions.filter(codename="view_goodsreceiptnote").exists()
    assert not system_admin.permissions.filter(codename="change_goodsreceiptnote").exists()



@pytest.mark.django_db
def test_closed_period_rejects_stock_and_expense_posting(materials_context):
    user, employee, department, branch, outlet, unit, item = materials_context
    today = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=branch, name="Closed month", start_date=today.replace(day=1), end_date=today,
    )
    period.close(user, "Finance reviewed period-end figures.")
    with pytest.raises(ValidationError, match="closed"):
        StockLedger.objects.create(
            item=item, store=outlet, quantity_out=Decimal("1.00"),
            reference_type="waste", reference_id=period.pk, created_by=user,
        )
    with pytest.raises(ValidationError, match="closed"):
        Expense.objects.create(store=outlet, amount=Decimal("15.00"), created_by=user)


@pytest.mark.django_db
def test_balanced_gl_journal_requires_configured_accounts(materials_context):
    user, employee, department, branch, outlet, unit, item = materials_context
    Expense.objects.create(store=outlet, amount=Decimal("43.25"), reference="EXP-1")
    today = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=branch, name="GL journal verification",
        start_date=today.replace(day=1), end_date=today,
    )
    period.close(user, "Expense reconciliation complete.")
    with pytest.raises(ValidationError, match="GL account mapping"):
        GLExport.generate(period, user)
    GLAccountMapping.objects.create(
        branch=branch, source_type=GLAccountMapping.SOURCE_EXPENSE,
        debit_account="EXPENSE-CODE", credit_account="CASH-CODE",
    )
    export = GLExport.generate(period, user)
    rows = list(csv.DictReader(io.StringIO(export.payload)))
    assert export.row_count == 2
    assert sum(Decimal(row["debit"]) for row in rows) == Decimal("43.25")
    assert sum(Decimal(row["credit"]) for row in rows) == Decimal("43.25")
    assert {row["account"] for row in rows} == {"EXPENSE-CODE", "CASH-CODE"}
    assert GLExport.generate(period, user).pk == export.pk


@pytest.mark.django_db
def test_changed_requisition_needs_fresh_budget_override(materials_context):
    user, employee, department, branch, outlet, unit, item = materials_context
    CostCenterBudget.objects.create(
        branch=branch, department=department,
        period_month=timezone.localdate().replace(day=1),
        spending_cap=Decimal("100.00"),
    )
    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, branch=branch, reason="Urgent supplies",
    )
    line = RequisitionItem.objects.create(
        requisition=requisition, item=item, unit=unit,
        quantity=Decimal("2.00"), estimated_unit_cost=Decimal("75.00"),
    )
    with pytest.raises(ValidationError, match="requires Financial Controller override"):
        enforce_requisition_budget(requisition)
    decision = BudgetOverride.objects.get(requisition=requisition)
    decision.decide(user, approve=True, note="Approved original amount")
    line.estimated_unit_cost = Decimal("100.00")
    line.save()
    with pytest.raises(ValidationError, match="requires Financial Controller override"):
        enforce_requisition_budget(requisition)
    decision.refresh_from_db()
    assert decision.status == BudgetOverride.STATUS_PENDING
    assert decision.decided_by is None


@pytest.mark.django_db
def test_department_head_recipe_list_is_scoped_to_assigned_outlets(materials_context):
    user, employee, department, branch, outlet, unit, item = materials_context
    user.groups.add(Group.objects.get_or_create(name="Department Head")[0])
    foreign_outlet = StoreLocation.objects.create(branch=branch, name="Unassigned Rooftop")
    own_recipe = Recipe.objects.create(name="Assigned", outlet=outlet,
                                       yield_quantity=Decimal("1"), target_food_cost_percent=Decimal("30"))
    Recipe.objects.create(name="Outside department", outlet=foreign_outlet,
                          yield_quantity=Decimal("1"), target_food_cost_percent=Decimal("30"))
    view = RecipeViewSet()
    view.request = SimpleNamespace(user=user)
    assert list(view.get_queryset()) == [own_recipe]


@pytest.mark.django_db
def test_pos_csv_import_retries_without_duplicate_sale_lines(materials_context):
    user, employee, department, branch, outlet, unit, item = materials_context
    call_command("setup_hotel_roles", verbosity=0)
    user.groups.add(Group.objects.get(name="Cost Controller"))
    batch = POSImportBatch.objects.create(
        outlet=outlet, business_date=timezone.localdate(), source="csv",
        source_reference="NIGHT-Z-001",
    )
    client = APIClient()
    client.force_authenticate(user=user)
    path = f"/api/v1/pos-imports/{batch.pk}/import-csv/"
    payload = {"csv": "external_plu,external_reference,quantity,external_name,net_sales\nPLU1,CHK1,2,Sample,9000"}
    first = client.post(path, payload, format="json")
    assert first.status_code == 200, first.data
    assert first.data["imported"] == 1
    second = client.post(path, payload, format="json")
    assert second.status_code == 200, second.data
    assert second.data["skipped_existing"] == 1
    assert batch.lines.count() == 1


@pytest.mark.django_db
def test_published_recipe_ingredients_cannot_be_rewritten(materials_context):
    user, employee, department, branch, outlet, unit, item = materials_context
    recipe = Recipe.objects.create(
        outlet=outlet, name="Immutable published dish",
        yield_quantity=Decimal("1.00"), target_food_cost_percent=Decimal("30.00"),
    )
    ingredient = RecipeIngredient.objects.create(
        recipe=recipe, item=item, quantity=Decimal("1.00"), unit=unit,
    )
    recipe.publish(user)
    ingredient.quantity = Decimal("4.00")
    with pytest.raises(ValidationError, match="Only draft recipes"):
        ingredient.save()
