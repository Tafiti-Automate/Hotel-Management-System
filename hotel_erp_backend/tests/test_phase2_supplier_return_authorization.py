"""Return posting and edit gates must enforce physical receiving ownership."""
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.procurement.views import SupplierReturnItemViewSet, SupplierReturnViewSet


def _user(*, superuser=False, branch_id=1):
    employee = SimpleNamespace(pk=17, id=17, is_active=True, branch_id=branch_id)
    return SimpleNamespace(is_authenticated=True, is_superuser=superuser, employee_profile=employee)


def _supplier_return(*, receipt_owner=17, store_branch=1, status="draft", applied=False):
    receipt = SimpleNamespace(received_by_id=receipt_owner)
    store = SimpleNamespace(branch_id=store_branch)
    return SimpleNamespace(
        goods_receipt=receipt, store=store, status=status,
        inventory_changes_applied=applied,
    )


def test_it_superuser_cannot_post_supplier_return():
    view = SupplierReturnViewSet()
    view.request = SimpleNamespace(user=_user(superuser=True))
    with pytest.raises(PermissionDenied, match="Receiving Clerk"):
        view._require_receiving_owner(_supplier_return())


def test_receiving_clerk_cannot_post_another_clerks_return():
    view = SupplierReturnViewSet()
    view.request = SimpleNamespace(user=_user())
    with patch("apps.procurement.views.user_has_role", side_effect=lambda _user, *roles: "Receiving Clerk" in roles):
        with pytest.raises(PermissionDenied, match="different receiving assignment"):
            view._require_receiving_owner(_supplier_return(receipt_owner=25))
        with pytest.raises(PermissionDenied, match="different receiving assignment"):
            view._require_receiving_owner(_supplier_return(store_branch=2))
        assert view._require_receiving_owner(_supplier_return()).pk == 17


@pytest.mark.parametrize("status", ["posted", "acknowledged", "cancelled"])
def test_supplier_return_lines_are_locked_after_draft(status):
    view = SupplierReturnItemViewSet()
    view.request = SimpleNamespace(user=_user())
    with patch("apps.procurement.views.user_has_role", side_effect=lambda _user, *roles: "Receiving Clerk" in roles):
        with pytest.raises(ValidationError, match="locked"):
            view._require_draft_return(_supplier_return(status=status))


def test_supplier_return_line_cannot_edit_another_property():
    view = SupplierReturnItemViewSet()
    view.request = SimpleNamespace(user=_user())
    with patch("apps.procurement.views.user_has_role", side_effect=lambda _user, *roles: "Receiving Clerk" in roles):
        with pytest.raises(PermissionDenied, match="assigned Receiving Clerk"):
            view._require_draft_return(_supplier_return(store_branch=2))
