"""Safely remove records produced by seed_demo_data for one batch marker."""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.inventory.models import StoreRequisition
from apps.procurement.models import PurchaseRequisition


class Command(BaseCommand):
    help = "Remove demo records belonging to one seed_demo_data batch."

    def add_arguments(self, parser):
        parser.add_argument("--batch", required=True)
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--confirm", action="store_true")

    def handle(self, *args, **options):
        batch = options["batch"].strip().upper()
        marker = f"[{batch}]"
        prs = PurchaseRequisition.objects.filter(control_notes__contains=marker)
        srs = StoreRequisition.objects.filter(purpose__contains=marker)
        self.stdout.write(f"Batch {batch}: {prs.count()} purchase requisitions, {srs.count()} store requests.")
        if options["dry_run"]:
            self.stdout.write(self.style.WARNING("Dry run only; nothing was deleted."))
            return
        if not options["confirm"]:
            raise CommandError("Nothing was deleted. Re-run with --confirm after reviewing --dry-run output.")
        with transaction.atomic():
            # Delete store requests first because some may link to generated purchase requisitions.
            srs.delete()
            prs.delete()
        self.stdout.write(self.style.SUCCESS(f"Batch {batch} removed."))
