from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="notification",
            name="deduplication_key",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddConstraint(
            model_name="notification",
            constraint=models.UniqueConstraint(
                condition=~models.Q(deduplication_key=""),
                fields=("employee", "deduplication_key"),
                name="unique_employee_notification_key",
            ),
        ),
    ]
