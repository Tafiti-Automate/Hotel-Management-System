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
from apps.departments.models import Branch, Department
from apps.employees.models import Designation, Employee
from apps.finance.models import ExpenseCategory, PaymentMethod
from apps.inventory.models import (
    Category,
    InventoryBalance,
    Item,
    ItemUnitPrice,
    ReorderRule,
    StoreKeeperAssignment,
    StoreLocation,
    SupplierItemPrice,
    UnitOfMeasure,
)
from apps.organization.models import Hotel
from apps.vendors.models import Supplier
from core.constants.choices import ArticleUnitRole, ItemBusinessType


CONFIRMATION_PHRASE = "RESEED-OPERATIONAL-DATA"
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
        "Replace hotel operational data with a coherent procurement and inventory "
        "baseline while preserving every user account and its access assignments."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--hotel-name",
            default="Kampala Grand Hotel",
            help="Name of the clean hotel profile to create.",
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
            help="Required in production: path for a pre-reseed JSON or JSON.GZ dump.",
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

    def handle(self, *args, **options):
        hotel_name = options["hotel_name"].strip()
        if not hotel_name:
            raise CommandError("--hotel-name cannot be empty.")

        User = get_user_model()
        accounts = list(User.objects.order_by("pk"))
        counts = self._application_model_counts(User)
        self._write_dry_run_summary(accounts, counts, hotel_name)

        if not options["execute"]:
            self.stdout.write(
                self.style.WARNING(
                    "Dry run only; nothing was changed. Execution requires --execute, "
                    f"--confirm {CONFIRMATION_PHRASE}, and a production backup path."
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

        is_production = self._is_production_database()
        if not is_production and not options["allow_non_production"]:
            raise CommandError(
                "Execution is restricted to core.settings.prod with PostgreSQL. "
                "Use --allow-non-production only for a local rehearsal."
            )
        if options["skip_backup"] and not options["allow_non_production"]:
            raise CommandError("--skip-backup is permitted only for non-production rehearsal/tests.")
        if not options["skip_backup"]:
            if not options["backup"]:
                raise CommandError("--backup is required before operational data can be replaced.")
            self._create_backup(Path(options["backup"]))

        account_snapshot = self._snapshot_accounts(accounts)
        employee_snapshot = self._snapshot_employees()
        group_snapshot = self._snapshot_groups()
        expected_passwords = {
            snapshot["fields"]["username"]: snapshot["fields"]["password"]
            for snapshot in account_snapshot
        }

        with transaction.atomic():
            # Flush is used instead of a hand-maintained delete list so new dependent
            # operational tables cannot leave stale records behind. PostgreSQL makes
            # the flush and replacement seed rollback together if any verification fails.
            call_command("flush", interactive=False, verbosity=0)
            self._restore_accounts(
                User,
                account_snapshot=account_snapshot,
                group_snapshot=group_snapshot,
            )
            seeded = self._seed_operational_baseline(
                hotel_name=hotel_name,
                employee_snapshot=employee_snapshot,
            )
            self._verify_result(
                User=User,
                expected_passwords=expected_passwords,
                expected_account_count=len(account_snapshot),
                seeded=seeded,
            )

        self.stdout.write(
            self.style.SUCCESS(
                "Operational data reseeded successfully. "
                f"Preserved {len(account_snapshot)} user account(s), created 3 suppliers, "
                f"{len(seeded['items'])} articles, {len(seeded['conversions'])} unit conversions, "
                f"and {len(seeded['catalogue'])} supplier catalogue entries."
            )
        )

    def _write_dry_run_summary(self, accounts, counts, hotel_name):
        database = connection.settings_dict
        engine = str(database.get("ENGINE", "")).rsplit(".", 1)[-1]
        target = str(database.get("NAME", ""))
        host = str(database.get("HOST", "")) or "local"
        self.stdout.write(f"Database target: {engine} database {target!r} at {host!r}.")
        self.stdout.write(f"User accounts to preserve: {len(accounts)}.")
        self.stdout.write(
            f"Operational/application records to replace: {sum(counts.values())}."
        )
        for label, count in sorted(counts.items()):
            self.stdout.write(f"  {label}: {count}")
        self.stdout.write(
            "Replacement baseline: "
            f"{hotel_name}, 1 branch, 8 departments, 3 suppliers, 9 articles, "
            "9 conversions, 11 supplier catalogue entries, and opening stock balances."
        )

    @staticmethod
    def _is_production_database():
        engine = str(connection.settings_dict.get("ENGINE", ""))
        return (
            settings.SETTINGS_MODULE == "core.settings.prod"
            and "postgresql" in engine
            and not settings.DEBUG
        )

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
        snapshots = []
        for user in accounts:
            snapshots.append(
                {
                    "fields": {name: getattr(user, name) for name in field_names},
                    "groups": list(user.groups.values_list("name", flat=True)),
                    "permissions": list(
                        user.user_permissions.values_list(
                            "content_type__app_label", "codename"
                        )
                    ),
                }
            )
        return snapshots

    @staticmethod
    def _snapshot_employees():
        return {
            employee.user_id: {
                "department": employee.department.name,
                "designation": employee.designation,
                "gender": employee.gender,
                "contact": employee.contact,
                "address": employee.address,
                "date_joined": employee.date_joined,
            }
            for employee in Employee.objects.select_related("department", "user")
        }

    @staticmethod
    def _snapshot_groups():
        return {
            group.name: list(
                group.permissions.values_list("content_type__app_label", "codename")
            )
            for group in Group.objects.prefetch_related("permissions")
        }

    def _restore_accounts(self, User, account_snapshot, group_snapshot):
        User.objects.bulk_create(
            User(**snapshot["fields"]) for snapshot in account_snapshot
        )
        self._reset_user_sequence(User)

        for group_name, permission_keys in group_snapshot.items():
            group, _ = Group.objects.get_or_create(name=group_name)
            permissions = self._permissions_for_keys(permission_keys)
            group.permissions.set(permissions)

        for snapshot in account_snapshot:
            user = User.objects.get(pk=snapshot["fields"][User._meta.pk.attname])
            groups = [
                Group.objects.get_or_create(name=group_name)[0]
                for group_name in snapshot["groups"]
            ]
            user.groups.set(groups)
            user.user_permissions.set(
                self._permissions_for_keys(snapshot["permissions"])
            )

        # Canonicalize legacy role names and restore the approved permission policy.
        call_command("setup_hotel_roles", verbosity=0)

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

    def _seed_operational_baseline(self, hotel_name, employee_snapshot):
        User = get_user_model()
        created_by = (
            User.objects.filter(is_superuser=True, is_active=True).first()
            or User.objects.filter(is_active=True).first()
            or User.objects.first()
        )
        hotel = Hotel.objects.create(
            name=hotel_name,
            legal_name=f"{hotel_name} Limited",
            business_type=Hotel.BUSINESS_TYPE_SINGLE,
            registration_number="UG-HOTEL-2026-001",
            tax_identification_number="TIN-100026001",
            email="reservations@kampalhotel.ug",
            phone="+256 312 555 100",
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
            name=f"{hotel_name} Main Property",
            branch_code="KLA-MAIN",
            branch_type=Branch.BRANCH_TYPE_MAIN,
            location="Kampala, Uganda",
            physical_address="Kampala, Uganda",
            city="Kampala",
            country="Uganda",
            contact_person=created_by.get_full_name() or created_by.username,
            contact=created_by.phone,
            email="operations@kampalagrandhotel.ug",
            is_head_office=True,
            is_active=True,
            created_by=created_by,
        )

        department_specs = {
            "Administration": "Hotel leadership, governance and administration.",
            "Finance & Accounts": "Financial control, accounts payable and reporting.",
            "Procurement": "Supplier sourcing, quotations and purchasing.",
            "Stores": "Inventory custody, receiving and internal issues.",
            "Kitchen": "Food production and kitchen operations.",
            "Food & Beverage": "Restaurant, bar and guest beverage service.",
            "Housekeeping": "Rooms, laundry and cleaning operations.",
            "Hotel Operations": "Cross-functional property operations.",
        }
        departments = {
            name: Department.objects.create(
                name=name,
                description=description,
                is_active=True,
                created_by=created_by,
            )
            for name, description in department_specs.items()
        }
        employees = self._rebuild_employee_profiles(
            branch=branch,
            departments=departments,
            employee_snapshot=employee_snapshot,
            created_by=created_by,
        )

        stores = {
            "Main Store": StoreLocation.objects.create(
                branch=branch,
                name="Main Store",
                address="Ground-floor receiving and central stores",
                is_default=True,
                is_active=True,
                created_by=created_by,
            ),
            "Kitchen Store": StoreLocation.objects.create(
                branch=branch,
                name="Kitchen Store",
                address="Kitchen dry-goods store",
                is_default=False,
                is_active=True,
                created_by=created_by,
            ),
            "Housekeeping Store": StoreLocation.objects.create(
                branch=branch,
                name="Housekeeping Store",
                address="Housekeeping and laundry store",
                is_default=False,
                is_active=True,
                created_by=created_by,
            ),
        }
        for employee in employees.values():
            if employee.user.groups.filter(name="Store Keeper").exists():
                StoreKeeperAssignment.objects.create(
                    store=stores["Main Store"],
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
        self._create_opening_balances_and_reorder_rules(
            items=items,
            suppliers=suppliers,
            store=stores["Main Store"],
            created_by=created_by,
        )

        for name, description in (
            ("Cash", "Cash received at the hotel."),
            ("MTN Mobile Money", "Guest and supplier mobile-money payments."),
            ("Visa / Mastercard", "Card payments processed at the hotel."),
            ("Bank Transfer", "Controlled bank payments to suppliers."),
        ):
            PaymentMethod.objects.create(
                name=name,
                description=description,
                is_active=True,
                is_default=name == "Cash",
                created_by=created_by,
            )
        for name, description in (
            ("Food supplies", "Kitchen food and beverage inputs."),
            ("Housekeeping supplies", "Cleaning, laundry and room supplies."),
            ("Office supplies", "Stationery and administrative consumables."),
            ("Repairs and maintenance", "Property repairs and maintenance services."),
        ):
            ExpenseCategory.objects.create(
                name=name,
                description=description,
                created_by=created_by,
            )

        return {
            "hotel": hotel,
            "branch": branch,
            "departments": departments,
            "employees": employees,
            "stores": stores,
            "suppliers": suppliers,
            "units": units,
            "categories": categories,
            "items": items,
            "conversions": conversions,
            "catalogue": catalogue,
        }

    def _rebuild_employee_profiles(
        self, branch, departments, employee_snapshot, created_by
    ):
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
                is_active=user.is_active,
                created_by=created_by,
            )
            employees[user.username] = employee
        return employees

    @staticmethod
    def _department_for_account(departments, previous_name, role_name):
        for name, department in departments.items():
            if name.casefold() == str(previous_name).casefold():
                return department
        canonical_role = ROLE_ALIASES.get(role_name, role_name)
        role_departments = {
            "Cost Controller": "Finance & Accounts",
            "Financial Manager": "Finance & Accounts",
            "Procurement Manager": "Procurement",
            "Store Keeper": "Stores",
            "Receiving Clerk": "Stores",
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
                "name": "Mugisha Agro & Food Supplies Ltd",
                "email": "mugishawarid@gmail.com",
                "phone": "+256 772 410 101",
                "address": "Kalerwe Market, Kampala",
                "contact_person": "Warid Mugisha",
                "payment_terms": "Net 14",
                "tin_number": "1000003101",
                "registration_number": "8003101",
                "notes": "Fresh produce, dairy, cooking oil and dry-food supplies.",
            },
            {
                "name": "KJ Hospitality Supplies Ltd",
                "email": "kjapher32@gmail.com",
                "phone": "+256 701 320 232",
                "address": "Ntinda Industrial Area, Kampala",
                "contact_person": "Japheth Kato",
                "payment_terms": "Net 30",
                "tin_number": "1000003102",
                "registration_number": "8003102",
                "notes": "Housekeeping chemicals, guest consumables, beverages and stationery.",
            },
            {
                "name": "Kampala Institutional Traders Ltd",
                "email": "wmugisha@kcca.go.ug",
                "phone": "+256 414 660 303",
                "address": "Nakasero, Kampala",
                "contact_person": "William Mugisha",
                "payment_terms": "Net 30",
                "tin_number": "1000003103",
                "registration_number": "8003103",
                "notes": "General institutional food, beverage and hotel operating supplies.",
            },
        )
        return {
            spec["email"]: Supplier.objects.create(**spec, created_by=created_by)
            for spec in specs
        }

    @staticmethod
    def _create_units(created_by):
        specs = (
            ("Kilogram", "kg"),
            ("Litre", "L"),
            ("Bottle", "btl"),
            ("Roll", "roll"),
            ("Ream", "ream"),
            ("Sack", "sack"),
            ("Crate", "crate"),
            ("Carton", "ctn"),
            ("Jerrycan", "jcan"),
            ("Bale", "bale"),
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
        food = Category.objects.create(
            name="Food & Beverage",
            code="FNB",
            description="Kitchen ingredients and saleable beverages.",
            created_by=created_by,
        )
        housekeeping = Category.objects.create(
            name="Housekeeping Supplies",
            code="HKS",
            description="Cleaning, laundry and room-operating supplies.",
            created_by=created_by,
        )
        stationery = Category.objects.create(
            name="Stationery",
            code="STA",
            description="Office and administrative consumables.",
            created_by=created_by,
        )
        return {
            "Dry Goods": Category.objects.create(
                name="Dry Goods", code="DRY", parent=food, created_by=created_by
            ),
            "Fresh Produce": Category.objects.create(
                name="Fresh Produce", code="FRE", parent=food, created_by=created_by
            ),
            "Beverages": Category.objects.create(
                name="Beverages", code="BEV", parent=food, created_by=created_by
            ),
            "Housekeeping Supplies": housekeeping,
            "Stationery": stationery,
        }

    @staticmethod
    def _create_items_and_conversions(categories, units, created_by):
        specs = (
            ("KGH-RICE-25", "Long Grain Rice", "Dry Goods", "Kilogram", "Sack", "25", "80", "250", ItemBusinessType.CONSUMABLE_EXPENSE),
            ("KGH-TOMATO", "Fresh Tomatoes", "Fresh Produce", "Kilogram", "Crate", "20", "30", "120", ItemBusinessType.CONSUMABLE_EXPENSE),
            ("KGH-MILK-1L", "Fresh Whole Milk 1L", "Beverages", "Bottle", "Crate", "12", "36", "144", ItemBusinessType.CONSUMABLE_EXPENSE),
            ("KGH-WATER-500", "Mineral Water 500ml", "Beverages", "Bottle", "Carton", "24", "96", "480", ItemBusinessType.RESALE_REVENUE),
            ("KGH-DETERGENT", "Laundry Detergent", "Housekeeping Supplies", "Litre", "Jerrycan", "5", "20", "80", ItemBusinessType.CONSUMABLE_EXPENSE),
            ("KGH-TISSUE", "Toilet Tissue Roll", "Housekeeping Supplies", "Roll", "Bale", "48", "96", "480", ItemBusinessType.CONSUMABLE_EXPENSE),
            ("KGH-BEER-500", "Local Beer 500ml", "Beverages", "Bottle", "Crate", "24", "72", "360", ItemBusinessType.RESALE_REVENUE),
            ("KGH-PAPER-A4", "A4 Printing Paper", "Stationery", "Ream", "Carton", "5", "10", "50", ItemBusinessType.CONSUMABLE_EXPENSE),
            ("KGH-OIL-20", "Vegetable Cooking Oil", "Dry Goods", "Litre", "Jerrycan", "20", "40", "160", ItemBusinessType.CONSUMABLE_EXPENSE),
        )
        items = {}
        conversions = {}
        for sku, name, category, base_unit, purchase_unit, factor, reorder, maximum, business_type in specs:
            item = Item.objects.create(
                category=categories[category],
                name=name,
                sku=sku,
                unit=units[base_unit].abbreviation,
                base_unit=units[base_unit],
                reorder_level=Decimal(reorder),
                maximum_level=Decimal(maximum),
                business_type=business_type,
                is_active=True,
                created_by=created_by,
            )
            conversion = ItemUnitPrice(
                item=item,
                unit=units[purchase_unit],
                conversion_factor=Decimal(factor),
                role=ArticleUnitRole.PURCHASE,
                is_active=True,
                created_by=created_by,
            )
            conversion.full_clean()
            conversion.save()
            items[sku] = item
            conversions[sku] = conversion
        return items, conversions

    @staticmethod
    def _create_supplier_catalogue(suppliers, items, units, created_by):
        valid_until = timezone.localdate() + timedelta(days=90)
        specs = (
            ("mugishawarid@gmail.com", "KGH-RICE-25", "Sack", "155000", True, "MUG-RICE-25"),
            ("wmugisha@kcca.go.ug", "KGH-RICE-25", "Sack", "160000", False, "KIT-RICE-25"),
            ("mugishawarid@gmail.com", "KGH-TOMATO", "Crate", "70000", True, "MUG-TOMATO-20"),
            ("mugishawarid@gmail.com", "KGH-MILK-1L", "Crate", "48000", True, "MUG-MILK-12"),
            ("kjapher32@gmail.com", "KGH-WATER-500", "Carton", "32000", False, "KJ-WATER-24"),
            ("wmugisha@kcca.go.ug", "KGH-WATER-500", "Carton", "30000", True, "KIT-WATER-24"),
            ("kjapher32@gmail.com", "KGH-DETERGENT", "Jerrycan", "65000", True, "KJ-DETERGENT-5"),
            ("kjapher32@gmail.com", "KGH-TISSUE", "Bale", "110000", True, "KJ-TISSUE-48"),
            ("wmugisha@kcca.go.ug", "KGH-BEER-500", "Crate", "84000", True, "KIT-BEER-24"),
            ("kjapher32@gmail.com", "KGH-PAPER-A4", "Carton", "95000", True, "KJ-A4-5"),
            ("mugishawarid@gmail.com", "KGH-OIL-20", "Jerrycan", "145000", True, "MUG-OIL-20"),
        )
        catalogue = []
        for email, sku, unit_name, price, preferred, supplier_sku in specs:
            entry = SupplierItemPrice(
                supplier=suppliers[email],
                item=items[sku],
                unit=units[unit_name],
                supplier_sku=supplier_sku,
                unit_price=Decimal(price),
                minimum_order_quantity=Decimal("1"),
                lead_time_days=2 if email == "mugishawarid@gmail.com" else 3,
                is_preferred=preferred,
                effective_from=timezone.localdate(),
                quotation_reference=f"QTN-{supplier_sku}-2026",
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
    def _create_opening_balances_and_reorder_rules(
        items, suppliers, store, created_by
    ):
        opening_quantities = {
            "KGH-RICE-25": "150",
            "KGH-TOMATO": "50",
            "KGH-MILK-1L": "72",
            "KGH-WATER-500": "240",
            "KGH-DETERGENT": "30",
            "KGH-TISSUE": "192",
            "KGH-BEER-500": "144",
            "KGH-PAPER-A4": "25",
            "KGH-OIL-20": "80",
        }
        preferred_by_item = {
            "KGH-RICE-25": "mugishawarid@gmail.com",
            "KGH-TOMATO": "mugishawarid@gmail.com",
            "KGH-MILK-1L": "mugishawarid@gmail.com",
            "KGH-WATER-500": "wmugisha@kcca.go.ug",
            "KGH-DETERGENT": "kjapher32@gmail.com",
            "KGH-TISSUE": "kjapher32@gmail.com",
            "KGH-BEER-500": "wmugisha@kcca.go.ug",
            "KGH-PAPER-A4": "kjapher32@gmail.com",
            "KGH-OIL-20": "mugishawarid@gmail.com",
        }
        for sku, item in items.items():
            InventoryBalance.objects.create(
                item=item,
                store=store,
                quantity_in_stock=Decimal(opening_quantities[sku]),
                reorder_level=item.reorder_level,
                created_by=created_by,
            )
            ReorderRule.objects.create(
                item=item,
                store=store,
                minimum_level=item.reorder_level,
                reorder_quantity=max(item.reorder_level, Decimal("1")),
                preferred_supplier=suppliers[preferred_by_item[sku]],
                is_active=True,
                created_by=created_by,
            )

    @staticmethod
    def _verify_result(User, expected_passwords, expected_account_count, seeded):
        if User.objects.count() != expected_account_count:
            raise CommandError("Account verification failed; the transaction will be rolled back.")
        for username, password_hash in expected_passwords.items():
            if User.objects.get(username=username).password != password_hash:
                raise CommandError(
                    f"Password preservation failed for {username}; the transaction will be rolled back."
                )
        if Supplier.objects.count() != 3:
            raise CommandError("Supplier verification failed; the transaction will be rolled back.")
        expected_emails = {
            "mugishawarid@gmail.com",
            "kjapher32@gmail.com",
            "wmugisha@kcca.go.ug",
        }
        if set(Supplier.objects.values_list("email", flat=True)) != expected_emails:
            raise CommandError("Supplier email verification failed; the transaction will be rolled back.")
        if Item.objects.count() != 9 or ItemUnitPrice.objects.count() != 9:
            raise CommandError("Article/UOM verification failed; the transaction will be rolled back.")
        if SupplierItemPrice.objects.count() != 11:
            raise CommandError("Supplier catalogue verification failed; the transaction will be rolled back.")
        # Use the related managers for a backend-agnostic verification of the two
        # deliberately competitive catalogue articles.
        for sku in ("KGH-RICE-25", "KGH-WATER-500"):
            if seeded["items"][sku].supplier_prices.count() != 2:
                raise CommandError(
                    f"Multiple-supplier verification failed for {sku}; the transaction will be rolled back."
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
