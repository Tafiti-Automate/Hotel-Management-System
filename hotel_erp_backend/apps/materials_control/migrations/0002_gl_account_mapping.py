"""Property-specific account mapping required for balanced monetary exports."""
import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("materials_control", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="GLAccountMapping",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("source_type", models.CharField(max_length=40, choices=[
                    ("supplier_invoice", "Supplier invoices"),
                    ("expense", "Expenses"),
                ])),
                ("debit_account", models.CharField(max_length=50)),
                ("credit_account", models.CharField(max_length=50)),
                ("tax_account", models.CharField(max_length=50, blank=True, help_text="Input VAT account for taxable supplier invoices.")),
                ("is_active", models.BooleanField(default=True)),
                ("branch", models.ForeignKey(to="departments.branch",
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="gl_account_mappings")),
                ("created_by", models.ForeignKey(to=settings.AUTH_USER_MODEL,
                    null=True, blank=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="created_%(class)ss")),
            ],
            options={"ordering": ("branch__name", "source_type"), "abstract": False},
        ),
        migrations.AddConstraint(
            model_name="glaccountmapping",
            constraint=models.UniqueConstraint(
                fields=("branch", "source_type"), name="unique_branch_gl_source_mapping",
            ),
        ),
    ]
