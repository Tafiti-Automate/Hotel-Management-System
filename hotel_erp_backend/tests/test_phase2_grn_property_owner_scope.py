"""GRN receiving isolation: no cross-property evidence or unauthorized mutation."""
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.procurement.models import (
    GoodsInspection, GoodsReceiptNote, PurchaseOrder, PurchaseRequisition
)
from apps.vendors.models import Supplier


@pytest.mark.django_db
@pytest.mark.parametrize("role", ["Receiving Clerk", "Financial Manager"])
def test_grn_header_and_inspection_evidence_isolated_by_property(role):
    call_command("setup_hotel_roles", verbosity=0)
    a = Branch.objects.create(name=f"GRN {role} A")
    b = Branch.objects.create(name=f"GRN {role} B")
    dept = Department.objects.create(name="GRN audit department")
    user = get_user_model().objects.create_user(
        username=f"grn-scope-{role.replace(' ', '-').lower()}",
        employee_code=f"GRN-{role.replace(' ', '-').upper()}"[:40],
        password="test-password",
    )
    user.groups.add(Group.objects.get(name=role))
    employee = Employee.objects.create(
        user=user, branch=a, department=dept, designation=role,
    )
    foreign_user = get_user_model().objects.create_user(
        username=f"grn-foreign-{role.replace(' ', '-').lower()}",
        employee_code=f"GRNF-{role.replace(' ', '-').upper()}"[:40],
        password="test-password",
    )
    foreign = Employee.objects.create(
        user=foreign_user, branch=b, department=dept, designation="Receiving Clerk",
    )
    supplier = Supplier.objects.create(
        name=f"GRN scope supplier {role}", phone="+256700000001",
        email=f"grn-{role.replace(' ', '-').lower()}@example.com",
        address="Kampala", tin_number=f"GRN-{role}",
        registration_number=f"GRNR-{role}",
    )
    receipts = []
    inspections = []
    for index, (branch, owner) in enumerate([(a, employee), (b, foreign)], 1):
        pr = PurchaseRequisition.objects.create(
            requester=employee, department=dept, branch=branch, reason="GRN scope test",
        )
        po = PurchaseOrder.objects.create(requisition=pr, supplier=supplier, ordered_by=employee)
        receipt = GoodsReceiptNote.objects.create(
            purchase_order=po, received_by=owner, delivery_note_no=f"GRN-DN-{index}",
        )
        inspect = GoodsInspection.objects.create(
            goods_receipt=receipt, inspected_by=owner,
            delivery_note_no=f"GRN-DN-{index}",
        )
        receipts.append(receipt)
        inspections.append(inspect)
    client = APIClient()
    client.force_authenticate(user=user)
    # Financial Manager can review GRN headers, but inspection details are
    # intentionally a Receiving Clerk permission in the ten-role matrix.
    collections = [("grns", receipts[0].pk, receipts[1].pk)]
    if role == "Receiving Clerk":
        collections.append(("goods-inspections", inspections[0].pk, inspections[1].pk))
    for endpoint, expected, forbidden in collections:
        response = client.get(f"/api/v1/{endpoint}/")
        assert response.status_code == 200, response.data
        records = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        ids = {str(row["id"]) for row in records}
        assert str(expected) in ids, endpoint
        assert str(forbidden) not in ids, endpoint
        assert client.get(f"/api/v1/{endpoint}/{forbidden}/").status_code == 404


@pytest.mark.django_db
def test_receiving_clerk_cannot_reassign_or_delete_unowned_grn():
    call_command("setup_hotel_roles", verbosity=0)
    a = Branch.objects.create(name="Receiving property A")
    b = Branch.objects.create(name="Receiving property B")
    dept = Department.objects.create(name="GRN write audit")
    user = get_user_model().objects.create_user(
        username="grn-owner-acceptance", employee_code="GRN-OWNER-01",
        password="test-password",
    )
    user.groups.add(Group.objects.get(name="Receiving Clerk"))
    owner = Employee.objects.create(
        user=user, branch=a, department=dept, designation="Receiving Clerk",
    )
    other_user = get_user_model().objects.create_user(
        username="grn-other-acceptance", employee_code="GRN-OTHER-02",
        password="test-password",
    )
    other = Employee.objects.create(
        user=other_user, branch=b, department=dept, designation="Receiving Clerk",
    )
    supplier = Supplier.objects.create(
        name="GRN write supplier", email="grn-write@example.com",
        phone="+256700000001", address="Kampala",
        tin_number="GRN-WRITE", registration_number="GRN-WRITE",
    )
    pr1 = PurchaseRequisition.objects.create(
        requester=owner, branch=a, department=dept, reason="GRN owner",
    )
    pr2 = PurchaseRequisition.objects.create(
        requester=other, branch=b, department=dept, reason="GRN foreign",
    )
    po1 = PurchaseOrder.objects.create(requisition=pr1, supplier=supplier, ordered_by=owner)
    po2 = PurchaseOrder.objects.create(requisition=pr2, supplier=supplier, ordered_by=other)
    own = GoodsReceiptNote.objects.create(purchase_order=po1, received_by=owner)
    foreign = GoodsReceiptNote.objects.create(purchase_order=po2, received_by=other)
    client = APIClient()
    client.force_authenticate(user=user)
    assert client.delete(f"/api/v1/grns/{foreign.pk}/").status_code == 404
    response = client.patch(
        f"/api/v1/grns/{own.pk}/",
        {"purchase_order": str(po2.pk)}, format="json",
    )
    assert response.status_code in (400, 403), response.data
    own.refresh_from_db()
    assert own.purchase_order_id == po1.pk
    assert client.delete(f"/api/v1/grns/{own.pk}/").status_code == 204
    assert not GoodsReceiptNote.objects.filter(pk=own.pk).exists()


