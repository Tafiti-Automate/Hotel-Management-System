"""Month-end planning must not post stock or duplicate consumption."""
from decimal import Decimal
from datetime import datetime, date, timezone as dt_timezone

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.materials_control.models import FiscalPeriod
from apps.notifications.models import Notification
from apps.inventory.models import (
    Category, DepartmentConsumption, InventoryBalance, InventoryBatch, Item, MonthEndCycle,
    MonthEndInventory, StockCount, StockLedger, StoreLocation,
)


@pytest.fixture
def plan_context(db):
    branch = Branch.objects.create(name="Month-end property")
    other = Branch.objects.create(name="Other property")
    department = Department.objects.create(name="Administration")
    store = StoreLocation.objects.create(branch=branch, name="Main store")
    outlet = StoreLocation.objects.create(branch=branch, name="Pool bar")
    StoreLocation.objects.create(branch=other, name="Other store")
    StoreLocation.objects.create(branch=branch, name="Inactive store", is_active=False)
    StoreLocation.objects.create(branch=branch, name="Transit", is_active=False, is_virtual_transit=True)
    item = Item.objects.create(category=Category.objects.create(name="Drinks"), name="Water",
                               unit="Bottle", reorder_level=Decimal("0"))
    balance = InventoryBalance.objects.create(store=store, item=item, quantity_in_stock=Decimal("10.0000"))
    user = get_user_model().objects.create_user(username="monthend-controller", employee_code="MEC01", password="test-password")
    user.groups.add(Group.objects.get_or_create(name="Cost Controller")[0])
    Employee.objects.create(user=user, branch=branch, department=department, designation="Cost Controller")
    client = APIClient()
    client.force_authenticate(user)
    payload = {"cutoff": "2026-11-30", "memo_reference": "CC/11/26", "memo": "Month-end stocktake schedule",
               "consumption_department_ids": [str(department.pk)], "roster_confirmed": True}
    return client, payload, branch, other, department, store, outlet, balance


URL = "/api/v1/month-end-cycles/"


def test_plan_creates_distinct_location_records_without_posting(plan_context):
    client, payload, branch, other, department, store, outlet, balance = plan_context
    response = client.post(URL, payload, format="json")
    assert response.status_code == 201, response.data
    rows = response.data["inventories"]
    assert {row["store"] for row in rows if row["store"]} == {str(store.pk), str(outlet.pk)}
    assert [row["closing_quantity"] for row in rows if row["department"]] == ["0.0000"]
    assert all(row["closing_quantity"] is None for row in rows if row["store"])
    assert all(not row["booked"] for row in rows)
    assert MonthEndInventory.objects.count() == 3
    balance.refresh_from_db()
    assert balance.quantity_in_stock == Decimal("10.0000")
    assert not StockLedger.objects.exists()
    assert not DepartmentConsumption.objects.exists()
    assert not StockCount.objects.exists()
    assert client.post(URL, payload, format="json").status_code == 400
    assert MonthEndCycle.objects.count() == 1


def test_roster_and_cutoff_validation(plan_context):
    client, payload, *_ = plan_context
    assert client.post(URL, {**payload, "roster_confirmed": False}, format="json").status_code == 400
    assert client.post(URL, {**payload, "cutoff": "2026-11-29"}, format="json").status_code == 400
    assert client.post(URL, {**payload, "consumption_department_ids": payload["consumption_department_ids"] * 2}, format="json").status_code == 400
    assert not MonthEndCycle.objects.exists()


def test_cross_property_and_finance_write_denied(plan_context):
    client, payload, branch, other, department, *_ = plan_context
    assert client.post(URL, payload, format="json").status_code == 201
    user = get_user_model().objects.create_user(username="monthend-finance", employee_code="MEF01", password="test-password")
    user.groups.add(Group.objects.get_or_create(name="Financial Manager")[0])
    Employee.objects.create(user=user, branch=other, department=department, designation="Financial Manager")
    client.force_authenticate(user)
    assert client.get(URL).data == []
    assert client.post(URL, payload, format="json").status_code == 403


