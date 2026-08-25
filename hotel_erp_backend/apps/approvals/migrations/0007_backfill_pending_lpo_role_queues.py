from django.db import migrations


def backfill_pending_lpo_role_queues(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Workflow = apps.get_model("approvals", "PurchaseOrderApprovalWorkflow")

    finance = Group.objects.filter(name="Financial Manager").first()
    general = Group.objects.filter(name="General Manager").first()

    # Preserve every completed approval decision. Only unfinished stages on an
    # LPO still awaiting approval are converted from legacy named employees to
    # the client's fixed role queues.
    common = {
        "purchase_order__status": "pending_approval",
        "status": "pending",
    }
    if finance:
        Workflow.objects.filter(stage=1, **common).update(
            approver=None,
            approver_role=finance,
        )
    if general:
        Workflow.objects.filter(stage=2, **common).update(
            approver=None,
            approver_role=general,
        )


def noop_reverse(apps, schema_editor):
    # A role-queue backfill cannot safely recreate the former named employee
    # assignment, so reversal intentionally leaves the corrected assignments.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("approvals", "0006_purchaseorderapprovalworkflow_role_queue"),
    ]

    operations = [
        migrations.RunPython(backfill_pending_lpo_role_queues, noop_reverse),
    ]
