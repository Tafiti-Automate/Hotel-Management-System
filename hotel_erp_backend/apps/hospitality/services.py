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


def transition_reservation(user, reservation, operation):
    """Perform reservation check-in/cancellation with a property-level lock."""
    from django.utils import timezone
    from apps.hospitality.models import PropertyGuest
    employee = require_property(user, reservation.branch_id)
    if not user.groups.filter(name__in=("Receptionist", "Front Office Manager")).exists() or not user.has_perm("hospitality.change_reservation"):
        raise PermissionDenied("Authorized front office role required.")
    with transaction.atomic():
        Branch.objects.select_for_update().get(pk=reservation.branch_id)
        booked = Reservation.objects.select_for_update().get(pk=reservation.pk)
        if booked.status != Reservation.STATUS_RESERVED:
            raise ValidationError({"status": "Only reserved bookings can be checked in or cancelled."})
        if operation == "cancel":
            booked.status = Reservation.STATUS_CANCELLED
            booked.save(update_fields=("status", "updated_at"))
            return booked
        if operation != "check-in":
            raise ValidationError({"operation": "Unsupported operation."})
        local_date = timezone.localdate()
        if not booked.arrival_date <= local_date < booked.departure_date:
            raise ValidationError({"arrival_date": "Check-in requires the current date to be within the reserved stay."})
        if not PropertyGuest.objects.filter(branch_id=booked.branch_id, customer_id=booked.customer_id).exists():
            raise ValidationError({"customer": "Guest must be registered at this property."})
        if not booked.room_id:
            raise ValidationError({"room": "Assign a room before check-in."})
        room = Room.objects.select_for_update().get(pk=booked.room_id)
        if not room.is_active or room.status != Room.STATUS_VACANT or room.housekeeping_status not in ("clean", "inspected"):
            raise ValidationError({"room": "Room must be vacant, active and clean or inspected."})
        if Reservation.objects.filter(room_id=room.pk, status=Reservation.STATUS_CHECKED_IN).exclude(pk=booked.pk).exists():
            raise ValidationError({"room": "This room already has a checked-in guest."})
        booked.status = Reservation.STATUS_CHECKED_IN
        booked.checked_in_at = timezone.now()
        booked.checked_in_by = employee
        room.status = Room.STATUS_OCCUPIED
        room.save(update_fields=("status", "updated_at"))
        booked.save(update_fields=("status", "checked_in_at", "checked_in_by", "updated_at"))
        return booked


def void_pos_order_line(user, pos_check, line_id, reason):
    """Supervisor-only reversible-in-accounting draft correction: never delete evidence."""
    from django.utils import timezone
    from apps.hospitality.models import POSCheck, POSOrderLine
    employee = require_property(user, pos_check.branch_id)
    require_outlet(employee, pos_check.outlet)
    if not user.groups.filter(name="Bar Supervisor").exists() or not user.has_perm("hospitality.change_posorderline"):
        raise PermissionDenied("Bar Supervisor approval is required.")
    reason = str(reason).strip()
    if not 8 <= len(reason) <= 250:
        raise ValidationError({"reason": "Give an explanation of 8 to 250 characters."})
    with transaction.atomic():
        locked = POSCheck.objects.select_for_update().get(pk=pos_check.pk)
        if locked.status != POSCheck.STATUS_OPEN:
            raise ValidationError({"check": "Closed checks cannot be adjusted."})
        try:
            line = POSOrderLine.objects.select_for_update().get(pk=line_id, pos_check=locked)
        except (POSOrderLine.DoesNotExist, TypeError, ValueError):
            raise ValidationError({"line": "Line does not belong to this check."})
        if line.voided_at:
            raise ValidationError({"line": "Line has already been voided."})
        line.voided_at = timezone.now()
        line.voided_by = employee
        line.void_reason = reason
        line.save(update_fields=("voided_at", "voided_by", "void_reason", "updated_at"))
        return line