@pytest.fixture
def operational_context(plan_context, monkeypatch):
    from django.utils import timezone
    monkeypatch.setattr(timezone, "now", lambda: datetime(2026, 11, 30, 12, 0, tzinfo=dt_timezone.utc))
    controller, payload, branch, other, department, store, outlet, balance = plan_context
    balance.weighted_average_cost = Decimal("1000.0000")
    balance.save()
    period = FiscalPeriod.objects.create(branch=branch, name="November 2026",
                                         start_date=date(2026, 11, 1), end_date=date(2026, 11, 30))
    def operator(role, code):
        user = get_user_model().objects.create_user(username="monthend-" + code, employee_code=code, password="test-password")
        user.groups.add(Group.objects.get_or_create(name=role)[0])
        Employee.objects.create(user=user, branch=branch, department=department, designation=role)
        client = APIClient()
        client.force_authenticate(user)
        return user, client
    finance_user, finance = operator("Financial Manager", "MEFIN")
    head, _ = operator("Department Head", "MEHOD")
    response = controller.post(URL, payload, format="json")
    assert response.status_code == 201, response.data
    data = response.data
    assert Notification.objects.filter(employee__user=head, deduplication_key=f"month-end-memo:{data['id']}").exists()
    base = URL + str(data["id"]) + "/"
    main = next(row for row in data["inventories"] if row["store"] == str(store.pk))
    empty = next(row for row in data["inventories"] if row["store"] == str(outlet.pk))
    return controller, finance, finance_user, period, balance, base, main, empty


def action(client, base, operation, body=None, expected=200):
    response = client.post(base + operation + "/", body or {}, format="json")
    assert response.status_code == expected, response.data
    return response.data


def test_full_month_end_cycle_requires_review_and_posts_once(operational_context):
    controller, finance, finance_user, period, balance, base, main, empty = operational_context
    assert not period.pre_close_checklist()["can_close"]
    action(controller, base, "approve", {"note": "Self approval"}, expected=403)
    prepared = action(controller, base, "prepare", {"inventory": main["id"]})
    row = next(r for r in prepared["inventories"] if r["id"] == main["id"])
    line = row["lines"][0]
    assert line["physical_quantity"] is None
    assert "system_quantity" not in line and "unit_cost" not in line
    action(controller, base, "submit", {"inventory": main["id"]}, expected=400)
    action(controller, base, "save-count", {"inventory": main["id"], "lines": [{"id": line["id"], "physical_quantity": "8.12501"}]}, expected=400)
    action(controller, base, "save-count", {"inventory": main["id"], "lines": [{"id": line["id"], "physical_quantity": "8.1250"}]})
    submitted = action(controller, base, "submit", {"inventory": main["id"]})
    line = next(r for r in submitted["inventories"] if r["id"] == main["id"])["lines"][0]
    assert Decimal(line["variance_value"]) == Decimal("-1875.0000")
    assert Decimal(line["closing_value"]) == Decimal("8125.0000")
    action(controller, base, "prepare", {"inventory": empty["id"]})
    action(controller, base, "submit", {"inventory": empty["id"]}, expected=400)
    action(controller, base, "submit", {"inventory": empty["id"], "confirm_empty": True})
    action(finance, base, "approve", {"note": "Reviewed"}, expected=400)
    action(controller, base, "investigate", {"inventory": main["id"], "lines": [{"id": line["id"], "note": "Recounted, shortage investigated."}]})
    action(controller, base, "book", expected=400)
    action(finance, base, "approve", {"note": "Independent variance review"})
    assert not StockLedger.objects.exists()
    result = action(controller, base, "book")
    assert result["status"] == "booked"
    assert all(row["booked"] for row in result["inventories"])
    balance.refresh_from_db()
    assert balance.quantity_in_stock == Decimal("8.1250")
    ledger = StockLedger.objects.get(store=balance.store, item=balance.item)
    assert ledger.quantity_out == Decimal("1.8750")
    assert ledger.total_cost_snapshot == Decimal("1875.0000")
    assert not DepartmentConsumption.objects.exists()
    action(controller, base, "book", expected=400)
    action(controller, base, "refresh", {"inventory": main["id"], "discard_counts": True}, expected=400)
    assert StockLedger.objects.count() == 1
    assert period.pre_close_checklist()["can_close"]
    period.close(finance_user, "Reconciled month-end inventory")
    assert period.status == FiscalPeriod.STATUS_CLOSED


def test_refresh_requires_explicit_recount_after_stock_changes(operational_context):
    controller, finance, _, period, balance, base, main, empty = operational_context
    prepared = action(controller, base, "prepare", {"inventory": main["id"]})
    line = next(r for r in prepared["inventories"] if r["id"] == main["id"])["lines"][0]
    action(controller, base, "save-count", {"inventory": main["id"], "lines": [{"id": line["id"], "physical_quantity": "10.0000"}]})
    balance.quantity_in_stock = Decimal("11.0000")
    balance.save()
    action(controller, base, "submit", {"inventory": main["id"]}, expected=400)
    action(controller, base, "refresh", {"inventory": main["id"]}, expected=400)
    refreshed = action(controller, base, "refresh", {"inventory": main["id"], "discard_counts": True})
    line = next(r for r in refreshed["inventories"] if r["id"] == main["id"])["lines"][0]
    assert line["physical_quantity"] is None
    assert "system_quantity" not in line
    assert not StockLedger.objects.exists()


