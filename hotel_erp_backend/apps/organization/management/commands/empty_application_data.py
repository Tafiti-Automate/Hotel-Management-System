from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.core.management.color import no_style
from django.db import connection


CONFIRMATION_PHRASE = "EMPTY-APPLICATION-DATA"
APPLICATION_LABELS = {
    "accounts",
    "approvals",
    "audit_logs",
    "customers",
    "departments",
    "employees",
    "finance",
    "inventory",
    "notifications",
    "organization",
    "procurement",
    "reports",
    "sales",
    "vendors",
}


class Command(BaseCommand):
    help = (
        "Remove all hotel application data while preserving superuser accounts. "
        "The command is a dry run unless --execute and the confirmation phrase are supplied."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--execute",
            action="store_true",
            help="Perform the cleanup. Without this flag, only record counts are shown.",
        )
        parser.add_argument(
            "--confirm",
            default="",
            help=f"Required with --execute; must be {CONFIRMATION_PHRASE!r}.",
        )

    def handle(self, *args, **options):
        User = get_user_model()
        superusers = User.objects.filter(is_superuser=True)
        regular_user_count = User.objects.filter(is_superuser=False).count()
        model_counts = self._application_model_counts(User)
        application_record_count = sum(model_counts.values()) + regular_user_count

        self.stdout.write(
            f"Application records to remove: {application_record_count} "
            f"({regular_user_count} non-superuser accounts)."
        )
        self.stdout.write(f"Superuser accounts to preserve: {superusers.count()}.")

        if not options["execute"]:
            self.stdout.write(
                self.style.WARNING(
                    "Dry run only; nothing was deleted. Re-run with --execute and "
                    f"--confirm {CONFIRMATION_PHRASE}."
                )
            )
            return

        if options["confirm"] != CONFIRMATION_PHRASE:
            raise CommandError(
                "Cleanup was not run. --execute requires "
                f"--confirm {CONFIRMATION_PHRASE}."
            )

        if not superusers.exists():
            raise CommandError(
                "Cleanup was not run because no superuser account exists to preserve."
            )

        field_names = [field.attname for field in User._meta.concrete_fields]
        preserved_superusers = list(superusers.values(*field_names))

        # Django's flush handles every current and future application table in a
        # database-safe order. Permissions and content types are recreated by its
        # post-migrate signal; role groups are rebuilt below.
        call_command("flush", interactive=False, verbosity=0)

        User.objects.bulk_create(User(**values) for values in preserved_superusers)
        self._reset_user_sequence(User)
        call_command("setup_hotel_roles", verbosity=0)

        restored_count = User.objects.filter(is_superuser=True).count()
        if restored_count != len(preserved_superusers):
            raise CommandError(
                "Application data was emptied, but not every superuser was restored."
            )

        self.stdout.write(
            self.style.SUCCESS(
                "Application data emptied successfully; no demo data was inserted, "
                f"and {restored_count} superuser account(s) were preserved."
            )
        )

    @staticmethod
    def _application_model_counts(User):
        counts = {}
        for model in apps.get_models():
            if model is User or model._meta.app_label not in APPLICATION_LABELS:
                continue
            count = model._default_manager.count()
            if count:
                counts[model._meta.label] = count
        return counts

    @staticmethod
    def _reset_user_sequence(User):
        statements = connection.ops.sequence_reset_sql(no_style(), [User])
        if not statements:
            return
        with connection.cursor() as cursor:
            for statement in statements:
                cursor.execute(statement)
