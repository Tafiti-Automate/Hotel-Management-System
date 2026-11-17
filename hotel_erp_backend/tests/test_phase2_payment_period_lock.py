"""Fiscal-period lock and bank-account safety on supplier payment posting."""
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.finance.models import BankAccount, PaymentMethod, SupplierInvoice, SupplierPayment
from apps.materials_control.models import FiscalPeriod
from tests.test_phase2_supplier_return_quantities import posted_receipt


@pytest.mark.django_db
def test_supplier_payment_cannot_post_into_closed_fiscal_period(posted_receipt):
    employee, supplier, item, store, receipt = posted_receipt
    preparer = get_user_model().objects.create_user(
        username="locked-payment-preparer", employee_code="PH2-LOCK-MAKER",
        password="test-pass-123",
    )
    poster = get_user_model().objects.create_user(
        username="locked-payment-poster", employee_code="PH2-LOCK-POST",
        password="test-pass-123",
    )
    invoice = SupplierInvoice.objects.create(
        supplier=supplier, purchase_order=receipt.purchase_order,
        invoice_number="PH2-LOCK-PAYMENT", subtotal=Decimal("7000.00"),
        due_date=timezone.localdate(), status=SupplierInvoice.STATUS_APPROVED,
    )
    method = PaymentMethod.objects.create(name="PH2 period lock bank transfer")
    payment = SupplierPayment.objects.create(
        invoice=invoice, amount=Decimal("1500.00"), payment_method=method,
        reference="PH2-LOCK-PAY", created_by=preparer,
    )
    date = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=store.branch, name="Closed supplier payment period",
        start_date=date.replace(day=1), end_date=date,
    )
    period.close(poster, "Stock and approved vendor invoices reconciled.")
    with pytest.raises(ValidationError, match="closed fiscal period"):
        payment.post(posted_by=poster)
    payment.refresh_from_db()
    assert payment.status == SupplierPayment.STATUS_DRAFT
    invoice.refresh_from_db()
    assert invoice.balance_due == Decimal("7000.00")


@pytest.mark.django_db
def test_supplier_payment_cannot_post_from_inactive_bank_account(posted_receipt):
    employee, supplier, item, store, receipt = posted_receipt
    preparer = get_user_model().objects.create_user(
        username="inactive-bank-maker", employee_code="PH2-BANK-MAKER",
        password="test-pass-123",
    )
    poster = get_user_model().objects.create_user(
        username="inactive-bank-poster", employee_code="PH2-BANK-POSTER",
        password="test-pass-123",
    )
    invoice = SupplierInvoice.objects.create(
        supplier=supplier, purchase_order=receipt.purchase_order,
        invoice_number="PH2-INACTIVE-BANK", subtotal=Decimal("7000.00"),
        due_date=timezone.localdate(), status=SupplierInvoice.STATUS_APPROVED,
    )
    bank = BankAccount.objects.create(
        name="Inactive payment test bank", account_number="PH2-ACC-INACTIVE",
        bank_name="Test Financial Institution", is_active=False,
    )
    method = PaymentMethod.objects.create(name="PH2 bank account transfer")
    payment = SupplierPayment.objects.create(
        invoice=invoice, amount=Decimal("100.00"), bank_account=bank,
        payment_method=method, reference="PH2-INACTIVE", created_by=preparer,
    )
    with pytest.raises(ValidationError, match="inactive"):
        payment.post(posted_by=poster)
    payment.refresh_from_db()
    assert payment.status == SupplierPayment.STATUS_DRAFT
