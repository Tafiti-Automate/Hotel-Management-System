from decimal import Decimal, ROUND_HALF_UP
from calendar import monthrange

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db.models import QuerySet
from rest_framework.test import APIClient

from apps.accounts.role_templates import sync_client_roles
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import (
    Category, DepartmentConsumption, InventoryBalance, Item, StockCount,
    StockIssue, StockLedger, StoreRequisition, StoreRequisitionItem,
    StockTransfer, StoreKeeperAssignment, StoreLocation, UnitOfMeasure,
)
from apps.notifications.models import Notification
from apps.materials_control.models import FiscalPeriod
from django.utils import timezone
from core.constants.choices import LedgerReferenceType
from apps.procurement.models import PurchaseOrder, PurchaseOrderItem, PurchaseRequisition, RequisitionItem
from apps.vendors.models import Supplier
from core.constants.choices import POStatus, PRStatus


def employee(username, role, department, branch):
    user = get_user_model().objects.create_user(username=username, employee_code=f"EMP-{username[:8]}", password="test-pass")
    user.groups.add(Group.objects.get(name=role))
    return user, Employee.objects.create(user=user, department=department, branch=branch, designation=role)


@pytest.fixture
def ctx(db):
    sync_client_roles()
    department = Department.objects.create(name="Housekeeping Workflow")
    branch = Branch.objects.create(name="Main Property Workflow")
    main = StoreLocation.objects.create(branch=branch, name="Main Store Workflow", is_default=True)
    other = StoreLocation.objects.create(branch=branch, name="Other Store Workflow")
    unit = UnitOfMeasure.objects.create(name="Piece Workflow", abbreviation="pc")
    category = Category.objects.create(name="Housekeeping Workflow Items")
    item = Item.objects.create(category=category, name="Bath Towel Workflow", sku="TOW-WF-001", unit="pc", base_unit=unit, reorder_level=Decimal("2.00"))
    InventoryBalance.objects.create(item=item, store=main, quantity_in_stock=Decimal("20.00"))
    su, se = employee("dept-supervisor", "Department Supervisor", department, branch)
    hu, he = employee("dept-hod", "Department Head", department, branch)
    cu, ce = employee("dept-cost", "Cost Controller", department, branch)
    ku, ke = employee("dept-keeper", "Store Keeper", department, branch)
    StoreKeeperAssignment.objects.create(store=main, employee=ke)
    return locals()


