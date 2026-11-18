"""Supplier return posting and line edits belong to assigned Store Keepers."""
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.procurement.views import SupplierReturnItemViewSet, SupplierReturnViewSet


def _user(*, superuser=False, branch_id=1):
    employee = SimpleNamespace(pk=17, id=17, is_active=True, branch_id=branch_id)
    return SimpleNamespace(is_authenticated=True, is_superuser=superuser, employee_profile=employee)


def _supplier_return(*, store_branch=1, status="draft", applied=False):
    store = SimpleNamespace(pk=10, id=10, branch_id=store_branch)
    return SimpleNamespace(
        store=store, status=status, inventory_changes_applied=applied,
    )


def _assigned(_queryset, **kwargs):
    return SimpleNamespace(exists=lambda: kwargs.get("store__is_active") is True)


def test_it_superuser_cannot_post_supplier_return():
    view = SupplierReturnViewSet()
    view.request = SimpleNamespace(user=_user(superuser=True))
    with pytest.raises(PermissionDenied, match="Store Keeper"):
        view._require_storekeeper_owner(_supplier_return())


def test_receiving_clerk_cannot_operate_supplier_return():
    view = SupplierReturnViewSet()
    view.request = SimpleNamespace(user=_user())
    with patch("apps.procurement.views.user_has_role", return_value=False):
        with pytest.raises(PermissionDenied, match="Store Keeper"):
            view._require_storekeeper_owner(_supplier_return())


def test_storekeeper_cannot_operate_another_store_or_property():
    view = SupplierReturnViewSet()
    view.request = SimpleNamespace(user=_user())
    with patch("apps.procurement.views.user_has_role",
               side_effect=lambda _user, *roles: "Store Keeper" in roles), \
         patch("apps.inventory.models.StoreKeeperAssignment.objects.filter") as assigned:
        assigned.return_value.exists.return_value = True
        with pytest.raises(PermissionDenied, match="outside your active assignment"):
            view._require_storekeeper_owner(_supplier_return(store_branch=2))
        assigned.return_value.exists.return_value = False
        with pytest.raises(PermissionDenied, match="outside your active assignment"):
            view._require_storekeeper_owner(_supplier_return())
        assigned.return_value.exists.return_value = True
        assert view._require_storekeeper_owner(_supplier_return()).pk == 17


@pytest.mark.parametrize("status", ["posted", "acknowledged", "cancelled"])
def test_supplier_return_lines_are_locked_after_draft(status):
    view = SupplierReturnItemViewSet()
    view.request = SimpleNamespace(user=_user())
    with patch("apps.procurement.views.user_has_role",
               side_effect=lambda _user, *roles: "Store Keeper" in roles), \
         patch("apps.inventory.models.StoreKeeperAssignment.objects.filter") as assigned:
        assigned.return_value.exists.return_value = True
        with pytest.raises(ValidationError, match="locked"):
            view._require_draft_return(_supplier_return(status=status))


def test_supplier_return_line_cannot_edit_another_property():
    view = SupplierReturnItemViewSet()
    view.request = SimpleNamespace(user=_user())
    with patch("apps.procurement.views.user_has_role",
               side_effect=lambda _user, *roles: "Store Keeper" in roles):
        with pytest.raises(PermissionDenied, match="outside your active assignment"):
            view._require_draft_return(_supplier_return(store_branch=2))
