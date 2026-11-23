"""Hotel room master configuration: Administrator + Front Office Manager only."""
from datetime import date

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.hospitality.models import Reservation, Room, RoomType
from apps.customers.models import Customer


@pytest.fixture
def room_users(db):
    call_command("setup_hotel_roles", verbosity=0)
    branch = Branch.objects.create(name="Room Master Branch A")
    other = Branch.objects.create(name="Room Master Branch B")
    department = Department.objects.create(name="Room Master Front Office")

    def make(role, suffix, employee_branch=None):
        user = get_user_model().objects.create_user(
            username=f"room-master-{suffix}", employee_code=f"RM-{suffix.upper()}",
            password="test-pass-123",
        )
        user.groups.add(Group.objects.get(name=role))
        if employee_branch:
            Employee.objects.create(
                user=user, branch=employee_branch, department=department, designation=role,
            )
        client = APIClient()
        client.force_authenticate(user=user)
        return user, client

    admin, admin_client = make("System Administrator", "admin")  # No employee assignment
    manager, manager_client = make("Front Office Manager", "manager", branch)
    outsider, other_client = make("Front Office Manager", "other", other)
    receptionist, front_client = make("Receptionist", "front", branch)
    return {
        "branch": branch, "other": other,
        "admin": admin, "admin_client": admin_client,
        "manager": manager, "manager_client": manager_client,
        "other_client": other_client, "front_client": front_client,
    }


@pytest.mark.django_db
def test_administrator_without_employee_can_register_room_types_and_rooms(room_users):
    ctx = room_users
    assert ctx["admin"].has_perm("hospitality.add_room")
    assert ctx["admin"].has_perm("hospitality.add_roomtype")
    types = "/api/v1/hospitality-room-types/"
    rooms = "/api/v1/hospitality-rooms/"
    kind = ctx["admin_client"].post(types, {
        "branch": str(ctx["branch"].pk), "code": "DLX",
        "name": "Deluxe", "capacity": 2, "is_active": True,
    }, format="json")
    assert kind.status_code == 201, kind.data
    created = ctx["admin_client"].post(rooms, {
        "branch": str(ctx["branch"].pk), "room_type": kind.data["id"],
        "number": "101", "floor": "First", "is_active": True,
    }, format="json")
    assert created.status_code == 201, created.data
    room = Room.objects.get(pk=created.data["id"])
    assert room.number == "101"
    assert room.status == Room.STATUS_VACANT
    assert room.housekeeping_status == "dirty"
    assert room.branch_id == ctx["branch"].pk
    assert room.created_by_id == ctx["admin"].pk

    visible = ctx["front_client"].get(rooms)
    assert visible.status_code == 200
    assert [row["number"] for row in visible.data["results"]] == ["101"]
    assert ctx["front_client"].get(types).data["count"] == 1
    availability = ctx["front_client"].get(
        "/api/v1/hospitality-reservations/availability/",
        {"arrival": "2026-12-03", "departure": "2026-12-05"},
    )
    assert availability.status_code == 200, availability.data
    assert "101" in [entry["number"] for entry in availability.data]

    updated = ctx["admin_client"].patch(
        rooms + str(room.pk) + "/", {"floor": "Second"}, format="json",
    )
    assert updated.status_code == 200, updated.data
    room.refresh_from_db()
    assert room.floor == "Second"
    assert ctx["admin_client"].delete(rooms + str(room.pk) + "/").status_code == 405


@pytest.mark.django_db
def test_front_office_manager_can_create_only_at_assigned_property(room_users):
    ctx = room_users
    endpoint = "/api/v1/hospitality-room-types/"
    allowed = ctx["manager_client"].post(endpoint, {
        "branch": str(ctx["branch"].pk), "code": "STD", "name": "Standard", "capacity": 2,
    }, format="json")
    assert allowed.status_code == 201, allowed.data
    prohibited = ctx["manager_client"].post(endpoint, {
        "branch": str(ctx["other"].pk), "code": "OTHER", "name": "Other", "capacity": 2,
    }, format="json")
    assert prohibited.status_code == 403, prohibited.data
    other = RoomType.objects.create(branch=ctx["other"], code="OTH", name="Other property")
    cross_type = ctx["manager_client"].post("/api/v1/hospitality-rooms/", {
        "branch": str(ctx["branch"].pk), "room_type": str(other.pk), "number": "202",
    }, format="json")
    assert cross_type.status_code == 400, cross_type.data
    assert ctx["manager_client"].get(endpoint).data["count"] == 1
    assert ctx["other_client"].get(endpoint).data["count"] == 1
    assert ctx["other_client"].patch(
        endpoint + allowed.data["id"] + "/", {"name": "Inter-property rename"}, format="json",
    ).status_code == 404


