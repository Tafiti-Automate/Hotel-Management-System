from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError

from apps.approvals.models import ApprovalWorkflow
from apps.departments.models import Department
from apps.employees.models import Employee
from apps.inventory.models import Category, Item
from apps.procurement.models import PurchaseRequisition, RequisitionItem
from apps.vendors.models import Supplier
from core.constants.choices import PRStatus, RequisitionType


@pytest.mark.django_db
def test_requisition_can_receive_approval_stage():
    user = get_user_model().objects.create_user(
        username="hod",
        employee_code="EMP-HOD",
        password="test-pass-123",
    )
    department = Department.objects.create(name="Housekeeping")
    approver = Employee.objects.create(
        user=user,
        department=department,
        designation="Head of Department",
    )
    category = Category.objects.create(name="Housekeeping Supplies")
    item = Item.objects.create(
        category=category,
        name="Detergent",
        sku="DET-001",
        unit="litre",
        reorder_level=Decimal("8.00"),
    )
    requisition = PurchaseRequisition.objects.create(
        requester=approver,
        department=department,
        reason="Routine housekeeping restock",
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("6.00"),
    )

    approval = ApprovalWorkflow.objects.create(
        requisition=requisition,
        approver=approver,
        stage=1,
    )

    assert approval.status == "pending"
    assert approval.requisition == requisition


@pytest.mark.django_db
def test_department_requisition_requires_requester_and_department():
    requisition = PurchaseRequisition(
        request_type=RequisitionType.DEPARTMENT,
        reason="Department restock",
    )

    with pytest.raises(ValidationError):
        requisition.full_clean()


@pytest.mark.django_db
def test_hotel_purchase_requisition_passes_ordered_controls():
    user_model = get_user_model()
    management = Department.objects.create(name="Management")
    approvers = []
    for index, designation in enumerate(("Procurement Manager", "Finance Controller", "Director"), start=1):
        user = user_model.objects.create_user(
            username=f"approver-{index}",
            employee_code=f"EMP-APR-{index}",
            password="test-pass-123",
        )
        approvers.append(
            Employee.objects.create(
                user=user,
                department=management,
                designation=designation,
            )
        )
    supplier = Supplier.objects.create(
        name="Hotel Equipment Supplier",
        email="equipment@example.com",
        phone="+256700000030",
        address="Kampala",
        tin_number="TIN-030",
        registration_number="REG-030",
    )
    category = Category.objects.create(name="Hotel Equipment")
    item = Item.objects.create(
        category=category,
        name="Commercial Blender",
        sku="BLEND-001",
        unit="piece",
        reorder_level=Decimal("1.00"),
    )
    requisition = PurchaseRequisition.objects.create(
        request_type=RequisitionType.HOTEL_PURCHASE,
        preferred_supplier=supplier,
        reason="Hotel-wide kitchen equipment purchase",
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("2.00"),
    )
    first_stage = ApprovalWorkflow.objects.create(
        requisition=requisition,
        approver=approvers[0],
        stage=1,
    )
    second_stage = ApprovalWorkflow.objects.create(
        requisition=requisition,
        approver=approvers[1],
        stage=2,
    )
    final_stage = ApprovalWorkflow.objects.create(
        requisition=requisition,
        approver=approvers[2],
        stage=3,
    )

    requisition.submit()
    requisition.refresh_from_db()
    assert requisition.status == PRStatus.SUBMITTED

    with pytest.raises(ValidationError):
        second_stage.approve()

    first_stage.approve()
    requisition.refresh_from_db()
    assert requisition.status == PRStatus.PROCUREMENT_APPROVED

    second_stage.approve()
    requisition.refresh_from_db()
    assert requisition.status == PRStatus.FINANCE_APPROVED

    final_stage.approve()
    requisition.refresh_from_db()
    assert requisition.status == PRStatus.APPROVED
