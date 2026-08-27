from django.db import migrations, models


def complete_received_requests_and_clear_stale_store_notifications(apps, schema_editor):
    StoreRequisition = apps.get_model("inventory", "StoreRequisition")
    Notification = apps.get_model("notifications", "Notification")

    completed = list(
        StoreRequisition.objects.filter(
            procurement_requisition__status="fulfilled",
            status__in=("submitted", "awaiting_procurement"),
        ).values_list("pk", "requisition_no")
    )
    if not completed:
        return

    request_ids = [pk for pk, _ in completed]
    StoreRequisition.objects.filter(pk__in=request_ids).update(status="completed")

    # Remove only obsolete action notifications produced by the old post-GRN
    # workflow. Other requisition/audit notifications remain untouched.
    for _, reference in completed:
        Notification.objects.filter(
            title__in=(
                f"{reference} needs Store Keeper action",
                f"{reference} is ready for a stock decision",
            )
        ).delete()


def reverse_noop(apps, schema_editor):
    # Completed requisitions represent real received procurement and should not be
    # reopened automatically if this migration is reversed.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0023_remove_single_preferred_supplier_rule"),
        ("notifications", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="storerequisition",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("pending_department_approval", "Pending Department Approval"),
                    ("submitted", "Submitted"),
                    ("awaiting_procurement", "Awaiting Procurement"),
                    ("completed", "Completed"),
                    ("approved", "Approved"),
                    ("partially_approved", "Partially Approved"),
                    ("rejected", "Rejected"),
                    ("partially_issued", "Partially Issued"),
                    ("issued", "Issued"),
                    ("cancelled", "Cancelled"),
                ],
                default="draft",
                max_length=30,
            ),
        ),
        migrations.RunPython(
            complete_received_requests_and_clear_stale_store_notifications,
            reverse_noop,
        ),
    ]