@pytest.mark.django_db
def test_receptionist_cannot_write_rooms_or_room_types(room_users):
    ctx=room_users
    kind=RoomType.objects.create(branch=ctx["branch"], code="STD", name="Standard")
    room=Room.objects.create(branch=ctx["branch"], room_type=kind, number="104")
    client=ctx["front_client"]
    assert client.get("/api/v1/hospitality-rooms/").status_code == 200
    assert client.post("/api/v1/hospitality-rooms/", {
        "branch": str(ctx["branch"].pk), "room_type": str(kind.pk), "number": "105",
    }, format="json").status_code == 403
    assert client.patch(
        f"/api/v1/hospitality-rooms/{room.pk}/", {"floor": "Third"}, format="json",
    ).status_code == 403
    assert client.post("/api/v1/hospitality-room-types/", {
        "branch": str(ctx["branch"].pk), "code": "NEW", "name": "New",
    }, format="json").status_code == 403


@pytest.mark.django_db
def test_room_configuration_cannot_overwrite_operational_status_or_cross_property(room_users):
    ctx=room_users
    kind=RoomType.objects.create(branch=ctx["branch"], code="STD", name="Standard")
    room=Room.objects.create(branch=ctx["branch"], room_type=kind, number="105")
    endpoint=f"/api/v1/hospitality-rooms/{room.pk}/"
    manager=ctx["manager_client"]
    for payload in ({"status": "occupied"}, {"housekeeping_status": "clean"}):
        response=manager.patch(endpoint, payload, format="json")
        assert response.status_code == 400, response.data
    reassigned=manager.patch(
        endpoint, {"branch": str(ctx["other"].pk)}, format="json",
    )
    assert reassigned.status_code == 400, reassigned.data
    room.refresh_from_db()
    assert room.branch_id == ctx["branch"].pk
    assert room.status == "vacant"
    assert room.housekeeping_status == "dirty"


@pytest.mark.django_db
def test_room_with_reservation_history_cannot_be_renumbered_or_deactivated(room_users):
    ctx=room_users
    kind=RoomType.objects.create(branch=ctx["branch"], code="STD", name="Standard")
    room=Room.objects.create(branch=ctx["branch"], room_type=kind, number="106")
    customer=Customer.objects.create(name="Room History Test Guest")
    Reservation.objects.create(
        branch=ctx["branch"], customer=customer, room=room, reference="RM-RES-10001",
        arrival_date=date(2026, 12, 10), departure_date=date(2026, 12, 12),
    )
    endpoint=f"/api/v1/hospitality-rooms/{room.pk}/"
    manager=ctx["manager_client"]
    assert manager.patch(endpoint, {"number": "107"}, format="json").status_code == 400
    assert manager.patch(endpoint, {"is_active": False}, format="json").status_code == 400
    assert manager.patch(
        f"/api/v1/hospitality-room-types/{kind.pk}/", {"is_active": False}, format="json",
    ).status_code == 400
    room.refresh_from_db()
    assert room.is_active
    assert room.number == "106"


@pytest.mark.django_db
def test_room_numbers_and_type_codes_are_unique_within_property(room_users):
    ctx = room_users
    kind = RoomType.objects.create(branch=ctx["branch"], code="STD", name="Standard")
    Room.objects.create(branch=ctx["branch"], room_type=kind, number="101")
    room_dup = ctx["admin_client"].post("/api/v1/hospitality-rooms/", {
        "branch": str(ctx["branch"].pk), "room_type": str(kind.pk), "number": "101",
    }, format="json")
    assert room_dup.status_code == 400, room_dup.data
    type_dup = ctx["admin_client"].post("/api/v1/hospitality-room-types/", {
        "branch": str(ctx["branch"].pk), "code": "std", "name": "Same", "capacity": 2,
    }, format="json")
    assert type_dup.status_code == 400, type_dup.data
    assert Room.objects.filter(branch=ctx["branch"], number="101").count() == 1
