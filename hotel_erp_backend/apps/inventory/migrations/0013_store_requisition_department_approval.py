from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("employees", "0002_employee_address_employee_branch_employee_contact_and_more"), ("inventory", "0012_stockadjustment_approved_at_and_more")]

    operations = [
        migrations.AddField(
            model_name="storerequisition",
            name="department_approval_comments",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="storerequisition",
            name="department_approved_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="storerequisition",
            name="department_approved_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="department_approved_store_requisitions", to="employees.employee"),
        ),
        migrations.AlterField(
            model_name="storerequisition",
            name="status",
            field=models.CharField(choices=[("draft", "Draft"), ("pending_department_approval", "Pending Department Approval"), ("submitted", "Submitted"), ("approved", "Approved"), ("partially_approved", "Partially Approved"), ("rejected", "Rejected"), ("partially_issued", "Partially Issued"), ("issued", "Issued"), ("cancelled", "Cancelled")], default="draft", max_length=30),
        ),
    ]
