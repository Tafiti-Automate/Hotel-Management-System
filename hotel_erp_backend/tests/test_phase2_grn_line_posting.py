"""GRN posting is authorized at the document workflow level, never per line."""
from uuid import uuid4

import pytest
from django.urls import Resolver404, resolve


def test_line_level_inventory_posting_endpoint_is_not_exposed():
    with pytest.raises(Resolver404):
        resolve(f"/api/v1/grn-items/{uuid4()}/post-to-inventory/")


def test_document_level_grn_posting_endpoint_remains_registered():
    match = resolve(f"/api/v1/grns/{uuid4()}/post-to-inventory/")
    assert match.url_name == "grn-post-to-inventory"
