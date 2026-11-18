"""Phase A: stock corrections are role-separated and stock transfers cannot skip approval."""

from decimal import Decimal
from datetime import date

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.test import APIClient

from apps.accounts.role_templates import sync_client_roles
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import (
    Category, Item, InventoryBalance, StockAdjustment, StockLedger,
    StockTransfer, StockTransferItem, StoreKeeperAssignment, StoreLocation,
)
from apps.inventory.serializers import StockTransferSerializer
from apps.materials_control.models import FiscalPeriod
from core.constants.choices import StockAdjustmentStatus, StockTransferStatus


def staff(role, suffix, branch, department):
    user = get_user_model().objects.create_user(
        username=f"control-{suffix}",
        employee_code=f"CTRL-{suffix}",
        password="ci-only-password",
    )
    user.groups.add(Group.objects.get(name=role))
    employee = Employee.objects.create(
        user=user, branch=branch, department=department, designation=role,
    )
    api = APIClient()
    api.force_authenticate(user=user)
    return user, employee, api


@pytest.mark.django_db
def test_transfer_requires_approval_and_cannot_be_applied_from_legacy_endpoint():
    sync_client_roles()
    branch = Branch.objects.create(name="Transfer-control branch")
    department = Department.objects.create(name="Transfer-control department")
    from_store = StoreLocation.objects.create(branch=branch, name="Transfer-controlled Main")
    to_store = StoreLocation.objects.create(branch=branch, name="Transfer-controlled Kitchen")
    item = Item.objects.create(
        category=Category.objects.create(name="Transfer-controlled category"),
        name="Transfer-controlled flour", sku="TRANSFER-CONTROL-FLOUR", unit="kg",
        reorder_level=Decimal("0.00"),
    )
    InventoryBalance.objects.create(item=item, store=from_store, quantity_in_stock=Decimal("10.00"))
    keeper, employee, api = staff("Store Keeper", "transfer", branch, department)
    StoreKeeperAssignment.objects.create(store=from_store, employee=employee)

    transfer = StockTransfer.objects.create(
        from_store=from_store, to_store=to_store, created_by=keeper,
    )
    StockTransferItem.objects.create(
        stock_transfer=transfer, item=item, quantity=Decimal("2.00"),
    )
    assert api.post(f"/api/v1/stock-transfers/{transfer.pk}/apply/").status_code == 404
    assert api.post(f"/api/v1/stock-transfers/{transfer.pk}/assign-store/").status_code == 404
    with pytest.raises(DjangoValidationError):
        transfer.apply_inventory_changes()
    with pytest.raises(DjangoValidationError):
        transfer.dispatch(require_approval=False)
    assert StockLedger.objects.filter(reference_id=transfer.pk).count() == 0

    approved = api.post(f"/api/v1/stock-transfers/{transfer.pk}/approve/")
    assert approved.status_code == 200, approved.data
    assert api.patch(
        f"/api/v1/stock-transfers/{transfer.pk}/", {"note": "silent edit"}, format="json",
    ).status_code == 400
    assert api.post(f"/api/v1/stock-transfers/{transfer.pk}/dispatch/").status_code == 200
    assert api.post(f"/api/v1/stock-transfers/{transfer.pk}/receive/").status_code == 403
    transfer.refresh_from_db()
    assert transfer.status == StockTransferStatus.IN_TRANSIT
    # Receiver must belong to the destination store, not merely the source.
    keeper_dest, dest_emp, receiver = staff("Store Keeper", "transfer-receiver", branch, department)
    StoreKeeperAssignment.objects.create(store=to_store, employee=dest_emp)
    response = receiver.post(f"/api/v1/stock-transfers/{transfer.pk}/receive/")
    assert response.status_code == 200, response.data
    assert StockLedger.objects.filter(reference_id=transfer.pk).count() == 2
    assert InventoryBalance.objects.get(item=item, store=to_store).quantity_in_stock == Decimal("2.00")
    assert receiver.post(f"/api/v1/stock-transfers/{transfer.pk}/receive/").status_code == 400

    other_branch = Branch.objects.create(name="Transfer destination foreign branch")
    foreign = StoreLocation.objects.create(branch=other_branch, name="Foreign hotel store")
    candidate = StockTransferSerializer(data={"from_store": str(from_store.pk), "to_store": str(foreign.pk)})
    assert not candidate.is_valid()
    assert "different hotels" in str(candidate.errors)


