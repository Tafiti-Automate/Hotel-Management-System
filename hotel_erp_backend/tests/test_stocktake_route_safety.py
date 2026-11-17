"""Stocktake line items must not expose document-level action URLs."""
from uuid import uuid4

import pytest
from django.urls import Resolver404, resolve


@pytest.mark.parametrize("action", ["submit", "approve", "reject", "assign-store"])
def test_stock_count_item_does_not_expose_invalid_document_actions(action):
    url = f"/api/v1/stock-count-items/{uuid4()}/{action}/"
    with pytest.raises(Resolver404):
        resolve(url)


def test_stock_count_document_keeps_its_workflow_actions():
    url = f"/api/v1/stock-counts/{uuid4()}/submit/"
    assert resolve(url).url_name == "stock-count-submit"
