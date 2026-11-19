"""Property-scoped REST and booking integrity smoke tests."""
from datetime import date, timedelta
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APIClient
import pytest
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.customers.models import Customer
from apps.hospitality.models import POSCheck, POSOrderLine, PropertyGuest, Reservation, Room, RoomType
from apps.inventory.models import StoreLocation
from apps.materials_control.models import OutletAssignment


@pytest.fixture
def operational_context(db):
    call_command("setup_hotel_roles", verbosity=0)
    a = Branch.objects.create(name="PMS API Property A")
    b = Branch.objects.create(name="PMS API Property B")
    department = Department.objects.create(name="Hospitality Operations")
    guest = Customer.objects.create(name="Hotel API Test Guest")
    rt_a = RoomType.objects.create(branch=a, code="STD", name="Standard")
    rt_b = RoomType.objects.create(branch=b, code="STD", name="Standard")
    room_a = Room.objects.create(branch=a, room_type=rt_a, number="201")
    room_b = Room.objects.create(branch=b, room_type=rt_b, number="201")
    outlet_a = StoreLocation.objects.create(branch=a, name="API Bar")
    outlet_b = StoreLocation.objects.create(branch=b, name="Other Hotel Bar")
    def staff(role, name, branch):
        user = get_user_model().objects.create_user(
            username=name, employee_code="API-" + name.upper(), password="test-password",
        )
        user.groups.add(Group.objects.get(name=role))
        person = Employee.objects.create(
            user=user, branch=branch, department=department, designation=role,
        )
        client = APIClient()
        client.force_authenticate(user=user)
        return client, person
    front, front_person = staff("Receptionist", "reception-api", a)
    PropertyGuest.objects.create(branch=a, customer=guest, registered_by=front_person)
    other, _ = staff("Receptionist", "other-front-api", b)
    bartender, bar_person = staff("Bartender", "bartender-api", a)
    OutletAssignment.objects.create(employee=bar_person, outlet=outlet_a, is_active=True)
    return locals()


@pytest.mark.django_db
def test_reservations_are_isolated_and_reject_overbooking(operational_context):
    c = operational_context
    endpoint = "/api/v1/hospitality-reservations/"
    payload = {
        "branch": str(c["a"].pk), "room": str(c["room_a"].pk),
        "customer": str(c["guest"].pk), "reference": "PMS-API-001",
        "arrival_date": "2026-12-01", "departure_date": "2026-12-04",
    }
    first = c["front"].post(endpoint, payload, format="json")
    assert first.status_code == 201, first.data
    assert c["other"].get(endpoint).data["count"] == 0
    conflicting = c["front"].post(endpoint, dict(payload, reference="PMS-API-002"), format="json")
    assert conflicting.status_code == 400, conflicting.data
    cross = c["front"].post(endpoint, dict(payload, room=str(c["room_b"].pk), reference="PMS-API-003"), format="json")
    assert cross.status_code == 400
    available = c["front"].get(endpoint + "availability/", {"arrival": "2026-12-02", "departure": "2026-12-03"})
    assert available.status_code == 200
    assert str(c["room_a"].pk) not in {row["id"] for row in available.data}


@pytest.mark.django_db
def test_pos_checks_require_assigned_outlet_and_disallow_room_charge(operational_context):
    c = operational_context
    endpoint = "/api/v1/hospitality-pos-checks/"
    wrong = c["bartender"].post(endpoint, {
        "branch": str(c["a"].pk), "outlet": str(c["outlet_b"].pk), "reference": "BAR-UNASSIGNED",
    }, format="json")
    assert wrong.status_code == 403
    outlet_list = c["bartender"].get(endpoint + "outlets/")
    assert outlet_list.status_code == 200
    assert [row["id"] for row in outlet_list.data] == [str(c["outlet_a"].pk)]
    assert c["front"].get(endpoint + "outlets/").data == []
    created = c["bartender"].post(endpoint, {
        "branch": str(c["a"].pk), "outlet": str(c["outlet_a"].pk), "reference": "BAR-001",
    }, format="json")
    assert created.status_code == 201, created.data
    assert created.data["status"] == "open"
    assert c["bartender"].patch(endpoint + str(created.data["id"]) + "/", {"status": "settled"}, format="json").status_code == 405
    front_response = c["front"].get(endpoint)
    assert front_response.status_code == 200
    assert front_response.data["count"] == 0  # Property-scoped and not assigned to the outlet
    assert POSCheck.objects.get(reference="BAR-001").status == "open"
    reservation = Reservation.objects.create(
        branch=c["a"], customer=c["guest"], room=c["room_a"], reference="ROOM-POS-001",
        arrival_date=date(2026, 12, 1), departure_date=date(2026, 12, 4),
    )
    blocked = c["bartender"].post(endpoint, {
        "branch": str(c["a"].pk), "outlet": str(c["outlet_a"].pk), "reference": "BAR-ROOM",
        "reservation": str(reservation.pk),
    }, format="json")
    assert blocked.status_code == 400


