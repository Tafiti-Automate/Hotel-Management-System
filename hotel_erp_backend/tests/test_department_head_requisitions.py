"""Regression tests for the approved Supervisor -> HOD -> Cost Control -> Stores workflow.

Old tests permitting HOD to originate and Storekeeper to edit requests directly
were superseded by the explicit segregation-of-duties design.
"""
from calendar import monthrange
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import (
    Category, DepartmentConsumption, InventoryBalance, Item, StockIssue,
    StoreKeeperAssignment, StoreLocation, StoreRequisition, StoreRequisitionItem,
    UnitOfMeasure,
)
from apps.materials_control.models import FiscalPeriod
from core.constants.choices import StoreRequisitionStatus


@pytest.fixture
def workflow(db):
    department = Department.objects.create(name="Housekeeping Control")
    branch = Branch.objects.create(name="Warehouse Control Property")
    store = StoreLocation.objects.create(branch=branch, name="Main Dry Store", is_active=True)
    unit = UnitOfMeasure.objects.create(name="Bottles Test", abbreviation="tbt")
    category = Category.objects.create(name="Cleaning Control Items")
    item = Item.objects.create(
        category=category, name="Surface Cleaner", sku="E2E-CLEANER",
        unit="btl", base_unit=unit, reorder_level=Decimal("2.00"),
    )

    def person(role,code):
        user = get_user_model().objects.create_user(
            username="wf-" + role.lower().replace(" ", "-"),
            employee_code="WF-" + code,
            password="test-pass-123",
        )
        user.groups.add(Group.objects.get_or_create(name=role)[0])
        employee = Employee.objects.create(
            user=user, department=department, branch=branch,
            designation=role, is_active=True,
        )
        client = APIClient()
        client.force_authenticate(user)
        return user, employee, client

    supervisor = person("Department Supervisor", "SUP")
    head = person("Department Head", "HOD")
    cost = person("Cost Controller", "COST")
    keeper = person("Store Keeper", "KEEP")
    StoreKeeperAssignment.objects.create(store=store, employee=keeper[1], is_active=True)
    InventoryBalance.objects.create(
        item=item, store=store, quantity_in_stock=Decimal("20.00"),
        weighted_average_cost=Decimal("2500.0000"),
    )
    today = timezone.localdate()
    FiscalPeriod.objects.create(
        branch=branch, name="Operational workflow period",
        start_date=today.replace(day=1),
        end_date=today.replace(day=monthrange(today.year,today.month)[1]),
    )
    return {"department": department, "branch": branch, "store": store, "item": item,
            "unit": unit, "supervisor": supervisor, "head": head,
            "cost": cost, "keeper": keeper}


def _create_supervisor_draft(ctx, quantity="10.00"):
    supervisor = ctx["supervisor"][2]
    result = supervisor.post(
        "/api/v1/store-requisitions/",
        {"purpose": "Shift supplies", "store": str(ctx["store"].pk)},
        format="json",
    )
    assert result.status_code == 201, result.data
    request_id = result.data["id"]
    line = supervisor.post(
        "/api/v1/store-requisition-items/",
        {"requisition": request_id, "item": str(ctx["item"].pk),
         "unit": str(ctx["unit"].pk), "quantity_requested": quantity},
        format="json",
    )
    assert line.status_code == 201, line.data
    return request_id, line.data["id"]


