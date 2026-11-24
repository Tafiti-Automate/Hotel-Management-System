from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("materials_control", "0008_recipe_production_department"), ("departments", "0003_branch_hotel_profile_fields")]
    operations = [
        migrations.AddField(model_name="glaccountmapping", name="department",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name="gl_account_mappings", to="departments.department")),
        migrations.AlterField(model_name="glaccountmapping", name="source_type", field=models.CharField(max_length=40, choices=[
            ("supplier_invoice", "Supplier invoices"), ("expense", "Expenses"),
            ("supplier_payment", "Supplier payments (AP debit / bank clearing credit)"),
            ("stock_consumption", "Department stock consumption"), ("pos_cogs", "POS cost of goods sold"),
            ("stock_waste", "Waste and spoilage expense"), ("stock_variance", "Physical counts and stock adjustments"),
            ("department_expense", "Department-specific operating expense"), ("department_cogs", "Department-specific cost of sales"),
        ])),
        migrations.RemoveConstraint(model_name="glaccountmapping", name="unique_branch_gl_source_mapping"),
        migrations.AddConstraint(model_name="glaccountmapping", constraint=models.UniqueConstraint(fields=("branch","source_type"),
            condition=models.Q(department__isnull=True), name="unique_branch_gl_source_mapping")),
        migrations.AddConstraint(model_name="glaccountmapping", constraint=models.UniqueConstraint(fields=("branch","department","source_type"),
            condition=models.Q(department__isnull=False), name="unique_department_gl_source_mapping")),
        migrations.AddConstraint(model_name="glaccountmapping", constraint=models.CheckConstraint(
            condition=(models.Q(department__isnull=False, source_type__in=("department_expense","department_cogs")) |
                       (models.Q(department__isnull=True) & ~models.Q(source_type__in=("department_expense","department_cogs")))),
            name="gl_mapping_department_source_consistency")),
    ]
