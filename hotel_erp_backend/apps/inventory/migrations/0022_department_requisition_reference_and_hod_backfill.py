import re
from django.db import migrations, models


def _suffix(value):
    match = re.search(r"(\d+)$", str(value or "").strip())
    return int(match.group(1)) if match else 0


def normalize_department_requisitions(apps, schema_editor):
    StoreRequisition = apps.get_model("inventory", "StoreRequisition")
    StoreRequisitionItem = apps.get_model("inventory", "StoreRequisitionItem")

    rows = list(StoreRequisition.objects.only("pk", "requisition_no", "created_at").order_by("created_at", "pk"))
    used = set()
    next_value = max((_suffix(row.requisition_no) for row in rows), default=0)

    # Move references out of the way before assigning their final display form.
    for index, row in enumerate(rows, start=1):
        StoreRequisition.objects.filter(pk=row.pk).update(requisition_no=f"TMP-R-{index:09d}")

    for row in rows:
        candidate = _suffix(row.requisition_no)
        if candidate <= 0 or candidate in used:
            next_value += 1
            while next_value in used:
                next_value += 1
            candidate = next_value
        used.add(candidate)
        StoreRequisition.objects.filter(pk=row.pk).update(requisition_no=f"R-{candidate:05d}")

    # Historical requests were approved before the HOD quantity field existed.
    # Their original requester quantity is therefore the only valid HOD baseline.
    StoreRequisitionItem.objects.filter(
        hod_approved_quantity__isnull=True,
        requisition__department_approved_by__isnull=False,
    ).update(hod_approved_quantity=models.F("base_quantity_requested"))


def reverse_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0021_storerequisitionitem_hod_approved_quantity"),
    ]

    operations = [
        migrations.RunPython(normalize_department_requisitions, reverse_noop),
    ]
