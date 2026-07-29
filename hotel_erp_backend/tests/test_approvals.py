from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.core.management import call_command

from apps.approvals.models import ApprovalMatrixRule, ApprovalWorkflow
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


@pytest.mark.django_db
def test_submission_builds_value_based_approval_route():
    department = Department.objects.create(name="Food and Beverage")
    user_model = get_user_model()
    requester_user = user_model.objects.create_user(
        username="chef", employee_code="EMP-CHEF", password="test-pass-123"
    )
    requester = Employee.objects.create(
        user=requester_user, department=department, designation="Executive Chef"
    )
    approvers = []
    for index, title in enumerate(("Department Head", "Finance Manager"), start=1):
        user = user_model.objects.create_user(
            username=f"matrix-{index}",
            employee_code=f"EMP-MATRIX-{index}",
            password="test-pass-123",
        )
        approvers.append(
            Employee.objects.create(
                user=user, department=department, designation=title
            )
        )
        ApprovalMatrixRule.objects.create(
            name="F&B purchasing",
            document_type=ApprovalMatrixRule.DOCUMENT_PURCHASE_REQUISITION,
            department=department,
            minimum_amount=Decimal("0.00"),
            maximum_amount=Decimal("1000000.00"),
            stage=index,
            stage_name=title,
            approver=approvers[-1],
        )

    category = Category.objects.create(name="Fresh Food")
    item = Item.objects.create(
        category=category,
        name="Fresh vegetables",
        unit="kilogram",
        reorder_level=Decimal("10.00"),
    )
    requisition = PurchaseRequisition.objects.create(
        requester=requester,
        department=department,
        reason="Daily kitchen production",
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("20.00"),
        estimated_unit_cost=Decimal("3000.00"),
    )

    requisition.submit()

    steps = list(requisition.approval_workflow.order_by("stage"))
    assert requisition.estimated_total == Decimal("60000.00")
    assert [step.stage_name for step in steps] == ["Department Head", "Finance Manager"]
    assert [step.approver for step in steps] == approvers


@pytest.mark.django_db
def test_only_assigned_employee_can_decide_approval(client):
    call_command("setup_hotel_roles", verbosity=0)
    department = Department.objects.create(name="Rooms Division")
    user_model = get_user_model()
    assigned_user = user_model.objects.create_user(
        username="assigned-hod",
        employee_code="EMP-ASSIGNED",
        password="test-pass-123",
    )
    other_user = user_model.objects.create_user(
        username="other-hod",
        employee_code="EMP-OTHER",
        password="test-pass-123",
    )
    department_head = Group.objects.get(name="Department Head")
    assigned_user.groups.add(department_head)
    other_user.groups.add(department_head)
    assigned_employee = Employee.objects.create(
        user=assigned_user,
        department=department,
        designation="Executive Housekeeper",
    )
    requester = Employee.objects.create(
        user=other_user,
        department=department,
        designation="Rooms Manager",
    )
    category = Category.objects.create(name="Guest Supplies")
    item = Item.objects.create(
        category=category,
        name="Guest soap",
        sku="SOAP-TEST",
        unit="piece",
        reorder_level=Decimal("5.00"),
    )
    requisition = PurchaseRequisition.objects.create(
        requester=requester,
        department=department,
        reason="Replenish guest soap",
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("10.00"),
        estimated_unit_cost=Decimal("1000.00"),
    )
    approval = ApprovalWorkflow.objects.create(
        requisition=requisition,
        approver=assigned_employee,
        stage=1,
    )
    requisition.submit()

    client.force_login(other_user)
    denied = client.post(
        f"/api/v1/approvals/{approval.pk}/approve/",
        {"comments": "Not my assigned stage"},
        content_type="application/json",
    )
    assert denied.status_code == 403
    approval.refresh_from_db()
    assert approval.status == "pending"

    client.force_login(assigned_user)
    allowed = client.post(
        f"/api/v1/approvals/{approval.pk}/approve/",
        {"comments": "Assigned review complete"},
        content_type="application/json",
    )
    assert allowed.status_code == 200
    approval.refresh_from_db()
    assert approval.status == "approved"
