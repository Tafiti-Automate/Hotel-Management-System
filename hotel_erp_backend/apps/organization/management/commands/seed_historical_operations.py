import os
import random
import re
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.customers.models import Customer
from apps.departments.models import Branch
from apps.finance.models import (
    CashFlow, Expense, ExpenseCategory, PaymentMethod, SupplierInvoice, SupplierPayment,
)
from apps.inventory.models import (
    Category, InventoryBalance, Item, ReorderRule, StockAdjustment,
    StockAdjustmentItem, StockCount, StockIssue, StockIssueItem,
    StoreLocation, StoreRequisition, StoreRequisitionItem,
    StoreReturn, StoreReturnItem, UnitOfMeasure,
)
from apps.organization.models import Hotel
from apps.procurement.models import (
    GoodsInspection, GoodsInspectionItem, GoodsReceiptItem, GoodsReceiptNote,
    PurchaseOrder, PurchaseOrderItem, PurchaseRequisition, RequisitionHistory,
    RequisitionItem, VendorQuotation, VendorQuotationItem,
)
from apps.sales.models import Sale, SaleItem
from apps.vendors.models import Supplier
from core.constants.choices import (
    CashFlowType, GoodsInspectionStatus, ItemBusinessType, POStatus, PRStatus,
    ProcurementSource, RequisitionType, StoreRequisitionStatus,
)