def open_guest_folio(user, reservation):
    """Create once for a currently checked-in guest without financial postings."""
    from apps.hospitality.models import GuestFolio, PropertyGuest
    employee = require_property(user, reservation.branch_id)
    if not user.groups.filter(name__in=("Receptionist", "Front Office Manager")).exists():
        raise PermissionDenied("Only authorized front office staff can open folios.")
    if not user.has_perm("hospitality.add_guestfolio"):
        raise PermissionDenied("Guest folio creation permission required.")
    with transaction.atomic():
        Branch.objects.select_for_update().get(pk=reservation.branch_id)
        locked = Reservation.objects.select_for_update().get(pk=reservation.pk)
        if locked.status != Reservation.STATUS_CHECKED_IN:
            raise ValidationError({"reservation": "A folio can only be opened for a checked-in guest."})
        if not PropertyGuest.objects.filter(branch_id=locked.branch_id, customer_id=locked.customer_id).exists():
            raise ValidationError({"reservation": "Guest must be registered at this property."})
        folio, _ = GuestFolio.objects.get_or_create(
            reservation=locked, defaults={
                "branch_id":locked.branch_id, "opened_by":employee, "created_by":user,
            },
        )
        if folio.branch_id != employee.branch_id:
            raise PermissionDenied("Guest folio is outside your property.")
        return folio


def open_cashier_session(user, outlet, opening_float):
    """Record till custody with a property lock; not a receipt or payment."""
    from decimal import Decimal
    from django.utils import timezone
    from apps.hospitality.models import CashierSession
    employee = assigned_employee(user)
    if not user.groups.filter(name="Cashier").exists() or not user.has_perm("hospitality.add_cashiersession"):
        raise PermissionDenied("Cashier role and session creation permission required.")
    require_outlet(employee, outlet)
    if opening_float < Decimal("0") or opening_float > Decimal("9999999999999.99"):
        raise ValidationError({"opening_float": "Opening float must be a valid nonnegative monetary amount."})
    with transaction.atomic():
        Branch.objects.select_for_update().get(pk=employee.branch_id)
        if CashierSession.objects.filter(cashier=employee, status=CashierSession.STATUS_OPEN).exists():
            raise ValidationError({"cashier": "Close the existing cashier session before opening another."})
        session = CashierSession(
            branch_id=employee.branch_id, outlet=outlet, cashier=employee,
            opened_at=timezone.now(), opening_float=opening_float, created_by=user,
        )
        try:
            session.full_clean()
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, "message_dict", None) or exc.messages)
        session.save()
        return session


def close_cashier_session(user, session, closing_count, note):
    """Close till custody only; does NOT reconcile sales, collect money or post revenue."""
    from decimal import Decimal
    from django.utils import timezone
    from apps.hospitality.models import CashierSession
    employee = require_property(user, session.branch_id)
    if not user.groups.filter(name="Cashier").exists() or not user.has_perm("hospitality.change_cashiersession"):
        raise PermissionDenied("Cashier session change permission required.")
    if session.cashier_id != employee.pk:
        raise PermissionDenied("Only the owning cashier can close their till.")
    require_outlet(employee, session.outlet)
    if not closing_count.is_finite() or closing_count < Decimal("0") or closing_count > Decimal("9999999999999.99") or closing_count.as_tuple().exponent < -2:
        raise ValidationError({"closing_count": "Closing count must be a nonnegative amount with at most two decimals."})
    note = str(note).strip()
    if len(note) > 250:
        raise ValidationError({"note": "Maximum 250 characters."})
    with transaction.atomic():
        Branch.objects.select_for_update().get(pk=session.branch_id)
        locked = CashierSession.objects.select_for_update().get(pk=session.pk)
        if locked.status != CashierSession.STATUS_OPEN:
            raise ValidationError({"status": "Session is already closed."})
        if locked.cashier_id != employee.pk:
            raise PermissionDenied("Only the owning cashier can close their till.")
        locked.status = CashierSession.STATUS_CLOSED
        locked.closed_at = timezone.now()
        locked.closed_by = employee
        locked.closing_count = closing_count
        locked.note = note
        locked.save(update_fields=("status", "closed_at", "closed_by", "closing_count", "note", "updated_at"))
        return locked


