"""Acceptance-gate tests for the read-only four-decimal migration reconciliation."""
import json
from decimal import Decimal
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.management.commands.audit_inventory_precision import (
    canonical, collect_snapshot,
)
from apps.inventory.models import InventoryBalance
from tests.test_inventory import create_inventory_operations_context


def test_normalized_baseline_has_identical_checksum_before_and_after_scale_widening():
    assert canonical(Decimal("20.00"), Decimal("0.0001")) == "20.0000"
    assert canonical(Decimal("20.0000"), Decimal("0.0001")) == "20.0000"
    assert canonical(Decimal("0.1255"), Decimal("0.0001")) == "0.1255"


@pytest.mark.django_db
def test_stock_precision_audit_is_read_only_and_detects_post_migration_changes(tmp_path):
    _, _, store, item = create_inventory_operations_context()
    balance = InventoryBalance.objects.get(store=store, item=item)
    balance.quantity_in_stock = Decimal("40.1255")
    balance.quantity_reserved = Decimal("0.0005")
    balance.save(update_fields=["quantity_in_stock", "quantity_reserved"])

    before_count = InventoryBalance.objects.count()
    baseline_path = tmp_path / "stock-precision-before.json"
    out = StringIO()
    call_command("audit_inventory_precision", "--json", "--strict",
                 "--write-baseline", str(baseline_path), stdout=out)
    report = json.loads(out.getvalue())
    assert report["read_only"] is True
    assert report["precision"] == "0.0001"
    assert report["blockers"] == []
    assert report["tables"]["inventory.InventoryBalance"]["rows"] == 1
    assert InventoryBalance.objects.count() == before_count
    assert baseline_path.exists()

    output = StringIO()
    call_command("audit_inventory_precision", "--json", "--strict",
                 "--baseline", str(baseline_path), stdout=output)
    compared = json.loads(output.getvalue())
    assert compared["baseline_comparison"]["matching"] is True

    balance.quantity_in_stock += Decimal("0.0001")
    balance.save(update_fields=["quantity_in_stock"])
    with pytest.raises(CommandError, match="did not pass"):
        call_command("audit_inventory_precision", "--json", "--strict",
                     "--baseline", str(baseline_path), stdout=StringIO())

    with pytest.raises(CommandError, match="exists"):
        call_command("audit_inventory_precision", "--json",
                     "--write-baseline", str(baseline_path), stdout=StringIO())


@pytest.mark.django_db
def test_stock_precision_audit_flags_reserved_stock_exceeding_onhand():
    _, _, store, item = create_inventory_operations_context()
    balance = InventoryBalance.objects.get(store=store, item=item)
    balance.quantity_reserved = Decimal("50.0000")
    balance.save(update_fields=["quantity_reserved"])
    report = collect_snapshot()
    assert any("reserved" in blocker for blocker in report["blockers"])
    with pytest.raises(CommandError, match="did not pass"):
        call_command("audit_inventory_precision", "--strict", stdout=StringIO())