class Command(BaseCommand):
    help = "Add a repeatable set of realistic historical operations to an existing hotel branch."

    def add_arguments(self, parser):
        parser.add_argument("--hotel", help="Existing hotel name (required when there is more than one).")
        parser.add_argument("--branch", help="Existing branch name or branch code (required when ambiguous).")
        parser.add_argument("--days", type=int, default=60, help="History window in days (default: 60).")
        parser.add_argument(
            "--batch-key",
            help="Stable identifier for automated deployments (letters, numbers, dashes, or underscores).",
        )
        parser.add_argument(
            "--commit",
            action="store_true",
            help="Actually write records. Without this flag the command only previews its target.",
        )
        parser.add_argument(
            "--production-only",
            action="store_true",
            help="Skip unless VERCEL_ENV is production (for safe Vercel build integration).",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if options["production_only"] and os.environ.get("VERCEL_ENV") != "production":
            self.stdout.write("Historical seed skipped: this is not a Vercel production deployment.")
            return
        days = options["days"]
        if not 28 <= days <= 366:
            raise CommandError("--days must be between 28 and 366.")

        hotel = self._hotel(options.get("hotel"))
        branch = self._branch(hotel, options.get("branch"))
        end_date = timezone.localdate()
        start_date = end_date - timedelta(days=days - 1)
        batch_key = (options.get("batch_key") or f"{start_date:%Y%m%d}-{end_date:%Y%m%d}").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{3,24}", batch_key):
            raise CommandError("--batch-key must be 3-24 letters, numbers, dashes, or underscores.")
        batch = f"HIST-{branch.branch_code or str(branch.pk)[:8]}-{batch_key.upper()}"

        if not options["commit"]:
            self.stdout.write(
                self.style.WARNING(
                    f"PREVIEW ONLY: {hotel.name} / {branch.name}, {start_date} to {end_date}. "
                    f"This will add about {round(days * 4 / 3)} F&B sales, 12 operating expenses, "
                    "customers, payment methods, sale articles, and Main Store activity."
                )
            )
            self.stdout.write("Run again with --commit after confirming the hotel and branch.")
            return

        store = self._main_store_and_consolidate(branch)

        if Sale.objects.filter(receipt_no__startswith=batch).exists():
            self.stdout.write(self.style.SUCCESS(f"Batch {batch} already exists; nothing was changed."))
            return

        branch_marker = f"HIST-{branch.branch_code or str(branch.pk)[:8]}-"
        existing_historical_sales = Sale.objects.filter(
            receipt_no__startswith=branch_marker
        )
        if existing_historical_sales.exists():
            example = existing_historical_sales.order_by("receipt_no").values_list(
                "receipt_no", flat=True
            ).first()
            self.stdout.write(
                self.style.WARNING(
                    f"Historical seed data already exists for {branch.name} "
                    f"({existing_historical_sales.count()} sales; example {example}). "
                    "No additional batch was created."
                )
            )
            return

        admin = get_user_model().objects.filter(is_superuser=True).first()
        unit, _ = UnitOfMeasure.objects.get_or_create(
            name="Piece", defaults={"abbreviation": "pcs", "is_active": True}
        )
        category, _ = Category.objects.get_or_create(
            name="Food & Beverage Sales",
            defaults={"code": "FBS", "description": "Guest food and beverage resale articles."},
        )
        item_specs = (
            ("HIST-WATER-500", "Mineral Water 500ml", "1500.00"),
            ("HIST-SODA-300", "Assorted Soda 300ml", "2500.00"),
            ("HIST-BEER-500", "Local Beer 500ml", "6000.00"),
            ("HIST-BREAKFAST", "Full Breakfast", "25000.00"),
            ("HIST-DINNER", "Chef's Dinner", "45000.00"),
        )
        items = []
        prices = {}
        for sku, name, price in item_specs:
            item, _ = Item.objects.get_or_create(
                sku=sku,
                defaults={
                    "category": category,
                    "name": name,
                    "unit": unit.abbreviation,
                    "base_unit": unit,
                    "reorder_level": Decimal("50.00"),
                    "maximum_level": Decimal("10000.00"),
                    "business_type": ItemBusinessType.RESALE_REVENUE,
                },
            )
            InventoryBalance.objects.get_or_create(
                item=item,
                store=store,
                defaults={"quantity_in_stock": Decimal("5000.00"), "reorder_level": Decimal("50.00")},
            )
            items.append(item)
            prices[item.pk] = Decimal(price)

        payment_methods = []
        for name in ("Cash", "MTN Mobile Money", "Visa/Mastercard"):
            method, _ = PaymentMethod.objects.get_or_create(name=name, defaults={"is_active": True})
            payment_methods.append(method)

        customer_specs = (
            ("Walk-in Guest", "", "", ""),
            ("Sarah Namukasa", "", "sarah.namukasa@example.com", "+256 772 555 014"),
            ("David Ochieng", "", "david.ochieng@example.com", "+256 701 555 028"),
            ("Amina Tours Account", "Amina Tours Uganda", "accounts@aminatours.example", "+256 414 555 036"),
            ("Nile Business Solutions", "Nile Business Solutions Ltd", "travel@nilebusiness.example", "+256 312 555 044"),
        )
        customers = []
        for name, company, email, phone in customer_specs:
            customer, _ = Customer.objects.get_or_create(
                name=name,
                company=company,
                defaults={"email": email, "phone": phone, "notes": "Synthetic historical sample record."},
            )
            customers.append(customer)

        rng = random.Random(20260802)
        sales_created = 0
        for day_index in range(days):
            sale_date = start_date + timedelta(days=day_index)
            daily_sales = 1 if day_index % 3 else 2
            for sequence in range(1, daily_sales + 1):
                receipt = f"{batch}-{day_index + 1:03d}-{sequence}"
                chosen = rng.sample(items, rng.randint(1, 3))
                sale = Sale.objects.create(
                    receipt_no=receipt,
                    customer=rng.choice(customers),
                    store=store,
                    sale_date=sale_date,
                    payment_method=rng.choice(payment_methods),
                    amount_paid=Decimal("0.00"),
                    note="Synthetic historical F&B transaction for reporting and system evaluation.",
                    created_by=admin,
                )
                for item in chosen:
                    SaleItem.objects.create(
                        sale=sale,
                        item=item,
                        unit=unit,
                        quantity=Decimal(rng.randint(1, 4)),
                        unit_price=prices[item.pk],
                        created_by=admin,
                    )
                sale.refresh_from_db()
                # Most hotel counter sales are settled immediately; every ninth is a corporate balance.
                sale.amount_paid = sale.total_amount if (day_index + sequence) % 9 else sale.total_amount * Decimal("0.60")
                sale.save()
                sale.complete_sale()
                CashFlow.objects.filter(reference=receipt).update(date=sale_date)
                sales_created += 1

        expense_specs = (
            ("Utility Bills", "UMEME electricity bill", "1850000.00"),
            ("Utilities", "NWSC water bill", "620000.00"),
            ("Internet & Communications", "Business internet subscription", "280000.00"),
            ("Repairs & Maintenance", "Plumbing and room maintenance", "475000.00"),
            ("Cleaning Supplies", "Laundry and housekeeping supplies", "735000.00"),
            ("Staff Welfare", "Staff meals and drinking water", "390000.00"),
        )
        expenses_created = 0
        for index in range(12):
            category_name, description, amount = expense_specs[index % len(expense_specs)]
            category_obj, _ = ExpenseCategory.objects.get_or_create(name=category_name)
            expense_date = start_date + timedelta(days=min(days - 1, index * max(1, days // 12)))
            reference = f"{batch}-EXP-{index + 1:02d}"
            flow = CashFlow.objects.create(
                store=store,
                amount=Decimal(amount),
                transaction_type=CashFlowType.OUTFLOW,
                reference=reference,
                payment_method=payment_methods[index % len(payment_methods)],
                note=description,
                created_by=admin,
            )
            CashFlow.objects.filter(pk=flow.pk).update(date=expense_date)
            expense = Expense.objects.create(
                store=store,
                category=category_obj,
                amount=Decimal(amount),
                description=f"{description} — synthetic historical sample.",
                reference=reference,
                related_cashflow=flow,
                payment_method=flow.payment_method,
                created_by=admin,
            )
            Expense.objects.filter(pk=expense.pk).update(date=expense_date)
            expenses_created += 1

        workflow_counts = self._create_supply_workflows(
            batch=batch,
            branch=branch,
            hotel=hotel,
            store=store,
            unit=unit,
            items=items,
            prices=prices,
            payment_method=payment_methods[1],
            start_date=start_date,
            days=days,
            admin=admin,
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Created batch {batch}: {sales_created} sales and {expenses_created} expenses "
                f"for {hotel.name} / {branch.name} ({start_date} to {end_date}); "
                f"{workflow_counts['procurement']} procure-to-pay and "
                f"{workflow_counts['requisitions']} store-requisition workflows."
            )
        )

    def _create_supply_workflows(
        self, *, batch, branch, hotel, store, unit, items, prices,
        payment_method, start_date, days, admin,
    ):
        employees = list(branch.employees.filter(is_active=True).select_related("department", "user")[:3])
        if not employees:
            raise CommandError(
                f"Branch '{branch.name}' needs at least one active employee before operational workflows can be seeded."
            )
        requester = employees[0]
        operator = employees[1] if len(employees) > 1 else requester
        approver = employees[2] if len(employees) > 2 else operator
        department = requester.department

        suppliers = []
        supplier_specs = (
            ("Lake Victoria Hospitality Supplies", "history.lakevictoria@example.com", "+256 414 555 181"),
            ("Kampala Fresh Foods Distributors", "history.kampalafresh@example.com", "+256 312 555 274"),
            ("Nile Beverages Wholesale", "history.nilebeverages@example.com", "+256 200 555 369"),
        )
        for index, (name, email, phone) in enumerate(supplier_specs, 1):
            supplier, _ = Supplier.objects.get_or_create(
                email=email,
                defaults={
                    "name": name,
                    "phone": phone,
                    "address": "Kampala, Uganda",
                    "contact_person": ("Peter Mugisha", "Joan Atim", "Isaac Ssemanda")[index - 1],
                    "payment_terms": "Net 30",
                    "tin_number": f"HIST-TIN-{index:03d}",
                    "registration_number": f"HIST-REG-{index:03d}",
                    "notes": "Synthetic supplier used for historical workflow demonstration.",
                },
            )
            suppliers.append(supplier)

        for index in range(15):
            event_date = start_date + timedelta(days=min(days - 1, 2 + index * max(1, days // 16)))
            item = items[index % len(items)]
            supplier = suppliers[index % len(suppliers)]
            quantity = Decimal(20 + (index % 5) * 5)
            cost = (prices[item.pk] * Decimal("0.62")).quantize(Decimal("0.01"))
            pr_no = f"{batch}-PR-{index + 1:02d}"
            requisition = PurchaseRequisition.objects.create(
                requisition_number=pr_no,
                hotel=hotel,
                branch=branch,
                request_type=RequisitionType.DEPARTMENT,
                procurement_source=ProcurementSource.MANUAL,
                requester=requester,
                department=department,
                preferred_supplier=supplier,
                status=PRStatus.APPROVED,
                reason=f"Routine replenishment of {item.name} for forecast guest occupancy.",
                expected_date=event_date + timedelta(days=3),
                submitted_at=timezone.now(),
                approved_at=timezone.now(),
                control_notes="Synthetic approved historical procurement workflow.",
                created_by=admin,
            )
            req_line = RequisitionItem.objects.create(
                requisition=requisition, item=item, unit=unit, quantity=quantity,
                approved_quantity=quantity, estimated_unit_cost=cost, created_by=admin,
            )
            RequisitionHistory.objects.create(
                requisition=requisition, action="fully_approved", previous_status=PRStatus.SUBMITTED,
                new_status=PRStatus.APPROVED, performed_by=admin,
                comments="Historical sample approval completed.", created_by=admin,
            )
            quote = VendorQuotation.objects.create(
                requisition=requisition, supplier=supplier, payment_terms="Net 30",
                delivery_date=event_date + timedelta(days=2), evaluation_score=Decimal("88.00"),
                evaluation_notes="Best evaluated compliant quotation.", created_by=admin,
            )
            VendorQuotationItem.objects.create(
                quotation=quote, requisition_item=req_line, item=item, unit=unit,
                quantity=quantity, unit_price=cost, delivery_days=2, selected=True,
                selection_reason="Best combination of price, availability, and delivery time.", created_by=admin,
            )
            order = PurchaseOrder.objects.create(
                requisition=requisition, supplier=supplier, ordered_by=operator, store=store,
                po_number=f"{batch}-PO-{index + 1:02d}",
                expected_date=event_date + timedelta(days=3), sent_at=timezone.now(),
                sent_by=operator, sent_to_email=supplier.email,
                supplier_acknowledged_at=timezone.now(), supplier_acknowledged_by=supplier.contact_person,
                note="Historical sample local purchase order.", created_by=admin,
            )
            po_line = PurchaseOrderItem.objects.create(
                purchase_order=order, item=item, unit=unit, quantity=quantity,
                unit_cost=cost, created_by=admin,
            )
            order.status = POStatus.ISSUED
            order.save(update_fields=("status", "updated_at"))
            grn = GoodsReceiptNote.objects.create(
                grn_number=f"{batch}-GRN-{index + 1:02d}", purchase_order=order,
                received_by=operator, received_date=event_date + timedelta(days=3),
                delivery_note_no=f"{batch}-DN-{index + 1:02d}",
                note="Delivery received in good condition.", created_by=admin,
            )
            receipt_line = GoodsReceiptItem.objects.create(
                goods_receipt=grn, purchase_order_item=po_line, item=item, store=store,
                quantity_received=quantity, unit_cost=cost, created_by=admin,
            )
            inspection = GoodsInspection.objects.create(
                goods_receipt=grn, inspected_by=operator,
                inspection_date=event_date + timedelta(days=3),
                status=GoodsInspectionStatus.ACCEPTED,
                delivery_note_no=grn.delivery_note_no,
                remarks="Quantity, packaging, and quality accepted.", created_by=admin,
            )
            GoodsInspectionItem.objects.create(
                inspection=inspection, goods_receipt_item=receipt_line, item=item,
                quantity_received=quantity, quantity_accepted=quantity,
                quantity_rejected=Decimal("0.00"), created_by=admin,
            )
            grn.post_to_inventory(posted_by=operator)
            subtotal = quantity * cost
            invoice = SupplierInvoice.objects.create(
                supplier=supplier, purchase_order=order,
                invoice_number=f"{batch}-INV-{index + 1:02d}", invoice_date=event_date + timedelta(days=3),
                due_date=event_date + timedelta(days=33), subtotal=subtotal,
                tax_amount=Decimal("0.00"), status=SupplierInvoice.STATUS_APPROVED,
                match_notes="LPO, GRN, and invoice matched.", created_by=admin,
            )
            payment = SupplierPayment.objects.create(
                invoice=invoice, amount=subtotal, payment_date=min(timezone.localdate(), event_date + timedelta(days=10)),
                payment_method=payment_method, reference=f"{batch}-PAY-{index + 1:02d}",
                note="Historical supplier settlement.", created_by=admin,
            )
            payment.post()

        for index in range(15):
            event_date = start_date + timedelta(days=min(days - 1, index * max(1, days // 15)))
            item = items[index % len(items)]
            quantity = Decimal(2 + index % 4)
            request = StoreRequisition.objects.create(
                requisition_no=f"{batch}-SR-{index + 1:02d}", department=department,
                store=store, requested_by=requester, approved_by=approver,
                status=StoreRequisitionStatus.APPROVED, required_date=event_date,
                purpose=f"Routine departmental issue of {item.name} for guest service.",
                approval_comments="Stock availability checked and request approved.",
                approved_at=timezone.now(), created_by=admin,
            )
            request_line = StoreRequisitionItem.objects.create(
                requisition=request, item=item, unit=unit, quantity_requested=quantity,
                quantity_approved=quantity, created_by=admin,
            )
            balance = InventoryBalance.objects.get(item=item, store=store)
            balance.quantity_reserved += quantity
            balance.save(update_fields=["quantity_reserved", "updated_at"])
            issue = StockIssue.objects.create(
                issue_no=f"{batch}-SI-{index + 1:02d}", requisition=request, store=store,
                issued_by=operator, received_by=requester, received_by_name=str(requester),
                note="Issued against approved department store request.", created_by=admin,
            )
            StockIssueItem.objects.create(
                issue=issue, requisition_item=request_line, item=item, unit=unit,
                quantity=quantity, created_by=admin,
            )
            issue.apply_inventory_changes()
            StockIssue.objects.filter(pk=issue.pk).update(issue_date=event_date)

        for index in range(5):
            item = items[index]
            store_return = StoreReturn.objects.create(
                return_no=f"{batch}-RET-{index + 1:02d}", department=department,
                store=store, received_by=operator,
                reason="Unused sealed stock returned after occupancy adjustment.", created_by=admin,
            )
            StoreReturnItem.objects.create(
                store_return=store_return, item=item, unit=unit, quantity=Decimal("1.00"),
                condition_note="Sealed and suitable for reissue.", created_by=admin,
            )
            store_return.apply_inventory_changes()

            adjustment = StockAdjustment.objects.create(
                store=store, reference=f"{batch}-ADJ-{index + 1:02d}",
                reason="Month-end shelf reconciliation.", note="Verified historical sample adjustment.",
                created_by=admin,
            )
            StockAdjustmentItem.objects.create(
                stock_adjustment=adjustment, item=item, unit=unit,
                quantity_change=Decimal("1.00"), unit_cost=prices[item.pk] * Decimal("0.62"),
                reason=adjustment.reason, created_by=admin,
            )
            adjustment.submit()
            adjustment.approve(approved_by=approver)
            adjustment.apply()
            ReorderRule.objects.get_or_create(
                item=item, store=store,
                defaults={"minimum_level": Decimal("50.00"), "reorder_quantity": Decimal("200.00"),
                          "preferred_supplier": suppliers[index % len(suppliers)], "is_active": True,
                          "created_by": admin},
            )

        for index in range(2):
            count = StockCount.objects.create(
                store=store, conducted_by=operator,
                note=f"{batch}: {'first' if index == 0 else 'second'} month-end cycle count.",
                created_by=admin,
            )
            count.populate_from_system_balances()
            count.submit()
            count.approve(approved_by=approver)
            count.apply_variances()

        return {"procurement": 15, "requisitions": 15}

    def _main_store_and_consolidate(self, branch):
        main_store = StoreLocation.objects.filter(
            branch=branch, name__iexact="Main Store"
        ).first()
        if main_store is None:
            main_store = StoreLocation.objects.filter(
                branch=branch, is_default=True, is_active=True
            ).first()
        if main_store is None:
            main_store = StoreLocation.objects.create(
                branch=branch,
                name="Main Store",
                address=branch.physical_address or branch.location,
                is_active=True,
                is_default=True,
            )

        generated_stores = StoreLocation.objects.filter(
            branch=branch,
            name__in=("Front Office & Bar Store", "Housekeeping Floor Store"),
        ).exclude(pk=main_store.pk)
        for old_store in generated_stores:
            for old_balance in InventoryBalance.objects.filter(store=old_store):
                main_balance, _ = InventoryBalance.objects.get_or_create(
                    item=old_balance.item,
                    store=main_store,
                    defaults={
                        "quantity_in_stock": Decimal("0.00"),
                        "quantity_reserved": Decimal("0.00"),
                        "reorder_level": old_balance.reorder_level,
                    },
                )
                main_balance.quantity_in_stock += old_balance.quantity_in_stock
                main_balance.quantity_reserved += old_balance.quantity_reserved
                main_balance.reorder_level = max(
                    main_balance.reorder_level, old_balance.reorder_level
                )
                main_balance.save(
                    update_fields=[
                        "quantity_in_stock", "quantity_reserved", "reorder_level", "updated_at"
                    ]
                )
                old_balance.delete()

            Sale.objects.filter(
                store=old_store, receipt_no__startswith="HIST-"
            ).update(store=main_store)
            CashFlow.objects.filter(
                store=old_store, reference__startswith="HIST-"
            ).update(store=main_store)
            Expense.objects.filter(
                store=old_store, reference__startswith="HIST-"
            ).update(store=main_store)
            PurchaseOrder.objects.filter(
                store=old_store, po_number__startswith="HIST-"
            ).update(store=main_store)
            GoodsReceiptItem.objects.filter(
                store=old_store,
                goods_receipt__grn_number__startswith="HIST-",
            ).update(store=main_store)
            StoreRequisition.objects.filter(
                store=old_store, requisition_no__startswith="HIST-"
            ).update(store=main_store)
            StockIssue.objects.filter(
                store=old_store, issue_no__startswith="HIST-"
            ).update(store=main_store)
            StoreReturn.objects.filter(
                store=old_store, return_no__startswith="HIST-"
            ).update(store=main_store)
            StockAdjustment.objects.filter(
                store=old_store, reference__startswith="HIST-"
            ).update(store=main_store)
            old_store.is_active = False
            old_store.is_default = False
            old_store.save(update_fields=["is_active", "is_default", "updated_at"])

        if not main_store.is_active or not main_store.is_default:
            main_store.is_active = True
            main_store.is_default = True
            main_store.save(update_fields=["is_active", "is_default", "updated_at"])
        return main_store

    def _hotel(self, name):
        hotels = Hotel.objects.all()
        if name:
            try:
                return hotels.get(name__iexact=name.strip())
            except Hotel.DoesNotExist as exc:
                raise CommandError(f"Hotel '{name}' was not found.") from exc
        if hotels.count() != 1:
            raise CommandError("Use --hotel because the database does not contain exactly one hotel.")
        return hotels.get()

    def _branch(self, hotel, value):
        branches = Branch.objects.filter(hotel=hotel, is_active=True)
        if value:
            branch = branches.filter(name__iexact=value.strip()).first()
            if branch is None:
                branch = branches.filter(branch_code__iexact=value.strip()).first()
            if branch is None:
                raise CommandError(f"Branch '{value}' was not found under {hotel.name}.")
            return branch
        if branches.count() != 1:
            head_office = branches.filter(is_head_office=True)
            if head_office.count() == 1:
                return head_office.get()
            main_property = branches.filter(branch_type=Branch.BRANCH_TYPE_MAIN)
            if main_property.count() == 1:
                return main_property.get()
            choices = ", ".join(f"{b.name} ({b.branch_code or 'no code'})" for b in branches)
            raise CommandError(f"Use --branch. Available branches: {choices}")
        return branches.get()
