import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import StoreKeeperAssignment, StoreLocation
from rest_framework.authtoken.models import Token


DEFAULT_TEST_PASSWORD = "RoleTest-2026!"

ROLE_ACCOUNTS = (
    ("role-system-admin", "ROLE-ADMIN", "System", "Administrator", "System Administrator", None),
    ("role-general-manager", "ROLE-GM", "General", "Manager", "General Manager", None),
    ("role-procurement", "ROLE-PROC", "Procurement", "Manager", "Procurement Manager", "Procurement"),
    ("role-cost-controller", "ROLE-COST", "Cost", "Controller", "Cost Controller", "Finance"),
    ("role-finance", "ROLE-FIN", "Financial", "Manager", "Financial Manager", "Finance"),
    ("role-store-keeper", "ROLE-KEEPER", "Store", "Keeper", "Store Keeper", "Procurement"),
    ("role-receiving", "ROLE-RECV", "Receiving", "Clerk", "Receiving Clerk", "Procurement"),
)

PASSWORD_VARIABLES = {
    username: f"ROLE_TEST_{employee_code.removeprefix('ROLE-').replace('-', '_')}_PASSWORD"
    for username, employee_code, *_rest in ROLE_ACCOUNTS
}


class Command(BaseCommand):
    help = "Create or refresh isolated role-testing users without creating workflow records."

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            default=os.environ.get("ROLE_TEST_PASSWORD", ""),
            help="Shared password for role-test accounts. Defaults only in DEBUG environments.",
        )
        parser.add_argument(
            "--branch",
            default="",
            help="Branch name to assign. Defaults to Kampala or the first active branch.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        password = str(options["password"]).strip()
        passwords = self.get_passwords(password)

        call_command("setup_hotel_roles", verbosity=0)
        branch = self.get_branch(str(options["branch"]).strip())
        departments = list(Department.objects.filter(is_active=True).order_by("name"))
        if not departments:
            raise CommandError("Create at least one active department before provisioning role users.")

        user_model = get_user_model()
        for username, employee_code, first_name, last_name, role, department_hint in ROLE_ACCOUNTS:
            department = self.get_department(departments, department_hint)
            user, created = user_model.objects.get_or_create(
                username=username,
                defaults={"employee_code": employee_code},
            )
            user.employee_code = employee_code
            user.first_name = first_name
            user.last_name = last_name
            user.email = f"{username}@example.invalid"
            user.is_active = True
            user.is_staff = role == "System Administrator"
            user.is_superuser = False
            user.set_password(passwords[username])
            user.save()
            user.groups.set([Group.objects.get(name=role)])
            user.user_permissions.clear()
            Token.objects.filter(user=user).delete()

            employee, _ = Employee.objects.update_or_create(
                user=user,
                defaults={
                    "branch": branch,
                    "department": department,
                    "designation": role,
                    "is_active": True,
                },
            )
            if role == "Store Keeper":
                for store in StoreLocation.objects.filter(branch=branch, is_active=True):
                    StoreKeeperAssignment.objects.update_or_create(
                        store=store,
                        employee=employee,
                        defaults={"is_active": True, "created_by": user},
                    )
            action = "Created" if created else "Refreshed"
            self.stdout.write(f"{action}: {username} ({role})")

        self.stdout.write(
            self.style.SUCCESS(
                f"Provisioned {len(ROLE_ACCOUNTS)} role-test users for {branch.name}."
            )
        )

    @staticmethod
    def get_passwords(shared_password):
        if settings.DEBUG:
            password = shared_password or DEFAULT_TEST_PASSWORD
            if len(password) < 12:
                raise CommandError("The role-test password must contain at least 12 characters.")
            return {username: password for username, *_rest in ROLE_ACCOUNTS}

        if shared_password:
            raise CommandError(
                "Shared role-test passwords are disabled in production. "
                "Set the separate ROLE_TEST_*_PASSWORD environment variables."
            )

        passwords = {
            username: os.environ.get(variable_name, "").strip()
            for username, variable_name in PASSWORD_VARIABLES.items()
        }
        missing = [
            PASSWORD_VARIABLES[username]
            for username, password in passwords.items()
            if len(password) < 16
        ]
        if missing:
            raise CommandError(
                "Set a unique password of at least 16 characters for: "
                + ", ".join(missing)
            )
        if len(set(passwords.values())) != len(passwords):
            raise CommandError("Every production role-test account must use a unique password.")
        return passwords

    def get_branch(self, requested_name):
        branches = Branch.objects.filter(is_active=True)
        if requested_name:
            branch = branches.filter(name__iexact=requested_name).first()
            if not branch:
                raise CommandError(f"Active branch {requested_name!r} was not found.")
            return branch
        branch = branches.filter(name__icontains="Kampala").first() or branches.order_by("name").first()
        if not branch:
            raise CommandError("Create at least one active branch before provisioning role users.")
        return branch

    @staticmethod
    def get_department(departments, hint):
        if hint:
            matched = next(
                (department for department in departments if hint.lower() in department.name.lower()),
                None,
            )
            if matched:
                return matched
        return departments[0]
