from django.core.management.base import BaseCommand, CommandError

from apps.audit_logs.models import AuditLog


class Command(BaseCommand):
    help = "Verify the HMAC chain for immutable audit records created after security hardening."

    def handle(self, *args, **options):
        previous = ""
        checked = 0
        records = AuditLog.objects.exclude(entry_hash="").order_by("chain_sequence")
        for record in records.iterator():
            if record.previous_hash != previous:
                raise CommandError(
                    f"Audit chain break at {record.id}: previous hash does not match."
                )
            if record.calculate_hash() != record.entry_hash:
                raise CommandError(f"Audit record {record.id} failed HMAC verification.")
            previous = record.entry_hash
            checked += 1
        self.stdout.write(self.style.SUCCESS(f"Audit chain verified: {checked} protected record(s)."))