@pytest.mark.django_db
def test_receiving_inspection_line_queryset_denies_unassigned_property():
    """The fourth receiving evidence collection must share header property scope."""
    from apps.procurement.views import GoodsInspectionItemViewSet
    from apps.inventory.models import Category, Item
    from apps.procurement.models import PurchaseOrderItem, GoodsReceiptItem, GoodsInspectionItem, RequisitionItem
    from types import SimpleNamespace

    call_command("setup_hotel_roles", verbosity=0)
    branch_a = Branch.objects.create(name="Inspection line property A")
    branch_b = Branch.objects.create(name="Inspection line property B")
    department = Department.objects.create(name="Inspection line audit")
    user = get_user_model().objects.create_user(
        username="inspection-line-property-owner", employee_code="INSP-SCOPE-A",
        password="test-password",
    )
    user.groups.add(Group.objects.get(name="Receiving Clerk"))
    owner = Employee.objects.create(
        user=user, branch=branch_a, department=department, designation="Receiving Clerk",
    )
    other_user = get_user_model().objects.create_user(
        username="inspection-line-other-owner", employee_code="INSP-SCOPE-B",
        password="test-password",
    )
    other = Employee.objects.create(
        user=other_user, branch=branch_b, department=department,
        designation="Receiving Clerk",
    )
    supplier = Supplier.objects.create(
        name="Inspection line property supplier", email="inspection-scope@example.com",
        phone="+256700000002", address="Kampala",
        tin_number="INSP-SCOPE", registration_number="INSP-SCOPE",
    )
    item = Item.objects.create(
        category=Category.objects.create(name="Inspection line category"),
        name="Inspection audit article", sku="INSP-SCOPE-ITEM",
        unit="kg", reorder_level=Decimal("0.00"),
    )
    lines = []
    for branch, employee in ((branch_a, owner), (branch_b, other)):
        pr = PurchaseRequisition.objects.create(
            requester=employee, department=department, branch=branch,
            reason="Inspection line scope",
        )
        po = PurchaseOrder.objects.create(
            requisition=pr, supplier=supplier, ordered_by=employee,
        )
        req_line = RequisitionItem.objects.create(
            requisition=pr, item=item, quantity=Decimal("1.00"),
        )
        po_line = PurchaseOrderItem.objects.create(
            purchase_order=po, requisition_item=req_line,
            item=item, quantity=Decimal("1.00"),
            unit_cost=Decimal("5.00"),
        )
        receipt = GoodsReceiptNote.objects.create(
            purchase_order=po, received_by=employee,
        )
        receipt_line = GoodsReceiptItem.objects.create(
            goods_receipt=receipt, purchase_order_item=po_line,
            item=item, quantity_received=Decimal("1.00"),
            unit_cost=Decimal("5.00"),
        )
        inspection = GoodsInspection.objects.create(
            goods_receipt=receipt, inspected_by=employee,
        )
        line = GoodsInspectionItem.objects.create(
            inspection=inspection, goods_receipt_item=receipt_line, item=item,
            quantity_received=Decimal("1.00"),
            quantity_accepted=Decimal("1.00"),
        )
        lines.append(line)
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/v1/goods-inspection-items/")
    assert response.status_code == 200, getattr(response, "data", None)
    data = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
    ids = {str(row["id"]) for row in data}
    assert str(lines[0].pk) in ids
    assert str(lines[1].pk) not in ids
    assert client.get(f"/api/v1/goods-inspection-items/{lines[1].pk}/").status_code == 404
    response = client.patch(
        f"/api/v1/goods-inspection-items/{lines[0].pk}/",
        {"inspection": str(lines[1].inspection_id)},
        format="json",
    )
    assert response.status_code in (400, 403), getattr(response, "data", None)
    lines[0].refresh_from_db()
    assert lines[0].inspection_id != lines[1].inspection_id
