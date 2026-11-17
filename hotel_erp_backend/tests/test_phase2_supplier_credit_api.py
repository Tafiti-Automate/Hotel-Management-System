"""API-level maker/checker and authorization for supplier credit notes."""
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.departments.models import Department
from apps.employees.models import Employee
from apps.finance.models import SupplierCreditNote, SupplierInvoice
from tests.test_phase2_supplier_return_quantities import posted_receipt, make_return


@pytest.mark.django_db
def test_credit_api_enforces_ap_finance_ap_handoffs_and_it_denial(posted_receipt):
    receiver, supplier, item, store, receipt = posted_receipt
    call_command("setup_hotel_roles", verbosity=0)
    department = Department.objects.create(name="Supplier credit finance team")

    def actor(username, employee_code, role):
        user = get_user_model().objects.create_user(
            username=username, employee_code=employee_code, password="test-pass-123"
        )
        user.groups.add(Group.objects.get(name=role))
        Employee.objects.create(
            user=user, branch=store.branch, department=department, designation=role,
        )
        return user

    maker = actor("api-credit-maker", "CR-API-MKR", "Accounts Payable Clerk")
    approver = actor("api-credit-finance", "CR-API-FIN", "Financial Manager")
    poster = actor("api-credit-poster", "CR-API-PST", "Accounts Payable Clerk")
    administrator = actor("api-credit-it", "CR-API-IT", "System Administrator")
    invoice = SupplierInvoice.objects.create(
        supplier=supplier, purchase_order=receipt.purchase_order,
        invoice_number="API-CREDIT-TEST", subtotal=Decimal("7000.00"),
        due_date=timezone.localdate(), created_by=maker,
    )
    invoice.perform_three_way_match()
    invoice.approve_for_payment(approved_by=approver)
    returned = make_return(posted_receipt, "2")
    returned.apply_inventory_changes(dispatched_by=receiver)
    returned.acknowledge(
        acknowledged_by="Supplier accounts", credit_note_number="API-CREDIT-CN-1",
    )
    client = APIClient()
    client.force_authenticate(user=maker)
    response = client.post("/api/v1/supplier-credit-notes/", {
        "invoice": str(invoice.pk),
        "supplier_return": str(returned.pk),
        "subtotal": "2000.00",
        "tax_amount": "0.00",
        "credit_date": str(timezone.localdate()),
    }, format="json")
    assert response.status_code == 201, response.data
    credit = SupplierCreditNote.objects.get(pk=response.data["id"])
    assert credit.status == SupplierCreditNote.STATUS_DRAFT

    client.force_authenticate(user=administrator)
    assert client.post(
        f"/api/v1/supplier-credit-notes/{credit.pk}/approve/"
    ).status_code == 403
    assert client.post(
        f"/api/v1/supplier-credit-notes/{credit.pk}/post/"
    ).status_code == 403

    client.force_authenticate(user=maker)
    assert client.post(
        f"/api/v1/supplier-credit-notes/{credit.pk}/approve/"
    ).status_code == 403

    client.force_authenticate(user=approver)
    response = client.post(f"/api/v1/supplier-credit-notes/{credit.pk}/approve/")
    assert response.status_code == 200, response.data
    credit.refresh_from_db()
    assert credit.status == SupplierCreditNote.STATUS_APPROVED
    assert client.post(
        f"/api/v1/supplier-credit-notes/{credit.pk}/post/"
    ).status_code == 403

    client.force_authenticate(user=maker)
    response = client.post(f"/api/v1/supplier-credit-notes/{credit.pk}/post/")
    assert response.status_code == 400
    assert "separate Accounts Payable" in str(response.data)

    client.force_authenticate(user=poster)
    response = client.post(f"/api/v1/supplier-credit-notes/{credit.pk}/post/")
    assert response.status_code == 200, response.data
    invoice.refresh_from_db()
    assert invoice.balance_due == Decimal("5000.00")
    response = client.post(f"/api/v1/supplier-credit-notes/{credit.pk}/post/")
    assert response.status_code == 400
    invoice.refresh_from_db()
    assert invoice.balance_due == Decimal("5000.00")
