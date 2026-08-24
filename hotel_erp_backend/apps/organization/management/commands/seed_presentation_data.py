import os
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.approvals.models import ApprovalMatrixRule
from apps.audit_logs.models import AuditLog
from apps.customers.models import Customer
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.finance.models import (
    BankAccount,
    BankTransaction,
    CashFlow,
    DailyCashSummary,
    Expense,
    ExpenseCategory,
    PaymentMethod,
    SupplierInvoice,
    SupplierInvoiceItem,
    SupplierPayment,
)
from apps.inventory.models import (
    InventoryBalance,
    Item,
    ReorderRule,
    StockAdjustment,
    StockAdjustmentItem,
    StockCount,
    StockIssue,
    StockIssueItem,
    StockTransfer,
    StockTransferItem,
    StoreLocation,
    StoreKeeperAssignment,
    StoreRequisition,
    StoreRequisitionItem,
    StoreReturn,
    StoreReturnItem,
    SupplierItemPrice,
    UnitOfMeasure,
)
from apps.notifications.models import Notification
from apps.organization.models import Hotel
from apps.procurement.models import (
    GoodsInspection,
    GoodsInspectionItem,
    GoodsReceiptItem,
    GoodsReceiptNote,
    ProcurementCommunication,
    PurchaseRequisition,
    RequisitionItem,
    SupplierReturn,
    SupplierReturnItem,
    VendorQuotation,
    VendorQuotationItem,
)
from apps.sales.models import Sale, SaleItem
from apps.vendors.models import Supplier
from core.constants.choices import BankTransactionType, CashFlowType


MARKER_ACTION = "presentation_seed_complete"
DEFAULT_HOTEL_NAME = "Pearl of Africa Grand Hotel"


