from django.db import migrations, models


GLOBAL_SEQUENCE = "procurement"


def assign_global_numeric_references(apps, schema_editor):
    """Make every controlled procurement reference numeric and globally unique."""

    Sequence = apps.get_model("procurement", "ProcurementDocumentSequence")
    PurchaseRequisition = apps.get_model("procurement", "PurchaseRequisition")
    PurchaseOrder = apps.get_model("procurement", "PurchaseOrder")
    GoodsReceiptNote = apps.get_model("procurement", "GoodsReceiptNote")
    StoreRequisition = apps.get_model("inventory", "StoreRequisition")

    specifications = (
        (PurchaseRequisition, "requisition_number", 0),
        (StoreRequisition, "requisition_no", 1),
        (PurchaseOrder, "po_number", 2),
        (PurchaseOrder, "lpo_number", 3),
        (GoodsReceiptNote, "grn_number", 4),
    )
    records = []
    highest_existing = 0

    for model, field, rank in specifications:
        for row in model.objects.only("pk", field, "created_at").iterator():
            original = str(getattr(row, field, "") or "").strip()
            if original.isdigit():
                highest_existing = max(highest_existing, int(original))
            records.append(
                (str(row.created_at or ""), rank, str(row.pk), model, field, original)
            )

    records.sort(key=lambda entry: (entry[0], entry[1], entry[2]))

    # Move every value out of the way first. This prevents a model-level unique
    # constraint from colliding while duplicate cross-document numbers are fixed.
    for index, (_, _, pk, model, field, _) in enumerate(records, start=1):
        model.objects.filter(pk=pk).update(**{field: f"TMP-{index:012d}"})

    used = set()
    next_value = highest_existing
    for _, _, pk, model, field, original in records:
        original_value = int(original) if original.isdigit() else 0
        if original_value > 0 and original_value not in used:
            assigned = original_value
        else:
            next_value += 1
            while next_value in used:
                next_value += 1
            assigned = next_value
        used.add(assigned)
        model.objects.filter(pk=pk).update(**{field: f"{assigned:06d}"})

    Sequence.objects.update_or_create(
        document_type=GLOBAL_SEQUENCE,
        defaults={"current_value": max(used, default=0)},
    )


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0019_storerequisition_store_optional"),
        ("procurement", "0020_alter_purchaserequisition_procurement_source"),
    ]

    operations = [
        migrations.AddField(
            model_name="purchaseorder",
            name="lpo_number",
            field=models.CharField(blank=True, max_length=50, null=True, unique=True),
        ),
        migrations.RunPython(assign_global_numeric_references, migrations.RunPython.noop),
    ]