@pytest.mark.django_db
def test_existing_materials_control_readiness_baseline_remains_ten(operational_context):
    from apps.accounts.role_templates import ROLE_SPECS, HOSPITALITY_ROLE_SPECS
    assert len(ROLE_SPECS) == 10
    assert len(HOSPITALITY_ROLE_SPECS) == 10
    assert Group.objects.filter(name__in=HOSPITALITY_ROLE_SPECS).count() == 10

@pytest.mark.django_db
def test_property_guest_registration_scoped_and_required_for_booking(operational_context):
    c = operational_context
    register = "/api/v1/hospitality-guests/register/"
    created = c["front"].post(register, {"name": "Guest Only In A", "phone": "+256700001234"}, format="json")
    assert created.status_code == 201, created.data
    assert c["front"].get("/api/v1/hospitality-guests/").data["count"] == 2
    assert c["other"].get("/api/v1/hospitality-guests/").data["count"] == 0
    booking = {
        "branch": str(c["b"].pk), "room": str(c["room_b"].pk),
        "customer": created.data["id"], "reference": "CROSS-GUEST-BLOCK",
        "arrival_date": "2026-12-11", "departure_date": "2026-12-12",
    }
    response = c["other"].post("/api/v1/hospitality-reservations/", booking, format="json")
    assert response.status_code == 400
    assert not PropertyGuest.objects.filter(branch=c["b"], customer_id=created.data["id"]).exists()


@pytest.mark.django_db
def test_pos_draft_order_line_pricing_idempotency_and_outlet_scope(operational_context):
    from decimal import Decimal
    from apps.materials_control.models import Recipe
    c = operational_context
    recipe = Recipe.objects.create(
        name="POS API Fresh Juice", outlet=c["outlet_a"],
        yield_quantity=Decimal("1.0000"), target_food_cost_percent=Decimal("30.00"),
        selling_price=Decimal("12000.00"), status=Recipe.STATUS_PUBLISHED,
    )
    check_result = c["bartender"].post("/api/v1/hospitality-pos-checks/", {
        "branch": str(c["a"].pk), "outlet": str(c["outlet_a"].pk),
        "reference": "POS-DRAFT-2026",
    }, format="json")
    assert check_result.status_code == 201, check_result.data
    pk = check_result.data["id"]
    url = f"/api/v1/hospitality-pos-checks/{pk}/add-line/"
    line = {"recipe": str(recipe.pk), "quantity": "2.5000", "client_reference": "tap-001"}
    created = c["bartender"].post(url, line, format="json")
    assert created.status_code == 201, created.data
    assert Decimal(created.data["line_total"]) == Decimal("30000.00")
    repeat = c["bartender"].post(url, line, format="json")
    assert repeat.status_code == 201
    assert POSOrderLine.objects.filter(check_id=pk).count() == 1
    altered = c["bartender"].post(url, {**line, "quantity": "3"}, format="json")
    assert altered.status_code == 400
    assert c["bartender"].post(url, {**line, "quantity": "-1", "client_reference": "tap-002"}, format="json").status_code == 400
    assert c["other"].get(f"/api/v1/hospitality-pos-checks/{pk}/").status_code in (403, 404)
    assert POSOrderLine.objects.get(check_id=pk).unit_price_snapshot == Decimal("12000.00")
    assert c["bartender"].get(f"/api/v1/hospitality-pos-checks/{pk}/lines/").status_code == 200
