from django.core.management.base import BaseCommand

from apps.notifications.services import sync_all_expiry_notifications


class Command(BaseCommand):
    help = "Generate due inventory expiry notifications for assigned Store Keepers."

    def handle(self, *args, **options):
        count = sync_all_expiry_notifications()
        self.stdout.write(self.style.SUCCESS(f"Processed {count} expiry alerts."))
