import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0002_employee_address_employee_branch_employee_contact_and_more"),
        ("procurement", "0014_purchaseorderitem_destination_department_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="purchaseorder",
            name="approved_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="purchaseorder",
            name="approved_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="approved_purchase_orders",
                to="employees.employee",
            ),
        ),
        migrations.AddField(
            model_name="purchaseorder",
            name="rejected_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="purchaseorder",
            name="revision",
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="purchaseorder",
            name="submitted_for_approval_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="purchaseorder",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("pending_approval", "Pending Approval"),
                    ("approved", "Approved"),
                    ("rejected", "Rejected"),
                    ("issued", "Issued"),
                    ("partially_received", "Partially Received"),
                    ("received", "Received"),
                    ("cancelled", "Cancelled"),
                ],
                default="draft",
                max_length=30,
            ),
        ),
    ]