@pytest.mark.django_db
def test_supervisor_origination_hod_and_cost_review_and_signed_pickup(workflow):
    """The genuine four-step flow posts a balanced transit and a consumption."""
    ctx=workflow
    denied=ctx["head"][2].post(
        "/api/v1/store-requisitions/",
        {"purpose":"Bypass Supervisor","store":str(ctx["store"].pk)},
        format="json",
    )
    assert denied.status_code == 403

    request_id,line_id=_create_supervisor_draft(ctx)
    supervisor=ctx["supervisor"][2]
    # Editing the unsubmitted draft is allowed, but quantities cannot increase.
    edit=supervisor.patch(
        f"/api/v1/store-requisition-items/{line_id}/",
        {"quantity_requested":"8.00"},format="json"
    )
    assert edit.status_code == 200, edit.data
    submit=supervisor.post(f"/api/v1/store-requisitions/{request_id}/submit/",{},format="json")
    assert submit.status_code == 200, submit.data
    assert submit.data["status"] == StoreRequisitionStatus.PENDING_DEPARTMENT_APPROVAL

    keeper=ctx["keeper"][2]
    assert keeper.get("/api/v1/store-requisitions/fulfillment-queue/").data == []

    reviewed=ctx["head"][2].post(
        f"/api/v1/store-requisitions/{request_id}/department-approve/",
        {"items":[{"id":line_id,"approved_quantity":"7.00","reason":"Reduced shift requirement"}]},
        format="json",
    )
    assert reviewed.status_code == 200, reviewed.data
    assert reviewed.data["status"] == StoreRequisitionStatus.SUBMITTED
    assert keeper.get("/api/v1/store-requisitions/fulfillment-queue/").data == []

    cost=ctx["cost"][2]
    approved=cost.post(
        f"/api/v1/store-requisitions/{request_id}/cost-control-approve/",
        {"items":[{"id":line_id,"approved_quantity":"6.00","reason":"Approved six bottles"}]},
        format="json",
    )
    assert approved.status_code == 200, approved.data
    assert approved.data["status"] == StoreRequisitionStatus.APPROVED
    queue=keeper.get("/api/v1/store-requisitions/fulfillment-queue/")
    assert queue.status_code == 200, queue.data
    assert queue.data[0]["id"] == request_id

    too_much=keeper.post(
        f"/api/v1/store-requisitions/{request_id}/dispatch-transfer/",
        {"quantities":{line_id:"7.00"}},format="json",
    )
    assert too_much.status_code == 400

    dispatched=keeper.post(
        f"/api/v1/store-requisitions/{request_id}/dispatch-transfer/",
        {"quantities":{line_id:"6.00"}},format="json",
    )
    assert dispatched.status_code == 201, dispatched.data
    issue=StockIssue.objects.get(pk=dispatched.data["id"])
    assert issue.fulfillment_status == StockIssue.STATUS_TRANSIT
    balance=InventoryBalance.objects.get(item=ctx["item"],store=ctx["store"])
    assert balance.quantity_in_stock == Decimal("14.00")

    signed=supervisor.post(f"/api/v1/stock-issues/{issue.pk}/acknowledge/",{},format="json")
    assert signed.status_code == 200, signed.data
    assert StockIssue.objects.get(pk=issue.pk).fulfillment_status != StockIssue.STATUS_TRANSIT
    assert DepartmentConsumption.objects.filter(stock_issue_item__issue=issue).count() == 1
    duplicate=supervisor.post(f"/api/v1/stock-issues/{issue.pk}/acknowledge/",{},format="json")
    assert duplicate.status_code == 400


@pytest.mark.django_db
def test_store_keeper_cannot_edit_supervisor_requested_or_cost_approved_quantities(workflow):
    ctx=workflow
    request_id,line_id=_create_supervisor_draft(ctx)
    supervisor=ctx["supervisor"][2]
    assert supervisor.post(f"/api/v1/store-requisitions/{request_id}/submit/",{},format="json").status_code == 200
    approved=ctx["head"][2].post(
        f"/api/v1/store-requisitions/{request_id}/department-approve/",
        {"items":[{"id":line_id,"approved_quantity":"10.00"}]},format="json",
    )
    assert approved.status_code == 200, approved.data
    approved=ctx["cost"][2].post(
        f"/api/v1/store-requisitions/{request_id}/cost-control-approve/",
        {"items":[{"id":line_id,"approved_quantity":"6.00","reason":"Restrict to six"}]},
        format="json",
    )
    assert approved.status_code == 200, approved.data

    keeper=ctx["keeper"][2]
    for patch in (
        {"quantity_requested":"12.00"},
        {"quantity_approved":"8.00"},
        {"quantity_approved":"4.00"},
    ):
        denied=keeper.patch(f"/api/v1/store-requisition-items/{line_id}/",patch,format="json")
        assert denied.status_code == 403, denied.data

    line=StoreRequisitionItem.objects.get(pk=line_id)
    assert line.base_quantity_requested == Decimal("10.00")
    assert line.hod_approved_quantity == Decimal("10.00")
    assert line.quantity_approved == Decimal("6.00")
    assert line.quantity_issued == Decimal("0.00")


