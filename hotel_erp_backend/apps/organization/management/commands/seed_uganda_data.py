import datetime
import os
import uuid
from decimal import Decimal
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group

from apps.organization.models import Hotel
from apps.departments.models import Branch, Department
from apps.employees.models import Designation, Employee
from apps.vendors.models import Supplier
from apps.customers.models import Customer, CustomerLedger, Payment, PaymentAllocation
from apps.inventory.models import (
    Category, UnitOfMeasure, Item, ItemUnitPrice, StoreLocation,
    InventoryBalance, SupplierItemPrice, StockLedger, InventoryBatch,
    StockTransfer, StockTransferItem, StockAdjustment, StockAdjustmentItem,
    ReorderRule, StoreRequisition, StoreRequisitionItem, StockIssue, StockIssueItem,
    StoreReturn, StoreReturnItem, StockCount, StockCountItem
)
from apps.finance.models import (
    PaymentMethod, CashFlow, DailyCashSummary, BankAccount, BankTransaction,
    ExpenseCategory, Expense
)
from apps.sales.models import Sale, SaleItem
from apps.notifications.models import Notification
from apps.audit_logs.models import AuditLog
from apps.approvals.models import ApprovalWorkflow

from core.constants.choices import ItemBusinessType, LedgerReferenceType

User = get_user_model()


