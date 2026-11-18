from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("finance", "0008_four_decimal_quantities"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="supplierpayment", name="submitted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="supplierpayment", name="approved_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="supplierpayment", name="released_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="supplierpayment", name="approved_by",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name="approved_supplier_payments", to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="supplierpayment", name="released_by",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name="released_supplier_payments", to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name="supplierpayment", name="status",
            field=models.CharField(
                max_length=20, default="draft",
                choices=[
                    ("draft", "Draft"),
                    ("submitted", "Awaiting finance approval"),
                    ("approved", "Authorized for bank release"),
                    ("released", "Bank execution pending - not settled"),
                    ("posted", "Settled (legacy or verified)"),
                    ("cancelled", "Cancelled"),
                ],
            ),
        ),
    ]
