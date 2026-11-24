from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0037_supplier_return_quarantine"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="MonthEndCycle",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("cutoff", models.DateField()),
                ("memo_reference", models.CharField(max_length=100)),
                ("memo", models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("branch", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="departments.branch")),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-cutoff",)},
        ),
        migrations.CreateModel(
            name="MonthEndInventory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("location_name", models.CharField(max_length=100)),
                ("cycle", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="inventories", to="inventory.monthendcycle")),
                ("store", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, to="inventory.storelocation")),
                ("department", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, to="departments.department")),
            ],
            options={"ordering": ("location_name", "pk")},
        ),
        migrations.AddConstraint(
            model_name="monthendcycle",
            constraint=models.UniqueConstraint(fields=("branch", "cutoff"), name="unique_month_end_branch_cutoff"),
        ),
        migrations.AddConstraint(
            model_name="monthendinventory",
            constraint=models.CheckConstraint(
                condition=(models.Q(store__isnull=False, department__isnull=True)
                           | models.Q(store__isnull=True, department__isnull=False)),
                name="month_end_exactly_one_location",
            ),
        ),
        migrations.AddConstraint(
            model_name="monthendinventory",
            constraint=models.UniqueConstraint(fields=("cycle", "store"), name="unique_month_end_cycle_store"),
        ),
        migrations.AddConstraint(
            model_name="monthendinventory",
            constraint=models.UniqueConstraint(fields=("cycle", "department"), name="unique_month_end_cycle_department"),
        ),
    ]
