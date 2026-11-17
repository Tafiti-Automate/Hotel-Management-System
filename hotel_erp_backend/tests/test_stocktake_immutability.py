"""Stocktake audit snapshots cannot be rewritten after submission."""
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from rest_framework.exceptions import ValidationError

from apps.inventory.serializers import StockCountItemSerializer
from apps.inventory.views import StockCountItemViewSet, StockCountViewSet


def test_theoretical_stock_quantity_is_server_owned():
    assert StockCountItemSerializer().fields["system_quantity"].read_only


@pytest.mark.parametrize("status", ["submitted", "approved", "applied", "cancelled"])
def test_submitted_stocktake_line_is_locked(status):
    view = StockCountItemViewSet()
    view.request = SimpleNamespace(user=SimpleNamespace(is_superuser=False))
    count = SimpleNamespace(store_id=42, status=status, inventory_changes_applied=False)
    with patch("apps.inventory.views.has_role", side_effect=lambda _user, *names: "Store Keeper" in names), \
         patch("apps.inventory.views.assigned_store_ids", return_value=[42]), \
         pytest.raises(ValidationError, match="locked"):
        view._require_editable_count(count)


@pytest.mark.parametrize("status", ["submitted", "approved", "applied", "cancelled"])
def test_submitted_stocktake_header_is_locked(status):
    view = StockCountViewSet()
    view.request = SimpleNamespace(user=SimpleNamespace(is_superuser=False))
    count = SimpleNamespace(store_id=42, status=status, inventory_changes_applied=False)
    with patch.object(view, "_is_store_keeper", return_value=True), \
         patch("apps.inventory.views.assigned_store_ids", return_value=[42]), \
         pytest.raises(ValidationError, match="locked"):
        view._require_count_entry(count)
