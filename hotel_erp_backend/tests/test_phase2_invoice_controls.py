"""Phase 2: protect three-way match and payment posting boundaries."""
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.finance.models import SupplierInvoice, SupplierPayment
from apps.finance.serializers import SupplierPaymentSerializer


@pytest.mark.parametrize("status", [
    SupplierInvoice.STATUS_MATCHED,
    SupplierInvoice.STATUS_APPROVED,
    SupplierInvoice.STATUS_PARTIALLY_PAID,
    SupplierInvoice.STATUS_PAID,
    SupplierInvoice.STATUS_CANCELLED,
])
def test_finalized_invoice_cannot_be_rematched(status):
    invoice = SupplierInvoice(status=status)
    with pytest.raises(DjangoValidationError, match="locked"):
        invoice.perform_three_way_match()


@pytest.mark.django_db
@pytest.mark.parametrize("role", [
    "System Administrator", "Financial Manager", "Cost Controller",
    "Procurement Manager", "Store Keeper", "Receiving Clerk",
])
@pytest.mark.parametrize("resource,action", [
    ("supplier-invoices", "match"),
    ("supplier-invoices", "approve-for-payment"),
    ("supplier-payments", "post"),
])
def test_non_ap_roles_cannot_trigger_invoice_or_payment_actions(role, resource, action):
    call_command("setup_hotel_roles", verbosity=0)
    user = get_user_model().objects.create_user(
        username=f"phase2-{role.lower().replace(' ', '-')}",
        employee_code=f"P2-{role.upper().replace(' ', '-')}"[:40],
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name=role))
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post(f"/api/v1/{resource}/{uuid4()}/{action}/")
    assert response.status_code == 403, (role, resource, action, response.status_code)


@pytest.mark.django_db
def test_ap_can_reach_invoice_match_action_without_blanket_403():
    call_command("setup_hotel_roles", verbosity=0)
    user = get_user_model().objects.create_user(
        username="phase2-ap-operator", employee_code="P2-AP",
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name="Accounts Payable Clerk"))
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post(f"/api/v1/supplier-invoices/{uuid4()}/match/")
    assert response.status_code == 404


@pytest.mark.parametrize("state", [
    SupplierPayment.STATUS_POSTED, SupplierPayment.STATUS_CANCELLED,
])
def test_posted_or_cancelled_supplier_payment_cannot_be_repriced(state):
    payment = SupplierPayment(status=state)
    serializer = SupplierPaymentSerializer(
        payment, data={"amount": "999999.00"}, partial=True
    )
    assert not serializer.is_valid()
    assert "controlled reversal" in str(serializer.errors)