class Command(BaseCommand):
    help = (
        "Create a coherent, presentation-ready Uganda hotel dataset, including "
        "procure-to-pay, stores, finance, sales, notifications, and audit history."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--hotel-name",
            default=os.environ.get("SEED_HOTEL_NAME", DEFAULT_HOTEL_NAME),
            help=f"Demo property name (default: {DEFAULT_HOTEL_NAME}).",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Replace existing application data before creating the presentation dataset.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        hotel_name = options["hotel_name"].strip()
        if not hotel_name:
            raise CommandError("--hotel-name cannot be empty.")

        sample_password = os.environ.get("SEED_EMPLOYEE_PASSWORD", "").strip()
        if sample_password and len(sample_password) < 12:
            raise CommandError("SEED_EMPLOYEE_PASSWORD must contain at least 12 characters.")

        if AuditLog.objects.filter(action=MARKER_ACTION).exists() and not options["reset"]:
            self.stdout.write(
                self.style.SUCCESS(
                    "Presentation data already exists; no duplicate records were created."
                )
            )
            self.summary()
            return

        if Hotel.objects.exists() and not options["reset"]:
            raise CommandError(
                "The database already contains hotel data; nothing was changed. "
                "Use --reset only if replacing the current data is intentional."
            )

        call_command(
            "seed_uganda_data",
            hotel_name=hotel_name,
            reset=options["reset"],
            verbosity=0,
        )
        call_command("setup_hotel_roles", verbosity=0)

        self.stdout.write("Building presentation workflows...")
        admin = get_user_model().objects.filter(is_superuser=True).first()
        context = self.get_context()
        employees = self.create_employees(
            branch=context["kampala_branch"],
            departments=context["departments"],
            sample_password=sample_password,
            created_by=admin,
        )
        for store in StoreLocation.objects.filter(branch=context["kampala_branch"], is_active=True):
            StoreKeeperAssignment.objects.create(
                store=store,
                employee=employees["stores"],
                created_by=admin,
            )
        suppliers = self.create_suppliers(admin)
        self.create_supplier_prices(context, suppliers, admin)
        self.create_approval_matrix(employees, admin)

        procurement = self.create_procure_to_pay(
            context=context,
            employees=employees,
            suppliers=suppliers,
            created_by=admin,
        )
        pending_requisition = self.create_pending_approval(
            context=context,
            employees=employees,
            created_by=admin,
        )
        stores = self.create_stores_workflows(
            context=context,
            employees=employees,
            suppliers=suppliers,
            created_by=admin,
        )
        sales = self.create_sales_and_finance(
            context=context,
            employees=employees,
            procurement=procurement,
            created_by=admin,
        )
        self.create_notifications_and_audit(
            employees=employees,
            procurement=procurement,
            pending_requisition=pending_requisition,
            stores=stores,
            sales=sales,
            created_by=admin,
        )

        password_note = (
            "Role-based users use SEED_EMPLOYEE_PASSWORD."
            if sample_password
            else "Role-based password logins remain disabled; use the existing superuser."
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Presentation data for '{hotel_name}' created successfully. {password_note}"
            )
        )
        self.summary()

    def get_context(self):
        departments = {department.name: department for department in Department.objects.all()}
        return {
            "hotel": Hotel.objects.get(),
            "kampala_branch": Branch.objects.get(branch_code="KLA"),
            "jinja_branch": Branch.objects.get(branch_code="JJA"),
            "main_store": StoreLocation.objects.get(name="Main Warehouse"),
            "kitchen_store": StoreLocation.objects.get(name="F&B Kitchen Store"),
            "jinja_store": StoreLocation.objects.get(name="Jinja Branch Store"),
            "departments": departments,
            "soap": Item.objects.get(name="Mukwano Liquid Hand Soap 5L"),
            "paper": Item.objects.get(name="A4 Printing Paper Ream"),
            "sugar": Item.objects.get(name="Kakira White Sugar 1kg"),
            "water": Item.objects.get(name="Rwenzori Mineral Water 500ml"),
            "cola": Item.objects.get(name="Coca Cola Soda 300ml"),
            "beer": Item.objects.get(name="Nile Special Beer 500ml"),
            "pieces": UnitOfMeasure.objects.get(abbreviation="pcs"),
            "litres": UnitOfMeasure.objects.get(abbreviation="L"),
            "kilograms": UnitOfMeasure.objects.get(abbreviation="kg"),
        }

    def create_employees(self, *, branch, departments, sample_password, created_by):
        specs = {
            "manager": (
                "grace.generalmanager",
                "Grace",
                "Nakato",
                "UG-HQ-101",
                "Human Resources",
                "General Manager",
                "General Manager",
                "+256 772 410 101",
            ),
            "procurement": (
                "daniel.procurementmanager",
                "Daniel",
                "Okello",
                "UG-HQ-102",
                "Procurement & Stores",
                "Procurement Manager",
                "Procurement Manager",
                "+256 701 410 102",
            ),
            "finance": (
                "ruth.financialmanager",
                "Ruth",
                "Namusoke",
                "UG-HQ-103",
                "Finance & Accounts",
                "Financial Manager",
                "Financial Manager",
                "+256 772 410 103",
            ),
            "stores": (
                "samuel.storekeeper",
                "Samuel",
                "Kato",
                "UG-HQ-104",
                "Procurement & Stores",
                "Store Keeper",
                "Store Keeper",
                "+256 701 410 104",
            ),
            "receiving": (
                "mercy.receivingclerk",
                "Mercy",
                "Akello",
                "UG-HQ-105",
                "Procurement & Stores",
                "Receiving Clerk",
                "Receiving Clerk",
                "+256 772 410 105",
            ),
            "cost_controller": (
                "alice.costcontroller",
                "Alice",
                "Nakato",
                "UG-HQ-110",
                "Finance & Accounts",
                "Cost Controller",
                "Cost Controller",
                "+256 701 410 110",
            ),
            "housekeeping": (
                "esther.requester",
                "Esther",
                "Nambasa",
                "UG-HQ-106",
                "Housekeeping",
                "Room Attendant",
                "Requester",
                "+256 701 410 106",
            ),
            "housekeeping_head": (
                "rebecca.departmenthead",
                "Rebecca",
                "Nansubuga",
                "UG-HQ-111",
                "Housekeeping",
                "Executive Housekeeper",
                "Department Head",
                "+256 772 410 111",
            ),
            "food_beverage": (
                "ivan.mugisha",
                "Ivan",
                "Mugisha",
                "UG-HQ-107",
                "Food & Beverage",
                "Food and Beverage Manager",
                None,
                "+256 772 410 107",
            ),
            "front_office": (
                "joan.namara",
                "Joan",
                "Namara",
                "UG-HQ-108",
                "Front Office",
                "Front Office Supervisor",
                None,
                "+256 701 410 108",
            ),
            "auditor": (
                "peter.atuhaire",
                "Peter",
                "Atuhaire",
                "UG-HQ-109",
                "Finance & Accounts",
                "Internal Auditor",
                None,
                "+256 772 410 109",
            ),
        }

        employees = {}
        user_model = get_user_model()
        for key, spec in specs.items():
            (
                username,
                first_name,
                last_name,
                employee_code,
                department_name,
                designation,
                role,
                phone,
            ) = spec
            user = user_model.objects.create_user(
                username=username,
                first_name=first_name,
                last_name=last_name,
                employee_code=employee_code,
                email=f"{username}@demo.pearlgrand.ug",
                phone=phone,
                is_active=True,
            )
            if sample_password:
                user.set_password(sample_password)
            else:
                user.set_unusable_password()
            user.save(update_fields=["password"])
            user.groups.set([Group.objects.get(name=role)] if role else [])

            employees[key] = Employee.objects.create(
                user=user,
                department=departments[department_name],
                branch=branch,
                designation=designation,
                gender="Female" if key in {"manager", "finance", "receiving", "housekeeping", "housekeeping_head", "front_office"} else "Male",
                contact=phone,
                address="Kampala, Uganda",
                date_joined=timezone.localdate() - timedelta(days=420),
                is_active=True,
                created_by=created_by,
            )
        return employees

    def create_suppliers(self, created_by):
        specs = (
            (
                "Kampala Hospitality Supplies Ltd",
                "sales@kampalahospitality.demo.ug",
                "+256 414 555 210",
                "Plot 18, 5th Street, Industrial Area, Kampala",
                "Amina Nansubuga",
                "Net 30",
                "1009002101",
                "8002002101",
            ),
            (
                "Pearl Hospitality Traders Uganda",
                "orders@pearltraders.demo.ug",
                "+256 393 555 340",
                "Ntinda Industrial Park, Kampala",
                "Moses Byaruhanga",
                "Net 21",
                "1009002102",
                "8002002102",
            ),
        )
        created = {}
        for name, email, phone, address, contact, terms, tin, registration in specs:
            created[name] = Supplier.objects.create(
                name=name,
                email=email,
                phone=phone,
                address=address,
                contact_person=contact,
                payment_terms=terms,
                tin_number=tin,
                registration_number=registration,
                is_active=True,
                notes="Presentation supplier record using realistic Ugandan commercial terms.",
                created_by=created_by,
            )
        created["Mukwano Industries Uganda"] = Supplier.objects.get(
            name="Mukwano Industries Uganda"
        )
        return created

    def create_supplier_prices(self, context, suppliers, created_by):
        prices = (
            (
                suppliers["Kampala Hospitality Supplies Ltd"],
                context["soap"],
                context["litres"],
                "17500.00",
                2,
            ),
            (
                suppliers["Kampala Hospitality Supplies Ltd"],
                context["paper"],
                context["pieces"],
                "21500.00",
                2,
            ),
            (
                suppliers["Pearl Hospitality Traders Uganda"],
                context["soap"],
                context["litres"],
                "17000.00",
                4,
            ),
            (
                suppliers["Pearl Hospitality Traders Uganda"],
                context["paper"],
                context["pieces"],
                "23500.00",
                3,
            ),
            (
                suppliers["Mukwano Industries Uganda"],
                context["paper"],
                context["pieces"],
                "22000.00",
                3,
            ),
        )
        for supplier, item, unit, unit_price, lead_time in prices:
            SupplierItemPrice.objects.update_or_create(
                supplier=supplier,
                item=item,
                unit=unit,
                defaults={
                    "unit_price": Decimal(unit_price),
                    "lead_time_days": lead_time,
                    "is_active": True,
                    "created_by": created_by,
                },
            )

    def create_approval_matrix(self, employees, created_by):
        stages = (
            (
                1,
                "Procurement review",
                ApprovalMatrixRule.ASSIGNMENT_FIXED_EMPLOYEE,
                employees["procurement"],
            ),
            (
                2,
                "Financial Manager review",
                ApprovalMatrixRule.ASSIGNMENT_FIXED_EMPLOYEE,
                employees["finance"],
            ),
            (
                3,
                "General Manager approval",
                ApprovalMatrixRule.ASSIGNMENT_FIXED_EMPLOYEE,
                employees["manager"],
            ),
        )
        for stage, stage_name, assignment_type, approver in stages:
            ApprovalMatrixRule.objects.update_or_create(
                document_type=ApprovalMatrixRule.DOCUMENT_PURCHASE_REQUISITION,
                branch=None,
                department=None,
                minimum_amount=Decimal("0.00"),
                stage=stage,
                defaults={
                    "name": f"Hotel purchase approval stage {stage}",
                    "stage_name": stage_name,
                    "assignment_type": assignment_type,
                    "approver": approver,
                    "approver_role": None,
                    "maximum_amount": None,
                    "is_active": True,
                    "created_by": created_by,
                },
            )
        for stage, stage_name, approver in (
            (1, "Finance LPO review", employees["finance"]),
            (2, "General Manager LPO approval", employees["manager"]),
        ):
            ApprovalMatrixRule.objects.update_or_create(
                document_type=ApprovalMatrixRule.DOCUMENT_PURCHASE_ORDER,
                branch=None,
                department=None,
                minimum_amount=Decimal("0.00"),
                stage=stage,
                defaults={
                    "name": f"Hotel LPO approval stage {stage}",
                    "stage_name": stage_name,
                    "assignment_type": ApprovalMatrixRule.ASSIGNMENT_FIXED_EMPLOYEE,
                    "approver": approver,
                    "approver_role": None,
                    "maximum_amount": None,
                    "is_active": True,
                    "created_by": created_by,
                },
            )

    def create_procure_to_pay(self, *, context, employees, suppliers, created_by):
        today = timezone.localdate()
        selected_supplier = suppliers["Kampala Hospitality Supplies Ltd"]
        requisition = PurchaseRequisition.objects.create(
            request_type="department",
            requester=employees["housekeeping"],
            department=context["departments"]["Housekeeping"],
            preferred_supplier=selected_supplier,
            reason=(
                "Replenish housekeeping and administration supplies ahead of the "
                "Kampala corporate conference week."
            ),
            expected_date=today + timedelta(days=4),
            control_notes="Budget confirmed under Rooms Division operating supplies.",
            created_by=employees["housekeeping"].user,
        )
        lines = {
            "soap": RequisitionItem.objects.create(
                requisition=requisition,
                item=context["soap"],
                quantity=Decimal("20.00"),
                estimated_unit_cost=Decimal("18000.00"),
                created_by=employees["housekeeping"].user,
            ),
            "paper": RequisitionItem.objects.create(
                requisition=requisition,
                item=context["paper"],
                quantity=Decimal("12.00"),
                estimated_unit_cost=Decimal("22000.00"),
                created_by=employees["housekeeping"].user,
            ),
        }
        requisition.submit()
        for step in requisition.approval_workflow.order_by("stage"):
            step.approve(
                comments=(
                    "Reviewed against conference occupancy forecast and approved "
                    f"at {step.stage_name.lower()}."
                )
            )
        requisition.refresh_from_db()

        quotation_specs = (
            (
                selected_supplier,
                Decimal("17500.00"),
                Decimal("21500.00"),
                2,
                True,
                "Best evaluated combination of price, delivery time, and local stock availability.",
            ),
            (
                suppliers["Pearl Hospitality Traders Uganda"],
                Decimal("17000.00"),
                Decimal("23500.00"),
                4,
                False,
                "",
            ),
            (
                suppliers["Mukwano Industries Uganda"],
                Decimal("18000.00"),
                Decimal("22000.00"),
                3,
                False,
                "",
            ),
        )
        quotations = []
        for supplier, soap_price, paper_price, delivery_days, selected, reason in quotation_specs:
            quotation = VendorQuotation.objects.create(
                requisition=requisition,
                supplier=supplier,
                payment_terms=supplier.payment_terms,
                delivery_date=today + timedelta(days=delivery_days),
                valid_until=today + timedelta(days=14),
                evaluation_score=Decimal("92.00") if selected else Decimal("84.00"),
                evaluation_notes=(
                    reason
                    or "Commercially compliant quotation retained for comparison."
                ),
                created_by=employees["procurement"].user,
            )
            VendorQuotationItem.objects.create(
                quotation=quotation,
                requisition_item=lines["soap"],
                unit=context["litres"],
                quantity=Decimal("20.00"),
                unit_price=soap_price,
                delivery_days=delivery_days,
                selected=selected,
                selection_reason=reason,
                created_by=employees["procurement"].user,
            )
            VendorQuotationItem.objects.create(
                quotation=quotation,
                requisition_item=lines["paper"],
                unit=context["pieces"],
                quantity=Decimal("12.00"),
                unit_price=paper_price,
                delivery_days=delivery_days,
                selected=selected,
                selection_reason=reason,
                created_by=employees["procurement"].user,
            )
            quotations.append(quotation)

        order = requisition.create_purchase_order(
            supplier=selected_supplier,
            ordered_by=employees["procurement"],
            store=context["main_store"],
            expected_date=today + timedelta(days=2),
            note="Deliver to the Kampala main receiving bay between 08:00 and 15:00.",
            created_by=employees["procurement"].user,
        )
        order.submit_for_approval()
        for approval in order.approval_workflow.order_by("stage"):
            approval.approve(decided_by=approval.approver.user)
        order.refresh_from_db()
        order.issue(
            sent_by=employees["procurement"],
            sent_to_email=selected_supplier.email,
        )
        order.acknowledge(acknowledged_by=selected_supplier.contact_person)
        ProcurementCommunication.objects.create(
            purchase_order=order,
            supplier=selected_supplier,
            recipient=selected_supplier.email,
            subject=f"Local Purchase Order {order.po_number}",
            status="sent",
            sent_at=timezone.now(),
            created_by=employees["procurement"].user,
        )

        receipt = GoodsReceiptNote.objects.create(
            purchase_order=order,
            received_by=employees["receiving"],
            delivery_note_no="KHS-DN-24071",
            note="Delivery received at Kampala main store; packaging intact.",
            created_by=employees["receiving"].user,
        )
        receipt_lines = []
        for order_line in order.items.select_related("item"):
            receipt_lines.append(
                GoodsReceiptItem.objects.create(
                    goods_receipt=receipt,
                    purchase_order_item=order_line,
                    store=context["main_store"],
                    quantity_received=order_line.quantity,
                    unit_cost=order_line.unit_cost,
                    created_by=employees["receiving"].user,
                )
            )
        inspection = GoodsInspection.objects.create(
            goods_receipt=receipt,
            inspected_by=employees["receiving"],
            delivery_note_no=receipt.delivery_note_no,
            remarks="Quantities, seals, and product specifications verified.",
            created_by=employees["receiving"].user,
        )
        for receipt_line in receipt_lines:
            GoodsInspectionItem.objects.create(
                inspection=inspection,
                goods_receipt_item=receipt_line,
                quantity_received=receipt_line.base_quantity,
                quantity_accepted=receipt_line.base_quantity,
                quantity_rejected=Decimal("0.00"),
                created_by=employees["receiving"].user,
            )
        receipt.post_to_inventory(posted_by=employees["receiving"])
        order.refresh_from_db()
        order.update_total_amount()

        invoice = SupplierInvoice.objects.create(
            supplier=selected_supplier,
            purchase_order=order,
            invoice_number="KHS-INV-2026-0714",
            invoice_date=today,
            due_date=today + timedelta(days=30),
            subtotal=order.total_amount,
            tax_amount=(order.total_amount * Decimal("0.18")).quantize(Decimal("0.01")),
            created_by=employees["finance"].user,
        )
        for order_line in order.items.select_related("item", "unit"):
            SupplierInvoiceItem.objects.create(
                invoice=invoice,
                purchase_order_item=order_line,
                unit=order_line.unit,
                quantity=order_line.quantity,
                unit_price=order_line.unit_cost,
                created_by=employees["finance"].user,
            )
        invoice.perform_three_way_match()
        invoice.approve_for_payment(approved_by=employees["manager"].user)
        payment_method = PaymentMethod.objects.get(name="Bank Transfer (EFT)")
        bank = BankAccount.objects.get(name="Main Operating Account")
        payment = SupplierPayment.objects.create(
            invoice=invoice,
            amount=invoice.balance_due,
            payment_method=payment_method,
            bank_account=bank,
            reference="STANBIC-EFT-260714-8841",
            note="Approved supplier settlement following successful three-way match.",
            created_by=employees["finance"].user,
        )
        payment.post(posted_by=employees["manager"].user)

        CashFlow.objects.create(
            store=context["main_store"],
            amount=payment.amount,
            transaction_type=CashFlowType.OUTFLOW,
            reference=payment.reference,
            payment_method=payment_method,
            note=f"Supplier settlement for {order.po_number}",
            created_by=employees["finance"].user,
        )
        BankTransaction.objects.create(
            bank_account=bank,
            store=context["main_store"],
            amount=payment.amount,
            transaction_type=BankTransactionType.WITHDRAWAL,
            reference=payment.reference,
            note=f"Payment of {invoice.invoice_number}",
            created_by=employees["finance"].user,
        )

        paper_receipt = next(line for line in receipt_lines if line.item_id == context["paper"].id)
        supplier_return = SupplierReturn.objects.create(
            supplier=selected_supplier,
            goods_receipt=receipt,
            store=context["main_store"],
            returned_by=employees["receiving"],
            reason="One ream developed moisture damage after receiving; supplier accepted a credit return.",
            created_by=employees["receiving"].user,
        )
        SupplierReturnItem.objects.create(
            supplier_return=supplier_return,
            item=paper_receipt.item,
            unit=context["pieces"],
            quantity=Decimal("1.00"),
            reason="Moisture-damaged packaging.",
            created_by=employees["receiving"].user,
        )
        supplier_return.apply_inventory_changes(dispatched_by=employees["receiving"])
        supplier_return.acknowledge(
            acknowledged_by=selected_supplier.contact_person,
            credit_note_number="KHS-CN-2026-0098",
        )

        return {
            "requisition": requisition,
            "order": order,
            "receipt": receipt,
            "invoice": invoice,
            "payment": payment,
            "supplier_return": supplier_return,
            "quotations": quotations,
        }

    def create_pending_approval(self, *, context, employees, created_by):
        requisition = PurchaseRequisition.objects.create(
            request_type="department",
            requester=employees["food_beverage"],
            department=context["departments"]["Food & Beverage"],
            preferred_supplier=Supplier.objects.get(name="Kakira Sugar Works"),
            reason=(
                "Dry-goods replenishment for the weekend conference buffet and "
                "breakfast service."
            ),
            expected_date=timezone.localdate() + timedelta(days=5),
            created_by=employees["food_beverage"].user,
        )
        RequisitionItem.objects.create(
            requisition=requisition,
            item=context["sugar"],
            quantity=Decimal("40.00"),
            estimated_unit_cost=Decimal("3500.00"),
            created_by=employees["food_beverage"].user,
        )
        requisition.submit()
        first_step = requisition.approval_workflow.order_by("stage").first()
        first_step.approve(
            comments="Department requirement confirmed against the banquet event order."
        )
        requisition.refresh_from_db()
        return requisition

    def create_stores_workflows(self, *, context, employees, suppliers, created_by):
        department = context["departments"]["Housekeeping"]
        request = StoreRequisition.objects.create(
            department=department,
            store=context["main_store"],
            requested_by=employees["housekeeping"],
            required_date=timezone.localdate(),
            purpose="Daily room turnover supplies for occupied Kampala rooms.",
            created_by=employees["housekeeping"].user,
        )
        soap_line = StoreRequisitionItem.objects.create(
            requisition=request,
            item=context["soap"],
            unit=context["litres"],
            quantity_requested=Decimal("4.00"),
            remarks="Issue to the housekeeping floor pantry.",
            created_by=employees["housekeeping"].user,
        )
        paper_line = StoreRequisitionItem.objects.create(
            requisition=request,
            item=context["paper"],
            unit=context["pieces"],
            quantity_requested=Decimal("2.00"),
            remarks="Administration desk printing requirement.",
            created_by=employees["housekeeping"].user,
        )
        request.submit(actor=employees["housekeeping"].user)
        request.approve_department(
            approved_by=employees["housekeeping_head"],
            comments="Housekeeping requirement confirmed.",
        )
        request.approve(
            approved_by=employees["stores"],
            comments="Stock availability confirmed and reserved.",
        )
        issue = StockIssue.objects.create(
            requisition=request,
            store=context["main_store"],
            issued_by=employees["stores"],
            received_by=employees["housekeeping"],
            received_by_name=str(employees["housekeeping"]),
            note="Issued against approved housekeeping requisition.",
            created_by=employees["stores"].user,
        )
        StockIssueItem.objects.create(
            issue=issue,
            requisition_item=soap_line,
            unit=context["litres"],
            quantity=Decimal("4.00"),
            created_by=employees["stores"].user,
        )
        StockIssueItem.objects.create(
            issue=issue,
            requisition_item=paper_line,
            unit=context["pieces"],
            quantity=Decimal("2.00"),
            created_by=employees["stores"].user,
        )
        issue.apply_inventory_changes()

        store_return = StoreReturn.objects.create(
            department=department,
            store=context["main_store"],
            received_by=employees["stores"],
            reason="Unused sealed soap returned after conference room allocation changed.",
            created_by=employees["stores"].user,
        )
        StoreReturnItem.objects.create(
            store_return=store_return,
            item=context["soap"],
            unit=context["litres"],
            quantity=Decimal("0.50"),
            condition_note="Sealed and suitable for reissue.",
            created_by=employees["stores"].user,
        )
        store_return.apply_inventory_changes()

        transfer = StockTransfer.objects.create(
            from_store=context["main_store"],
            to_store=context["jinja_store"],
            requested_by=employees["stores"],
            required_date=timezone.localdate() + timedelta(days=1),
            note="Rebalance bottled-water stock for the Jinja weekend occupancy forecast.",
            created_by=employees["stores"].user,
        )
        StockTransferItem.objects.create(
            stock_transfer=transfer,
            item=context["water"],
            unit=context["pieces"],
            quantity=Decimal("24.00"),
            created_by=employees["stores"].user,
        )
        transfer.approve(approved_by=employees["manager"])
        transfer.dispatch(dispatched_by=employees["stores"])
        transfer.receive(received_by=employees["stores"])

        adjustment = StockAdjustment.objects.create(
            store=context["jinja_store"],
            reference="ADJ-JJA-2026-004",
            reason="Two bottles found in a sealed overflow carton during shelf reconciliation.",
            note="Positive adjustment verified by the Store Keeper.",
            created_by=employees["stores"].user,
        )
        StockAdjustmentItem.objects.create(
            stock_adjustment=adjustment,
            item=context["water"],
            unit=context["pieces"],
            quantity_change=Decimal("2.00"),
            unit_cost=Decimal("900.00"),
            reason=adjustment.reason,
            created_by=employees["stores"].user,
        )
        adjustment.submit()
        adjustment.approve(approved_by=employees["manager"])
        adjustment.apply()

        count = StockCount.objects.create(
            store=context["jinja_store"],
            conducted_by=employees["stores"],
            note="Month-end cycle count for the Jinja branch store.",
            created_by=employees["stores"].user,
        )
        count.populate_from_system_balances()
        water_count = count.items.filter(item=context["water"]).first()
        if water_count and water_count.system_quantity > 0:
            water_count.physical_quantity = water_count.system_quantity - Decimal("1.00")
            water_count.note = "One bottle recorded as staff refreshment during late shift."
            water_count.save(update_fields=["physical_quantity", "note", "updated_at"])
        count.submit()
        count.approve(approved_by=employees["manager"])
        count.apply_variances()

        reorder_rule = ReorderRule.objects.create(
            item=context["paper"],
            store=context["main_store"],
            minimum_level=Decimal("15.00"),
            reorder_quantity=Decimal("30.00"),
            preferred_supplier=suppliers["Kampala Hospitality Supplies Ltd"],
            is_active=True,
            created_by=employees["stores"].user,
        )

        return {
            "request": request,
            "issue": issue,
            "return": store_return,
            "transfer": transfer,
            "adjustment": adjustment,
            "count": count,
            "reorder_rule": reorder_rule,
        }

    def create_sales_and_finance(self, *, context, employees, procurement, created_by):
        mtn = Customer.objects.get(company="MTN Uganda")
        uwa = Customer.objects.get(company="UWA")
        mobile_money = PaymentMethod.objects.get(name="MTN Mobile Money")
        card = PaymentMethod.objects.get(name="Visa/Mastercard")

        corporate_sale = Sale.objects.create(
            customer=mtn,
            store=context["main_store"],
            recorded_by=employees["front_office"],
            payment_method=mobile_money,
            note="Conference refreshment package billed to the MTN Uganda event account.",
            created_by=employees["front_office"].user,
        )
        SaleItem.objects.create(
            sale=corporate_sale,
            item=context["water"],
            unit=context["pieces"],
            quantity=Decimal("20.00"),
            unit_price=Decimal("1500.00"),
            created_by=employees["front_office"].user,
        )
        SaleItem.objects.create(
            sale=corporate_sale,
            item=context["cola"],
            unit=context["pieces"],
            quantity=Decimal("24.00"),
            unit_price=Decimal("2000.00"),
            created_by=employees["front_office"].user,
        )
        corporate_sale.refresh_from_db()
        corporate_sale.amount_paid = corporate_sale.total_amount
        corporate_sale.save()
        corporate_sale.complete_sale()

        account_sale = Sale.objects.create(
            customer=uwa,
            store=context["main_store"],
            recorded_by=employees["front_office"],
            payment_method=card,
            note="Board dinner beverage service; balance remains on the approved corporate account.",
            created_by=employees["front_office"].user,
        )
        SaleItem.objects.create(
            sale=account_sale,
            item=context["beer"],
            unit=context["pieces"],
            quantity=Decimal("10.00"),
            unit_price=Decimal("5000.00"),
            created_by=employees["front_office"].user,
        )
        account_sale.refresh_from_db()
        account_sale.amount_paid = Decimal("30000.00")
        account_sale.save()
        account_sale.complete_sale()

        utility_category = ExpenseCategory.objects.get(name="Utility Bills")
        eft = PaymentMethod.objects.get(name="Bank Transfer (EFT)")
        utility_flow = CashFlow.objects.create(
            store=context["main_store"],
            amount=Decimal("850000.00"),
            transaction_type=CashFlowType.OUTFLOW,
            reference="UMEME-2607-44821",
            payment_method=eft,
            note="Monthly Kampala property electricity settlement.",
            created_by=employees["finance"].user,
        )
        utility_expense = Expense.objects.create(
            store=context["main_store"],
            category=utility_category,
            amount=Decimal("850000.00"),
            description="Kampala property electricity bill for the current operating month.",
            reference="UMEME-2607-44821",
            related_cashflow=utility_flow,
            payment_method=eft,
            created_by=employees["finance"].user,
        )
        bank = BankAccount.objects.get(name="Main Operating Account")
        BankTransaction.objects.create(
            bank_account=bank,
            store=context["main_store"],
            amount=utility_expense.amount,
            transaction_type=BankTransactionType.WITHDRAWAL,
            related_cashflow=utility_flow,
            reference=utility_expense.reference,
            note=utility_expense.description,
            created_by=employees["finance"].user,
        )
        sales_inflow = corporate_sale.amount_paid + account_sale.amount_paid
        BankTransaction.objects.create(
            bank_account=bank,
            store=context["main_store"],
            amount=sales_inflow,
            transaction_type=BankTransactionType.DEPOSIT,
            reference="DAILY-CARD-MOMO-SETTLEMENT",
            note="Daily settlement of card and mobile-money hotel sales.",
            created_by=employees["finance"].user,
        )

        opening = Decimal("5000000.00")
        calculated = (
            opening
            + sales_inflow
            - utility_expense.amount
            - procurement["payment"].amount
        )
        DailyCashSummary.objects.create(
            store=context["main_store"],
            date=timezone.localdate(),
            opening_balance=opening,
            calculated_balance=calculated,
            closing_balance=calculated,
            note="Daily cashier and finance reconciliation completed with no variance.",
            created_by=employees["finance"].user,
        )

        return {
            "corporate_sale": corporate_sale,
            "account_sale": account_sale,
            "utility_expense": utility_expense,
        }

    def create_notifications_and_audit(
        self,
        *,
        employees,
        procurement,
        pending_requisition,
        stores,
        sales,
        created_by,
    ):
        notifications = (
            (
                employees["procurement"],
                "Purchase requisition awaiting review",
                (
                    f"{pending_requisition} for Food & Beverage has completed department "
                    "review and is ready for procurement review."
                ),
                False,
            ),
            (
                employees["stores"],
                "A4 paper is below its reorder minimum",
                "Kampala Main Warehouse has reached the configured paper reorder threshold.",
                False,
            ),
            (
                employees["finance"],
                "Supplier invoice paid",
                (
                    f"{procurement['invoice'].invoice_number} passed three-way matching "
                    f"and was settled under {procurement['payment'].reference}."
                ),
                True,
            ),
            (
                employees["manager"],
                "Jinja stock count completed",
                f"{stores['count']} was approved and its verified variance was posted.",
                True,
            ),
        )
        for employee, title, message, is_read in notifications:
            Notification.objects.create(
                employee=employee,
                title=title,
                message=message,
                is_read=is_read,
                created_by=created_by,
            )

        audit_entries = (
            (
                employees["housekeeping"].user,
                "approved",
                "PurchaseRequisition",
                procurement["requisition"].id,
                {"reason": procurement["requisition"].reason},
            ),
            (
                employees["procurement"].user,
                "issued",
                "PurchaseOrder",
                procurement["order"].id,
                {"po_number": procurement["order"].po_number},
            ),
            (
                employees["receiving"].user,
                "posted",
                "GoodsReceiptNote",
                procurement["receipt"].id,
                {"grn_number": procurement["receipt"].grn_number},
            ),
            (
                employees["stores"].user,
                "completed",
                "StockTransfer",
                stores["transfer"].id,
                {"route": "Kampala Main Warehouse to Jinja Branch Store"},
            ),
            (
                employees["front_office"].user,
                "completed",
                "Sale",
                sales["corporate_sale"].id,
                {"receipt_no": sales["corporate_sale"].receipt_no},
            ),
        )
        for actor, action, entity_type, entity_id, metadata in audit_entries:
            AuditLog.objects.create(
                actor=actor,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                metadata=metadata,
                ip_address="127.0.0.1",
                created_by=created_by,
            )

        AuditLog.objects.create(
            actor=created_by,
            action=MARKER_ACTION,
            entity_type="PresentationDataset",
            metadata={
                "hotel": Hotel.objects.get().name,
                "scope": [
                    "organization",
                    "role-based staff",
                    "procure-to-pay",
                    "stores",
                    "inventory",
                    "sales",
                    "finance",
                    "notifications",
                    "audit",
                ],
            },
            ip_address="127.0.0.1",
            created_by=created_by,
        )

    def summary(self):
        self.stdout.write(f"Hotels: {Hotel.objects.count()}")
        self.stdout.write(f"Branches: {Branch.objects.count()}")
        self.stdout.write(f"Employees: {Employee.objects.count()}")
        self.stdout.write(f"Suppliers: {Supplier.objects.count()}")
        self.stdout.write(f"Articles: {Item.objects.count()}")
        self.stdout.write(f"Purchase requisitions: {PurchaseRequisition.objects.count()}")
        self.stdout.write(f"Supplier quotations: {VendorQuotation.objects.count()}")
        self.stdout.write(f"Supplier invoices: {SupplierInvoice.objects.count()}")
        self.stdout.write(f"Store requisitions: {StoreRequisition.objects.count()}")
        self.stdout.write(f"Sales: {Sale.objects.count()}")
        self.stdout.write(f"Notifications: {Notification.objects.count()}")
