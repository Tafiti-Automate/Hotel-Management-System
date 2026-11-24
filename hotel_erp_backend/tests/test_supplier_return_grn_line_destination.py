"""Supplier return requests must follow the posted GRN LINE destination."""
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from rest_framework.exceptions import ValidationError

from apps.procurement.supplier_return_requests import SupplierReturnRequestViewSet


def test_return_report_uses_line_store_not_optional_purchase_order_header():
    # Structural regression: earlier code incorrectly dereferenced optional
    # PurchaseOrder.store_id instead of the actual GRN line destination.
    from pathlib import Path
    source = Path(__file__).resolve().parents[1] / "apps" / "procurement" / "supplier_return_requests.py"
    text = source.read_text()
    assert "line.store_id != store.pk" in text
    assert "store.pk != receipt.purchase_order.store_id" not in text