def change_room_condition(user, room, condition, reason):
    """Audited housekeeping / out-of-order transition with property serialization.

    This operation never rewrites occupancy, checks out a guest, or posts revenue.
    """
    from apps.audit_logs.models import AuditLog

    employee = require_property(user, room.branch_id)
    groups = set(user.groups.values_list("name", flat=True))
    allowed = {"Front Office Manager", "Housekeeping Supervisor", "Housekeeper"}
    if not groups.intersection(allowed) or not user.has_perm("hospitality.change_room"):
        raise PermissionDenied("Authorized front office or housekeeping staff with room-change permission required.")

    condition = str(condition or "").strip().lower()
    reason = str(reason or "").strip()
    if not 8 <= len(reason) <= 250:
        raise ValidationError({"reason": "Give a reason between 8 and 250 characters."})
    if condition not in {"dirty", "clean", "inspected", "out_of_order", "return_to_service"}:
        raise ValidationError({"condition": "Unsupported room condition."})
    if condition in {"out_of_order", "return_to_service"} and "Front Office Manager" not in groups:
        raise PermissionDenied("Only the Front Office Manager can change out-of-order status.")
    if condition == "inspected" and not groups.intersection({"Front Office Manager", "Housekeeping Supervisor"}):
        raise PermissionDenied("Inspection requires Front Office Manager or Housekeeping Supervisor approval.")

    with transaction.atomic():
        Branch.objects.select_for_update().get(pk=room.branch_id)
        locked = Room.objects.select_for_update().get(pk=room.pk, branch_id=room.branch_id)
        before_status = locked.status
        before_housekeeping = locked.housekeeping_status
        if condition == "out_of_order":
            if locked.status != Room.STATUS_VACANT:
                raise ValidationError({"condition": "Only vacant rooms can be taken out of order."})
            if locked.reservations.filter(
                status__in=(Reservation.STATUS_RESERVED, Reservation.STATUS_CHECKED_IN)
            ).exists():
                raise ValidationError({"condition": "Move or cancel all active reservations before taking this room out of order."})
            locked.status = Room.STATUS_OUT_OF_ORDER
            locked.housekeeping_status = "dirty"
        elif condition == "return_to_service":
            if locked.status != Room.STATUS_OUT_OF_ORDER:
                raise ValidationError({"condition": "This room is not out of order."})
            locked.status = Room.STATUS_VACANT
            locked.housekeeping_status = "dirty"
        else:
            if locked.status == Room.STATUS_OUT_OF_ORDER or not locked.is_active:
                raise ValidationError({"condition": "Return the room to active service before housekeeping updates."})
            transitions = {"dirty": {"clean"}, "clean": {"dirty", "inspected"}, "inspected": {"dirty"}}
            if condition not in transitions.get(before_housekeeping, set()):
                raise ValidationError({"condition": "Invalid housekeeping progression. Mark dirty rooms clean, then inspect them."})
            locked.housekeeping_status = condition
        locked.save(update_fields=("status", "housekeeping_status", "updated_at"))
        AuditLog.objects.create(
            actor=user, action="pms.room.condition_changed", entity_type="hospitality.Room",
            entity_id=str(locked.pk), metadata={
                "branch_id": str(locked.branch_id), "room_number": locked.number,
                "employee_id": str(employee.pk), "reason": reason,
                "old_status": before_status, "new_status": locked.status,
                "old_housekeeping": before_housekeeping, "new_housekeeping": locked.housekeeping_status,
            },
        )
        return locked


