"""Read-only certification audit of posted supplier GRNs and inventory evidence.

This check never repairs quantities, valuation or audit history. It deliberately
checks receipt-to-ledger *flows* rather than deriving opening stock from today's
balance. A separate opening-stock/closing-stock ledger reconciliation is needed.
"""
import json
from collections import defaultdict
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.management.base import BaseCommand, CommandError

from apps.inventory.models import DepartmentConsumption, StockLedger
from apps.procurement.models import GoodsReceiptNote
from core.constants.choices import GoodsReceiptStatus, LedgerReferenceType


FOUR = Decimal("0.0001")


def summarize_received_lines(receipt):
    """Compare the locked inspection/GRN to the immutable stock ledger."""
    blockers = []
    expected_quantity = defaultdict(lambda: Decimal("0"))
    expected_value = defaultdict(lambda: Decimal("0"))
    lines = list(receipt.items.select_related(
        "item", "store", "purchase_order_item", "direct_issue_department",
    ))
    if not lines:
        blockers.append("posted_grn_has_no_lines")
    for line in lines:
        if not line.inventory_changes_applied:
            blockers.append(f"unposted_receipt_line:{line.pk}")
        try:
            quantity = line.inventory_post_quantity(require_accepted=True)
        except DjangoValidationError:
            blockers.append(f"invalid_or_incomplete_inspection:{line.pk}")
            continue
        if quantity < 0:
            blockers.append(f"negative_accepted_quantity:{line.pk}")
            continue
        if quantity == 0:
            if DepartmentConsumption.objects.filter(goods_receipt_item=line).exists():
                blockers.append(f"rejected_line_has_consumption:{line.pk}")
            continue
        if line.store_id and line.direct_issue_department_id:
            blockers.append(f"ambiguous_receipt_destination:{line.pk}")
            continue
        if line.store_id:
            key = (str(line.item_id), str(line.store_id))
            expected_quantity[key] += quantity
            try:
                expected_value[key] += (
                    quantity * line.base_unit_cost.quantize(FOUR)
                ).quantize(FOUR)
            except (DjangoValidationError, ArithmeticError):
                blockers.append(f"unknown_receipt_valuation:{line.pk}")
        elif line.direct_issue_department_id:
            postings = list(DepartmentConsumption.objects.filter(goods_receipt_item=line))
            if len(postings) != 1 or postings[0].quantity != quantity:
                blockers.append(f"direct_receipt_consumption_mismatch:{line.pk}")
            elif postings[0].department_id != line.direct_issue_department_id:
                blockers.append(f"direct_receipt_department_mismatch:{line.pk}")
        else:
            blockers.append(f"receipt_line_without_destination:{line.pk}")

    actual_quantity = defaultdict(lambda: Decimal("0"))
    actual_value = defaultdict(lambda: Decimal("0"))
    missing_value = set()
    for movement in StockLedger.objects.filter(
        reference_type=LedgerReferenceType.GRN_RECEIPT, reference_id=receipt.pk,
    ):
        key = (str(movement.item_id), str(movement.store_id))
        actual_quantity[key] += movement.quantity_in - movement.quantity_out
        if movement.total_cost_snapshot is None:
            missing_value.add(key)
        else:
            actual_value[key] += movement.total_cost_snapshot
        if movement.quantity_out or movement.store_id is None:
            blockers.append(f"invalid_grn_ledger_direction:{movement.pk}")

    keys = sorted(set(expected_quantity) | set(actual_quantity))
    for key in keys:
        if expected_quantity[key] != actual_quantity[key]:
            blockers.append(f"grn_quantity_ledger_mismatch:{key[0]}:{key[1]}")
        if key in missing_value:
            blockers.append(f"missing_grn_cost_snapshot:{key[0]}:{key[1]}")
        elif expected_value[key] != actual_value[key]:
            blockers.append(f"grn_value_ledger_mismatch:{key[0]}:{key[1]}")
    return sorted(set(blockers)), len(lines)


class Command(BaseCommand):
    help = "Audit posted GRNs against accepted inspection quantities and historical inventory ledgers (read-only)."

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="Print machine-readable results.")
        parser.add_argument("--strict", action="store_true", help="Fail on any posted GRN mismatch.")
        parser.add_argument("--branch", help="Limit to one authorized property/branch UUID.")

    def handle(self, *args, **options):
        records = GoodsReceiptNote.objects.filter(
            status=GoodsReceiptStatus.POSTED,
        ).select_related("purchase_order__requisition")
        if options.get("branch"):
            records = records.filter(
                purchase_order__requisition__branch_id=options["branch"],
            )
        failures = []
        count = 0
        lines_checked = 0
        for receipt in records.iterator(chunk_size=100):
            count += 1
            problems, lines = summarize_received_lines(receipt)
            lines_checked += lines
            if problems:
                failures.append({"grn_id": str(receipt.pk), "blockers": problems})
        report = {
            "read_only": True,
            "posted_grns_checked": count,
            "receipt_lines_checked": lines_checked,
            "unreconciled_grns": len(failures),
            "failures": failures,
        }
        if options["json"]:
            self.stdout.write(json.dumps(report, sort_keys=True))
        else:
            self.stdout.write(
                f"GRN reconciliation: {count} posted GRNs, {lines_checked} lines, "
                f"{len(failures)} with unresolved quantity/value mismatches."
            )
            for failure in failures:
                self.stdout.write(f"GRN {failure['grn_id']}: {', '.join(failure['blockers'])}")
        if options["strict"] and failures:
            raise CommandError("Posted GRN reconciliation is blocked by unresolved discrepancies.")
