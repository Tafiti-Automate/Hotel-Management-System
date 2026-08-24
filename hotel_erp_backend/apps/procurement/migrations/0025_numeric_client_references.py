import re

from django.db import migrations


def _numeric_suffix(value):
    match = re.search(r"(\d+)$", str(value or "").strip())
    return int(match.group(1)) if match else 0


def normalize_client_references(apps, schema_editor):
    """Restore numeric client references while preserving historical suffixes.

    Migration 0021 assigned a global numeric sequence. Older migration 0022 then
    decorated some of those values with prefixes/dates. Recovering the numeric
    suffix therefore keeps the original business identity in existing databases.
    """
    Sequence = apps.get_model("procurement", "ProcurementDocumentSequence")
    PurchaseRequisition = apps.get_model("procurement", "PurchaseRequisition")
    PurchaseOrder = apps.get_model("procurement", "PurchaseOrder")
    GoodsReceiptNote = apps.get_model("procurement", "GoodsReceiptNote")
    StoreRequisition = apps.get_model("inventory", "StoreRequisition")

    rows = []
    for model, field, rank in (
        (PurchaseRequisition, "requisition_number", 0),
        (StoreRequisition, "requisition_no", 1),
        (PurchaseOrder, "lpo_number", 2),
        (GoodsReceiptNote, "grn_number", 3),
    ):
        for row in model.objects.only("pk", field, "created_at").iterator():
            original = str(getattr(row, field, "") or "").strip()
            rows.append(
                (row.created_at, rank, str(row.pk), model, field, _numeric_suffix(original))
            )

    rows.sort(key=lambda value: (value[0] is None, value[0], value[1], value[2]))

    # Move all unique fields out of the way before assigning final references.
    for index, (_, _, pk, model, field, _) in enumerate(rows, start=1):
        model.objects.filter(pk=pk).update(**{field: f"TMP-{index:012d}"})
    for index, order in enumerate(PurchaseOrder.objects.all().iterator(), start=1):
        PurchaseOrder.objects.filter(pk=order.pk).update(po_number=f"TMP-PO-{index:09d}")

    used = set()
    highest_candidate = max((candidate for *_, candidate in rows), default=0)
    sequence = Sequence.objects.filter(document_type="procurement").first()
    next_value = max(highest_candidate, getattr(sequence, "current_value", 0) or 0)

    for _, _, pk, model, field, candidate in rows:
        if candidate > 0 and candidate not in used:
            assigned = candidate
        else:
            next_value += 1
            while next_value in used:
                next_value += 1
            assigned = next_value
        used.add(assigned)
        reference = f"{assigned:06d}"
        model.objects.filter(pk=pk).update(**{field: reference})
        if model is PurchaseOrder:
            # PO is retained only as a compatibility field; users see one LPO number.
            model.objects.filter(pk=pk).update(po_number=reference)

    Sequence.objects.update_or_create(
        document_type="procurement",
        defaults={"current_value": max(used, default=0)},
    )


class Migration(migrations.Migration):
    dependencies = [
        ("procurement", "0024_client_procurement_workflow"),
    ]

    operations = [
        migrations.RunPython(normalize_client_references, migrations.RunPython.noop),
    ]