def test_batch_count_reconciles_quantities_without_inventing_expiry(operational_context):
    controller, finance, _, period, balance, base, main, empty = operational_context
    batch = InventoryBatch.objects.create(item=balance.item, store=balance.store,
        quantity=Decimal("10.0000"), remaining_quantity=Decimal("10.0000"),
        unit_cost=Decimal("1000.00"), batch_number="B1", expiry_date=date(2027, 1, 1))
    prepared = action(controller, base, "prepare", {"inventory": main["id"]})
    line = next(r for r in prepared["inventories"] if r["id"] == main["id"])["lines"][0]
    assert line["batch_required"] and "system_quantity" not in line["batches"][0]
    action(controller, base, "save-count", {"inventory": main["id"], "lines": [{"id": line["id"], "physical_quantity": "8.0000"}]}, expected=400)
    action(controller, base, "save-count", {"inventory": main["id"], "lines": [{"id": line["id"], "physical_quantity": "8.0000", "batches": [{"id": str(batch.pk), "physical_quantity": "7.0000"}]}]})
    action(controller, base, "submit", {"inventory": main["id"]}, expected=400)
    action(controller, base, "save-count", {"inventory": main["id"], "lines": [{"id": line["id"], "physical_quantity": "8.0000", "batches": [{"id": str(batch.pk), "physical_quantity": "8.0000"}]}]})
    action(controller, base, "submit", {"inventory": main["id"]})
    action(controller, base, "investigate", {"inventory": main["id"], "lines": [{"id": line["id"], "note": "Batch recounted."}]})
    action(controller, base, "prepare", {"inventory": empty["id"]})
    action(controller, base, "submit", {"inventory": empty["id"], "confirm_empty": True})
    action(finance, base, "approve", {"note": "Batch and stock variance reviewed"})
    action(controller, base, "book")
    batch.refresh_from_db()
    balance.refresh_from_db()
    assert batch.remaining_quantity == balance.quantity_in_stock == Decimal("8.0000")
    assert batch.expiry_date == date(2027, 1, 1)
    assert StockLedger.objects.count() == 1


def test_monthly_reconciliation_does_not_invent_opening_stock(operational_context):
    controller, finance, _, period, balance, base, main, empty = operational_context
    prepared = action(controller, base, "prepare", {"inventory": main["id"]})
    line = next(r for r in prepared["inventories"] if r["id"] == main["id"])["lines"][0]
    action(controller, base, "save-count", {"inventory": main["id"], "lines": [{"id": line["id"], "physical_quantity": "10.0000"}]})
    action(controller, base, "submit", {"inventory": main["id"]})
    action(controller, base, "prepare", {"inventory": empty["id"]})
    action(controller, base, "submit", {"inventory": empty["id"], "confirm_empty": True})
    action(finance, base, "approve", {"note": "Reviewed"})
    action(controller, base, "book")
    response = finance.get(base + "reconciliation/")
    assert response.status_code == 200, response.data
    report = response.data
    assert not report["reconciled"]
    assert report["previous_cutoff"] is None
    assert all(row["opening_value"] is None and row["difference"] is None for row in report["locations"])
    assert any("opening inventory" in blocker for blocker in report["blockers"])
    assert report["direct_department_expenses"] == []


def test_later_booking_keeps_cutoff_accounting_date(operational_context, monkeypatch):
    from django.utils import timezone
    controller, finance, _, period, balance, base, main, empty = operational_context
    prepared = action(controller, base, "prepare", {"inventory": main["id"]})
    line = next(r for r in prepared["inventories"] if r["id"] == main["id"])["lines"][0]
    action(controller, base, "save-count", {"inventory": main["id"], "lines": [{"id": line["id"], "physical_quantity": "8.0000"}]})
    action(controller, base, "submit", {"inventory": main["id"]})
    action(controller, base, "prepare", {"inventory": empty["id"]})
    action(controller, base, "submit", {"inventory": empty["id"], "confirm_empty": True})
    monkeypatch.setattr(timezone, "now", lambda: datetime(2026, 12, 1, 9, 0, tzinfo=dt_timezone.utc))
    action(controller, base, "investigate", {"inventory": main["id"], "lines": [{"id": line["id"], "note": "Cutoff count independently reviewed."}]})
    action(finance, base, "approve", {"note": "Review on next business day"})
    action(controller, base, "book")
    ledger = StockLedger.objects.get()
    assert ledger.business_date == date(2026, 11, 30)
    assert ledger.created_at.date() == date(2026, 12, 1)
    assert StockCount.objects.get().count_date == date(2026, 11, 30)
    assert period.inventory_valuation_reconciliation()["movement_count"] == 1


