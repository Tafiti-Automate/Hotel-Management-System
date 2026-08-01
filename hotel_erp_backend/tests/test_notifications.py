import pytest
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import Category, Item, StoreLocation, StoreRequisition, StoreRequisitionItem
from apps.notifications.models import Notification


def create_employee(username, employee_code, department):
    user = get_user_model().objects.create_user(
        username=username,
        employee_code=employee_code,
        password="test-pass-123",
    )
    employee = Employee.objects.create(
        user=user,
        department=department,
        designation="Hotel Staff",
    )
    return user, employee


@pytest.mark.django_db
def test_staff_only_sees_their_own_notifications():
    department = Department.objects.create(name="Procurement")
    user, employee = create_employee("daniel", "EMP-PROC", department)
    _, other_employee = create_employee("alex", "EMP-STORES", department)
    own = Notification.objects.create(
        employee=employee,
        title="Purchase requisition awaiting review",
        message="A department requisition is ready for procurement.",
    )
    Notification.objects.create(
        employee=other_employee,
        title="Low stock",
        message="A store article is below its reorder level.",
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get("/api/v1/notifications/")

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["id"] == str(own.id)


@pytest.mark.django_db
def test_staff_can_mark_own_notifications_read_but_not_another_employees():
    department = Department.objects.create(name="Stores")
    user, employee = create_employee("alex", "EMP-STORE", department)
    _, other_employee = create_employee("daniel", "EMP-BUYER", department)
    own = Notification.objects.create(
        employee=employee,
        title="Reorder threshold reached",
        message="A4 paper requires replenishment.",
    )
    other = Notification.objects.create(
        employee=other_employee,
        title="Requisition ready",
        message="A requisition is awaiting review.",
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post(f"/api/v1/notifications/{own.id}/mark-read/")
    blocked = client.post(f"/api/v1/notifications/{other.id}/mark-read/")

    own.refresh_from_db()
    other.refresh_from_db()
    assert response.status_code == 200
    assert response.data["is_read"] is True
    assert own.is_read is True
    assert blocked.status_code == 404
    assert other.is_read is False


@pytest.mark.django_db
def test_staff_can_mark_all_of_their_notifications_read():
    department = Department.objects.create(name="Management")
    user, employee = create_employee("grace", "EMP-GM", department)
    _, other_employee = create_employee("esther", "EMP-HOD", department)
    for index in range(2):
        Notification.objects.create(
            employee=employee,
            title=f"Management alert {index + 1}",
            message="A controlled document needs attention.",
        )
    other = Notification.objects.create(
        employee=other_employee,
        title="Department alert",
        message="A department document needs attention.",
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post("/api/v1/notifications/mark-all-read/")

    other.refresh_from_db()
    assert response.status_code == 200
    assert response.data["updated"] == 2
    assert not Notification.objects.filter(employee=employee, is_read=False).exists()
    assert other.is_read is False


@pytest.mark.django_db
def test_department_store_request_notifies_each_next_role():
    branch = Branch.objects.create(name="Notification Hotel")
    department = Department.objects.create(name="Notification Housekeeping")
    store = StoreLocation.objects.create(branch=branch, name="Notification Main Store")
    category = Category.objects.create(name="Notification Supplies")
    item = Item.objects.create(
        category=category,
        name="Notification Soap",
        unit="piece",
        reorder_level=Decimal("1.00"),
    )

    requester_user, requester = create_employee("notify-requester", "NOTIFY-REQ", department)
    requester.branch = branch
    requester.save(update_fields=("branch", "updated_at"))
    head_user, head = create_employee("notify-head", "NOTIFY-HOD", department)
    head.branch = branch
    head.save(update_fields=("branch", "updated_at"))
    stores_user, stores = create_employee("notify-stores", "NOTIFY-STORE", department)
    stores.branch = branch
    stores.save(update_fields=("branch", "updated_at"))
    procurement_user, procurement = create_employee("notify-procurement", "NOTIFY-PROC", department)
    procurement.branch = branch
    procurement.save(update_fields=("branch", "updated_at"))

    head_user.groups.add(Group.objects.create(name="Department Head"))
    stores_user.groups.add(Group.objects.create(name="Stores Manager"))
    procurement_user.groups.add(Group.objects.create(name="Procurement Manager"))

    requisition = StoreRequisition.objects.create(
        department=department,
        store=store,
        requested_by=requester,
        purpose="Guest room preparation",
    )
    StoreRequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity_requested=Decimal("4.00"),
    )

    requisition.submit(actor=requester_user)
    assert Notification.objects.filter(
        employee=head,
        title__contains="needs department approval",
    ).exists()

    requisition.approve_department(head, "Required for occupied rooms")
    assert Notification.objects.filter(
        employee=stores,
        title__contains="needs a stock decision",
    ).exists()

    purchase = requisition.create_shortage_purchase_requisition(
        created_by=stores_user,
        reason="No soap is available in the store.",
    )
    assert purchase.source_store_requisition == requisition
    assert Notification.objects.filter(
        employee=procurement,
        title__contains="confirmed stock shortage",
    ).exists()
