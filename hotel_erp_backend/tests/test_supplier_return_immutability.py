"""Supplier return records must remain immutable once dispatched."""

from types import SimpleNamespace

import pytest
from rest_framework.exceptions import ValidationError

from apps.procurement.serializers import SupplierReturnItemSerializer, SupplierReturnSerializer
from apps.procurement.views import SupplierReturnItemViewSet, SupplierReturnViewSet


@pytest.mark.parametrize("status,applied", [("posted", True), ("posted", False), ("draft", True)])
def test_dispatched_return_rejects_header_edits_and_deletion(status, applied):
    returned = SimpleNamespace(status=status, inventory_changes_applied=applied)
    with pytest.raises(ValidationError):
        SupplierReturnSerializer(instance=returned).validate({})
    with pytest.raises(ValidationError):
        SupplierReturnViewSet().perform_destroy(returned)


@pytest.mark.parametrize("status,applied", [("posted", True), ("posted", False), ("draft", True)])
def test_dispatched_return_rejects_line_edits_and_deletion(status, applied):
    parent = SimpleNamespace(status=status, inventory_changes_applied=applied)
    line = SimpleNamespace(supplier_return=parent, supplier_return_id="original")
    with pytest.raises(ValidationError):
        SupplierReturnItemSerializer(instance=line).validate({})
    with pytest.raises(ValidationError):
        SupplierReturnItemViewSet().perform_destroy(line)


def test_return_line_cannot_be_reassigned_to_another_return():
    original = SimpleNamespace(pk="original", status="draft", inventory_changes_applied=False)
    other = SimpleNamespace(pk="different", status="draft", inventory_changes_applied=False)
    line = SimpleNamespace(supplier_return=original, supplier_return_id="original")
    with pytest.raises(ValidationError):
        SupplierReturnItemSerializer(instance=line).validate({"supplier_return": other})