@pytest.mark.django_db
def test_department_request_is_reduction_only_and_reaches_stores(ctx, monkeypatch):
    supervisor = APIClient(); supervisor.force_authenticate(ctx["su"])
    request = supervisor.post("/api/v1/store-requisitions/", {"store": str(ctx["main"].pk), "purpose": "Replace linen"}, format="json")
    assert request.status_code == 201, request.data
    rid = request.data["id"]
    line = supervisor.post("/api/v1/store-requisition-items/", {"requisition": rid, "item": str(ctx["item"].pk), "unit": str(ctx["unit"].pk), "quantity_requested": "10.00"}, format="json")
    assert line.status_code == 201, line.data
    lid = line.data["id"]
    assert supervisor.patch(f"/api/v1/store-requisition-items/{lid}/", {"quantity_requested": "11.00"}, format="json").status_code == 400
    submitted = supervisor.post(f"/api/v1/store-requisitions/{rid}/submit/", {}, format="json")
    assert submitted.status_code == 200 and submitted.data["status"] == "pending_department_approval"

    hod = APIClient(); hod.force_authenticate(ctx["hu"])
    assert hod.post(f"/api/v1/store-requisitions/{rid}/department-approve/", {"items": [{"id": lid, "approved_quantity": "11.00"}]}, format="json").status_code == 400
    approved = hod.post(f"/api/v1/store-requisitions/{rid}/department-approve/", {"items": [{"id": lid, "approved_quantity": "8.00", "reason": "HOD reduction"}]}, format="json")
    assert approved.status_code == 200 and approved.data["status"] == "submitted"

    cost = APIClient(); cost.force_authenticate(ctx["cu"])
    original_select_related = QuerySet.select_related

    def reject_joined_row_locks(queryset, *fields):
        if queryset.query.select_for_update:
            raise AssertionError(
                "Department-request row locks must not join nullable related tables."
            )
        return original_select_related(queryset, *fields)

    # SQLite accepts FOR UPDATE query shapes that PostgreSQL rejects. Guard the
    # endpoint invariant directly so this production-only failure is covered.
    with monkeypatch.context() as lock_guard:
        lock_guard.setattr(QuerySet, "select_related", reject_joined_row_locks)
        assert cost.post(f"/api/v1/store-requisitions/{rid}/cost-control-approve/", {"items": [{"id": lid, "approved_quantity": "9.00"}]}, format="json").status_code == 400
        approved = cost.post(f"/api/v1/store-requisitions/{rid}/cost-control-approve/", {"items": [{"id": lid, "approved_quantity": "6.00", "reason": "Cost control"}]}, format="json")
        assert approved.status_code == 200 and approved.data["status"] == "approved"
        balance = InventoryBalance.objects.get(item=ctx["item"], store=ctx["main"])
        assert balance.quantity_in_stock == Decimal("20.00") and balance.quantity_reserved == Decimal("6.00")

        keeper = APIClient(); keeper.force_authenticate(ctx["ku"])
        transfer = keeper.post(f"/api/v1/store-requisitions/{rid}/prepare-transfer/", {}, format="json")
        assert transfer.status_code == 200 and transfer.data["created"] is True
        assert StockIssue.objects.get(pk=transfer.data["id"]).inventory_changes_applied is False
        balance.refresh_from_db(); assert balance.quantity_in_stock == Decimal("20.00")
        assert Notification.objects.filter(employee=ctx["he"], title__icontains="ready for pickup").exists()


