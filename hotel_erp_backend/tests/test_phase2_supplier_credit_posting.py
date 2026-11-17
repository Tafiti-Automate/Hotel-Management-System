"""Supplier credit financial posting: GL, RBAC separation, payable reconciliation."""
import csv
import io
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.finance.models import SupplierCreditNote, SupplierInvoice
from apps.materials_control.models import FiscalPeriod, GLAccountMapping, GLExport
from tests.test_phase2_supplier_return_quantities import make_return, posted_receipt


@pytest.mark.django_db
def test_posted_return_credit_reduces_open_payable_and_reverses_gl(posted_receipt):
    employee, supplier, item, store, grn = posted_receipt
    maker = get_user_model().objects.create_user(
        username="credit-ap-maker", employee_code="PH2-CREDIT-MKR",
        password="test-pass-123",
    )
    finance = get_user_model().objects.create_user(
        username="credit-finance-approver", employee_code="PH2-CREDIT-FIN",
        password="test-pass-123",
    )
    poster = get_user_model().objects.create_user(
        username="credit-ap-poster", employee_code="PH2-CREDIT-PST",
        password="test-pass-123",
    )
    invoice = SupplierInvoice.objects.create(
        supplier=supplier, purchase_order=grn.purchase_order,
        invoice_number="CREDIT-PH2-INV", subtotal=Decimal("7000.00"),
        due_date=timezone.localdate(), created_by=maker,
    )
    invoice.perform_three_way_match()
    invoice.approve_for_payment(approved_by=finance)
    assert invoice.balance_due == Decimal("7000.00")

    returned = make_return(posted_receipt, "2")
    returned.apply_inventory_changes(dispatched_by=employee)
    returned.acknowledge(acknowledged_by="Supplier representative",
                         credit_note_number="CR-PH2-2026")

    credit = SupplierCreditNote.objects.create(
        invoice=invoice, supplier_return=returned,
        subtotal=Decimal("2000.00"), created_by=maker,
    )
    with pytest.raises(ValidationError, match="separate Financial Manager"):
        credit.approve(actor=maker)
    credit.approve(actor=finance)
    with pytest.raises(ValidationError, match="separate Accounts Payable"):
        credit.post(actor=finance)
    with pytest.raises(ValidationError, match="separate Accounts Payable"):
        credit.post(actor=maker)
    credit.post(actor=poster)
    credit.refresh_from_db()
    invoice.refresh_from_db()
    assert credit.status == SupplierCreditNote.STATUS_POSTED
    assert invoice.credited_amount == Decimal("2000.00")
    assert invoice.paid_amount == Decimal("0.00")
    assert invoice.balance_due == Decimal("5000.00")
    with pytest.raises(ValidationError, match="Only approved"):
        credit.post(actor=poster)
    invoice.refresh_from_db()
    assert invoice.balance_due == Decimal("5000.00")

    today = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=store.branch, name="Credit-note closing test",
        start_date=today.replace(day=1), end_date=today,
    )
    GLAccountMapping.objects.create(
        branch=store.branch, source_type=GLAccountMapping.SOURCE_INVOICE,
        debit_account="INV-STOCK", credit_account="TRADE-PAYABLE",
    )
    period.close(finance, "Invoice and credit reconcile.")
    exported = GLExport.generate(period, finance)
    records = list(csv.DictReader(io.StringIO(exported.payload)))
    credit_rows = [row for row in records if row["source"] == "supplier_credit_note"]
    assert len(credit_rows) == 2
    assert sum(Decimal(row["debit"]) for row in credit_rows) == Decimal("2000.00")
    assert sum(Decimal(row["credit"]) for row in credit_rows) == Decimal("2000.00")
    assert {row["account"] for row in credit_rows} == {"INV-STOCK", "TRADE-PAYABLE"}
    assert sum(Decimal(row["debit"]) for row in records) == sum(
        Decimal(row["credit"]) for row in records
    )


