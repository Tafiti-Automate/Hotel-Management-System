from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("vendors", "0002_supplier_contact_person_supplier_notes_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="supplier",
            name="email",
            field=models.EmailField(max_length=254),
        ),
    ]