@pytest.mark.django_db
def test_adjustment_requires_store_maker_and_finance_approver_and_posts_once():
    sync_client_roles()
    branch = Branch.objects.create(name="Adjustment-control branch")
    department = Department.objects.create(name="Adjustment-control department")
    store = StoreLocation.objects.create(branch=branch, name="Adjustment-control store")
    item = Item.objects.create(
        category=Category.objects.create(name="Adjustment-control category"),
        name="Adjustment-control flour", sku="ADJUSTMENT-CONTROL-FLOUR", unit="kg",
        reorder_level=Decimal("0.00"),
    )
    InventoryBalance.objects.create(
        item=item, store=store, quantity_in_stock=Decimal("10.00"),
        weighted_average_cost=Decimal("500.0000"),
    )
    today = date.today()
    FiscalPeriod.objects.create(
        branch=branch, name="Adjustment posting period",
        start_date=date(today.year, today.month, 1),
        end_date=date(today.year, 12, 31),
    )
    keeper_user, keeper_emp, keeper = staff("Store Keeper", "adjust-maker", branch, department)
    StoreKeeperAssignment.objects.create(store=store, employee=keeper_emp)
    finance_user, _, finance = staff("Financial Manager", "adjust-finance", branch, department)
    _, _, controller = staff("Cost Controller", "adjust-controller", branch, department)

    draft = keeper.post(
        "/api/v1/stock-adjustments/",
        {"store": str(store.pk), "reason": "Counted damaged goods"},
        format="json",
    )
    assert draft.status_code == 201, draft.data
    aid = draft.data["id"]
    line = keeper.post(
        "/api/v1/stock-adjustment-items/",
        {"stock_adjustment": aid, "item": str(item.pk), "quantity_change": "-2.00"},
        format="json",
    )
    assert line.status_code == 201, line.data

    # Immutable approval fields cannot be forged through normal PATCH.
    altered = keeper.patch(
        f"/api/v1/stock-adjustments/{aid}/",
        {"status": "approved", "approved_by": str(keeper_emp.pk)},
        format="json",
    )
    assert altered.status_code == 200, altered.data
    assert altered.data["status"] == StockAdjustmentStatus.DRAFT
    assert keeper.post(f"/api/v1/stock-adjustments/{aid}/approve/").status_code == 403
    assert keeper.post(f"/api/v1/stock-adjustments/{aid}/apply/").status_code == 400
    assert finance.post(f"/api/v1/stock-adjustments/{aid}/approve/").status_code == 400
    submitted = keeper.post(f"/api/v1/stock-adjustments/{aid}/submit/")
    assert submitted.status_code == 200
    assert keeper.patch(
        f"/api/v1/stock-adjustment-items/{line.data['id']}/",
        {"quantity_change": "-3.00"}, format="json",
    ).status_code == 400
    assert keeper.delete(f"/api/v1/stock-adjustments/{aid}/").status_code == 400
    assert controller.post(f"/api/v1/stock-adjustments/{aid}/approve/").status_code == 403

    approved = finance.post(f"/api/v1/stock-adjustments/{aid}/approve/")
    assert approved.status_code == 200, approved.data
    assert str(approved.data["approved_by"]) == str(finance_user.employee_profile.pk)
    assert finance.post(f"/api/v1/stock-adjustments/{aid}/apply/").status_code == 403

    posted = keeper.post(f"/api/v1/stock-adjustments/{aid}/apply/")
    assert posted.status_code == 200, posted.data
    assert posted.data["status"] == StockAdjustmentStatus.APPLIED
    assert keeper.post(f"/api/v1/stock-adjustments/{aid}/apply/").status_code == 400
    assert StockLedger.objects.filter(reference_id=aid).count() == 1
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("8.00")