@pytest.mark.django_db
def test_store_keeper_verifies_grn_before_soh_increases(ctx):
    sync_client_roles()
    today = timezone.localdate()
    FiscalPeriod.objects.create(
        branch=ctx["branch"], name="Receiving test month",
        start_date=today.replace(day=1),
        end_date=today.replace(day=monthrange(today.year, today.month)[1]),
    )
    balance = InventoryBalance.objects.get(item=ctx["item"], store=ctx["main"])
    balance.weighted_average_cost = Decimal("3000.0000")
    balance.save(update_fields=["weighted_average_cost", "updated_at"])
    receiving_user, receiving = employee("grn-receiver", "Receiving Clerk", ctx["department"], ctx["branch"])
    supplier = Supplier.objects.create(name="Workflow Vendor", email="wf@example.com", phone="+256700000001", address="Kampala", tin_number="TIN-WF", registration_number="REG-WF")
    requisition = PurchaseRequisition.objects.create(requester=ctx["se"], department=ctx["department"], branch=ctx["branch"], reason="Restock", status=PRStatus.APPROVED)
    req_line = RequisitionItem.objects.create(requisition=requisition, item=ctx["item"], unit=ctx["unit"], quantity=Decimal("4.00"), approved_quantity=Decimal("4.00"), destination_store=ctx["main"])
    order = PurchaseOrder.objects.create(requisition=requisition, supplier=supplier, ordered_by=ctx["se"], store=ctx["main"])
    po_line = PurchaseOrderItem.objects.create(purchase_order=order, requisition_item=req_line, item=ctx["item"], unit=ctx["unit"], quantity=Decimal("4.00"), unit_cost=Decimal("1000.00"), destination_store=ctx["main"])
    order.status = POStatus.ISSUED; order.save(update_fields=["status", "updated_at"])

    receiver = APIClient(); receiver.force_authenticate(receiving_user)
    received = receiver.post(f"/api/v1/purchase-orders/{order.pk}/receive-delivery/", {"supplier_invoice_no": "INV-1", "lines": [{"purchase_order_item": str(po_line.pk), "quantity_received": "4.00"}]}, format="json")
    assert received.status_code == 201, received.data
    grn = received.data["id"]
    before = InventoryBalance.objects.get(item=ctx["item"], store=ctx["main"]).quantity_in_stock
    assert receiver.post(f"/api/v1/grns/{grn}/post-to-inventory/", {}, format="json").status_code == 403

    keeper = APIClient(); keeper.force_authenticate(ctx["ku"])
    stores = keeper.get("/api/v1/stores/")
    rows = stores.data.get("results", stores.data) if isinstance(stores.data, dict) else stores.data
    assert {row["id"] for row in rows} >= {str(ctx["main"].pk), str(ctx["other"].pk)}
    check = keeper.get(f"/api/v1/grns/{grn}/verification/")
    assert check.status_code == 200 and check.data["lines"][0]["matches_lpo_limit"] is True
    posted = keeper.post(f"/api/v1/grns/{grn}/post-to-inventory/", {}, format="json")
    assert posted.status_code == 200 and posted.data["status"] == "posted"
    assert InventoryBalance.objects.get(item=ctx["item"], store=ctx["main"]).quantity_in_stock == before + Decimal("4.00")
    after = InventoryBalance.objects.get(item=ctx["item"], store=ctx["main"])
    expected_wac = (
        (before * Decimal("3000")) + (Decimal("4.00") * Decimal("1000"))
    ) / (before + Decimal("4.00"))
    assert after.weighted_average_cost == expected_wac.quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP
    )
    assert StockLedger.objects.filter(
        reference_id=grn, reference_type=LedgerReferenceType.GRN_RECEIPT,
        quantity_in=Decimal("4.00"),
    ).count() == 1
    assert keeper.post(f"/api/v1/grns/{grn}/post-to-inventory/", {}, format="json").status_code == 400


@pytest.mark.django_db
def test_store_keeper_transfer_and_count_controls_are_assigned_store_scoped(ctx):
    unassigned = StoreLocation.objects.create(branch=ctx["branch"], name="Unassigned Store Workflow")
    visible_transfer = StockTransfer.objects.create(
        from_store=ctx["main"], to_store=ctx["other"], requested_by=ctx["ke"],
    )
    hidden_transfer = StockTransfer.objects.create(
        from_store=ctx["other"], to_store=unassigned, requested_by=ctx["ke"],
    )
    StockCount.objects.create(store=ctx["main"], conducted_by=ctx["ke"])
    StockCount.objects.create(store=ctx["other"], conducted_by=ctx["ke"])
    StockLedger.objects.create(item=ctx["item"], store=ctx["main"], quantity_in=Decimal("1.00"), reference_type="stock_count", reference_id=visible_transfer.pk)
    StockLedger.objects.create(item=ctx["item"], store=ctx["other"], quantity_in=Decimal("1.00"), reference_type="stock_count", reference_id=hidden_transfer.pk)

    keeper = APIClient(); keeper.force_authenticate(ctx["ku"])
    transfers = keeper.get("/api/v1/stock-transfers/")
    transfer_rows = transfers.data.get("results", transfers.data)
    assert {row["id"] for row in transfer_rows} == {str(visible_transfer.pk)}
    counts = keeper.get("/api/v1/stock-counts/")
    count_rows = counts.data.get("results", counts.data)
    assert {str(row["store"]) for row in count_rows} == {str(ctx["main"].pk)}
    ledgers = keeper.get("/api/v1/stock-ledger/")
    ledger_rows = ledgers.data.get("results", ledgers.data)
    assert {str(row["store"]) for row in ledger_rows} == {str(ctx["main"].pk)}

    blocked_transfer = keeper.post(
        "/api/v1/stock-transfers/",
        {"from_store": str(ctx["other"].pk), "to_store": str(ctx["main"].pk)},
        format="json",
    )
    assert blocked_transfer.status_code == 403
    created_transfer = keeper.post(
        "/api/v1/stock-transfers/",
        {"from_store": str(ctx["main"].pk), "to_store": str(ctx["other"].pk)},
        format="json",
    )
    assert created_transfer.status_code == 201, created_transfer.data
    assert str(created_transfer.data["requested_by"]) == str(ctx["ke"].pk)

    blocked_count = keeper.post(
        "/api/v1/stock-counts/", {"store": str(ctx["other"].pk), "conducted_by": str(ctx["ke"].pk)}, format="json",
    )
    assert blocked_count.status_code == 403
    created_count = keeper.post(
        "/api/v1/stock-counts/", {"store": str(ctx["main"].pk), "conducted_by": str(ctx["ke"].pk)}, format="json",
    )
    assert created_count.status_code == 201, created_count.data
    assert str(created_count.data["conducted_by"]) == str(ctx["ke"].pk)


