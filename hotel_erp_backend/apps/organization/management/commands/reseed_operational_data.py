import gzip
import os
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.core.management.color import no_style
from django.db import connection, transaction
from django.utils import timezone

from apps.accounts.role_templates import ROLE_ALIASES
from apps.audit_logs.models import AuditLog
from apps.departments.models import Branch, Department
from apps.employees.models import Designation, Employee
from apps.inventory.models import (
    Category,
    InventoryBalance,
    Item,
    ItemUnitPrice,
    StoreKeeperAssignment,
    StoreLocation,
    SupplierItemPrice,
    UnitOfMeasure,
)
from apps.organization.models import Hotel
from apps.vendors.models import Supplier
from core.constants.choices import ArticleUnitRole, ItemBusinessType


CONFIRMATION_PHRASE = "RESEED-OPERATIONAL-DATA"
RESET_MARKER_ACTION = "tafiti_operational_reseed"
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
        "Replace production operational data with a small Tafiti Hotel procurement "
        "test baseline while preserving every existing user account, password, role "
        "membership, and direct permission assignment."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--hotel-name",
            default="Tafiti Hotel",
            help="Hotel name for the clean baseline. Defaults to Tafiti Hotel.",
        )
        parser.add_argument(
            "--execute",
            action="store_true",
            help="Perform the reseed. Without this flag the command is read-only.",
        )
        parser.add_argument(
            "--confirm",
            default="",
            help=f"Required with --execute; must be {CONFIRMATION_PHRASE!r}.",
        )
        parser.add_argument(
            "--backup",
            default="",
            help="Path for a pre-reseed JSON or JSON.GZ database dump.",
        )
        parser.add_argument(
            "--external-backup-confirmed",
            action="store_true",
            help=(
                "Production-only acknowledgement that a database-provider backup/snapshot "
                "already exists. Use this instead of --backup on ephemeral build hosts."
            ),
        )
        parser.add_argument(
            "--skip-backup",
            action="store_true",
            help="Testing only; requires --allow-non-production.",
        )
        parser.add_argument(
            "--allow-non-production",
            action="store_true",
            help="Allow execution against a non-production database for rehearsal/tests.",
        )
        parser.add_argument(
            "--once-key",
            default="",
            help=(
                "Optional idempotency key. If this exact key was already completed, "
                "the destructive reset is skipped. Recommended for deployment hooks."
            ),
        )

    def handle(self, *args, **options):
        hotel_name = options["hotel_name"].strip()
        once_key = options["once_key"].strip()
        if not hotel_name:
            raise CommandError("--hotel-name cannot be empty.")

        User = get_user_model()
        accounts = list(User.objects.order_by("pk"))
        counts = self._application_model_counts(User)
        self._write_dry_run_summary(accounts, counts, hotel_name, once_key)

        if not options["execute"]:
            self.stdout.write(
                self.style.WARNING(
                    "Dry run only; nothing was changed. Execution requires --execute "
                    f"and --confirm {CONFIRMATION_PHRASE}."
                )
            )
            return

        if options["confirm"] != CONFIRMATION_PHRASE:
            raise CommandError(
                f"Reseed was not run. --confirm must be {CONFIRMATION_PHRASE}."
            )
        if not accounts:
            raise CommandError("Reseed was not run because there are no user accounts to preserve.")
        if not any(user.is_superuser for user in accounts):
            raise CommandError("Reseed was not run because no recovery superuser exists.")

        if once_key and self._reset_marker_exists(once_key):
            self.stdout.write(
                self.style.SUCCESS(
                    f"Operational reseed key {once_key!r} was already completed; nothing was changed."
                )
            )
            return

        is_production = self._is_production_database()
        if not is_production and not options["allow_non_production"]:
            raise CommandError(
                "Execution is restricted to core.settings.prod with PostgreSQL. "
                "Use --allow-non-production only for a local rehearsal/test."
            )
        if options["skip_backup"] and not options["allow_non_production"]:
            raise CommandError("--skip-backup is permitted only for non-production rehearsal/tests.")

        if is_production:
            if options["backup"] and options["external_backup_confirmed"]:
                raise CommandError("Choose either --backup or --external-backup-confirmed, not both.")
            if options["backup"]:
                self._create_backup(Path(options["backup"]))
            elif not options["external_backup_confirmed"]:
                raise CommandError(
                    "Production reseed requires either --backup PATH or "
                    "--external-backup-confirmed after creating a provider snapshot."
                )
        elif not options["skip_backup"]:
            if not options["backup"]:
                raise CommandError(
                    "Provide --backup PATH, or use --skip-backup with --allow-non-production."
                )
            self._create_backup(Path(options["backup"]))

        account_snapshot = self._snapshot_accounts(accounts)
        employee_snapshot = self._snapshot_employees()
        group_snapshot = self._snapshot_groups()
        expected_passwords = {
            snapshot["fields"]["username"]: snapshot["fields"]["password"]
            for snapshot in account_snapshot
        }
        expected_groups = {
            snapshot["fields"]["username"]: tuple(sorted(snapshot["groups"]))
            for snapshot in account_snapshot
        }

        with transaction.atomic():
            # Flush provides a reliable, future-proof reset of transactional and master
            # records. User accounts are snapshotted first and recreated with the same
            # primary keys and concrete field values before the Tafiti baseline is seeded.
            call_command("flush", interactive=False, verbosity=0)
            self._restore_accounts(
                User,
                account_snapshot=account_snapshot,
                group_snapshot=group_snapshot,
            )
            seeded = self._seed_tafiti_baseline(
                hotel_name=hotel_name,
                employee_snapshot=employee_snapshot,
            )
            self._verify_result(
                User=User,
                expected_passwords=expected_passwords,
                expected_groups=expected_groups,
                expected_account_count=len(account_snapshot),
                expected_hotel_name=hotel_name,
                seeded=seeded,
            )
            if once_key:
                AuditLog.objects.create(
                    actor=seeded["created_by"],
                    action=RESET_MARKER_ACTION,
                    entity_type="OperationalReseed",
                    entity_id=seeded["hotel"].id,
                    metadata={
                        "once_key": once_key,
                        "hotel": hotel_name,
                        "completed_at": timezone.now().isoformat(),
                    },
                    created_by=seeded["created_by"],
                )

        self.stdout.write(
            self.style.SUCCESS(
                "Tafiti operational test data created successfully. "
                f"Preserved {len(account_snapshot)} user account(s); created 1 hotel, "
                "1 main branch, 1 store, 5 suppliers, 4 articles, 4 unit conversions, "
                f"and {len(seeded['catalogue'])} supplier price quotations."
            )
        )

    def _write_dry_run_summary(self, accounts, counts, hotel_name, once_key):
        database = connection.settings_dict
        engine = str(database.get("ENGINE", "")).rsplit(".", 1)[-1]
        target = str(database.get("NAME", ""))
        host = str(database.get("HOST", "")) or "local"
        self.stdout.write(f"Database target: {engine} database {target!r} at {host!r}.")
        self.stdout.write(f"User accounts to preserve unchanged: {len(accounts)}.")
        self.stdout.write(f"Operational/application records to replace: {sum(counts.values())}.")
        for label, count in sorted(counts.items()):
            self.stdout.write(f"  {label}: {count}")
        self.stdout.write(
            "Replacement baseline: "
            f"{hotel_name}, Main Branch, Main Store, 5 suppliers, 4 categorized articles, "
            "4 purchase-unit conversions, 10 supplier/article quotation rows, and zero opening stock."
        )
        if once_key:
            self.stdout.write(f"One-time deployment key: {once_key!r}.")

    @staticmethod
    def _is_production_database():
        engine = str(connection.settings_dict.get("ENGINE", ""))
        return (
            settings.SETTINGS_MODULE == "core.settings.prod"
            and "postgresql" in engine
            and not settings.DEBUG
        )

    @staticmethod
    def _reset_marker_exists(once_key):
        return AuditLog.objects.filter(
            action=RESET_MARKER_ACTION,
            entity_type="OperationalReseed",
            metadata__once_key=once_key,
        ).exists()

    def _create_backup(self, path):
        path = path.expanduser().resolve()
        if path.exists():
            raise CommandError(f"Backup path already exists: {path}")
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            opener = gzip.open if path.suffix.lower() == ".gz" else open
            with opener(path, "wt", encoding="utf-8") as output:
                call_command(
                    "dumpdata",
                    exclude=["contenttypes", "auth.permission"],
                    use_natural_foreign_keys=True,
                    use_natural_primary_keys=True,
                    indent=2,
                    stdout=output,
                    verbosity=0,
                )
            os.chmod(path, 0o600)
        except Exception:
            if path.exists():
                path.unlink()
            raise
        self.stdout.write(self.style.SUCCESS(f"Pre-reseed backup written to {path}."))

    @staticmethod
    def _snapshot_accounts(accounts):
        User = get_user_model()
        field_names = [field.attname for field in User._meta.concrete_fields]
        return [
            {
                "fields": {name: getattr(user, name) for name in field_names},
                "groups": list(user.groups.values_list("name", flat=True)),
                "permissions": list(
                    user.user_permissions.values_list("content_type__app_label", "codename")
                ),
            }
            for user in accounts
        ]

    @staticmethod
    def _snapshot_employees():
        snapshot = {}
        for employee in Employee.objects.select_related("department", "user"):
            snapshot[employee.user_id] = {
                "department": employee.department.name,
                "department_description": employee.department.description,
                "designation": employee.designation,
                "gender": employee.gender,
                "contact": employee.contact,
                "address": employee.address,
                "date_joined": employee.date_joined,
                "photo": employee.photo.name if employee.photo else "",
            }
        return snapshot

    @staticmethod
    def _snapshot_groups():
        return {
            group.name: list(
                group.permissions.values_list("content_type__app_label", "codename")
            )
            for group in Group.objects.prefetch_related("permissions")
        }

    def _restore_accounts(self, User, account_snapshot, group_snapshot):
        User.objects.bulk_create(User(**snapshot["fields"]) for snapshot in account_snapshot)
        self._reset_user_sequence(User)

        for group_name, permission_keys in group_snapshot.items():
            group, _ = Group.objects.get_or_create(name=group_name)
            group.permissions.set(self._permissions_for_keys(permission_keys))

        for snapshot in account_snapshot:
            user = User.objects.get(pk=snapshot["fields"][User._meta.pk.attname])
            user.groups.set(
                [Group.objects.get_or_create(name=name)[0] for name in snapshot["groups"]]
            )
            user.user_permissions.set(self._permissions_for_keys(snapshot["permissions"]))

    @staticmethod
    def _permissions_for_keys(permission_keys):
        permissions = []
        for app_label, codename in permission_keys:
            permission = Permission.objects.filter(
                content_type__app_label=app_label,
                codename=codename,
            ).first()
            if permission:
                permissions.append(permission)
        return permissions

    @staticmethod
    def _reset_user_sequence(User):
        statements = connection.ops.sequence_reset_sql(no_style(), [User])
        if not statements:
            return
        with connection.cursor() as cursor:
            for statement in statements:
                cursor.execute(statement)

    def _seed_tafiti_baseline(self, hotel_name, employee_snapshot):
        User = get_user_model()
        created_by = (
            User.objects.filter(is_superuser=True, is_active=True).first()
            or User.objects.filter(is_active=True).first()
            or User.objects.first()
        )
        hotel = Hotel.objects.create(
            name=hotel_name,
            legal_name="Tafiti Hotel Limited",
            business_type=Hotel.BUSINESS_TYPE_SINGLE,
            registration_number="TAFITI-HOTEL-001",
            tax_identification_number="1000000001",
            email="info@tafitihotel.ug",
            phone="+256 414 555 100",
            address="Kampala, Uganda",
            city="Kampala",
            country="Uganda",
            currency="UGX",
            timezone="Africa/Kampala",
            is_active=True,
            created_by=created_by,
        )
        branch = Branch.objects.create(
            hotel=hotel,
            name="Main Branch",
            branch_code="MAIN",
            branch_type=Branch.BRANCH_TYPE_MAIN,
            location="Kampala, Uganda",
            physical_address="Kampala, Uganda",
            city="Kampala",
            country="Uganda",
            contact_person=created_by.get_full_name() or created_by.username,
            contact=created_by.phone,
            email="operations@tafitihotel.ug",
            is_head_office=True,
            is_active=True,
            created_by=created_by,
        )

        departments = self._create_departments_for_preserved_users(
            employee_snapshot=employee_snapshot,
            created_by=created_by,
        )
        employees = self._rebuild_employee_profiles(
            branch=branch,
            departments=departments,
            employee_snapshot=employee_snapshot,
            created_by=created_by,
        )

        main_store = StoreLocation.objects.create(
            branch=branch,
            name="Main Store",
            address="Tafiti Hotel central receiving and stores area",
            is_default=True,
            is_active=True,
            created_by=created_by,
        )
        for employee in employees.values():
            if employee.user.groups.filter(name="Store Keeper").exists():
                StoreKeeperAssignment.objects.create(
                    store=main_store,
                    employee=employee,
                    is_active=True,
                    created_by=created_by,
                )

        suppliers = self._create_suppliers(created_by)
        units = self._create_units(created_by)
        categories = self._create_categories(created_by)
        items, conversions = self._create_items_and_conversions(
            categories=categories,
            units=units,
            created_by=created_by,
        )
        catalogue = self._create_supplier_catalogue(
            suppliers=suppliers,
            items=items,
            units=units,
            created_by=created_by,
        )

        # A zero opening balance makes the procurement test easy to understand: the
        # first stock increase comes from an actual GRN posted during the workflow.
        for item in items.values():
            InventoryBalance.objects.create(
                item=item,
                store=main_store,
                quantity_in_stock=Decimal("0.00"),
                quantity_reserved=Decimal("0.00"),
                reorder_level=item.reorder_level,
                created_by=created_by,
            )

        return {
            "created_by": created_by,
            "hotel": hotel,
            "branch": branch,
            "departments": departments,
            "employees": employees,
            "store": main_store,
            "suppliers": suppliers,
            "units": units,
            "categories": categories,
            "items": items,
            "conversions": conversions,
            "catalogue": catalogue,
        }

    @staticmethod
    def _create_departments_for_preserved_users(employee_snapshot, created_by):
        # Keep existing employees in the same department names they had before the
        # reset. Add only a few fallback departments required by the fixed roles.
        specs = {
            "Administration": "Hotel administration and executive management.",
            "Finance & Accounts": "Financial control and accounts.",
            "Procurement & Stores": "Procurement and stores operations.",
            "Stores": "Store keeping and receiving operations.",
            "Housekeeping": "Housekeeping operations.",
            "Hotel Operations": "General hotel operations.",
        }
        for previous in employee_snapshot.values():
            name = str(previous.get("department") or "").strip()
            if name:
                specs.setdefault(
                    name,
                    previous.get("department_description")
                    or "Preserved department for an existing user account.",
                )
        return {
            name: Department.objects.create(
                name=name,
                description=description,
                is_active=True,
                created_by=created_by,
            )
            for name, description in specs.items()
        }

    def _rebuild_employee_profiles(self, branch, departments, employee_snapshot, created_by):
        User = get_user_model()
        employees = {}
        for user in User.objects.order_by("username"):
            previous = employee_snapshot.get(user.pk, {})
            should_have_profile = bool(previous) or (
                user.account_type == User.ACCOUNT_EMPLOYEE and not user.is_superuser
            )
            if not should_have_profile:
                continue
            role_name = user.groups.order_by("name").values_list("name", flat=True).first()
            department = self._department_for_account(
                departments=departments,
                previous_name=previous.get("department", ""),
                role_name=role_name or "",
            )
            designation_title = previous.get("designation") or role_name or "Hotel Staff"
            designation, _ = Designation.objects.get_or_create(
                department=department,
                title=designation_title,
                defaults={"is_active": True, "created_by": created_by},
            )
            employee = Employee.objects.create(
                user=user,
                department=department,
                branch=branch,
                designation_record=designation,
                designation=designation_title,
                gender=previous.get("gender", ""),
                contact=previous.get("contact") or user.phone,
                address=previous.get("address", ""),
                date_joined=previous.get("date_joined") or timezone.localdate(),
                photo=previous.get("photo") or None,
                is_active=user.is_active,
                created_by=created_by,
            )
            employees[user.username] = employee
        return employees

    @staticmethod
    def _department_for_account(departments, previous_name, role_name):
        previous_name = str(previous_name or "").strip()
        if previous_name and previous_name in departments:
            return departments[previous_name]
        canonical_role = ROLE_ALIASES.get(role_name, role_name)
        role_departments = {
            "Cost Controller": "Finance & Accounts",
            "Financial Manager": "Finance & Accounts",
            "Procurement Manager": "Procurement & Stores",
            "Store Keeper": "Procurement & Stores",
            "Receiving Clerk": "Procurement & Stores",
            "General Manager": "Administration",
            "System Administrator": "Administration",
            "Department Head": "Hotel Operations",
            "Requester": "Hotel Operations",
        }
        return departments[role_departments.get(canonical_role, "Hotel Operations")]

    @staticmethod
    def _create_suppliers(created_by):
        specs = (
            {
                "key": "food_beverage",
                "name": "Tafiti Food & Beverage Supplies Ltd",
                "email": "mugishawarid@gmail.com",
                "phone": "+256 772 410 101",
                "address": "Kalerwe, Kampala, Uganda",
                "contact_person": "Warid Mugisha",
                "payment_terms": "Net 14",
                "tin_number": "1000004101",
                "registration_number": "TAF-SUP-4101",
                "notes": "Dry food and beverage supplier for hotel operations.",
            },
            {
                "key": "housekeeping_office",
                "name": "Prime Housekeeping & Office Supplies Ltd",
                "email": "kjapher38@gmail.com",
                "phone": "+256 701 320 238",
                "address": "Ntinda, Kampala, Uganda",
                "contact_person": "Japheth Kato",
                "payment_terms": "Net 30",
                "tin_number": "1000004102",
                "registration_number": "TAF-SUP-4102",
                "notes": "Housekeeping consumables and office stationery supplier.",
            },
            {
                "key": "institutional",
                "name": "Kampala Institutional Traders Ltd",
                "email": "wmugisha@kcca.go.ug",
                "phone": "+256 414 660 303",
                "address": "Nakasero, Kampala, Uganda",
                "contact_person": "William Mugisha",
                "payment_terms": "Net 30",
                "tin_number": "1000004103",
                "registration_number": "TAF-SUP-4103",
                "notes": "Institutional beverage and stationery supplier.",
            },
            {
                "key": "hospitality",
                "name": "East Africa Hospitality Supplies Ltd",
                "email": "watumwaizaac32@gmail.com",
                "phone": "+256 752 440 404",
                "address": "Industrial Area, Kampala, Uganda",
                "contact_person": "Isaac Watum",
                "payment_terms": "Net 14",
                "tin_number": "1000004104",
                "registration_number": "TAF-SUP-4104",
                "notes": "Food and housekeeping supplies for hotels and restaurants.",
            },
            {
                "key": "general",
                "name": "Reliable General Supplies Ltd",
                # Intentionally rotated from the supplied test mailbox list. Supplier
                # emails are not unique because different supplier records may share a
                # purchasing contact mailbox in a test or group-company setup.
                "email": "mugishawarid@gmail.com",
                "phone": "+256 782 550 505",
                "address": "Nakawa, Kampala, Uganda",
                "contact_person": "Moses Mugisha",
                "payment_terms": "Net 21",
                "tin_number": "1000004105",
                "registration_number": "TAF-SUP-4105",
                "notes": "General hotel consumables and office supply company.",
            },
        )
        suppliers = {}
        for spec in specs:
            key = spec.pop("key")
            suppliers[key] = Supplier.objects.create(**spec, created_by=created_by)
        return suppliers

    @staticmethod
    def _create_units(created_by):
        specs = (
            ("Kilogram", "kg"),
            ("Sack", "sack"),
            ("Bottle", "btl"),
            ("Carton", "ctn"),
            ("Litre", "L"),
            ("Jerrycan", "jcan"),
            ("Ream", "ream"),
        )
        return {
            name: UnitOfMeasure.objects.create(
                name=name,
                abbreviation=abbreviation,
                is_active=True,
                created_by=created_by,
            )
            for name, abbreviation in specs
        }

    @staticmethod
    def _create_categories(created_by):
        specs = (
            ("Food Supplies", "FOOD", "Dry food and kitchen inputs."),
            ("Beverages", "BEV", "Non-alcoholic beverages for hotel operations."),
            ("Housekeeping Supplies", "HKS", "Cleaning and housekeeping consumables."),
            ("Stationery", "STA", "Office and administrative consumables."),
        )
        return {
            name: Category.objects.create(
                name=name,
                code=code,
                description=description,
                is_active=True,
                created_by=created_by,
            )
            for name, code, description in specs
        }

    @staticmethod
    def _create_items_and_conversions(categories, units, created_by):
        specs = (
            {
                "sku": "TAF-RICE-25",
                "name": "Long Grain Rice",
                "category": "Food Supplies",
                "base_unit": "Kilogram",
                "purchase_unit": "Sack",
                "factor": "25",
                "reorder": "25",
                "maximum": "250",
            },
            {
                "sku": "TAF-WATER-500",
                "name": "Mineral Water 500ml",
                "category": "Beverages",
                "base_unit": "Bottle",
                "purchase_unit": "Carton",
                "factor": "24",
                "reorder": "48",
                "maximum": "480",
            },
            {
                "sku": "TAF-SOAP-5L",
                "name": "Liquid Hand Soap",
                "category": "Housekeeping Supplies",
                "base_unit": "Litre",
                "purchase_unit": "Jerrycan",
                "factor": "5",
                "reorder": "10",
                "maximum": "100",
            },
            {
                "sku": "TAF-PAPER-A4",
                "name": "A4 Printing Paper 80gsm",
                "category": "Stationery",
                "base_unit": "Ream",
                "purchase_unit": "Carton",
                "factor": "5",
                "reorder": "5",
                "maximum": "50",
            },
        )
        items = {}
        conversions = {}
        for spec in specs:
            base_unit = units[spec["base_unit"]]
            purchase_unit = units[spec["purchase_unit"]]
            item = Item.objects.create(
                category=categories[spec["category"]],
                name=spec["name"],
                sku=spec["sku"],
                unit=base_unit.abbreviation,
                base_unit=base_unit,
                reorder_level=Decimal(spec["reorder"]),
                maximum_level=Decimal(spec["maximum"]),
                business_type=ItemBusinessType.CONSUMABLE_EXPENSE,
                is_active=True,
                created_by=created_by,
            )
            conversion = ItemUnitPrice(
                item=item,
                unit=purchase_unit,
                conversion_factor=Decimal(spec["factor"]),
                role=ArticleUnitRole.PURCHASE,
                is_active=True,
                created_by=created_by,
            )
            conversion.full_clean()
            conversion.save()
            items[spec["sku"]] = item
            conversions[spec["sku"]] = conversion
        return items, conversions

    @staticmethod
    def _create_supplier_catalogue(suppliers, items, units, created_by):
        valid_until = timezone.localdate() + timedelta(days=90)
        specs = (
            # supplier key, article, purchase UOM, quotation price, preferred, quote ref, lead days
            ("food_beverage", "TAF-RICE-25", "Sack", "117500", False, "TFB-RICE-001", 2),
            ("food_beverage", "TAF-WATER-500", "Carton", "18500", False, "TFB-WATER-001", 2),
            ("housekeeping_office", "TAF-SOAP-5L", "Jerrycan", "42000", False, "PHO-SOAP-001", 2),
            ("housekeeping_office", "TAF-PAPER-A4", "Carton", "97500", False, "PHO-PAPER-001", 2),
            ("institutional", "TAF-WATER-500", "Carton", "17800", True, "KIT-WATER-001", 1),
            ("institutional", "TAF-PAPER-A4", "Carton", "95000", False, "KIT-PAPER-001", 3),
            ("hospitality", "TAF-RICE-25", "Sack", "115000", True, "EAH-RICE-001", 2),
            ("hospitality", "TAF-SOAP-5L", "Jerrycan", "40000", True, "EAH-SOAP-001", 2),
            ("general", "TAF-WATER-500", "Carton", "19000", False, "RGS-WATER-001", 3),
            ("general", "TAF-PAPER-A4", "Carton", "92500", True, "RGS-PAPER-001", 3),
        )
        catalogue = []
        for supplier_key, sku, unit_name, price, preferred, quote_ref, lead_days in specs:
            entry = SupplierItemPrice(
                supplier=suppliers[supplier_key],
                item=items[sku],
                unit=units[unit_name],
                supplier_sku=f"{supplier_key[:3].upper()}-{sku}",
                unit_price=Decimal(price),
                minimum_order_quantity=Decimal("1"),
                lead_time_days=lead_days,
                is_preferred=preferred,
                last_quoted_at=timezone.localdate(),
                effective_from=timezone.localdate(),
                quotation_reference=quote_ref,
                quotation_valid_until=valid_until,
                currency="UGX",
                is_active=True,
                created_by=created_by,
            )
            entry.full_clean()
            entry.save()
            catalogue.append(entry)
        return catalogue

    @staticmethod
    def _verify_result(
        User, expected_passwords, expected_groups, expected_account_count, expected_hotel_name, seeded
    ):
        if User.objects.count() != expected_account_count:
            raise CommandError("Account verification failed; the transaction will be rolled back.")
        for username, password_hash in expected_passwords.items():
            user = User.objects.get(username=username)
            if user.password != password_hash:
                raise CommandError(
                    f"Password preservation failed for {username}; the transaction will be rolled back."
                )
            actual_groups = tuple(sorted(user.groups.values_list("name", flat=True)))
            if actual_groups != expected_groups[username]:
                raise CommandError(
                    f"Role membership preservation failed for {username}; the transaction will be rolled back."
                )

        if Hotel.objects.count() != 1 or seeded["hotel"].name != expected_hotel_name:
            raise CommandError("Hotel verification failed; the transaction will be rolled back.")
        if Branch.objects.count() != 1 or seeded["branch"].name != "Main Branch":
            raise CommandError("Branch verification failed; the transaction will be rolled back.")
        if StoreLocation.objects.count() != 1 or seeded["store"].name != "Main Store":
            raise CommandError("Store verification failed; the transaction will be rolled back.")
        if Supplier.objects.count() != 5:
            raise CommandError("Supplier verification failed; the transaction will be rolled back.")

        expected_emails = [
            "mugishawarid@gmail.com",
            "kjapher38@gmail.com",
            "wmugisha@kcca.go.ug",
            "watumwaizaac32@gmail.com",
            "mugishawarid@gmail.com",
        ]
        if sorted(Supplier.objects.values_list("email", flat=True)) != sorted(expected_emails):
            raise CommandError("Supplier email rotation verification failed; the transaction will be rolled back.")
        if Item.objects.count() != 4 or ItemUnitPrice.objects.count() != 4:
            raise CommandError("Article/UOM verification failed; the transaction will be rolled back.")
        if SupplierItemPrice.objects.count() != 10:
            raise CommandError("Supplier catalogue verification failed; the transaction will be rolled back.")
        if InventoryBalance.objects.count() != 4:
            raise CommandError("Opening inventory verification failed; the transaction will be rolled back.")
        if InventoryBalance.objects.exclude(quantity_in_stock=Decimal("0.00")).exists():
            raise CommandError("Opening stock must be zero for a clean workflow test.")

        for sku in ("TAF-RICE-25", "TAF-WATER-500", "TAF-SOAP-5L", "TAF-PAPER-A4"):
            if seeded["items"][sku].supplier_prices.count() < 2:
                raise CommandError(
                    f"Competitive supplier verification failed for {sku}; the transaction will be rolled back."
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
