"""GRN certification audit is read-only and fails closed for missing ledger."""
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from apps.accounts.management.commands.audit_grn_posting import summarize_received_lines


def test_empty_posted_grn_is_a_certification_blocker():
    grn = SimpleNamespace(items=SimpleNamespace(
        select_related=lambda *_: [],
    ), pk="grn-audit-empty")
    with patch("apps.accounts.management.commands.audit_grn_posting.StockLedger.objects.filter", return_value=[]):
        failures, line_count = summarize_received_lines(grn)
    assert "posted_grn_has_no_lines" in failures
    assert line_count == 0


def test_posted_receipt_without_ledger_reports_quantity_and_cost_mismatch():
    line = SimpleNamespace(
        pk="line-1", item_id="item-a", store_id="store-a",
        direct_issue_department_id=None, inventory_changes_applied=True,
        inventory_post_quantity=lambda require_accepted: Decimal("2.0000"),
        base_unit_cost=Decimal("2000.0000"),
    )
    grn = SimpleNamespace(
        pk="grn-a",
        items=SimpleNamespace(select_related=lambda *_: [line]),
    )
    with patch("apps.accounts.management.commands.audit_grn_posting.StockLedger.objects.filter", return_value=[]):
        failures, counted = summarize_received_lines(grn)
    assert counted == 1
    assert any(x.startswith("grn_quantity_ledger_mismatch:") for x in failures)
    assert any(x.startswith("grn_value_ledger_mismatch:") for x in failures)


def test_rejected_zero_accepted_receipt_does_not_require_an_inbound_ledger():
    line = SimpleNamespace(
        pk="rejected-1", item_id="item-r", store_id="store-r",
        inventory_changes_applied=True,
        inventory_post_quantity=lambda require_accepted: Decimal("0"),
    )
    grn = SimpleNamespace(
        pk="rejected-grn",
        items=SimpleNamespace(select_related=lambda *_: [line]),
    )
    with patch("apps.accounts.management.commands.audit_grn_posting.StockLedger.objects.filter", return_value=[]):
        with patch("apps.accounts.management.commands.audit_grn_posting.DepartmentConsumption.objects.filter") as q:
            q.return_value.exists.return_value = False
            failures, counted = summarize_received_lines(grn)
    assert counted == 1
    assert failures == []
