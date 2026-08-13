import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("approvals", "0003_approvalmatrixrule_approver_role_and_more"),
        ("employees", "0002_employee_address_employee_branch_employee_contact_and_more"),
        ("procurement", "0015_purchaseorder_approval_control"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="PurchaseOrderApprovalWorkflow",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("stage", models.PositiveIntegerField()),
                ("stage_name", models.CharField(blank=True, max_length=100)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("returned", "Returned for correction"),
                            ("skipped", "Skipped"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("comments", models.TextField(blank=True)),
                ("decided_at", models.DateTimeField(blank=True, null=True)),
                (
                    "approver",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="purchase_order_approval_steps",
                        to="employees.employee",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_%(class)ss",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="purchase_order_approval_decisions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "matrix_rule",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="generated_purchase_order_steps",
                        to="approvals.approvalmatrixrule",
                    ),
                ),
                (
                    "purchase_order",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="approval_workflow",
                        to="procurement.purchaseorder",
                    ),
                ),
            ],
            options={
                "ordering": ("purchase_order", "stage"),
            },
        ),
        migrations.AddConstraint(
            model_name="purchaseorderapprovalworkflow",
            constraint=models.UniqueConstraint(
                fields=("purchase_order", "stage"),
                name="unique_purchase_order_approval_stage",
            ),
        ),
    ]
