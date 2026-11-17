"""Read-only acceptance preflight for the ten approved hotel operational roles."""
import json
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.role_templates import SYSTEM_ROLE_NAMES
from apps.inventory.models import StoreKeeperAssignment


class Command(BaseCommand):
    help = "Audit real hotel role assignments without modifying users, stock or permissions."

    def add_arguments(self, parser):
        parser.add_argument(
            "--json", action="store_true",
            help="Print one machine-readable report without names, emails or employee IDs.",
        )
        parser.add_argument(
            "--strict", action="store_true",
            help="Exit unsuccessfully when a required operational role has no ready user.",
        )

    def handle(self, *args, **options):
        failures = []
        role_results = []
        json_output = options.get('json', False)
        for role in SYSTEM_ROLE_NAMES:
            group = Group.objects.filter(name=role).first()
            if not group:
                failures.append(f"{role}: group missing; run setup_hotel_roles after deployment")
                role_results.append({
                    "role": role, "ready": False, "ready_users": 0,
                    "inactive_users": 0, "missing_assignment_users": 0,
                    "blocker": "role_group_missing",
                })
                if not json_output:
                    self.stdout.write(f"[MISSING] {role}: role group does not exist")
                continue

            ready = 0
            inactive = 0
            unassigned = 0
            for user in group.user_set.all().select_related(
                "employee_profile__branch", "employee_profile__department"
            ):
                if not user.is_active:
                    inactive += 1
                    continue
                employee = getattr(user, "employee_profile", None)
                if role == "System Administrator" and user.is_superuser:
                    ready += 1
                    continue
                if role == "System Administrator" and user.account_type == user.ACCOUNT_SYSTEM:
                    ready += 1
                    continue
                if not employee or not employee.is_active or not employee.branch_id or not employee.department_id:
                    unassigned += 1
                    continue
                if role == "Store Keeper" and not StoreKeeperAssignment.objects.filter(
                    employee=employee, is_active=True, store__is_active=True,
                    store__branch_id=employee.branch_id,
                ).exists():
                    unassigned += 1
                    continue
                ready += 1

            status = "READY" if ready else "NOT READY"
            role_results.append({
                "role": role, "ready": bool(ready), "ready_users": ready,
                "inactive_users": inactive, "missing_assignment_users": unassigned,
                "blocker": None if ready else "no_active_assigned_user",
            })
            if not json_output:
                self.stdout.write(
                    f"[{status}] {role}: {ready} active and assigned; "
                    f"{inactive} inactive; {unassigned} missing operational assignment"
                )
            if not ready:
                failures.append(f"{role}: no active, correctly assigned user")

        if json_output:
            self.stdout.write(json.dumps({
                "schema_version": 1,
                "read_only": True,
                "all_roles_ready": not failures,
                "ready_role_count": len(SYSTEM_ROLE_NAMES) - len(failures),
                "required_role_count": len(SYSTEM_ROLE_NAMES),
                "roles": role_results,
            }, sort_keys=True))
        else:
            self.stdout.write(
                f"Role readiness: {len(SYSTEM_ROLE_NAMES) - len(failures)}/"
                f"{len(SYSTEM_ROLE_NAMES)} canonical roles have a usable account"
            )
        if failures and options["strict"]:
            raise CommandError("Role acceptance is blocked: " + "; ".join(failures))
