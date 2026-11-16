"""Sprint 1 stock valuation and internal transit tracking."""
from decimal import Decimal, ROUND_HALF_UP
from django.db import migrations, models
import django.db.models.deletion
import core.validators.quantities
from core.constants.choices import LedgerReferenceType


def backfill_wac(apps, schema_editor):
    Balance = apps.get_model("inventory", "InventoryBalance")
    Batch = apps.get_model("inventory", "InventoryBatch")
    for balance in Balance.objects.filter(quantity_in_stock__gt=0).iterator():
        weighted = Decimal("0.0000")
        counted = Decimal("0.00")
        for batch in Batch.objects.filter(
            item_id=balance.item_id, store_id=balance.store_id, remaining_quantity__gt=0
        ).iterator():
            counted += batch.remaining_quantity
            weighted += batch.remaining_quantity * batch.unit_cost
        if counted > 0:
            balance.weighted_average_cost = (
                weighted / counted
            ).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            balance.save(update_fields=["weighted_average_cost"])


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0027_inventorybatch_batch_number_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="inventorybalance", name="weighted_average_cost",
            field=models.DecimalField(decimal_places=4, max_digits=15,
                default=Decimal("0.0000"), validators=[
                    core.validators.quantities.validate_non_negative_decimal
                ]),
        ),
        migrations.AddField(
            model_name="inventorybalance", name="bin_location",
            field=models.CharField(blank=True, max_length=80, default="",
                help_text="Warehouse aisle / shelf / bin for picking order."),
        ),
        migrations.AddField(
            model_name="stockissue", name="fulfillment_status",
            field=models.CharField(max_length=20, blank=True, default="",
                choices=[("packed", "Packed"), ("in_transit", "In transit"), ("completed", "Completed")],
                help_text="Separate physical transit state for a Stores issue voucher."),
        ),
        migrations.AddField(
            model_name="stockissue", name="dispatched_at",
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="stockissue", name="signed_at",
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="stockissue", name="transit_store",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name="outstanding_transit_issues", to="inventory.storelocation"
            ),
        ),
        migrations.AddField(
            model_name="stockissueitem", name="dispatched_unit_cost",
            field=models.DecimalField(max_digits=15, decimal_places=4,
                default=Decimal("0.0000"), validators=[
                    core.validators.quantities.validate_non_negative_decimal
                ]),
        ),
        migrations.AlterField(
            model_name="stockledger", name="reference_type",
            field=models.CharField(
                choices=[(choice.value, choice.label) for choice in LedgerReferenceType],
                max_length=50,
            ),
        ),
        migrations.RunPython(backfill_wac, migrations.RunPython.noop),
    ]
