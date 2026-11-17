"""Bank reconciliation: one-to-one statement evidence and maker/checker API."""
from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.departments.models import Department
from apps.employees.models import Employee
from apps.finance.models import (
    BankAccount, BankTransaction, PaymentMethod, SupplierInvoice, SupplierPayment,
    SupplierPaymentReconciliation,
)
from core.constants.choices import BankTransactionType
from tests.test_phase2_supplier_return_quantities import posted_receipt


@pytest.fixture
def bank_reconciliation_context(posted_receipt):
    employee, supplier, item, store, grn = posted_receipt
    call_command("setup_hotel_roles", verbosity=0)
    department = Department.objects.create(name="Payment reconciliation team")

    def actor(role, suffix):
        user = get_user_model().objects.create_user(
            username=f"bank-recon-{suffix}",
            employee_code=f"PH2-BR-{suffix.upper()}",
            password="test-pass-123",
        )
        user.groups.add(Group.objects.get(name=role))
        Employee.objects.create(
            user=user, branch=store.branch, department=department, designation=role,
        )
        return user

    preparer = actor("Accounts Payable Clerk", "maker")
    reviewer = actor("Financial Manager", "reviewer")
    poster = actor("Accounts Payable Clerk", "poster")
    administrator = actor("System Administrator", "it")
    invoice = SupplierInvoice.objects.create(
        supplier=supplier, purchase_order=grn.purchase_order,
        invoice_number="PH2-BANK-RECON-INVOICE",
        subtotal=Decimal("7000.00"), due_date=timezone.localdate(),
        status=SupplierInvoice.STATUS_APPROVED,
    )
    bank = BankAccount.objects.create(
        name="PH2 reconciliation bank", account_number="PH2-RECON-ACCOUNT",
        bank_name="Audit bank",
    )
    method = PaymentMethod.objects.create(name="PH2 reconciliation transfer")
    payment = SupplierPayment.objects.create(
        invoice=invoice, amount=Decimal("2000.00"), bank_account=bank,
        payment_method=method, reference="PAY-RECON-01", created_by=preparer,
    )
    payment.post(posted_by=poster)
    entry = BankTransaction.objects.create(
        bank_account=bank, amount=Decimal("2000.00"),
        transaction_type=BankTransactionType.WITHDRAWAL,
        reference="BANK-STATEMENT-01",
    )
    return preparer, reviewer, poster, administrator, payment, entry, bank, invoice


@pytest.mark.django_db
def test_api_reconciliation_is_single_use_and_independently_confirmed(bank_reconciliation_context):
    preparer, reviewer, poster, it, payment, entry, bank, invoice = bank_reconciliation_context
    client = APIClient()
    client.force_authenticate(user=preparer)
    response = client.post("/api/v1/supplier-payment-reconciliations/", {
        "payment": str(payment.pk), "bank_transaction": str(entry.pk),
    }, format="json")
    assert response.status_code == 201, response.data
    matching = SupplierPaymentReconciliation.objects.get(pk=response.data["id"])
    assert matching.status == SupplierPaymentReconciliation.STATUS_PENDING

    duplicate = client.post("/api/v1/supplier-payment-reconciliations/", {
        "payment": str(payment.pk), "bank_transaction": str(entry.pk),
    }, format="json")
    assert duplicate.status_code == 400

    client.force_authenticate(user=it)
    assert client.post(
        f"/api/v1/supplier-payment-reconciliations/{matching.pk}/confirm/",
        {"note": "Should not work"}, format="json",
    ).status_code == 403

    client.force_authenticate(user=preparer)
    assert client.post(
        f"/api/v1/supplier-payment-reconciliations/{matching.pk}/confirm/",
        {"note": "Prepared payment"}, format="json",
    ).status_code == 403

    client.force_authenticate(user=reviewer)
    assert client.post(
        f"/api/v1/supplier-payment-reconciliations/{matching.pk}/confirm/",
        {"note": ""}, format="json",
    ).status_code == 400
    response = client.post(
        f"/api/v1/supplier-payment-reconciliations/{matching.pk}/confirm/",
        {"note": "Bank withdrawal cross-checked against the recorded statement."},
        format="json",
    )
    assert response.status_code == 200, response.data
    matching.refresh_from_db()
    assert matching.status == SupplierPaymentReconciliation.STATUS_CONFIRMED

    assert client.post(
        f"/api/v1/supplier-payment-reconciliations/{matching.pk}/confirm/",
        {"note": "Again"}, format="json",
    ).status_code == 400
    assert client.patch(
        f"/api/v1/supplier-payment-reconciliations/{matching.pk}/",
        {"review_note": "Tamper"}, format="json",
    ).status_code in (400, 403)

    entry.refresh_from_db()
    assert entry.reference == "BANK-STATEMENT-01"
    assert SupplierPaymentReconciliation.objects.count() == 1
    invoice.refresh_from_db()
    assert invoice.balance_due == Decimal("5000.00")


