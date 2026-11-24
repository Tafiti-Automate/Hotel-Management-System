"""Read-only, deterministic before/after audit for the four-decimal stock migration.

This command does not change records or apply migrations. Capture a baseline on
a restored staging copy BEFORE applying the new precision migrations, apply the
migrations to that copy, then compare an AFTER snapshot before accepting release.
Never replace a verified database backup with this lightweight audit file.
"""
import hashlib
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.apps import apps
from django.core.management.base import BaseCommand, CommandError
from django.db.models import F

QTY = Decimal("0.0001")
MONEY = Decimal("0.01")

# A deliberate allowlist. Identifiers and numerical fields only; no customer,
# supplier or staff names, passwords, contact details or invoice descriptions.
QUANTITY_FIELDS = {
    "inventory.Item": ("reorder_level", "maximum_level"),
    "inventory.InventoryBalance": (
        "quantity_in_stock", "quantity_reserved", "quantity_quarantined", "reorder_level",
    ),
    "inventory.SupplierItemPrice": ("minimum_order_quantity",),
    "inventory.SupplierPriceQuoteProposal": ("fixed_order_quantity",),
    "inventory.StockLedger": ("quantity_in", "quantity_out"),
    "inventory.InventoryBatch": ("quantity", "remaining_quantity"),
    "inventory.StockTransferItem": ("quantity", "base_quantity"),
    "inventory.StockAdjustmentItem": ("quantity_change",),
    "inventory.ReorderRule": ("minimum_level", "reorder_quantity"),
    "inventory.StoreRequisitionItem": (
        "quantity_requested", "base_quantity_requested", "hod_approved_quantity",
        "quantity_approved", "quantity_issued",
    ),
    "inventory.StockIssueItem": ("quantity", "base_quantity"),
    "inventory.DepartmentConsumption": ("quantity",),
    "inventory.StoreReturnItem": ("quantity", "base_quantity"),
    "inventory.StockCountItem": ("system_quantity", "physical_quantity"),
    "procurement.RequisitionItem": ("quantity", "approved_quantity", "procurement_quantity"),
    "procurement.PurchaseOrderItem": (
        "quantity", "base_quantity", "procurement_quantity", "procurement_base_quantity",
        "purchasing_approved_quantity", "purchasing_approved_base_quantity",
        "finance_approved_quantity", "finance_approved_base_quantity",
        "management_approved_quantity", "management_approved_base_quantity",
    ),
    "procurement.GoodsReceiptItem": ("quantity_received", "base_quantity"),
    "procurement.VendorQuotationItem": ("quantity",),
    "procurement.GoodsInspectionItem": ("quantity_received", "quantity_accepted", "quantity_rejected"),
    "procurement.SupplierReturnItem": ("quantity", "base_quantity"),
    "sales.SaleItem": ("quantity", "base_quantity"),
    "finance.SupplierInvoice": ("quantity_variance",),
    "finance.SupplierInvoiceItem": ("quantity", "base_quantity"),
    "materials_control.WasteRecord": ("quantity", "base_quantity"),
    "materials_control.Recipe": ("yield_quantity",),
    "materials_control.POSSaleLine": ("quantity",),
}
# Unchanged monetary and booked valuation evidence is compared too.
VALUE_FIELDS = {
    "inventory.InventoryBalance": ("weighted_average_cost",),
    "inventory.StockLedger": ("unit_cost_snapshot", "total_cost_snapshot", "wac_before", "wac_after"),
    "procurement.PurchaseOrder": ("total_amount",),
    "finance.SupplierInvoice": ("subtotal", "tax_amount"),
    "materials_control.POSSaleLine": ("cost_of_goods_sold", "net_sales"),
}
FOUR_PLACE_VALUE_FIELDS = {
    ("inventory.InventoryBalance", "weighted_average_cost"),
    ("inventory.StockLedger", "unit_cost_snapshot"),
    ("inventory.StockLedger", "total_cost_snapshot"),
    ("inventory.StockLedger", "wac_before"),
    ("inventory.StockLedger", "wac_after"),
}


def canonical(value, precision):
    if value is None:
        return None
    number = Decimal(str(value))
    if not number.is_finite():
        raise InvalidOperation("Non-finite stock or monetary value")
    rounded = number.quantize(precision)
    if rounded != number:
        raise InvalidOperation("A stored number cannot be represented at the expected precision")
    return str(rounded)