@pytest.mark.django_db
def test_requisition_only_orders_the_unavailable_stock_and_keeps_approved_quantity(workflow):
    ctx = workflow
    supervisor = ctx["supervisor"][2]
    head = ctx["head"][2]
    keeper = ctx["keeper"][2]
    request_id, line_id = _create_supervisor_draft(ctx, quantity="30.0000")
    assert supervisor.post(
        f"/api/v1/store-requisitions/{request_id}/submit/", {}, format="json"
    ).status_code == 200
    decision = head.post(
        f"/api/v1/store-requisitions/{request_id}/department-approve/",
        {"items": [{"id": line_id, "approved_quantity": "28.0000"}]}, format="json",
    )
    assert decision.status_code == 200, decision.data
    confirmed = keeper.patch(
        f"/api/v1/store-requisition-items/{line_id}/",
        {"quantity_approved": "28.0000", "storekeeper_comment": "Purchase only the shortfall"},
        format="json",
    )
    assert confirmed.status_code == 200, confirmed.data
    purchase = keeper.post(
        f"/api/v1/store-requisitions/{request_id}/send-to-procurement/",
        {"reason": "Approved store shortage"}, format="json",
    )
    assert purchase.status_code == 200, purchase.data
    req = StoreRequisition.objects.get(pk=request_id)
    original = StoreRequisitionItem.objects.get(pk=line_id)
    assert req.status == StoreRequisitionStatus.AWAITING_PROCUREMENT
    assert original.base_quantity_requested == Decimal("30.0000")
    assert original.hod_approved_quantity == Decimal("28.0000")
    assert original.quantity_approved == Decimal("28.0000")
    assert original.quantity_issued == Decimal("0.0000")
    from apps.procurement.models import RequisitionItem
    sourced = RequisitionItem.objects.get(requisition=req.procurement_requisition)
    assert sourced.quantity == Decimal("8.0000")
    assert keeper.post(
        f"/api/v1/store-requisitions/{request_id}/send-to-procurement/",
        {}, format="json",
    ).status_code == 400


@pytest.mark.django_db
def test_full_internal_requisition_closes_only_after_signed_pickup(workflow):
    ctx = workflow
    supervisor = ctx["supervisor"][2]
    request_id, line_id = _create_supervisor_draft(ctx, quantity="5.0000")
    assert supervisor.post(
        f"/api/v1/store-requisitions/{request_id}/submit/", {}, format="json"
    ).status_code == 200
    hod = ctx["head"][2].post(
        f"/api/v1/store-requisitions/{request_id}/department-approve/",
        {"items": [{"id": line_id, "approved_quantity": "5.0000"}]}, format="json",
    )
    assert hod.status_code == 200, hod.data
    cost = ctx["cost"][2].post(
        f"/api/v1/store-requisitions/{request_id}/cost-control-approve/",
        {"items": [{"id": line_id, "approved_quantity": "5.0000"}]}, format="json",
    )
    assert cost.status_code == 200, cost.data
    dispatch = ctx["keeper"][2].post(
        f"/api/v1/store-requisitions/{request_id}/dispatch-transfer/",
        {"quantities": {line_id: "5.0000"}}, format="json",
    )
    assert dispatch.status_code == 201, dispatch.data
    req = StoreRequisition.objects.get(pk=request_id)
    assert req.status == StoreRequisitionStatus.ISSUED
    signed = supervisor.post(
        f"/api/v1/stock-issues/{dispatch.data['id']}/acknowledge/", {}, format="json",
    )
    assert signed.status_code == 200, signed.data
    req.refresh_from_db()
    assert req.status == StoreRequisitionStatus.COMPLETED


@pytest.mark.django_db
def test_unrelated_roles_cannot_create_department_requisitions(workflow):
    ctx = workflow
    for role in ("head", "cost", "keeper"):
        denied = ctx[role][2].post(
            "/api/v1/store-requisitions/",
            {"purpose": "Unauthorized origin", "store": str(ctx["store"].pk)},
            format="json",
        )
        assert denied.status_code == 403, (role, denied.data)
