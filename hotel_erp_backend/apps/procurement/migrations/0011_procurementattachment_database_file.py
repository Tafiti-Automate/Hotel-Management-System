from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("procurement", "0010_purchaseorder_email_status_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="procurementattachment",
            name="content_type",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name="procurementattachment",
            name="file_content",
            field=models.BinaryField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name="procurementattachment",
            name="file_size",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