@pytest.mark.django_db
def test_internal_dispatch_moves_stock_into_virtual_transit_until_pickup(ctx):
    today = timezone.localdate()
    FiscalPeriod.objects.create(
        branch=ctx["branch"], name="Dispatch test month",
        start_date=today.replace(day=1),
        end_date=today.replace(day=monthrange(today.year, today.month)[1]),
    )
    req = StoreRequisition.objects.create(
        requested_by=ctx["se"], department=ctx["department"],
        store=ctx["main"], purpose="Linen for the shift", status="approved",
    )
    line = StoreRequisitionItem.objects.create(
        requisition=req, item=ctx["item"], unit=ctx["unit"],
        quantity_requested=Decimal("5.00"),
        hod_approved_quantity=Decimal("5.00"),
        quantity_approved=Decimal("5.00"),
    )
    source = InventoryBalance.objects.get(item=ctx["item"], store=ctx["main"])
    source.weighted_average_cost = Decimal("1250.0000")
    source.quantity_reserved = Decimal("5.00")
    source.save(update_fields=["weighted_average_cost", "quantity_reserved", "updated_at"])

    keeper = APIClient()
    keeper.force_authenticate(ctx["ku"])
    queue = keeper.get("/api/v1/store-requisitions/fulfillment-queue/")
    assert queue.status_code == 200, queue.data
    assert any(row["reference"] == req.requisition_no for row in queue.data)
    dispatched = keeper.post(
        "/api/v1/store-requisitions/dispatch-batch/",
        {"requests": [{
            "id": str(req.pk), "quantities": {str(line.pk): "3.00"},
        }]}, format="json",
    )
    assert dispatched.status_code == 201, dispatched.data
    issue = StockIssue.objects.get(pk=dispatched.data[0]["id"])
    assert issue.fulfillment_status == "in_transit"
    assert issue.inventory_changes_applied
    source.refresh_from_db()
    line.refresh_from_db()
    assert source.quantity_in_stock == Decimal("17.00")
    assert source.quantity_reserved == Decimal("2.00")
    assert line.quantity_issued == Decimal("3.00")
    assert InventoryBalance.objects.get(
        item=ctx["item"], store=issue.transit_store
    ).quantity_in_stock == Decimal("3.00")
    assert not DepartmentConsumption.objects.filter(
        stock_issue_item__issue=issue
    ).exists()
    assert StockLedger.objects.filter(
        reference_id=issue.pk,
        reference_type=LedgerReferenceType.TRANSIT_DISPATCH,
    ).count() == 2
    assert FiscalPeriod.objects.get(branch=ctx["branch"]).pre_close_checklist()[
        "open_issue_transits"
    ] == 1

    # The requesting supervisor is the only person permitted to sign delivery.
    supervisor = APIClient()
    supervisor.force_authenticate(ctx["su"])
    acknowledged = supervisor.post(
        f"/api/v1/stock-issues/{issue.pk}/acknowledge/", {}, format="json",
    )
    assert acknowledged.status_code == 200, acknowledged.data
    issue.refresh_from_db()
    assert issue.fulfillment_status == "completed"
    assert InventoryBalance.objects.get(
        item=ctx["item"], store=issue.transit_store
    ).quantity_in_stock == Decimal("0.00")
    consumed = DepartmentConsumption.objects.get(stock_issue_item__issue=issue)
    assert consumed.quantity == Decimal("3.00")
    assert consumed.unit_cost == Decimal("1250.0000")
    assert StockLedger.objects.filter(
        reference_id=issue.pk, reference_type=LedgerReferenceType.TRANSIT_PICKUP,
    ).count() == 1
    assert FiscalPeriod.objects.get(branch=ctx["branch"]).pre_close_checklist()[
        "open_issue_transits"
    ] == 0
    assert supervisor.post(
        f"/api/v1/stock-issues/{issue.pk}/acknowledge/", {}, format="json",
    ).status_code == 400


