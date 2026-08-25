from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("approvals", "0005_consolidate_operational_roles"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.AlterField(
            model_name="purchaseorderapprovalworkflow",
            name="approver",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="purchase_order_approval_steps",
                to="employees.employee",
            ),
        ),
        migrations.AddField(
            model_name="purchaseorderapprovalworkflow",
            name="approver_role",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="purchase_order_approval_steps",
                to="auth.group",
            ),
        ),
    ]