def test_department_cost_classification_freezes_evidence_without_duplicate_expense(operational_context):
    from apps.inventory.models import StoreRequisition, StoreRequisitionItem, StockIssue, StockIssueItem
    from django.utils import timezone
    controller, finance, finance_user, period, balance, base, main, empty = operational_context
    employee = finance_user.employee_profile
    department = employee.department
    req = StoreRequisition.objects.create(department=department, store=balance.store, requested_by=employee)
    req_line = StoreRequisitionItem.objects.create(requisition=req, item=balance.item, quantity_requested=Decimal("2.0000"))
    issue = StockIssue.objects.create(requisition=req, store=balance.store, issued_by=employee,
                                      fulfillment_status=StockIssue.STATUS_COMPLETED, signed_at=timezone.now(),
                                      inventory_changes_applied=True)
    line = StockIssueItem.objects.create(issue=issue, requisition_item=req_line, item=balance.item,
                                         quantity=Decimal("2.0000"), dispatched_unit_cost=Decimal("1000.0000"))
    expense = DepartmentConsumption.objects.create(department=department, stock_issue_item=line,
        item=balance.item, quantity=Decimal("2.0000"), unit_cost=Decimal("1000.00"), consumed_on=date(2026,11,30))
    prepared = action(controller, base, "prepare", {"inventory": main["id"]})
    item = next(row for row in prepared["inventories"] if row["id"] == main["id"])["lines"][0]
    action(controller, base, "save-count", {"inventory": main["id"], "lines": [{"id": item["id"], "physical_quantity": "10.0000"}]})
    action(controller, base, "submit", {"inventory": main["id"]})
    action(controller, base, "prepare", {"inventory": empty["id"]})
    result = action(controller, base, "submit", {"inventory": empty["id"], "confirm_empty": True})
    dept = next(row for row in result["inventories"] if row["department"])
    assert Decimal(dept["department_cost"]["net_cost"]) == Decimal("2000")
    assert dept["department_cost"]["lines"][0]["reference"] == issue.issue_no
    action(finance, base, "approve", {"note": "Reviewed"}, expected=400)
    approved = action(finance, base, "approve", {"note": "Reviewed", "department_classifications": {str(dept["id"]): "expense"}})
    assert next(row for row in approved["inventories"] if row["department"])["department_cost"]["classification"] == "expense"
    DepartmentConsumption.objects.filter(pk=expense.pk).update(unit_cost=Decimal("1100.00"))
    action(controller, base, "book", expected=400)
    DepartmentConsumption.objects.filter(pk=expense.pk).update(unit_cost=Decimal("1000.00"))
    result = action(controller, base, "book")
    assert result["status"] == "booked"
    assert DepartmentConsumption.objects.count() == 1
    assert not StockLedger.objects.exists()
    assert next(row for row in result["inventories"] if row["department"])["department_cost"]["net_cost"] == "2000.0000"


def test_unrecorded_physical_article_is_counted_before_valuation_reconciliation(operational_context):
    controller, finance, _, period, balance, base, main, empty = operational_context
    found = Item.objects.create(category=balance.item.category,name="Found article",unit="kg",reorder_level=Decimal("0"))
    prepared=action(controller,base,"prepare",{"inventory":main["id"]})
    line=next(r for r in prepared["inventories"] if r["id"]==main["id"])["lines"][0]
    action(controller,base,"save-count",{"inventory":main["id"],"lines":[{"id":line["id"],"physical_quantity":"10.0000"}]})
    action(controller,base,"add-article",{"inventory":main["id"],"item":str(found.pk),"physical_quantity":"7.1250"})
    result=action(controller,base,"submit",{"inventory":main["id"]})
    added=next(l for r in result["inventories"] if r["id"]==main["id"] for l in r["lines"] if l["article"]=="Found article")
    assert added["system_quantity"]=="0.0000" and Decimal(added["variance"])==Decimal("7.1250")
    assert added["variance_value"] is None
    assert not InventoryBalance.objects.filter(store=balance.store,item=found).exists()
    assert not StockLedger.objects.exists()
