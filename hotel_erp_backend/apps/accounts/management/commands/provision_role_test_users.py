import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.departments.models import Branch, Department
from apps.employees.models import Employee


DEFAULT_TEST_PASSWORD = "RoleTest-2026!"

ROLE_ACCOUNTS = (
    ("role-system-admin", "ROLE-ADMIN", "System", "Administrator", "System Administrator", None),
    ("role-general-manager", "ROLE-GM", "General", "Manager", "General Manager", None),
    ("role-procurement", "ROLE-PROC", "Procurement", "Manager", "Procurement Manager", "Procurement"),
    ("role-finance", "ROLE-FIN", "Finance", "Controller", "Finance Controller", "Finance"),
    ("role-stores-manager", "ROLE-STORES", "Stores", "Manager", "Stores Manager", "Procurement"),
    ("role-store-keeper", "ROLE-KEEPER", "Store", "Keeper", "Store Keeper", "Procurement"),
    ("role-department-head", "ROLE-HOD", "Department", "Head", "Department Head", "Front Office"),
    ("role-receiving", "ROLE-RECV", "Receiving", "Officer", "Receiving Officer", "Procurement"),
    ("role-auditor", "ROLE-AUDIT", "Operations", "Auditor", "Auditor", None),
)


class Command(BaseCommand):
    help = "Create or refresh local role-testing users without creating workflow records."

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
        if not password:
            if not settings.DEBUG:
                raise CommandError(
                    "Set ROLE_TEST_PASSWORD or pass --password outside a DEBUG environment."
                )
            password = DEFAULT_TEST_PASSWORD
        if len(password) < 12:
            raise CommandError("The role-test password must contain at least 12 characters.")

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
            user.set_password(password)
            user.save()
            user.groups.set([Group.objects.get(name=role)])

            Employee.objects.update_or_create(
                user=user,
                defaults={
                    "branch": branch,
                    "department": department,
                    "designation": role,
                    "is_active": True,
                },
            )
            action = "Created" if created else "Refreshed"
            self.stdout.write(f"{action}: {username} ({role})")

        self.stdout.write(
            self.style.SUCCESS(
                f"Provisioned {len(ROLE_ACCOUNTS)} role-test users for {branch.name}."
            )
        )

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
