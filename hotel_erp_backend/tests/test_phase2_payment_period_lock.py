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


@pytest.mark.django_db
def test_supplier_payment_instruction_never_marks_invoice_paid_before_bank_settlement(posted_receipt):
    """AP -> independent Finance -> independent GM; no simulated bank settlement."""
    from django.contrib.auth.models import Group
    from rest_framework.test import APIClient
    from apps.employees.models import Employee
    employee, supplier, item, store, receipt = posted_receipt

    def operator(role, code):
        user = get_user_model().objects.create_user(
            username=f"ap-safe-{code}", employee_code=f"APSAFE-{code}",
        )
        user.groups.add(Group.objects.get_or_create(name=role)[0])
        Employee.objects.create(
            user=user, department=employee.department, branch=store.branch,
            designation=role, is_active=True,
        )
        api = APIClient()
        api.force_authenticate(user)
        return user, api

    preparer, ap = operator("Accounts Payable Clerk", "PREP")
    another_clerk, another_ap = operator("Accounts Payable Clerk", "OTHER")
    approver, finance = operator("Financial Manager", "FIN")
    releaser, gm = operator("General Manager", "GM")
    invoice = SupplierInvoice.objects.create(
        supplier=supplier, purchase_order=receipt.purchase_order,
        invoice_number="SAFE-AP-PAYMENT", subtotal=Decimal("2000.00"),
        due_date=timezone.localdate(), status=SupplierInvoice.STATUS_APPROVED,
    )
    method = PaymentMethod.objects.create(name="External bank instruction only")
    payment = SupplierPayment.objects.create(
        invoice=invoice, amount=Decimal("1500.00"), payment_method=method,
        reference="SAFE-PAY-001", created_by=preparer,
    )
    url = f"/api/v1/supplier-payments/{payment.pk}/"
    assert another_ap.patch(url, {"amount": "1.00"}, format="json").status_code == 403
    assert another_ap.delete(url).status_code == 403
    assert another_ap.post(url + "submit/", {}, format="json").status_code == 400
    assert ap.post(url + "post/", {}, format="json").status_code in (400, 403)
    assert ap.post(url + "authorize/", {}, format="json").status_code == 403
    assert ap.post(url + "submit/", {}, format="json").status_code == 200
    assert ap.post(url + "submit/", {}, format="json").status_code == 400
    assert ap.patch(url, {"amount": "10.00"}, format="json").status_code == 400
    assert gm.post(url + "authorize/", {}, format="json").status_code == 403
    authorized = finance.post(url + "authorize/", {}, format="json")
    assert authorized.status_code == 200, authorized.data
    assert finance.post(url + "release/", {}, format="json").status_code == 400
    released = gm.post(url + "release/", {}, format="json")
    assert released.status_code == 200, released.data
    assert released.data["status"] == SupplierPayment.STATUS_RELEASED
    assert gm.post(url + "release/", {}, format="json").status_code == 400
    assert gm.post(url + "post/", {}, format="json").status_code in (400, 403)

    # A second pending payment may only reserve the uncommitted invoice balance.
    excess = SupplierPayment.objects.create(
        invoice=invoice, amount=Decimal("600.00"), payment_method=method,
        reference="SAFE-PAY-EXCESS", created_by=preparer,
    )
    denied = ap.post(
        f"/api/v1/supplier-payments/{excess.pk}/submit/", {}, format="json",
    )
    assert denied.status_code == 400, denied.data
    excess.refresh_from_db()
    assert excess.status == SupplierPayment.STATUS_DRAFT
    invoice.refresh_from_db()
    assert invoice.status == SupplierInvoice.STATUS_APPROVED
    assert invoice.balance_due == Decimal("2000.00")
    assert invoice.paid_amount == Decimal("0.00")


@pytest.mark.django_db
def test_payment_request_checks_closed_fiscal_period_before_submission(posted_receipt):
    employee, supplier, item, store, receipt = posted_receipt
    maker = get_user_model().objects.create_user(
        username="controlled-payment-maker", employee_code="CTRL-AP-MAKER",
    )
    invoice = SupplierInvoice.objects.create(
        supplier=supplier, purchase_order=receipt.purchase_order,
        invoice_number="SAFE-AP-FISCAL", subtotal=Decimal("250.00"),
        due_date=timezone.localdate(), status=SupplierInvoice.STATUS_APPROVED,
    )
    payment = SupplierPayment.objects.create(
        invoice=invoice, amount=Decimal("100.00"),
        payment_method=PaymentMethod.objects.create(name="Safe fiscal bank"),
        reference="SAFE-AP-FISCAL-REF", created_by=maker,
    )
    date = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=store.branch, name="Closed bank instructions",
        start_date=date.replace(day=1), end_date=date,
    )
    period.close(maker, "Payment period closed")
    with pytest.raises(ValidationError, match="closed fiscal period"):
        payment.submit(actor=maker)
    payment.refresh_from_db()
    assert payment.status == SupplierPayment.STATUS_DRAFT
