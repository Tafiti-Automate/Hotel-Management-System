from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.core.management import call_command

from apps.approvals.models import ApprovalMatrixRule, ApprovalWorkflow
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import Category, Item
from apps.organization.models import Hotel
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
def test_requester_cannot_be_assigned_to_approve_own_requisition():
    user = get_user_model().objects.create_user(
        username="self-approver",
        employee_code="EMP-SELF",
        password="test-pass-123",
    )
    department = Department.objects.create(name="Front Office")
    requester = Employee.objects.create(
        user=user,
        department=department,
        designation="Department Head",
    )
    requisition = PurchaseRequisition.objects.create(
        requester=requester,
        department=department,
        reason="Front desk supplies",
    )
    rule = ApprovalMatrixRule.objects.create(
        name="Front Office approval",
        document_type=ApprovalMatrixRule.DOCUMENT_PURCHASE_REQUISITION,
        minimum_amount=0,
        stage=1,
        stage_name="Department approval",
        approver=requester,
    )

    with pytest.raises(ValidationError, match="cannot be assigned"):
        rule.resolve_approver(requisition)


@pytest.mark.django_db
def test_hotel_purchase_requisition_passes_ordered_controls():
    user_model = get_user_model()
    management = Department.objects.create(name="Management")
    approvers = []
    for index, designation in enumerate(("Procurement Manager", "Financial Manager", "General Manager"), start=1):
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
    financial_manager = Group.objects.get(name="Financial Manager")
    assigned_user.groups.add(financial_manager)
    other_user.groups.add(financial_manager)
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


@pytest.mark.django_db
def test_financial_manager_role_route_uses_requesting_property():
    call_command("setup_hotel_roles", verbosity=0)
    hotel = Hotel.objects.create(name="Routing Hotel")
    branch = Branch.objects.create(
        hotel=hotel,
        name="Kampala Main",
        branch_code="KLA",
    )
    housekeeping = Department.objects.create(name="Housekeeping Routing")
    food_beverage = Department.objects.create(name="Food and Beverage Routing")
    user_model = get_user_model()
    financial_manager_group = Group.objects.get(name="Financial Manager")
    other_branch = Branch.objects.create(
        hotel=hotel,
        name="Jinja Branch",
        branch_code="JJA",
    )

    housekeeping_user = user_model.objects.create_user(
        username="housekeeping-finance-routing",
        employee_code="EMP-HK-ROUTE",
    )
    housekeeping_user.groups.add(financial_manager_group)
    Employee.objects.create(
        user=housekeeping_user,
        department=housekeeping,
        branch=other_branch,
        designation="Financial Manager",
    )

    food_head_user = user_model.objects.create_user(
        username="food-finance-routing",
        employee_code="EMP-FB-ROUTE",
    )
    food_head_user.groups.add(financial_manager_group)
    food_finance = Employee.objects.create(
        user=food_head_user,
        department=food_beverage,
        branch=branch,
        designation="Financial Manager",
    )
    requester_user = user_model.objects.create_user(
        username="food-requester-routing",
        employee_code="EMP-FB-REQ",
    )
    requester = Employee.objects.create(
        user=requester_user,
        department=food_beverage,
        branch=branch,
        designation="Restaurant Supervisor",
    )
    ApprovalMatrixRule.objects.create(
        name="Dynamic financial approval",
        document_type=ApprovalMatrixRule.DOCUMENT_PURCHASE_REQUISITION,
        minimum_amount=Decimal("0.00"),
        stage=1,
        stage_name="Financial Manager review",
        assignment_type=ApprovalMatrixRule.ASSIGNMENT_ROLE,
        approver_role=financial_manager_group,
    )
    category = Category.objects.create(name="Restaurant Routing Supplies")
    item = Item.objects.create(
        category=category,
        name="Table napkins",
        sku="NAP-ROUTE",
        unit="packet",
        reorder_level=Decimal("2.00"),
    )
    requisition = PurchaseRequisition.objects.create(
        requester=requester,
        department=food_beverage,
        reason="Restaurant service supplies",
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("4.00"),
        estimated_unit_cost=Decimal("5000.00"),
    )

    requisition.submit(actor=requester_user)

    requisition.refresh_from_db()
    assert requisition.branch == branch
    assert requisition.hotel == hotel
    assert requisition.requisition_number.isdigit()
    assert requisition.approval_workflow.get().approver == food_finance


@pytest.mark.django_db
def test_approver_can_return_requisition_for_correction_with_history():
    user = get_user_model().objects.create_user(
        username="correction-approver",
        employee_code="EMP-CORRECT",
    )
    department = Department.objects.create(name="Maintenance Correction")
    approver = Employee.objects.create(
        user=user,
        department=department,
        designation="Maintenance Manager",
    )
    category = Category.objects.create(name="Maintenance Correction Supplies")
    item = Item.objects.create(
        category=category,
        name="LED lamp",
        sku="LED-CORRECT",
        unit="piece",
        reorder_level=Decimal("2.00"),
    )
    requisition = PurchaseRequisition.objects.create(
        requester=approver,
        department=department,
        reason="Replace failed lamps",
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("6.00"),
        estimated_unit_cost=Decimal("12000.00"),
    )
    approval = ApprovalWorkflow.objects.create(
        requisition=requisition,
        approver=approver,
        stage=1,
        stage_name="Department review",
    )
    requisition.submit(actor=user)

    approval.return_for_correction(
        comments="Attach the maintenance inspection report.",
        decided_by=user,
    )

    requisition.refresh_from_db()
    approval.refresh_from_db()
    assert requisition.status == PRStatus.RETURNED
    assert requisition.returned_at is not None
    assert requisition.editable is True
    assert approval.status == "returned"
    assert approval.decided_by == user
    assert approval.decided_at is not None
    assert requisition.history.filter(
        action="returned_for_correction",
        comments="Attach the maintenance inspection report.",
    ).exists()
