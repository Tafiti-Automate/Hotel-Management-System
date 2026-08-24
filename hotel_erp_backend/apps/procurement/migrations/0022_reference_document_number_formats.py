import re

from django.db import migrations


def _scope_code(branch, hotel):
    source = getattr(branch, "branch_code", "") or ""
    if not source and hotel:
        source = "".join(
            word[0]
            for word in str(hotel.name).split()
            if word and word.lower() not in {"of", "the", "and"}
        )
    return re.sub(r"[^A-Za-z0-9]", "", source).upper()[:4] or "LPO"


def _suffix(reference, fallback):
    match = re.search(r"(\d+)$", str(reference or ""))
    value = int(match.group(1)) if match else fallback
    return max(1, value)


def format_existing_references(apps, schema_editor):
    PurchaseRequisition = apps.get_model("procurement", "PurchaseRequisition")
    PurchaseOrder = apps.get_model("procurement", "PurchaseOrder")

    requisitions = PurchaseRequisition.objects.select_related("branch", "hotel").order_by(
        "created_at", "pk"
    )
    for fallback, requisition in enumerate(requisitions.iterator(), start=1):
        reference_date = requisition.created_at
        number = _suffix(requisition.requisition_number, fallback)
        PurchaseRequisition.objects.filter(pk=requisition.pk).update(
            requisition_number=f"i{reference_date:%y}-{number:05d}"
        )

    orders = PurchaseOrder.objects.select_related(
        "requisition__branch", "requisition__hotel"
    ).order_by("created_at", "pk")
    for fallback, order in enumerate(orders.iterator(), start=1):
        reference_date = order.created_at
        number = _suffix(order.lpo_number, fallback)
        scope = _scope_code(order.requisition.branch, order.requisition.hotel)
        PurchaseOrder.objects.filter(pk=order.pk).update(
            lpo_number=f"{scope}{reference_date:%Y%m}-{number:05d}"
        )


class Migration(migrations.Migration):

    dependencies = [
        ("procurement", "0021_global_numeric_document_numbers"),
    ]

    operations = [
        migrations.RunPython(format_existing_references, migrations.RunPython.noop),
    ]
