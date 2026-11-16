from django.db.models.signals import pre_save
from django.dispatch import receiver

from apps.materials_control.models import WasteRecord
from apps.materials_control.services import assert_period_open


@receiver(pre_save, sender=WasteRecord)
def protect_closed_waste_period(sender, instance, **kwargs):
    if instance.outlet_id:
        assert_period_open(instance.outlet.branch_id, instance.created_at.date() if instance.created_at else None)

