from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("employees", "0002_employee_address_employee_branch_employee_contact_and_more")]

    operations = [
        migrations.AlterField(
            model_name="employee",
            name="gender",
            field=models.CharField(blank=True, choices=[("Male", "Male"), ("Female", "Female")], max_length=10),
        ),
    ]
