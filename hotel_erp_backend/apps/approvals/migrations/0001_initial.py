# Generated for the initial Hotel Management System scaffold.
import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("employees", "0001_initial"),
        ("procurement", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="ApprovalWorkflow",
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
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("skipped", "Skipped"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("comments", models.TextField(blank=True)),
                (
                    "approver",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="approval_steps",
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
                    "requisition",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="approval_workflow",
                        to="procurement.purchaserequisition",
                    ),
                ),
            ],
            options={
                "ordering": ("requisition", "stage"),
            },
        ),
        migrations.AddConstraint(
            model_name="approvalworkflow",
            constraint=models.UniqueConstraint(
                fields=("requisition", "stage"),
                name="unique_requisition_approval_stage",
            ),
        ),
    ]
