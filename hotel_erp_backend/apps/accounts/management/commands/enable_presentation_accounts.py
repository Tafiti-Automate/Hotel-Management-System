import os

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from rest_framework.authtoken.models import Token


ACCOUNT_SPECS = (
    ("anankya", "Store Keeper", "DEMO_STORE_KEEPER_PASSWORD"),
    ("esther.nambasa", "Department Head", "DEMO_DEPARTMENT_HEAD_PASSWORD"),
    ("grace.nakato", "General Manager", "DEMO_GENERAL_MANAGER_PASSWORD"),
    ("daniel.okello", "Procurement Manager", "DEMO_PROCUREMENT_MANAGER_PASSWORD"),
)


class Command(BaseCommand):
    help = (
        "Enable the four named presentation accounts using separate passwords "
        "from environment variables and enforce their expected role groups."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--verify-only",
            action="store_true",
            help="Verify the accounts and role assignments without changing passwords.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        call_command("setup_hotel_roles", verbosity=0)
        verify_only = options["verify_only"]
        passwords = self.get_passwords(verify_only)
        user_model = get_user_model()

        for username, role_name, variable_name in ACCOUNT_SPECS:
            try:
                user = user_model.objects.select_related("employee_profile").get(
                    username=username
                )
            except user_model.DoesNotExist as error:
                raise CommandError(
                    f"Presentation user {username!r} does not exist. "
                    "Run seed_presentation_data first."
                ) from error

            try:
                group = Group.objects.get(name=role_name)
            except Group.DoesNotExist as error:
                raise CommandError(f"Required role group {role_name!r} does not exist.") from error

            if not verify_only:
                user.is_active = True
                user.is_staff = False
                user.is_superuser = False
                user.set_password(passwords[variable_name])
                user.save(
                    update_fields=(
                        "is_active",
                        "is_staff",
                        "is_superuser",
                        "password",
                    )
                )
                user.groups.set([group])
                user.user_permissions.clear()
                Token.objects.filter(user=user).delete()

            user.refresh_from_db()
            actual_groups = list(user.groups.values_list("name", flat=True))
            if actual_groups != [role_name]:
                raise CommandError(
                    f"{username!r} has groups {actual_groups!r}; expected only {role_name!r}."
                )
            if user.is_superuser or user.is_staff or not user.is_active:
                raise CommandError(
                    f"{username!r} is not configured as an active role-only account."
                )
            if not hasattr(user, "employee_profile"):
                raise CommandError(f"{username!r} has no employee profile.")
            if not user.has_usable_password():
                raise CommandError(f"{username!r} does not have an enabled password.")

            self.stdout.write(
                self.style.SUCCESS(
                    f"{username}: {role_name} "
                    f"({group.permissions.count()} model permissions)"
                )
            )

    @staticmethod
    def get_passwords(verify_only):
        if verify_only:
            return {}

        passwords = {}
        for _, _, variable_name in ACCOUNT_SPECS:
            password = os.environ.get(variable_name, "")
            if len(password) < 16:
                raise CommandError(
                    f"{variable_name} must contain at least 16 characters."
                )
            passwords[variable_name] = password

        if len(set(passwords.values())) != len(passwords):
            raise CommandError("Every presentation account must use a different password.")
        return passwords
