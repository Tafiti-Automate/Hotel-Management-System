"""Foundation tests — shared property boundaries and no duplicate guest master."""
from datetime import date, timedelta
import pytest
from django.core.exceptions import ValidationError
from apps.customers.models import Customer
from apps.departments.models import Branch
from apps.hospitality.models import RoomType, Room, Reservation, POSCheck
from apps.inventory.models import StoreLocation
from apps.employees.models import Employee
from apps.departments.models import Department
from django.contrib.auth import get_user_model


@pytest.mark.django_db
def test_room_type_and_room_are_scoped_to_one_property():
    a = Branch.objects.create(name="PMS Test Hotel A")
    b = Branch.objects.create(name="PMS Test Hotel B")
    category = RoomType.objects.create(branch=a, code="STD", name="Standard")
    mismatched = Room(branch=b, room_type=category, number="201")
    with pytest.raises(ValidationError):
        mismatched.full_clean()
    Room.objects.create(branch=a, room_type=category, number="201")
    with pytest.raises(ValidationError):
        Room(branch=a, room_type=category, number="201").full_clean()


@pytest.mark.django_db
def test_reservation_reuses_customer_and_blocks_overlapping_dates():
    a = Branch.objects.create(name="PMS Booking Hotel")
    category = RoomType.objects.create(branch=a, code="DLX", name="Deluxe")
    room = Room.objects.create(branch=a, room_type=category, number="204")
    guest = Customer.objects.create(name="PMS Test Guest")
    start = date(2026, 12, 1)
    Reservation.objects.create(
        branch=a, room=room, customer=guest, reference="PMS-TEST-001",
        arrival_date=start, departure_date=start + timedelta(days=2),
    )
    overlap = Reservation(
        branch=a, room=room, customer=guest, reference="PMS-TEST-002",
        arrival_date=start + timedelta(days=1), departure_date=start + timedelta(days=3),
    )
    with pytest.raises(ValidationError):
        overlap.full_clean()
    departure_day = Reservation(
        branch=a, room=room, customer=guest, reference="PMS-TEST-003",
        arrival_date=start + timedelta(days=2), departure_date=start + timedelta(days=3),
    )
    departure_day.full_clean()


@pytest.mark.django_db
def test_pos_check_rejects_cross_property_room_charge():
    a = Branch.objects.create(name="POS Hotel A")
    b = Branch.objects.create(name="POS Hotel B")
    guest = Customer.objects.create(name="POS Test Guest")
    room_type = RoomType.objects.create(branch=b, code="STD", name="Standard")
    room = Room.objects.create(branch=b, room_type=room_type, number="101")
    reservation = Reservation.objects.create(
        branch=b, room=room, customer=guest, reference="PMS-POS-001",
        arrival_date=date(2026, 12, 1), departure_date=date(2026, 12, 2),
    )
    outlet = StoreLocation.objects.create(branch=a, name="Bar POS Test Outlet")
    user = get_user_model().objects.create_user(
        username="pos-foundation-operator", employee_code="POS-BASE-01", password="test-password"
    )
    employee = Employee.objects.create(user=user, branch=a, department=Department.objects.create(name="POS Test Department"), designation="Bartender")
    check = POSCheck(branch=a, outlet=outlet, reservation=reservation, opened_by=employee, reference="BAR-001")
    with pytest.raises(ValidationError):
        check.full_clean()


@pytest.mark.django_db
def test_operational_roles_provisioned_without_granting_materials_control_posting():
    from apps.accounts.role_templates import HOSPITALITY_ROLE_SPECS
    assert "Receptionist" in HOSPITALITY_ROLE_SPECS
    assert "Bartender" in HOSPITALITY_ROLE_SPECS
    assert "Cashier" in HOSPITALITY_ROLE_SPECS
    assert "Housekeeper" in HOSPITALITY_ROLE_SPECS
    assert "procurement" not in HOSPITALITY_ROLE_SPECS["Bartender"].get("crud", {})
