from django.core.management.base import BaseCommand

from apps.accounts.role_templates import ROLE_SPECS, sync_client_roles


class Command(BaseCommand):
    help = "Create/update the predefined client workflow roles and restore their default permissions."

    def handle(self, *args, **options):
        groups = sync_client_roles(reset_permissions=True)
        for name in ROLE_SPECS:
            group = groups[name]
            self.stdout.write(self.style.SUCCESS(f"{name}: {group.permissions.count()} permissions"))
        self.stdout.write(self.style.SUCCESS("Client workflow role templates are ready."))