class Command(BaseCommand):
    help = "Seed an empty database with realistic Ugandan hotel demo data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--hotel-name",
            default=os.environ.get("SEED_HOTEL_NAME", "Demo Hotel"),
            help="Name used for the sample hotel (default: Demo Hotel).",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete existing application data before recreating the demo data.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        hotel_name = options["hotel_name"].strip()
        if not hotel_name:
            raise CommandError("--hotel-name cannot be empty.")

        sample_password = os.environ.get("SEED_EMPLOYEE_PASSWORD", "").strip()
        if sample_password and len(sample_password) < 12:
            raise CommandError("SEED_EMPLOYEE_PASSWORD must contain at least 12 characters.")

        has_application_data = any(
            (
                Hotel.objects.exists(),
                Branch.objects.exists(),
                Department.objects.exists(),
                Supplier.objects.exists(),
                Item.objects.exists(),
                Customer.objects.exists(),
                User.objects.filter(is_superuser=False).exists(),
            )
        )
        if has_application_data and not options["reset"]:
            raise CommandError(
                "The database already contains application data; nothing was changed. "
                "Use --reset only if you intentionally want to replace it with demo data."
            )

        if options["reset"]:
            self.stdout.write(
                self.style.WARNING("Reset requested: deleting existing application data...")
            )
        else:
            self.stdout.write("Database is empty; preparing demo data...")

        # Delete all existing data to ensure clean seed
        # Delete reverse dependencies first to prevent PROTECT/CASCADE database errors
        
        # 1. Audit and Notification Logs
        AuditLog.objects.all().delete()
        Notification.objects.all().delete()
        ApprovalWorkflow.objects.all().delete()

        # 2. Sales and customer billing
        SaleItem.objects.all().delete()
        Sale.objects.all().delete()
        PaymentAllocation.objects.all().delete()
        Payment.objects.all().delete()
        CustomerLedger.objects.all().delete()
        Customer.objects.all().delete()

        # 3. Procurement and suppliers
        from apps.procurement.models import (
            PurchaseRequisition, RequisitionItem, VendorQuotation, VendorQuotationItem,
            PurchaseOrder, PurchaseOrderItem, GoodsReceiptNote, GoodsReceiptItem,
            GoodsInspection, GoodsInspectionItem, SupplierReturn, SupplierReturnItem
        )
        SupplierReturnItem.objects.all().delete()
        SupplierReturn.objects.all().delete()
        GoodsInspectionItem.objects.all().delete()
        GoodsInspection.objects.all().delete()
        GoodsReceiptItem.objects.all().delete()
        GoodsReceiptNote.objects.all().delete()
        PurchaseOrderItem.objects.all().delete()
        PurchaseOrder.objects.all().delete()
        VendorQuotationItem.objects.all().delete()
        VendorQuotation.objects.all().delete()
        RequisitionItem.objects.all().delete()
        PurchaseRequisition.objects.all().delete()

        # 4. Inventory operations
        StockCountItem.objects.all().delete()
        StockCount.objects.all().delete()
        StoreReturnItem.objects.all().delete()
        StoreReturn.objects.all().delete()
        StockIssueItem.objects.all().delete()
        StockIssue.objects.all().delete()
        StoreRequisitionItem.objects.all().delete()
        StoreRequisition.objects.all().delete()
        ReorderRule.objects.all().delete()
        StockAdjustmentItem.objects.all().delete()
        StockAdjustment.objects.all().delete()
        StockTransferItem.objects.all().delete()
        StockTransfer.objects.all().delete()
        InventoryBatch.objects.all().delete()
        StockLedger.objects.all().delete()
        SupplierItemPrice.objects.all().delete()
        InventoryBalance.objects.all().delete()
        StoreLocation.objects.all().delete()
        ItemUnitPrice.objects.all().delete()
        Item.objects.all().delete()
        Category.objects.all().delete()
        UnitOfMeasure.objects.all().delete()

        # 5. Finance and accounting
        Expense.objects.all().delete()
        ExpenseCategory.objects.all().delete()
        DailyCashSummary.objects.all().delete()
        CashFlow.objects.all().delete()
        BankTransaction.objects.all().delete()
        BankAccount.objects.all().delete()
        PaymentMethod.objects.all().delete()

        # 6. Employees and Organization
        Employee.objects.all().delete()
        Designation.objects.all().delete()
        Department.objects.all().delete()
        Branch.objects.all().delete()
        Hotel.objects.all().delete()
        Supplier.objects.all().delete()

        # 7. Non-superuser accounts
        User.objects.filter(is_superuser=False).delete()

        if options["reset"]:
            self.stdout.write(self.style.SUCCESS("Existing application data deleted."))

        # Ensure the groups exist before assigning them to the sample employees.
        call_command("setup_hotel_roles", verbosity=0)

        # Set default created_by to a superuser if available
        admin_user = User.objects.filter(is_superuser=True).first()

        # ==========================================
        # 1. CREATE HOTEL
        # ==========================================
        self.stdout.write(f"Creating hotel '{hotel_name}'...")
        hotel = Hotel.objects.create(
            name=hotel_name,
            legal_name=f"{hotel_name} Uganda Limited",
            business_type=Hotel.BUSINESS_TYPE_GROUP,
            registration_number="URSB-80020019283",
            tax_identification_number="1002938475",
            email="info@texthotel.co.ug",
            phone="+256312123456",
            alternate_phone="+256772123456",
            website="https://www.texthotel.co.ug",
            address="Plot 12, Kampala Road",
            city="Kampala",
            country="Uganda",
            currency="UGX",
            timezone="Africa/Kampala",
            is_active=True,
            created_by=admin_user
        )

        # ==========================================
        # 2. CREATE BRANCHES
        # ==========================================
        self.stdout.write("Creating Branches...")
        branch_kampala = Branch.objects.create(
            hotel=hotel,
            name=f"{hotel_name} Kampala",
            branch_code="KLA",
            branch_type=Branch.BRANCH_TYPE_MAIN,
            location="Kampala Road, Kampala",
            physical_address="Plot 12, Kampala Road",
            city="Kampala",
            country="Uganda",
            contact_person="John Okello",
            contact="+256312123456",
            email="kampala@texthotel.co.ug",
            is_head_office=True,
            is_active=True,
            created_by=admin_user
        )

        branch_jinja = Branch.objects.create(
            hotel=hotel,
            name=f"{hotel_name} Jinja",
            branch_code="JJA",
            branch_type=Branch.BRANCH_TYPE_BRANCH,
            location="Nile Crescent, Jinja",
            physical_address="Plot 4, Nile Crescent",
            city="Jinja",
            country="Uganda",
            contact_person="Sarah Mukasa",
            contact="+256312654321",
            email="jinja@texthotel.co.ug",
            is_head_office=False,
            is_active=True,
            created_by=admin_user
        )

        # ==========================================
        # 3. CREATE STORE LOCATIONS
        # ==========================================
        self.stdout.write("Creating Store Locations...")
        store_main = StoreLocation.objects.create(
            branch=branch_kampala,
            name="Main Warehouse",
            address="Kampala Main Building, Basement",
            is_active=True,
            is_default=True,
            created_by=admin_user
        )

        store_kitchen = StoreLocation.objects.create(
            branch=branch_kampala,
            name="F&B Kitchen Store",
            address="Ground Floor Kitchen Annex",
            is_active=True,
            is_default=False,
            created_by=admin_user
        )

        store_jinja = StoreLocation.objects.create(
            branch=branch_jinja,
            name="Jinja Branch Store",
            address="Jinja Branch Office, Room 2",
            is_active=True,
            is_default=False,
            created_by=admin_user
        )

        # ==========================================
        # 4. CREATE DEPARTMENTS
        # ==========================================
        self.stdout.write("Creating Departments...")
        departments_list = [
            "Front Office",
            "Housekeeping",
            "Food & Beverage",
            "Human Resources",
            "Finance & Accounts",
            "Procurement & Stores",
            "Information Technology",
            "Security"
        ]
        departments = {}
        for dept_name in departments_list:
            dept = Department.objects.create(
                name=dept_name,
                description=f"Standard hotel operational department: {dept_name}",
                is_active=True,
                created_by=admin_user
            )
            departments[dept_name] = dept

        # ==========================================
        # 5. CREATE DESIGNATIONS
        # ==========================================
        self.stdout.write("Creating Designations...")
        designation_specs = [
            ("Front Office", "Receptionist", "Welcomes guests and handles check-ins"),
            ("Front Office", "Front Office Manager", "Manages receptionists and bookings"),
            ("Housekeeping", "Room Attendant", "Cleans and prepares guest rooms"),
            ("Housekeeping", "Executive Housekeeper", "Manages housekeeping operations"),
            ("Food & Beverage", "Waiter", "Serves food and beverage to guests"),
            ("Food & Beverage", "Chef", "Prepares food in the kitchen"),
            ("Food & Beverage", "F&B Manager", "Manages restaurant and catering services"),
            ("Human Resources", "HR Officer", "Handles staff recruitment and admin"),
            ("Human Resources", "HR Manager", "Directs human resource strategy"),
            ("Finance & Accounts", "Accountant", "Handles ledger and accounts processing"),
            ("Finance & Accounts", "Finance Manager", "Oversees hotel financial operations"),
            ("Procurement & Stores", "Stores Assistant", "Manages stock issuance and receipt"),
            ("Procurement & Stores", "Procurement Officer", "Liaises with suppliers and handles POs")
        ]
        designations = {}
        for dept_name, title, desc in designation_specs:
            designation = Designation.objects.create(
                department=departments[dept_name],
                title=title,
                description=desc,
                is_active=True,
                created_by=admin_user
            )
            designations[title] = designation

        # ==========================================
        # 6. CREATE EMPLOYEES & USERS
        # ==========================================
        self.stdout.write("Creating Users & Employees...")
        employee_specs = [
            {
                "username": "jokello",
                "first_name": "John",
                "last_name": "Okello",
                "email": "john.okello@texthotel.co.ug",
                "employee_code": "EMP-001",
                "phone": "+256772111222",
                "gender": "Male",
                "address": "Kireka, Kampala",
                "dept": "Human Resources",
                "designation_title": "HR Manager",
                "role_group": "General Manager"
            },
            {
                "username": "smukasa",
                "first_name": "Sarah",
                "last_name": "Mukasa",
                "email": "sarah.mukasa@texthotel.co.ug",
                "employee_code": "EMP-002",
                "phone": "+256701333444",
                "gender": "Female",
                "address": "Ntinda, Kampala",
                "dept": "Finance & Accounts",
                "designation_title": "Finance Manager",
                "role_group": "Finance Controller"
            },
            {
                "username": "pnamara",
                "first_name": "Patricia",
                "last_name": "Namara",
                "email": "patricia.namara@texthotel.co.ug",
                "employee_code": "EMP-003",
                "phone": "+256772555666",
                "gender": "Female",
                "address": "Najjera, Kampala",
                "dept": "Front Office",
                "designation_title": "Receptionist",
                "role_group": "Department Head"
            },
            {
                "username": "anankya",
                "first_name": "Alex",
                "last_name": "Nankya",
                "email": "alex.nankya@texthotel.co.ug",
                "employee_code": "EMP-004",
                "phone": "+256701777888",
                "gender": "Male",
                "address": "Mukono",
                "dept": "Procurement & Stores",
                "designation_title": "Stores Assistant",
                "role_group": "Store Keeper"
            }
        ]

        for emp in employee_specs:
            user = User.objects.create_user(
                username=emp["username"],
                email=emp["email"],
                first_name=emp["first_name"],
                last_name=emp["last_name"],
                employee_code=emp["employee_code"],
                phone=emp["phone"]
            )
            if sample_password:
                user.set_password(sample_password)
            else:
                user.set_unusable_password()
            user.save()

            # Add user to role group if it exists
            if emp["role_group"]:
                group = Group.objects.filter(name=emp["role_group"]).first()
                if group:
                    user.groups.add(group)

            Employee.objects.create(
                user=user,
                department=departments[emp["dept"]],
                branch=branch_kampala,
                designation_record=designations[emp["designation_title"]],
                designation=emp["designation_title"],
                gender=emp["gender"],
                contact=emp["phone"],
                address=emp["address"],
                date_joined=datetime.date(2025, 1, 1),
                is_active=True,
                created_by=admin_user
            )

        # ==========================================
        # 7. CREATE PAYMENT METHODS & BANK ACCOUNTS
        # ==========================================
        self.stdout.write("Creating Finance records...")
        pm_cash = PaymentMethod.objects.create(
            name="Cash",
            description="Physical cash payments",
            is_active=True,
            is_default=True,
            created_by=admin_user
        )
        pm_momo = PaymentMethod.objects.create(
            name="MTN Mobile Money",
            description="MTN MoMo payments (+256...)",
            is_active=True,
            is_default=False,
            created_by=admin_user
        )
        pm_airtel = PaymentMethod.objects.create(
            name="Airtel Money",
            description="Airtel Money payments (+256...)",
            is_active=True,
            is_default=False,
            created_by=admin_user
        )
        pm_eft = PaymentMethod.objects.create(
            name="Bank Transfer (EFT)",
            description="Electronic Funds Transfer directly to Stanbic/Centenary",
            is_active=True,
            is_default=False,
            created_by=admin_user
        )
        pm_card = PaymentMethod.objects.create(
            name="Visa/Mastercard",
            description="Card swipe payments via POS terminal",
            is_active=True,
            is_default=False,
            created_by=admin_user
        )

        bank_stanbic = BankAccount.objects.create(
            name="Main Operating Account",
            account_number="9030012345678",
            bank_name="Stanbic Bank Uganda",
            opening_balance=Decimal("10000000.00"),
            is_active=True,
            note="Primary business operations account, Kampala Branch",
            created_by=admin_user
        )

        bank_centenary = BankAccount.objects.create(
            name="Centenary Collection Account",
            account_number="3100045678901",
            bank_name="Centenary Bank",
            opening_balance=Decimal("5000000.00"),
            is_active=True,
            note="Secondary collections account",
            created_by=admin_user
        )

        # ==========================================
        # 8. CREATE EXPENSE CATEGORIES
        # ==========================================
        self.stdout.write("Creating Expense Categories...")
        expense_cats = [
            ("Utility Bills", "Water, electricity, internet, and phone bills"),
            ("Food Ingredients & Supplies", "Kitchen inputs, meat, vegetables, dairy, and spices"),
            ("Staff Wages", "Salaries and casual labor payouts"),
            ("Maintenance & Repairs", "Plumbing, electrical fixing, and building paint touch ups")
        ]
        for name, desc in expense_cats:
            ExpenseCategory.objects.create(
                name=name,
                description=desc,
                created_by=admin_user
            )

        # ==========================================
        # 9. CREATE SUPPLIERS
        # ==========================================
        self.stdout.write("Creating Suppliers...")
        supplier_mukwano = Supplier.objects.create(
            name="Mukwano Industries Uganda",
            email="orders@mukwano.com",
            phone="+256312200000",
            address="Plot 88, Port Bell Road, Kampala",
            contact_person="Mubarak Kirunda",
            payment_terms="Net 30",
            tin_number="1001020304",
            registration_number="URSB-100200",
            is_active=True,
            notes="Suppliers of soaps, detergent, vegetable oil, and plastics.",
            created_by=admin_user
        )

        supplier_kakira = Supplier.objects.create(
            name="Kakira Sugar Works",
            email="sales@kakirasugar.com",
            phone="+256332444000",
            address="Kakira, Jinja",
            contact_person="Rao Kumar",
            payment_terms="Net 15",
            tin_number="1002030405",
            registration_number="URSB-100300",
            is_active=True,
            notes="Primary supplier of premium white sugar.",
            created_by=admin_user
        )

        supplier_nile = Supplier.objects.create(
            name="Nile Breweries Limited",
            email="info@nilebrew.com",
            phone="+256332100100",
            address="Plot 9, Port Bell Road, Kampala",
            contact_person="Agnes Atwine",
            payment_terms="Cash on Delivery",
            tin_number="1003040506",
            registration_number="URSB-100400",
            is_active=True,
            notes="Supplier of Nile Special beer, Club beer, and Eagle lager.",
            created_by=admin_user
        )

        supplier_fresh = Supplier.objects.create(
            name="Fresh Dairy Uganda",
            email="logistics@freshdairy.co.ug",
            phone="+256312400400",
            address="Plot 10, Lubogo Road, Kampala",
            contact_person="Moses Mwesigwa",
            payment_terms="Net 7",
            tin_number="1004050607",
            registration_number="URSB-100500",
            is_active=True,
            notes="Suppliers of fresh milk, yoghurt, butter, and cheese.",
            created_by=admin_user
        )

        # ==========================================
        # 10. CREATE INVENTORY CATEGORIES & UOMs
        # ==========================================
        self.stdout.write("Creating Inventory Categories and UOMs...")
        cat_bev = Category.objects.create(name="Beverages", description="Soft drinks, water, beer, spirits, juices", created_by=admin_user)
        cat_dry = Category.objects.create(name="Dry Foods", description="Sugar, flour, rice, salt, baking powder", created_by=admin_user)
        cat_hsk = Category.objects.create(name="Housekeeping Supplies", description="Cleaning liquids, soap, toilet paper, mops", created_by=admin_user)
        cat_amen = Category.objects.create(name="Guest Amenities", description="Shampoo, toothbrushes, shower caps, slippers", created_by=admin_user)
        cat_stat = Category.objects.create(name="Stationery", description="A4 papers, books, files, staplers, pens", created_by=admin_user)

        uom_pcs = UnitOfMeasure.objects.create(name="Pieces", abbreviation="pcs", is_active=True, created_by=admin_user)
        uom_liters = UnitOfMeasure.objects.create(name="Liters", abbreviation="L", is_active=True, created_by=admin_user)
        uom_kgs = UnitOfMeasure.objects.create(name="Kilograms", abbreviation="kg", is_active=True, created_by=admin_user)
        uom_crate = UnitOfMeasure.objects.create(name="Crates", abbreviation="crate", is_active=True, created_by=admin_user)
        uom_carton = UnitOfMeasure.objects.create(name="Cartons", abbreviation="carton", is_active=True, created_by=admin_user)

        # ==========================================
        # 11. CREATE ITEMS
        # ==========================================
        self.stdout.write("Creating Items...")
        
        item_water = Item.objects.create(
            category=cat_bev,
            name="Rwenzori Mineral Water 500ml",
            brand="Rwenzori",
            description="Uganda's premium drinking mineral water.",
            unit="pcs",
            base_unit=uom_pcs,
            reorder_level=Decimal("100.00"),
            business_type=ItemBusinessType.RESALE_REVENUE,
            is_active=True,
            created_by=admin_user
        )

        item_cola = Item.objects.create(
            category=cat_bev,
            name="Coca Cola Soda 300ml",
            brand="Coca Cola",
            description="Classic carbonated soft drink.",
            unit="pcs",
            base_unit=uom_pcs,
            reorder_level=Decimal("150.00"),
            business_type=ItemBusinessType.RESALE_REVENUE,
            is_active=True,
            created_by=admin_user
        )

        item_beer = Item.objects.create(
            category=cat_bev,
            name="Nile Special Beer 500ml",
            brand="Nile Breweries",
            description="Award-winning Ugandan lager.",
            unit="pcs",
            base_unit=uom_pcs,
            reorder_level=Decimal("50.00"),
            business_type=ItemBusinessType.RESALE_REVENUE,
            is_active=True,
            created_by=admin_user
        )

        item_sugar = Item.objects.create(
            category=cat_dry,
            name="Kakira White Sugar 1kg",
            brand="Kakira",
            description="High-quality white sugar from Jinja.",
            unit="kg",
            base_unit=uom_kgs,
            reorder_level=Decimal("20.00"),
            business_type=ItemBusinessType.CONSUMABLE_EXPENSE,
            is_active=True,
            created_by=admin_user
        )

        item_soap = Item.objects.create(
            category=cat_hsk,
            name="Mukwano Liquid Hand Soap 5L",
            brand="Mukwano",
            description="Antibacterial hand wash soap.",
            unit="L",
            base_unit=uom_liters,
            reorder_level=Decimal("5.00"),
            business_type=ItemBusinessType.CONSUMABLE_EXPENSE,
            is_active=True,
            created_by=admin_user
        )

        item_paper = Item.objects.create(
            category=cat_stat,
            name="A4 Printing Paper Ream",
            brand="Double A",
            description="Standard 80gsm white printing paper ream.",
            unit="pcs",
            base_unit=uom_pcs,
            reorder_level=Decimal("10.00"),
            business_type=ItemBusinessType.CONSUMABLE_EXPENSE,
            is_active=True,
            created_by=admin_user
        )

        # ==========================================
        # 12. CREATE ITEM UNIT PRICES (SELLING PRICES)
        # ==========================================
        self.stdout.write("Creating Item Unit Prices...")
        ItemUnitPrice.objects.create(
            item=item_water,
            unit=uom_pcs,
            conversion_factor=Decimal("1.0000"),
            selling_price=Decimal("1500.00"),
            is_active=True,
            created_by=admin_user
        )

        ItemUnitPrice.objects.create(
            item=item_cola,
            unit=uom_pcs,
            conversion_factor=Decimal("1.0000"),
            selling_price=Decimal("2000.00"),
            is_active=True,
            created_by=admin_user
        )

        ItemUnitPrice.objects.create(
            item=item_beer,
            unit=uom_pcs,
            conversion_factor=Decimal("1.0000"),
            selling_price=Decimal("5000.00"),
            is_active=True,
            created_by=admin_user
        )

        # ==========================================
        # 13. CREATE SUPPLIER ITEM PRICES
        # ==========================================
        self.stdout.write("Creating Supplier Item Prices...")
        SupplierItemPrice.objects.create(
            supplier=supplier_mukwano,
            item=item_soap,
            unit=uom_liters,
            unit_price=Decimal("18000.00"),
            lead_time_days=2,
            is_active=True,
            created_by=admin_user
        )

        SupplierItemPrice.objects.create(
            supplier=supplier_kakira,
            item=item_sugar,
            unit=uom_kgs,
            unit_price=Decimal("3500.00"),
            lead_time_days=3,
            is_active=True,
            created_by=admin_user
        )

        SupplierItemPrice.objects.create(
            supplier=supplier_nile,
            item=item_beer,
            unit=uom_pcs,
            unit_price=Decimal("3200.00"),
            lead_time_days=1,
            is_active=True,
            created_by=admin_user
        )

        # ==========================================
        # 14. CREATE INVENTORY BALANCES & STOCK LEDGERS
        # ==========================================
        self.stdout.write("Creating Inventory Balances...")
        balances = [
            (item_water, store_main, Decimal("250.00"), Decimal("100.00")),
            (item_cola, store_main, Decimal("180.00"), Decimal("150.00")),
            (item_beer, store_main, Decimal("120.00"), Decimal("50.00")),
            (item_sugar, store_kitchen, Decimal("50.00"), Decimal("20.00")),
            (item_soap, store_main, Decimal("15.00"), Decimal("5.00")),
        ]

        for item, store, qty, reorder in balances:
            # Create Balance record
            InventoryBalance.objects.create(
                item=item,
                store=store,
                quantity_in_stock=qty,
                reorder_level=reorder,
                created_by=admin_user
            )

            # Create Stock Ledger Entry for initial stock
            StockLedger.objects.create(
                item=item,
                store=store,
                quantity_in=qty,
                quantity_out=Decimal("0.00"),
                reference_type=LedgerReferenceType.STOCK_ADJUSTMENT,
                reference_id=uuid.uuid4(),
                note="Initial database seed stock.",
                created_by=admin_user
            )

        # ==========================================
        # 15. CREATE CUSTOMERS
        # ==========================================
        self.stdout.write("Creating Customers...")
        Customer.objects.create(
            name="Uganda Wildlife Authority",
            company="UWA",
            email="info@uwa.go.ug",
            phone="+256414355000",
            address="Plot 7 Kira Road, Kampala",
            balance=Decimal("0.00"),
            is_active=True,
            notes="Regular corporate guest bookings for park guides & board meetings.",
            created_by=admin_user
        )

        Customer.objects.create(
            name="MTN Uganda Limited",
            company="MTN Uganda",
            email="business@mtn.co.ug",
            phone="+256772123100",
            address="MTN Towers, Hannington Road, Kampala",
            balance=Decimal("0.00"),
            is_active=True,
            notes="Corporate partner for employee retreats and conferences.",
            created_by=admin_user
        )

        Customer.objects.create(
            name="Dr. Fred Kigozi",
            company="",
            email="fkigozi@gmail.com",
            phone="+256772555666",
            address="Kololo, Kampala",
            balance=Decimal("0.00"),
            is_active=True,
            notes="Frequent individual diner and spa guest.",
            created_by=admin_user
        )

        Customer.objects.create(
            name="Ms. Florence Nakato",
            company="",
            email="fnakato@yahoo.com",
            phone="+256701888999",
            address="Entebbe",
            balance=Decimal("0.00"),
            is_active=True,
            notes="VIP client, books weekend getaways.",
            created_by=admin_user
        )

        password_note = (
            "Sample employee logins use SEED_EMPLOYEE_PASSWORD."
            if sample_password
            else "Sample employee password logins are disabled."
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Demo data for '{hotel_name}' created successfully. {password_note}"
            )
        )