@pytest.mark.django_db
def test_credit_refuses_to_exceed_original_return_value_or_open_invoice(posted_receipt):
    employee, supplier, item, store, grn = posted_receipt
    maker = get_user_model().objects.create_user(
        username="credit-maker-caps", employee_code="PH2-CREDIT-CAPS",
        password="test-pass-123",
    )
    reviewer = get_user_model().objects.create_user(
        username="credit-reviewer-caps", employee_code="PH2-CREDIT-REV",
        password="test-pass-123",
    )
    actor = get_user_model().objects.create_user(
        username="credit-poster-caps", employee_code="PH2-CREDIT-OP",
        password="test-pass-123",
    )
    invoice = SupplierInvoice.objects.create(
        supplier=supplier, purchase_order=grn.purchase_order,
        invoice_number="CREDIT-CAPS-INV", subtotal=Decimal("7000.00"),
        due_date=timezone.localdate(),
    )
    invoice.perform_three_way_match()
    invoice.approve_for_payment(approved_by=reviewer)
    returned = make_return(posted_receipt, "2")
    returned.apply_inventory_changes(dispatched_by=employee)
    returned.acknowledge(acknowledged_by="Supplier", credit_note_number="CREDIT-CAPS-CN")
    credit = SupplierCreditNote.objects.create(
        invoice=invoice, supplier_return=returned,
        subtotal=Decimal("2000.01"), created_by=maker,
    )
    with pytest.raises(ValidationError, match="exceeds original returned-goods"):
        credit.approve(actor=reviewer)
    credit.subtotal = Decimal("2000.00")
    credit.save(update_fields=("subtotal", "updated_at"))
    credit.approve(actor=reviewer)
    credit.post(actor=actor)
    assert invoice.credited_amount == Decimal("2000.00")


@pytest.mark.django_db
def test_supplier_credit_reverses_original_vat_without_excess_tax(posted_receipt):
    employee, supplier, item, store, grn = posted_receipt
    maker = get_user_model().objects.create_user(
        username="credit-vat-maker", employee_code="PH2-VAT-MKR", password="test-pass-123",
    )
    finance = get_user_model().objects.create_user(
        username="credit-vat-finance", employee_code="PH2-VAT-FIN", password="test-pass-123",
    )
    poster = get_user_model().objects.create_user(
        username="credit-vat-poster", employee_code="PH2-VAT-PST", password="test-pass-123",
    )
    invoice = SupplierInvoice.objects.create(
        supplier=supplier, purchase_order=grn.purchase_order,
        invoice_number="PH2-VAT-INVOICE", subtotal=Decimal("7000.00"),
        tax_amount=Decimal("1260.00"), due_date=timezone.localdate(),
    )
    invoice.perform_three_way_match()
    invoice.approve_for_payment(approved_by=finance)
    returned = make_return(posted_receipt, "2")
    returned.apply_inventory_changes(dispatched_by=employee)
    returned.acknowledge(acknowledged_by="Supplier VAT team",
                         credit_note_number="PH2-VAT-CREDIT")
    credit = SupplierCreditNote.objects.create(
        invoice=invoice, supplier_return=returned,
        subtotal=Decimal("2000.00"), tax_amount=Decimal("360.01"),
        created_by=maker,
    )
    with pytest.raises(ValidationError, match="proportional input VAT"):
        credit.approve(actor=finance)
    credit.tax_amount = Decimal("360.00")
    credit.save(update_fields=("tax_amount", "updated_at"))
    credit.approve(actor=finance)
    credit.post(actor=poster)
    invoice.refresh_from_db()
    assert invoice.balance_due == Decimal("5900.00")

    today = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=store.branch, name="Supplier credit VAT GL",
        start_date=today.replace(day=1), end_date=today,
    )
    GLAccountMapping.objects.create(
        branch=store.branch, source_type=GLAccountMapping.SOURCE_INVOICE,
        debit_account="INVENTORY-1400", credit_account="AP-2100",
        tax_account="INPUT-VAT-1500",
    )
    period.close(finance, "VAT credit reconciled against approved supplier return.")
    exported = GLExport.generate(period, finance)
    rows = list(csv.DictReader(io.StringIO(exported.payload)))
    reversals = [row for row in rows if row["source"] == "supplier_credit_note"]
    assert len(reversals) == 3
    assert sum(Decimal(row["debit"]) for row in reversals) == Decimal("2360.00")
    assert sum(Decimal(row["credit"]) for row in reversals) == Decimal("2360.00")
    vat_row = next(row for row in reversals if row["account"] == "INPUT-VAT-1500")
    assert Decimal(vat_row["credit"]) == Decimal("360.00")
