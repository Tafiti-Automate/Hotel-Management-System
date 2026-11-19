from decimal import Decimal, InvalidOperation
from django.conf import settings
from django.db import migrations, models


def freeze_previous_approved_lpo_vat(apps, schema_editor):
    """The legacy LPO PDF charged configured VAT on every line; preserve that history."""
    try:
        rate = Decimal(str(getattr(settings, "VAT_RATE", "0.18")))
    except (InvalidOperation, ValueError, TypeError):
        rate = Decimal("0.18")
    if not rate.is_finite():
        rate = Decimal("0.18")
    if rate > 1:
        rate /= Decimal("100")
    if not Decimal("0") <= rate <= Decimal("1"):
        rate = Decimal("0.18")
    Line = apps.get_model("procurement", "PurchaseOrderItem")
    Line.objects.exclude(purchase_order__status="draft").filter(
        vat_rate_snapshot__isnull=True,
    ).update(vat_rate_snapshot=rate.quantize(Decimal("0.0001")))


class Migration(migrations.Migration):
    dependencies = [
        ("procurement", "0037_goods_receipt_blind_count_lock"),
        ("inventory", "0036_item_vat_applicability"),
    ]

    operations = [
        migrations.AddField(
            model_name="purchaseorderitem",
            name="vat_rate_snapshot",
            field=models.DecimalField(
                max_digits=6, decimal_places=4, null=True, blank=True,
                help_text="VAT fraction captured from the Article while LPO is draft. Historic approved orders are retained.",
            ),
        ),
        migrations.RunPython(freeze_previous_approved_lpo_vat, migrations.RunPython.noop),
    ]
