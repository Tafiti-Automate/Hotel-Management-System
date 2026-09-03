from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("employees", "0008_alter_employee_gender")]

    operations = [
        migrations.AlterField(
            model_name="employee",
            name="photo",
            field=models.ImageField(
                blank=True,
                max_length=500,
                null=True,
                upload_to="employee_photos/",
            ),
        ),
    ]
