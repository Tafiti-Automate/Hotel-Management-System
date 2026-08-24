from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("procurement", "0022_reference_document_number_formats"),
    ]

    operations = [
        migrations.AlterField(
            model_name="purchaseorder",
            name="lpo_number",
            field=models.CharField(blank=True, max_length=50, unique=True),
        ),
    ]
