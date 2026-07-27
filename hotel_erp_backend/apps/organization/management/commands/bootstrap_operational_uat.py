from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.approvals.models import ApprovalMatrixRule
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.finance.models import BankAccount, PaymentMethod, SupplierInvoice, SupplierPayment
from apps.inventory.models import (
    InventoryBalance,
    StockAdjustment,
    StockAdjustmentItem,
    StockCount,
    StockIssue,
    StockIssueItem,
    StockTransfer,
    StockTransferItem,
    StoreLocation,
    StoreRequisition,
    StoreRequisitionItem,
    StoreReturn,
    StoreReturnItem,
)
from apps.procurement.models import (
    GoodsInspection,
    GoodsInspectionItem,
    GoodsReceiptItem,
    GoodsReceiptNote,
    PurchaseRequisition,
    RequisitionItem,
    VendorQuotation,
    VendorQuotationItem,
)


UAT_PASSWORD = "UatOnly-2026!"
MARKER = "[UAT-E2E-2026]"


class Command(BaseCommand):
    help = "Create an idempotent UAT role matrix and exercise procure-to-pay and stores workflows."

    @transaction.atomic
    def handle(self, *args, **options):
        call_command("setup_hotel_roles", verbosity=0)
        branch = Branch.objects.filter(name__icontains="Kampala").first() or Branch.objects.first()
        destination_branch = Branch.objects.exclude(pk=getattr(branch, "pk", None)).first() or branch
        department = Department.objects.filter(name__icontains="Procurement").first() or Department.objects.first()
        if not branch or not department:
            raise CommandError("Create at least one branch and department before bootstrapping UAT.")

        employees = {
            "head": self.employee("uat-department-head", "UAT", "Department Head", branch, department, "Department Head"),
            "procurement": self.employee("uat-procurement", "UAT", "Procurement Manager", branch, department, "Procurement Manager"),
            "finance": self.employee("uat-finance", "UAT", "Finance Controller", branch, department, "Finance Controller"),
            "manager": self.employee("uat-general-manager", "UAT", "General Manager", branch, department, "General Manager"),
            "stores": self.employee("uat-stores-manager", "UAT", "Stores Manager", branch, department, "Stores Manager"),
            "receiving": self.employee("uat-receiving", "UAT", "Receiving Officer", branch, department, "Receiving Officer"),
            "auditor": self.employee("uat-auditor", "UAT", "Auditor", branch, department, "Auditor"),
        }
        self.approval_matrix(employees)

        if PurchaseRequisition.objects.filter(reason=MARKER).exists():
            self.stdout.write(self.style.WARNING("UAT workflow records already exist; role configuration refreshed only."))
            self.summary()
            return

        source_store = StoreLocation.objects.filter(branch=branch).first()
        destination_store = StoreLocation.objects.filter(branch=destination_branch).first()
        if not source_store or not destination_store:
            raise CommandError("Both UAT branches require at least one store.")
        balance = (
            InventoryBalance.objects.filter(store=source_store, quantity_in_stock__gte=Decimal("10.00"))
            .select_related("item")
            .first()
        )
        if not balance:
            raise CommandError("The source store needs an Article balance of at least 10 units.")
        item = balance.item
        supplier_price = item.supplier_prices.filter(is_active=True).select_related("supplier", "unit").first()
        if not supplier_price:
            raise CommandError(f"Attach {item} to an active supplier before bootstrapping UAT.")

        requisition = PurchaseRequisition.objects.create(
            request_type="department",
            requester=employees["head"],
            department=department,
            preferred_supplier=supplier_price.supplier,
            reason=MARKER,
            expected_date=timezone.localdate(),
            created_by=employees["head"].user,
        )
        req_line = RequisitionItem.objects.create(
            requisition=requisition,
            item=item,
            quantity=Decimal("2.00"),
            estimated_unit_cost=supplier_price.unit_price,
            created_by=employees["head"].user,
        )
        requisition.submit()
        for step in requisition.approval_workflow.order_by("stage"):
            step.approve(comments=f"{MARKER} stage validated")
        requisition.refresh_from_db()

        quotation = VendorQuotation.objects.create(
            requisition=requisition,
            supplier=supplier_price.supplier,
            created_by=employees["procurement"].user,
        )
        VendorQuotationItem.objects.create(
            quotation=quotation,
            requisition_item=req_line,
            unit=supplier_price.unit,
            quantity=Decimal("2.00"),
            unit_price=supplier_price.unit_price,
            delivery_days=max(supplier_price.lead_time_days, 1),
            selected=True,
            selection_reason=f"{MARKER} evaluated winner",
            created_by=employees["procurement"].user,
        )
        order = requisition.create_purchase_order(
            supplier=supplier_price.supplier,
            ordered_by=employees["procurement"],
            store=source_store,
            note=MARKER,
            created_by=employees["procurement"].user,
        )
        order.issue(sent_by=employees["procurement"], sent_to_email=supplier_price.supplier.email)

        receipt = GoodsReceiptNote.objects.create(
            purchase_order=order,
            received_by=employees["receiving"],
            note=MARKER,
            created_by=employees["receiving"].user,
        )
        order_line = order.items.get()
        receipt_line = GoodsReceiptItem.objects.create(
            goods_receipt=receipt,
            purchase_order_item=order_line,
            store=source_store,
            quantity_received=order_line.quantity,
            unit_cost=order_line.unit_cost,
            created_by=employees["receiving"].user,
        )
        inspection = GoodsInspection.objects.create(
            goods_receipt=receipt,
            inspected_by=employees["receiving"],
            delivery_note_no="UAT-DN-001",
            remarks=MARKER,
            created_by=employees["receiving"].user,
        )
        GoodsInspectionItem.objects.create(
            inspection=inspection,
            goods_receipt_item=receipt_line,
            quantity_received=receipt_line.base_quantity,
            quantity_accepted=receipt_line.base_quantity,
            quantity_rejected=Decimal("0.00"),
            created_by=employees["receiving"].user,
        )
        receipt.post_to_inventory()

        invoice = SupplierInvoice.objects.create(
            supplier=supplier_price.supplier,
            purchase_order=order,
            invoice_number="UAT-INV-001",
            invoice_date=timezone.localdate(),
            due_date=timezone.localdate(),
            subtotal=receipt_line.base_quantity * receipt_line.unit_cost,
            tax_amount=Decimal("0.00"),
            created_by=employees["finance"].user,
        )
        invoice.perform_three_way_match()
        invoice.approve_for_payment()
        method, _ = PaymentMethod.objects.get_or_create(
            name="UAT Bank Transfer",
            defaults={"description": MARKER, "is_active": True},
        )
        bank, _ = BankAccount.objects.get_or_create(
            account_number="UAT-0001",
            defaults={"name": "UAT Operating Account", "bank_name": "UAT Bank", "is_active": True},
        )
        payment = SupplierPayment.objects.create(
            invoice=invoice,
            amount=invoice.balance_due,
            payment_method=method,
            bank_account=bank,
            reference="UAT-PAY-001",
            note=MARKER,
            created_by=employees["finance"].user,
        )
        payment.post()

        self.stores_flow(employees, department, source_store, destination_store, item)
        self.stdout.write(self.style.SUCCESS("Operational UAT workflow created successfully."))
        self.summary()

    def employee(self, username, first_name, last_name, branch, department, role):
        user_model = get_user_model()
        user, created = user_model.objects.get_or_create(
            username=username,
            defaults={
                "first_name": first_name,
                "last_name": last_name,
                "employee_code": username.upper(),
                "email": f"{username}@example.invalid",
                "is_active": True,
            },
        )
        if created or not user.has_usable_password():
            user.set_password(UAT_PASSWORD)
        user.is_active = True
        user.save()
        group = Group.objects.get(name=role)
        user.groups.set([group])
        employee, _ = Employee.objects.update_or_create(
            user=user,
            defaults={
                "branch": branch,
                "department": department,
                "designation": role,
                "is_active": True,
            },
        )
        return employee

    def approval_matrix(self, employees):
        stages = (
            (1, "Department approval", employees["head"]),
            (2, "Procurement approval", employees["procurement"]),
            (3, "Finance approval", employees["finance"]),
            (4, "General Manager approval", employees["manager"]),
        )
        for stage, stage_name, approver in stages:
            ApprovalMatrixRule.objects.update_or_create(
                document_type=ApprovalMatrixRule.DOCUMENT_PURCHASE_REQUISITION,
                branch=None,
                department=None,
                minimum_amount=Decimal("0.00"),
                stage=stage,
                defaults={
                    "name": f"UAT purchase approval stage {stage}",
                    "stage_name": stage_name,
                    "approver": approver,
                    "maximum_amount": None,
                    "is_active": True,
                },
            )

    def stores_flow(self, employees, department, source, destination, item):
        request = StoreRequisition.objects.create(
            department=department,
            store=source,
            requested_by=employees["head"],
            purpose=MARKER,
            created_by=employees["head"].user,
        )
        request_line = StoreRequisitionItem.objects.create(
            requisition=request,
            item=item,
            quantity_requested=Decimal("2.00"),
            created_by=employees["head"].user,
        )
        request.submit()
        request.approve(approved_by=employees["stores"])
        issue = StockIssue.objects.create(
            requisition=request,
            store=source,
            issued_by=employees["stores"],
            received_by=employees["head"],
            received_by_name=str(employees["head"]),
            note=MARKER,
            created_by=employees["stores"].user,
        )
        StockIssueItem.objects.create(
            issue=issue,
            requisition_item=request_line,
            quantity=Decimal("2.00"),
            created_by=employees["stores"].user,
        )
        issue.apply_inventory_changes()

        department_return = StoreReturn.objects.create(
            department=department,
            store=source,
            received_by=employees["stores"],
            reason=MARKER,
            created_by=employees["stores"].user,
        )
        StoreReturnItem.objects.create(
            store_return=department_return,
            item=item,
            quantity=Decimal("0.25"),
            condition_note="Unused UAT quantity",
            created_by=employees["stores"].user,
        )
        department_return.apply_inventory_changes()

        transfer = StockTransfer.objects.create(
            from_store=source,
            to_store=destination,
            requested_by=employees["stores"],
            note=MARKER,
            created_by=employees["stores"].user,
        )
        StockTransferItem.objects.create(
            stock_transfer=transfer,
            item=item,
            quantity=Decimal("1.00"),
            created_by=employees["stores"].user,
        )
        transfer.dispatch()
        transfer.receive()

        adjustment = StockAdjustment.objects.create(
            store=destination,
            reference="UAT-ADJ-001",
            reason=MARKER,
            approved_by=employees["manager"],
            created_by=employees["stores"].user,
        )
        StockAdjustmentItem.objects.create(
            stock_adjustment=adjustment,
            item=item,
            quantity_change=Decimal("0.50"),
            reason=MARKER,
            created_by=employees["stores"].user,
        )
        adjustment.apply()

        count = StockCount.objects.create(
            store=destination,
            conducted_by=employees["stores"],
            note=MARKER,
            created_by=employees["stores"].user,
        )
        count.populate_from_system_balances()
        count.submit()
        count.approve(approved_by=employees["manager"])
        count.apply_variances()

    def summary(self):
        self.stdout.write(f"UAT users: {get_user_model().objects.filter(username__startswith='uat-').count()}")
        self.stdout.write(f"Approval rules: {ApprovalMatrixRule.objects.filter(is_active=True).count()}")
        self.stdout.write(f"UAT requisitions: {PurchaseRequisition.objects.filter(reason=MARKER).count()}")
        self.stdout.write(f"UAT invoices: {SupplierInvoice.objects.filter(invoice_number='UAT-INV-001').count()}")
