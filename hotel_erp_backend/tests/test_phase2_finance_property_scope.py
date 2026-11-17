"""Phase 2: Accounts Payable and Finance views must not leak another property."""
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.finance.models import PaymentMethod, SupplierInvoice, SupplierPayment
from apps.procurement.models import PurchaseOrder, PurchaseRequisition
from apps.vendors.models import Supplier


@pytest.mark.django_db
@pytest.mark.parametrize("role", ["Accounts Payable Clerk", "Financial Manager"])
def test_finance_invoice_and_payment_records_are_scoped_to_property(role):
    call_command("setup_hotel_roles", verbosity=0)
    branch_a = Branch.objects.create(name=f"{role} payable hotel A")
    branch_b = Branch.objects.create(name=f"{role} payable hotel B")
    department = Department.objects.create(name=f"{role} payable audit")
    user = get_user_model().objects.create_user(
        username=f"finance-scope-{role.replace(' ', '-').lower()}",
        employee_code=f"P2-SCOPE-{role.replace(' ', '-').upper()}"[:40],
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name=role))
    employee = Employee.objects.create(
        user=user, branch=branch_a, department=department, designation=role
    )
    supplier = Supplier.objects.create(
        name=f"Supplier {role}", email="audit@example.com", phone="+256700000008",
        address="Kampala", tin_number=f"TIN-{role}", registration_number=f"REG-{role}",
    )
    invoices = []
    for index, branch in enumerate((branch_a, branch_b), start=1):
        request = PurchaseRequisition.objects.create(
            requester=employee, department=department, branch=branch,
            reason=f"Test purchase in property {index}",
        )
        po = PurchaseOrder.objects.create(requisition=request, supplier=supplier, ordered_by=employee)
        invoice = SupplierInvoice.objects.create(
            supplier=supplier, purchase_order=po, invoice_number=f"PHASE2-{role}-{index}",
            due_date=timezone.localdate(), subtotal=Decimal("100.00"),
        )
        invoices.append(invoice)

    method = PaymentMethod.objects.create(name=f"{role} audit transfer")
    payments = [
        SupplierPayment.objects.create(
            invoice=invoice, payment_method=method, amount=Decimal("20.00"),
            reference=f"PHASE2-PAY-{role}-{index}"
        )
        for index, invoice in enumerate(invoices, start=1)
    ]

    client = APIClient()
    client.force_authenticate(user=user)
    for endpoint, accessible, forbidden in (
        ("supplier-invoices", invoices[0].pk, invoices[1].pk),
        ("supplier-payments", payments[0].pk, payments[1].pk),
    ):
        response = client.get(f"/api/v1/{endpoint}/")
        assert response.status_code == 200
        records = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        ids = {str(row["id"]) for row in records}
        assert str(accessible) in ids, endpoint
        assert str(forbidden) not in ids, endpoint

    if role == "Accounts Payable Clerk":
        # A posted FK cannot be used to write into another property's payable.
        foreign_order = invoices[1].purchase_order
        response = client.post("/api/v1/supplier-invoices/", {
            "supplier": str(supplier.pk),
            "purchase_order": str(foreign_order.pk),
            "invoice_number": "CROSS-HOTEL-UNAUTHORIZED",
            "due_date": str(timezone.localdate()),
            "subtotal": "100.00",
        })
        assert response.status_code == 403
        assert not SupplierInvoice.objects.filter(
            invoice_number="CROSS-HOTEL-UNAUTHORIZED"
        ).exists()

        response = client.post("/api/v1/supplier-payments/", {
            "invoice": str(invoices[1].pk),
            "amount": "5.00",
            "payment_method": str(method.pk),
            "reference": "CROSS-HOTEL-PAYMENT",
        })
        assert response.status_code == 403
        assert not SupplierPayment.objects.filter(
            reference="CROSS-HOTEL-PAYMENT"
        ).exists()