def collect_snapshot():
    """Stable per-table SHA-256 checksums, counts and storage invariants."""
    models = {}
    blockers = []
    examined = 0
    for model_name in sorted(set(QUANTITY_FIELDS) | set(VALUE_FIELDS)):
        model = apps.get_model(model_name)
        names = tuple(QUANTITY_FIELDS.get(model_name, ())) + tuple(
            f for f in VALUE_FIELDS.get(model_name, ()) if f not in QUANTITY_FIELDS.get(model_name, ())
        )
        digest = hashlib.sha256()
        count = 0
        for record in model.objects.order_by("pk").values_list("pk", *names).iterator(chunk_size=400):
            identifier, *values = record
            cells = [str(identifier)]
            for field_name, value in zip(names, values):
                precision = QTY if field_name in QUANTITY_FIELDS.get(model_name, ()) or (
                    model_name, field_name
                ) in FOUR_PLACE_VALUE_FIELDS else MONEY
                try:
                    cells.append(canonical(value, precision))
                except (InvalidOperation, ValueError):
                    blockers.append(f"{model_name}.{field_name} contains an unrepresentable value")
                    cells.append("INVALID")
            digest.update(json.dumps(cells, separators=(",", ":")).encode("utf-8") + b"\n")
            count += 1
        models[model_name] = {"rows": count, "sha256": digest.hexdigest()}
        examined += count

    from apps.inventory.models import InventoryBalance, InventoryBatch, StockLedger

    for _ in InventoryBalance.objects.filter(
        quantity_reserved__gt=F("quantity_in_stock")
    ).values_list("pk", flat=True).iterator(chunk_size=400):
        blockers.append("A store balance has more reserved stock than its on-hand quantity")
        break
    if InventoryBalance.objects.filter(
        quantity_reserved__gt=F("quantity_in_stock") - F("quantity_quarantined")
    ).exists():
        blockers.append(
            "A store balance has more reserved and quarantined stock than its on-hand quantity"
        )

    if InventoryBatch.objects.filter(
        remaining_quantity__gt=F("quantity")
    ).exists():
        blockers.append("An inventory batch has more remaining stock than its original quantity")

    if StockLedger.objects.filter(
        quantity_in__gt=0, quantity_out__gt=0
    ).exists() or StockLedger.objects.filter(quantity_in=0, quantity_out=0).exists():
        blockers.append("A ledger movement has invalid direction or zero quantity")

    incomplete = StockLedger.objects.exclude(unit_cost_snapshot__isnull=True).filter(
        total_cost_snapshot__isnull=True
    ).exists()
    if incomplete:
        blockers.append("A valued stock ledger movement is missing its total cost snapshot")

    return {
        "schema_version": 1,
        "read_only": True,
        "precision": "0.0001",
        "tables": models,
        "total_rows": examined,
        "blockers": sorted(set(blockers)),
        "unvalued_ledger_rows": StockLedger.objects.filter(unit_cost_snapshot__isnull=True).count(),
        "note": "Deterministic values-only checksum. No historical values have been revalued.",
    }


class Command(BaseCommand):
    help = "Read-only before/after inventory precision and valuation snapshot audit."

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="Print machine-readable audit results.")
        parser.add_argument("--strict", action="store_true", help="Fail on blockers or a baseline mismatch.")
        parser.add_argument("--baseline", help="Existing pre-migration JSON snapshot for comparison.")
        parser.add_argument("--write-baseline", help="Create a new snapshot file; never overwrite an existing file.")

    def handle(self, *args, **options):
        report = collect_snapshot()
        baseline_path = options.get("baseline")
        if baseline_path:
            try:
                baseline = json.loads(Path(baseline_path).read_text(encoding="utf-8"))
            except (OSError, ValueError) as error:
                raise CommandError("Cannot read the requested baseline JSON file.") from error
            if baseline.get("schema_version") != 1 or not isinstance(baseline.get("tables"), dict):
                raise CommandError("Unsupported baseline schema.")
            differences = []
            for name in sorted(set(baseline["tables"]) | set(report["tables"])):
                if baseline["tables"].get(name) != report["tables"].get(name):
                    differences.append(name)
            report["baseline_comparison"] = {
                "matching": not differences,
                "changed_tables": differences,
                "baseline_blockers": baseline.get("blockers", []),
            }
            if differences:
                report["blockers"].append("The pre/post migration quantity or historical valuation checksums differ.")

        new_path = options.get("write_baseline")
        if new_path:
            try:
                with Path(new_path).open("x", encoding="utf-8") as handle:
                    json.dump(report, handle, sort_keys=True, indent=2)
                    handle.write("\n")
            except FileExistsError as error:
                raise CommandError("Baseline file exists. Never overwrite earlier reconciliation evidence.") from error
            except OSError as error:
                raise CommandError("Failed to create the baseline snapshot.") from error

        if options.get("json"):
            self.stdout.write(json.dumps(report, sort_keys=True))
        else:
            self.stdout.write(
                f"Read-only stock precision audit: {report['total_rows']} rows, "
                f"{len(report['tables'])} model tables, {len(report['blockers'])} blockers"
            )
            for blocker in report["blockers"]:
                self.stdout.write("BLOCKED: " + blocker)

        if options.get("strict") and report["blockers"]:
            raise CommandError("Inventory precision reconciliation did not pass.")
