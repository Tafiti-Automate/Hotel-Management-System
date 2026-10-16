from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.accounts.role_templates import sync_client_roles
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import Category, InventoryBalance, Item, StockIssue, StoreLocation, UnitOfMeasure
from apps.notifications.models import Notification
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
    return locals()


@pytest.mark.django_db
def test_department_request_is_reduction_only_and_reaches_stores(ctx):
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
