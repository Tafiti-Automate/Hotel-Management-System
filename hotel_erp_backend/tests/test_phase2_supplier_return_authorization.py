"""Supplier return access is exclusive to active Cost Controllers in the same hotel."""
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.procurement.views import SupplierReturnItemViewSet, SupplierReturnViewSet


def _user(*, active=True, branch_id=1, hotel_id=5):
    branch = SimpleNamespace(pk=branch_id, hotel_id=hotel_id)
    employee = SimpleNamespace(pk=17, id=17, is_active=active, branch_id=branch_id, branch=branch)
    return SimpleNamespace(is_authenticated=True, employee_profile=employee)


def _supplier_return(*, hotel_id=5, status="draft", applied=False):
    store = SimpleNamespace(pk=10, id=10, branch_id=1, branch=SimpleNamespace(pk=1, hotel_id=hotel_id))
    return SimpleNamespace(store=store, status=status, inventory_changes_applied=applied)


@pytest.mark.parametrize("role", ["Store Keeper", "Receiving Clerk", "Procurement Manager"])
def test_other_roles_cannot_operate_supplier_returns(role):
    view = SupplierReturnViewSet()
    view.request = SimpleNamespace(user=_user())
    with patch("apps.procurement.views.user_has_role", side_effect=lambda _user, *roles: role in roles):
        with pytest.raises(PermissionDenied, match="Cost Controller"):
            view._require_storekeeper_owner(_supplier_return())


def test_active_cost_controller_can_return_from_any_store_in_same_hotel():
    view = SupplierReturnViewSet()
    view.request = SimpleNamespace(user=_user())
    with patch("apps.procurement.views.user_has_role", return_value=True):
        assert view._require_storekeeper_owner(_supplier_return()).pk == 17


def test_cost_controller_cannot_return_goods_from_another_hotel():
    view = SupplierReturnViewSet()
    view.request = SimpleNamespace(user=_user())
    with patch("apps.procurement.views.user_has_role", return_value=True):
        with pytest.raises(PermissionDenied, match="different hotel"):
            view._require_storekeeper_owner(_supplier_return(hotel_id=9))


def test_inactive_cost_controller_cannot_return_goods():
    view = SupplierReturnViewSet()
    view.request = SimpleNamespace(user=_user(active=False))
    with patch("apps.procurement.views.user_has_role", return_value=True):
        with pytest.raises(PermissionDenied, match="Cost Controller"):
            view._require_storekeeper_owner(_supplier_return())


@pytest.mark.parametrize("status", ["posted", "acknowledged", "cancelled"])
def test_supplier_return_lines_are_locked_after_draft(status):
    view = SupplierReturnItemViewSet()
    view.request = SimpleNamespace(user=_user())
    with patch("apps.procurement.views.user_has_role", return_value=True):
        with pytest.raises(ValidationError, match="locked"):
            view._require_draft_return(_supplier_return(status=status))


def test_supplier_return_lines_cannot_be_changed_for_another_hotel():
    view = SupplierReturnItemViewSet()
    view.request = SimpleNamespace(user=_user())
    with patch("apps.procurement.views.user_has_role", return_value=True):
        with pytest.raises(PermissionDenied, match="different hotel"):
            view._require_draft_return(_supplier_return(hotel_id=9))

def _posted_receipt(*, origin_hotel=5, origin_branch=2, has_posted_stock=True):
    def posted_accepted_lines(**filters):
        # A line marked as processed is not proof of accepted SOH: fully
        # rejected lines have zero stock movement and must not be returnable.
        accepted_gate = filters.get("inspection_items__quantity_accepted__gt") == 0
        return SimpleNamespace(exists=lambda: has_posted_stock and accepted_gate)
    lines = SimpleNamespace(filter=posted_accepted_lines)
    source_branch = SimpleNamespace(pk=origin_branch, hotel_id=origin_hotel)
    return SimpleNamespace(
        status="posted",
        purchase_order=SimpleNamespace(
            store_id=None,
            requisition=SimpleNamespace(branch=source_branch),
        ),
        items=lines,
    )


def test_supplier_return_creation_allows_other_branch_of_same_hotel():
    view = SupplierReturnViewSet()
    view.request = SimpleNamespace(user=_user(branch_id=1, hotel_id=5))
    receipt = _posted_receipt(origin_hotel=5, origin_branch=2)
    serializer = SimpleNamespace(
        validated_data={"goods_receipt": receipt, "store": _supplier_return().store},
        save=lambda **kwargs: kwargs,
    )
    with patch("apps.procurement.views.user_has_role", return_value=True):
        assert view.perform_create(serializer) is None


def test_supplier_return_creation_rejects_another_hotel():
    view = SupplierReturnViewSet()
    view.request = SimpleNamespace(user=_user(hotel_id=5))
    serializer = SimpleNamespace(
        validated_data={
            "goods_receipt": _posted_receipt(origin_hotel=9),
            "store": _supplier_return().store,
        },
    )
    with patch("apps.procurement.views.user_has_role", return_value=True):
        with pytest.raises(PermissionDenied, match="different hotel"):
            view.perform_create(serializer)


def test_supplier_return_rejects_source_store_without_posted_grn_lines():
    view = SupplierReturnViewSet()
    view.request = SimpleNamespace(user=_user())
    serializer = SimpleNamespace(
        validated_data={
            "goods_receipt": _posted_receipt(has_posted_stock=False),
            "store": _supplier_return().store,
        },
    )
    with patch("apps.procurement.views.user_has_role", return_value=True):
        with pytest.raises(ValidationError, match="accepted, posted GRN"):
            view.perform_create(serializer)


def test_without_hotel_parent_supplier_return_requires_same_branch():
    view = SupplierReturnViewSet()
    view.request = SimpleNamespace(user=_user(branch_id=1, hotel_id=None))
    allowed = _supplier_return(hotel_id=None)
    denied = _supplier_return(hotel_id=None)
    denied.store.branch_id = 2
    with patch("apps.procurement.views.user_has_role", return_value=True):
        assert view._require_storekeeper_owner(allowed).pk == 17
        with pytest.raises(PermissionDenied, match="different hotel/property"):
            view._require_storekeeper_owner(denied)
