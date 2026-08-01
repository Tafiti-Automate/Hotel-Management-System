from django.db import migrations, models


def classify_existing_accounts(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    Employee = apps.get_model("employees", "Employee")
    employee_user_ids = set(Employee.objects.values_list("user_id", flat=True))
    User.objects.exclude(id__in=employee_user_ids).update(account_type="system")
    User.objects.filter(id__in=employee_user_ids).update(account_type="employee")


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
        ("employees", "0002_employee_address_employee_branch_employee_contact_and_more"),
    ]
    operations = [
        migrations.AddField(
            model_name="user",
            name="account_type",
            field=models.CharField(
                choices=[("employee", "Employee account"), ("system", "System account")],
                default="employee",
                max_length=20,
            ),
        ),
        migrations.RunPython(classify_existing_accounts, migrations.RunPython.noop),
    ]