@pytest.mark.django_db
def test_invalid_bank_matches_fail_without_adjusting_payables(bank_reconciliation_context):
    preparer, reviewer, poster, it, payment, entry, bank, invoice = bank_reconciliation_context
    other = BankAccount.objects.create(
        name="Unrelated bank", account_number="PH2-OTHER-BANK",
        bank_name="Other institution",
    )
    wrong_bank = BankTransaction.objects.create(
        bank_account=other, amount=payment.amount,
        transaction_type=BankTransactionType.WITHDRAWAL,
        reference="FOREIGN-BANK",
    )
    incorrect_amount = BankTransaction.objects.create(
        bank_account=bank, amount=Decimal("2000.01"),
        transaction_type=BankTransactionType.WITHDRAWAL,
        reference="WRONG-AMOUNT",
    )
    wrong_direction = BankTransaction.objects.create(
        bank_account=bank, amount=payment.amount,
        transaction_type=BankTransactionType.DEPOSIT,
        reference="WRONG-DIRECTION",
    )
    for bank_entry, text in (
        (wrong_bank, "account differ"),
        (incorrect_amount, "amount differs"),
        (wrong_direction, "bank withdrawal"),
    ):
        candidate = SupplierPaymentReconciliation(
            payment=payment, bank_transaction=bank_entry,
        )
        with pytest.raises(DjangoValidationError, match=text):
            candidate.full_clean()
    invoice.refresh_from_db()
    assert invoice.balance_due == Decimal("5000.00")


@pytest.mark.django_db
def test_reconciliation_confirmation_requires_independent_user(bank_reconciliation_context):
    preparer, reviewer, poster, it, payment, entry, bank, invoice = bank_reconciliation_context
    matching = SupplierPaymentReconciliation.objects.create(
        payment=payment, bank_transaction=entry, created_by=reviewer,
    )
    with pytest.raises(DjangoValidationError, match="preparer cannot confirm"):
        matching.confirm(actor=reviewer, note="Same person")
    assert matching.status == SupplierPaymentReconciliation.STATUS_PENDING


@pytest.mark.django_db
def test_matched_bank_entry_is_locked_even_for_administrator(bank_reconciliation_context):
    preparer, reviewer, poster, it, payment, entry, bank, invoice = bank_reconciliation_context
    SupplierPaymentReconciliation.objects.create(
        payment=payment, bank_transaction=entry, created_by=preparer
    )
    administrator = get_user_model().objects.create_superuser(
        username="bank-locked-superuser", employee_code="PH2-BR-SUPER",
        password="test-pass-123",
    )
    client = APIClient()
    client.force_authenticate(user=administrator)
    response = client.patch(
        f"/api/v1/bank-transactions/{entry.pk}/",
        {"amount": "100.00"}, format="json",
    )
    assert response.status_code == 400
    response = client.delete(f"/api/v1/bank-transactions/{entry.pk}/")
    assert response.status_code == 400
    entry.refresh_from_db()
    assert entry.amount == Decimal("2000.00")
    assert BankTransaction.objects.filter(pk=entry.pk).exists()