@pytest.mark.django_db
def test_multi_request_dispatch_rolls_back_when_any_request_is_short(ctx):
    today = timezone.localdate()
    FiscalPeriod.objects.create(
        branch=ctx["branch"], name="Rollback test month",
        start_date=today.replace(day=1),
        end_date=today.replace(day=monthrange(today.year, today.month)[1]),
    )
    requests = []
    for number in range(2):
        req = StoreRequisition.objects.create(
            requested_by=ctx["se"], department=ctx["department"],
            store=ctx["main"], purpose=f"Request {number}", status="approved",
        )
        line = StoreRequisitionItem.objects.create(
            requisition=req, item=ctx["item"], unit=ctx["unit"],
            quantity_requested=Decimal("15.00"),
            hod_approved_quantity=Decimal("15.00"),
            quantity_approved=Decimal("15.00"),
        )
        requests.append({"id": str(req.pk), "quantities": {str(line.pk): "15.00"}})
    keeper = APIClient()
    keeper.force_authenticate(ctx["ku"])
    response = keeper.post(
        "/api/v1/store-requisitions/dispatch-batch/",
        {"requests": requests}, format="json",
    )
    assert response.status_code == 400, response.data
    assert StockIssue.objects.count() == 0
    assert StockLedger.objects.filter(
        reference_type=LedgerReferenceType.TRANSIT_DISPATCH,
    ).count() == 0
    assert InventoryBalance.objects.get(
        item=ctx["item"], store=ctx["main"]
    ).quantity_in_stock == Decimal("20.00")


@pytest.mark.django_db
def test_dispatch_refuses_unconfigured_or_closed_fiscal_period(ctx):
    request = StoreRequisition.objects.create(
        requested_by=ctx["se"], department=ctx["department"],
        store=ctx["main"], purpose="Fiscal lock test", status="approved",
    )
    line = StoreRequisitionItem.objects.create(
        requisition=request, item=ctx["item"], unit=ctx["unit"],
        quantity_requested=Decimal("2.00"),
        hod_approved_quantity=Decimal("2.00"),
        quantity_approved=Decimal("2.00"),
    )
    keeper = APIClient()
    keeper.force_authenticate(ctx["ku"])
    path = f"/api/v1/store-requisitions/{request.pk}/dispatch-transfer/"
    assert keeper.post(path, {
        "quantities": {str(line.pk): "2.00"}
    }, format="json").status_code == 400
    today = timezone.localdate()
    FiscalPeriod.objects.create(
        branch=ctx["branch"], name="Closed month",
        start_date=today.replace(day=1),
        end_date=today.replace(day=monthrange(today.year, today.month)[1]),
        status="closed",
    )
    assert keeper.post(path, {
        "quantities": {str(line.pk): "2.00"}
    }, format="json").status_code == 400
    assert StockIssue.objects.count() == 0