def move_reservation_room(user, reservation, target_room_id, reason):
    """Reallocate a reserved or checked-in guest without touching the folio ledger."""
    from uuid import UUID
    from apps.audit_logs.models import AuditLog

    employee = require_property(user, reservation.branch_id)
    if not user.groups.filter(name="Front Office Manager").exists() or not user.has_perm("hospitality.change_reservation"):
        raise PermissionDenied("Front Office Manager with reservation-change permission required.")
    reason = str(reason or "").strip()
    if not 8 <= len(reason) <= 250:
        raise ValidationError({"reason": "Give a room-move reason between 8 and 250 characters."})
    try:
        target_key = UUID(str(target_room_id))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError({"target_room": "A valid destination room is required."})

    with transaction.atomic():
        Branch.objects.select_for_update().get(pk=reservation.branch_id)
        booked = Reservation.objects.select_for_update().get(pk=reservation.pk, branch_id=reservation.branch_id)
        if booked.status not in (Reservation.STATUS_RESERVED, Reservation.STATUS_CHECKED_IN):
            raise ValidationError({"reservation": "Only reserved or checked-in reservations can move rooms."})
        if str(booked.room_id) == str(target_key):
            raise ValidationError({"target_room": "Choose a different room."})
        try:
            target = Room.objects.select_for_update().select_related("room_type").get(
                pk=target_key, branch_id=booked.branch_id,
            )
        except Room.DoesNotExist:
            raise ValidationError({"target_room": "Destination room does not belong to this property."})
        if not target.is_active or target.status != Room.STATUS_VACANT or not target.room_type.is_active:
            raise ValidationError({"target_room": "Destination must be an active, vacant room of an active type."})
        if booked.adults + booked.children > target.room_type.capacity:
            raise ValidationError({"target_room": "Destination capacity is insufficient for this reservation."})
        if booked.status == Reservation.STATUS_CHECKED_IN and target.housekeeping_status not in ("clean", "inspected"):
            raise ValidationError({"target_room": "Checked-in guests may move only into a clean or inspected room."})
        if Reservation.objects.filter(
            room=target, status__in=(Reservation.STATUS_RESERVED, Reservation.STATUS_CHECKED_IN),
            arrival_date__lt=booked.departure_date, departure_date__gt=booked.arrival_date,
        ).exclude(pk=booked.pk).exists():
            raise ValidationError({"target_room": "Destination has a conflicting reservation."})
        if Reservation.objects.filter(room=target, status=Reservation.STATUS_CHECKED_IN).exclude(pk=booked.pk).exists():
            raise ValidationError({"target_room": "Destination is already occupied."})

        original_id = booked.room_id
        source = Room.objects.select_for_update().filter(pk=original_id, branch_id=booked.branch_id).first() if original_id else None
        if booked.status == Reservation.STATUS_CHECKED_IN:
            if not source or source.status != Room.STATUS_OCCUPIED:
                raise ValidationError({"room": "Source room occupancy is inconsistent; resolve it before moving the guest."})
            source.status = Room.STATUS_VACANT
            source.housekeeping_status = "dirty"
            source.save(update_fields=("status", "housekeeping_status", "updated_at"))
            target.status = Room.STATUS_OCCUPIED
            target.save(update_fields=("status", "updated_at"))
        booked.room = target
        try:
            booked.full_clean()
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, "message_dict", None) or exc.messages)
        booked.save(update_fields=("room", "updated_at"))
        AuditLog.objects.create(
            actor=user, action="pms.reservation.room_moved", entity_type="hospitality.Reservation",
            entity_id=str(booked.pk), metadata={
                "branch_id": str(booked.branch_id), "employee_id": str(employee.pk),
                "reservation_reference": booked.reference, "reason": reason,
                "from_room_id": str(original_id or ""), "to_room_id": str(target.pk),
                "checked_in": booked.status == Reservation.STATUS_CHECKED_IN,
            },
        )
        return booked
