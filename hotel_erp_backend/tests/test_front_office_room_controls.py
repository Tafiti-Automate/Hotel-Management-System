"""Property-locked Front Office Manager room condition and room move controls."""
from datetime import date, timedelta
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from rest_framework.exceptions import PermissionDenied, ValidationError
from apps.audit_logs.models import AuditLog
from apps.customers.models import Customer
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.hospitality.models import Reservation, Room, RoomType
from apps.hospitality.services import change_room_condition, move_reservation_room


@pytest.fixture
def front_office():
    branch = Branch.objects.create(name="PMS Move Hotel")
    other = Branch.objects.create(name="Other PMS Hotel")
    room_type = RoomType.objects.create(branch=branch, code="STD", name="Standard", capacity=2)
    source = Room.objects.create(branch=branch, room_type=room_type, number="101", status="occupied", housekeeping_status="inspected")
    target = Room.objects.create(branch=branch, room_type=room_type, number="102", housekeeping_status="clean")
    conflict = Room.objects.create(branch=branch, room_type=room_type, number="103", housekeeping_status="clean")
    remote_type = RoomType.objects.create(branch=other, code="STD", name="Standard")
    remote = Room.objects.create(branch=other, room_type=remote_type, number="999", housekeeping_status="clean")
    user = get_user_model().objects.create_user(username="pms-moving-manager", employee_code="PMS-MOV-01", password="test-password")
    user.groups.add(Group.objects.get_or_create(name="Front Office Manager")[0])
    for code in ("change_room", "change_reservation"):
        user.user_permissions.add(Permission.objects.get(content_type__app_label="hospitality", codename=code))
    Employee.objects.create(
        user=user, branch=branch, department=Department.objects.create(name="PMS Moving Team"),
        designation="Front Office Manager",
    )
    guest = Customer.objects.create(name="Front Office Test Guest")
    start = date.today()
    stay = Reservation.objects.create(
        branch=branch, customer=guest, room=source, reference="PMS-ROOM-MOVE-001",
        arrival_date=start, departure_date=start + timedelta(days=2), status="checked_in",
    )
    return user, branch, other, source, target, conflict, remote, stay


@pytest.mark.django_db
def test_checked_in_move_is_atomic_and_audited(front_office):
    user, branch, _, source, target, _, _, stay = front_office
    result = move_reservation_room(user, stay, target.pk, "Guest requests a quieter room")
    source.refresh_from_db(); target.refresh_from_db(); stay.refresh_from_db()
    assert result.pk == stay.pk and stay.room_id == target.pk
    assert source.status == "vacant" and source.housekeeping_status == "dirty"
    assert target.status == "occupied"
    log = AuditLog.objects.get(action="pms.reservation.room_moved", entity_id=str(stay.pk))
    assert log.metadata["from_room_id"] == str(source.pk) and log.metadata["to_room_id"] == str(target.pk)
    with pytest.raises(ValidationError):
        move_reservation_room(user, stay, source.pk, "Trying to return without cleaning")


@pytest.mark.django_db
def test_moves_reject_other_properties_and_booking_conflicts(front_office):
    user, branch, _, source, target, conflict, remote, stay = front_office
    with pytest.raises(ValidationError):
        move_reservation_room(user, stay, remote.pk, "Transfer to a different property")
    Customer.objects.get(pk=stay.customer_id)
    Reservation.objects.create(
        branch=branch, customer=stay.customer, room=conflict, reference="PMS-ROOM-MOVE-CONFLICT",
        arrival_date=stay.arrival_date, departure_date=stay.departure_date,
    )
    with pytest.raises(ValidationError):
        move_reservation_room(user, stay, conflict.pk, "Guest requested unavailable room")
    stay.refresh_from_db()
    assert stay.room_id == source.pk
    assert not AuditLog.objects.filter(action="pms.reservation.room_moved").exists()


@pytest.mark.django_db
def test_housekeeping_transitions_and_out_of_order_controls(front_office):
    user, _, _, source, target, conflict, _, stay = front_office
    updated = change_room_condition(user, target, "inspected", "Inspection completed by supervisor")
    assert updated.housekeeping_status == "inspected"
    with pytest.raises(ValidationError):
        change_room_condition(user, source, "out_of_order", "Room requires maintenance")
    with pytest.raises(ValidationError):
        change_room_condition(user, target, "clean", "Already inspected and still clean")
    change_room_condition(user, conflict, "out_of_order", "Water leak in the bathroom")
    with pytest.raises(ValidationError):
        change_room_condition(user, conflict, "inspected", "Cannot inspect closed room")
    restored = change_room_condition(user, conflict, "return_to_service", "Maintenance completed and released")
    assert restored.status == "vacant" and restored.housekeeping_status == "dirty"
    assert AuditLog.objects.filter(action="pms.room.condition_changed", entity_id=str(conflict.pk)).count() == 2


@pytest.mark.django_db
def test_room_move_and_status_permissions_fail_closed(front_office):
    user, branch, _, source, target, conflict, _, stay = front_office
    user.groups.clear()
    with pytest.raises(PermissionDenied):
        move_reservation_room(user, stay, target.pk, "This user is no longer the manager")
    with pytest.raises(PermissionDenied):
        change_room_condition(user, conflict, "clean", "No authorized housekeeping role")
    assert not AuditLog.objects.filter(action__startswith='pms.').exists()


@pytest.mark.django_db
def test_housekeeping_blocks_out_of_order_when_reservations_exist(front_office):
    user, branch, _, source, target, conflict, _, stay = front_office
    Reservation.objects.create(
        branch=branch, customer=stay.customer, room=conflict, reference="PMS-OOO-CONFLICT",
        arrival_date=stay.departure_date + timedelta(days=1),
        departure_date=stay.departure_date + timedelta(days=2),
    )
    with pytest.raises(ValidationError):
        change_room_condition(user, conflict, "out_of_order", "Scheduled maintenance with a booked room")
    conflict.refresh_from_db()
    assert conflict.status == "vacant"
    assert not AuditLog.objects.filter(action="pms.room.condition_changed", entity_id=str(conflict.pk)).exists()


@pytest.mark.django_db
def test_room_control_api_validates_scope_and_permissions(front_office):
    from rest_framework.test import APIClient
    user, branch, _, source, target, conflict, remote, stay = front_office
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post(
        "/api/v1/hospitality-rooms/" + str(target.pk) + "/change-condition/",
        {"condition": "inspected", "reason": "Supervisor inspected the prepared room"},
        format="json",
    )
    assert response.status_code == 200, response.data
    forbidden = client.post(
        "/api/v1/hospitality-rooms/" + str(remote.pk) + "/change-condition/",
        {"condition": "clean", "reason": "Attempt to change another hotel room"},
        format="json",
    )
    assert forbidden.status_code == 404
    moved = client.post(
        "/api/v1/hospitality-reservations/" + str(stay.pk) + "/move-room/",
        {"target_room": str(target.pk), "reason": "Checked-in guest approved room change"},
        format="json",
    )
    assert moved.status_code == 200, moved.data
    stay.refresh_from_db()
    assert stay.room_id == target.pk
