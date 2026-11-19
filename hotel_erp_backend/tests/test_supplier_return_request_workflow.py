"""End-to-end supplier-return reporting and controlled dispatch regressions."""
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.employees.models import Employee
from apps.inventory.models import InventoryBalance, StockLedger, StoreKeeperAssignment
from apps.organization.models import Hotel
from apps.procurement.models import SupplierReturnRequest, SupplierReturn
from tests.test_phase2_supplier_return_quantities import posted_receipt


@pytest.fixture
def return_context(posted_receipt):
    keeper, supplier, item, store, grn = posted_receipt
    hotel = Hotel.objects.create(name="Supplier return workflow hotel")
    branch = store.branch
    branch.hotel = hotel
    branch.save(update_fields=["hotel", "updated_at"])
    keeper.user.groups.add(Group.objects.get_or_create(name="Store Keeper")[0])
    StoreKeeperAssignment.objects.create(store=store, employee=keeper)
    controller_user = get_user_model().objects.create_user(
        username="cost-controller-return", employee_code="EMP-SRR-CC", password="test-pass-123"
    )
    controller_user.groups.add(Group.objects.get_or_create(name="Cost Controller")[0])
    controller = Employee.objects.create(
        user=controller_user, department=keeper.department, branch=branch, designation="Cost Controller",
    )
    return keeper, controller, supplier, item, store, grn


def client_for(employee):
    client = APIClient()
    client.force_authenticate(user=employee.user)
    return client


def payload(context, *, source="stock_on_hand", quantity="2.0000"):
    _, _, _, _, store, grn = context
    line = grn.items.first()
    return {
        "goods_receipt": str(grn.pk),
        "goods_receipt_item": str(line.pk),
        "store": str(store.pk),
        "source": source,
        "quantity": quantity,
        "reason": "Damaged packaging",
        "evidence_note": "Carton photo inspected",
    }


@pytest.mark.django_db
def test_storekeeper_report_quarantines_then_cost_controller_dispatches_once(return_context):
    keeper, controller, supplier, item, store, grn = return_context
    kclient, cclient = client_for(keeper), client_for(controller)
    created = kclient.post("/api/v1/supplier-return-requests/", payload(return_context), format="json")
    assert created.status_code == 201, created.data
    request_id = created.data["id"]
    balance = InventoryBalance.objects.get(item=item, store=store)
    assert balance.quantity_in_stock == Decimal("7.0000")
    assert balance.quantity_quarantined == Decimal("2.0000")
    assert balance.available_quantity == Decimal("5.0000")
    denied = kclient.post("/api/v1/supplier-return-requests/" + str(request_id) + "/approve/", {}, format="json")
    assert denied.status_code == 403
    approved = cclient.post("/api/v1/supplier-return-requests/" + str(request_id) + "/approve/", {}, format="json")
    assert approved.status_code == 200, approved.data
    sent = cclient.post("/api/v1/supplier-return-requests/" + str(request_id) + "/dispatch/", {}, format="json")
    assert sent.status_code == 200, sent.data
    balance.refresh_from_db()
    assert balance.quantity_in_stock == Decimal("5.0000")
    assert balance.quantity_quarantined == Decimal("0.0000")
    report = SupplierReturnRequest.objects.get(pk=request_id)
    assert report.supplier_return_id
    assert StockLedger.objects.filter(reference_id=report.supplier_return_id).count() == 1
    repeat = cclient.post("/api/v1/supplier-return-requests/" + str(request_id) + "/dispatch/", {}, format="json")
    assert repeat.status_code == 400
    assert SupplierReturn.objects.filter(pk=report.supplier_return_id).count() == 1
    assert StockLedger.objects.filter(reference_id=report.supplier_return_id).count() == 1


@pytest.mark.django_db
def test_rejection_releases_quarantine_without_deducting_physical_stock(return_context):
    keeper, controller, supplier, item, store, grn = return_context
    response = client_for(keeper).post("/api/v1/supplier-return-requests/", payload(return_context), format="json")
    assert response.status_code == 201, response.data
    response = client_for(controller).post(
        "/api/v1/supplier-return-requests/" + str(response.data["id"]) + "/reject/",
        {"note": "Goods rechecked; acceptable condition"}, format="json",
    )
    assert response.status_code == 200, response.data
    balance = InventoryBalance.objects.get(item=item, store=store)
    assert balance.quantity_in_stock == Decimal("7.0000")
    assert balance.quantity_quarantined == Decimal("0.0000")


@pytest.mark.django_db
def test_receiving_rejection_uses_no_stock_movement(return_context):
    keeper, controller, supplier, item, store, grn = return_context
    keeper.user.groups.remove(Group.objects.get(name="Store Keeper"))
    keeper.user.groups.add(Group.objects.get_or_create(name="Receiving Clerk")[0])
    cclient, clerk = client_for(controller), client_for(keeper)
    original = InventoryBalance.objects.get(item=item, store=store).quantity_in_stock
    created = clerk.post("/api/v1/supplier-return-requests/", payload(
        return_context, source="receiving_rejection", quantity="2.0000",
    ), format="json")
    assert created.status_code == 201, created.data
    request_id = created.data["id"]
    assert cclient.post("/api/v1/supplier-return-requests/" + str(request_id) + "/approve/", {}, format="json").status_code == 200
    sent = cclient.post("/api/v1/supplier-return-requests/" + str(request_id) + "/dispatch/", {}, format="json")
    assert sent.status_code == 200, sent.data
    report = SupplierReturnRequest.objects.get(pk=request_id)
    assert report.supplier_return_id is None
    balance = InventoryBalance.objects.get(item=item, store=store)
    assert balance.quantity_in_stock == original
    assert balance.quantity_quarantined == Decimal("0.0000")
