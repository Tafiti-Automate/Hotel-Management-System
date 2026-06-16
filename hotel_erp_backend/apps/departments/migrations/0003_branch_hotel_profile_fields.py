# Manually added hotel/property fields for branches

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("organization", "0001_initial"),
        ("departments", "0002_department_is_active_branch"),
    ]

    operations = [
        migrations.AlterField(
            model_name="branch",
            name="name",
            field=models.CharField(max_length=100),
        ),
        migrations.AddField(
            model_name="branch",
            name="hotel",
            field=models.ForeignKey(blank=True, help_text="Parent hotel/company this property belongs to.", null=True, on_delete=django.db.models.deletion.PROTECT, related_name="branches", to="organization.hotel"),
        ),
        migrations.AddField(
            model_name="branch",
            name="branch_code",
            field=models.CharField(blank=True, max_length=30),
        ),
        migrations.AddField(
            model_name="branch",
            name="branch_type",
            field=models.CharField(choices=[("main", "Main Property"), ("branch", "Branch Property")], default="main", max_length=20),
        ),
        migrations.AddField(
            model_name="branch",
            name="physical_address",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="branch",
            name="city",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="branch",
            name="country",
            field=models.CharField(default="Uganda", max_length=100),
        ),
        migrations.AddField(
            model_name="branch",
            name="email",
            field=models.EmailField(blank=True, max_length=254),
        ),
        migrations.AddField(
            model_name="branch",
            name="is_head_office",
            field=models.BooleanField(default=False),
        ),
        migrations.AddConstraint(
            model_name="branch",
            constraint=models.UniqueConstraint(fields=("hotel", "name"), name="unique_branch_name_per_hotel"),
        ),
        migrations.AddConstraint(
            model_name="branch",
            constraint=models.UniqueConstraint(condition=models.Q(("branch_code", ""), _negated=True), fields=("hotel", "branch_code"), name="unique_branch_code_per_hotel"),
        ),
    ]
