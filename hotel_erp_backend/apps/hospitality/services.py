"""Atomic reservation allocation and read-only property scope checks."""
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.departments.models import Branch
from apps.employees.models import Employee
from apps.hospitality.models import Reservation, Room
from apps.materials_control.models import OutletAssignment


def assigned_employee(user):
    if not user or not user.is_authenticated or not user.is_active:
        raise PermissionDenied("An active operational account is required.")
    employee = Employee.objects.filter(user=user, is_active=True, branch__is_active=True).first()
    if not employee or not employee.branch_id:
        raise PermissionDenied("An active employee property assignment is required.")
    return employee


def require_property(user, branch_id):
    employee = assigned_employee(user)
    if str(employee.branch_id) != str(branch_id):
        raise PermissionDenied("Record belongs to another property.")
    return employee


def require_outlet(employee, outlet):
    if outlet.branch_id != employee.branch_id or not outlet.is_active:
        raise PermissionDenied("The POS outlet is unavailable for this property.")
    if not OutletAssignment.objects.filter(
        employee=employee, outlet=outlet, is_active=True,
    ).exists():
        raise PermissionDenied("A current assignment to this outlet is required.")


def save_reservation(payload, user, instance=None):
    # Lock the parent property first: serializes competing bookings for the
    # same hotel even where SQLite lacks row-level SELECT FOR UPDATE.
    branch = payload["branch"]
    require_property(user, branch.pk)
    with transaction.atomic():
        Branch.objects.select_for_update().get(pk=branch.pk)
        if instance:
            locked = Reservation.objects.select_for_update().get(pk=instance.pk, branch=branch)
            if locked.status != Reservation.STATUS_RESERVED:
                raise ValidationError({"status": "Only reserved bookings can be edited."})
        else:
            locked = Reservation(branch=branch)
        for field, value in payload.items():
            setattr(locked, field, value)
        locked.status = Reservation.STATUS_RESERVED
        try:
            locked.full_clean()
        except DjangoValidationError as error:
            raise ValidationError(getattr(error, "message_dict", None) or error.messages)
        locked.save()
    return locked


def room_availability(branch_id, arrival, departure, user):
    require_property(user, branch_id)
    if departure <= arrival:
        raise ValidationError({"departure": "Departure must be after arrival."})
    occupied = Reservation.objects.filter(
        branch_id=branch_id,
        room__isnull=False,
        status__in=(Reservation.STATUS_RESERVED, Reservation.STATUS_CHECKED_IN),
        arrival_date__lt=departure,
        departure_date__gt=arrival,
    ).values_list("room_id", flat=True)
    return Room.objects.filter(
        branch_id=branch_id,
        is_active=True,
        status=Room.STATUS_VACANT,
    ).exclude(pk__in=occupied).select_related("room_type")


def register_property_guest(user, name, phone="", email=""):
    """Create a new shared customer only through a property-scoped guest registration."""
    from apps.customers.models import Customer
    from apps.hospitality.models import PropertyGuest
    employee = assigned_employee(user)
    if not name.strip():
        raise ValidationError({"name": "Guest name is required."})
    with transaction.atomic():
        # A new Customer is private to the registering property until explicitly
        # linked elsewhere; no cross-property customer directory is exposed.
        customer = Customer.objects.create(
            name=name.strip(), phone=phone.strip(), email=email.strip(), created_by=user,
        )
        registration = PropertyGuest.objects.create(
            branch_id=employee.branch_id, customer=customer, registered_by=employee, created_by=user,
        )
    return registration


def add_pos_line(user, check, recipe, quantity, client_reference):
    """One-time draft addition, price snapshotted from published outlet recipe."""
    from decimal import Decimal
    from django.db import IntegrityError
    from django.utils import timezone
    from apps.hospitality.models import POSCheck, POSOrderLine
    from apps.materials_control.models import Recipe
    employee = require_property(user, check.branch_id)
    require_outlet(employee, check.outlet)
    if not user.has_perm("hospitality.add_posorderline"):
        raise PermissionDenied("This role cannot enter orders.")
    with transaction.atomic():
        locked = POSCheck.objects.select_for_update().get(pk=check.pk)
        if locked.status != POSCheck.STATUS_OPEN:
            raise ValidationError({"check": "Only open checks accept order lines."})
        existing = POSOrderLine.objects.filter(
            pos_check=locked, client_reference=client_reference,
        ).first()
        if existing:
            if existing.recipe_id != recipe.pk or existing.quantity != quantity:
                raise ValidationError({"client_reference": "This request reference was already used for different items."})
            return existing
        active = Recipe.objects.select_for_update().filter(
            pk=recipe.pk, outlet_id=locked.outlet_id,
            status=Recipe.STATUS_PUBLISHED, is_sub_recipe=False,
            selling_price__gt=0,
        ).first()
        if not active:
            raise ValidationError({"recipe": "Select a published, priced menu item in this outlet."})
        unit = active.selling_price
        total = (quantity * unit).quantize(Decimal("0.01"))
        line = POSOrderLine(
            pos_check=locked, recipe=active, client_reference=client_reference,
            item_name_snapshot=active.name, quantity=quantity,
            unit_price_snapshot=unit, line_total=total,
            entered_by=employee, created_by=user,
        )
        try:
            line.full_clean()
        except DjangoValidationError as error:
            raise ValidationError(getattr(error, "message_dict", None) or error.messages)
        line.save()
        return line
