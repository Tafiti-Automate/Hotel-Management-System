"""Shared PMS and POS document foundations.

Branch is the property boundary. Room and reservation workflows use Customer
rather than a second, inconsistent guest master. Operational posting endpoints
are intentionally deferred until per-property permission and locking controls
have been implemented.
"""
from django.core.exceptions import ValidationError
from django.db import models
from core.mixins.models import BaseModel


class RoomType(BaseModel):
    branch = models.ForeignKey("departments.Branch", on_delete=models.PROTECT, related_name="room_types")
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=100)
    capacity = models.PositiveSmallIntegerField(default=2)
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        ordering = ("branch__name", "name")
        constraints = [
            models.UniqueConstraint(fields=("branch", "code"), name="unique_room_type_per_property"),
        ]

    def __str__(self):
        return f"{self.branch}: {self.name}"


class Room(BaseModel):
    STATUS_VACANT = "vacant"
    STATUS_OCCUPIED = "occupied"
    STATUS_OUT_OF_ORDER = "out_of_order"
    STATUS_CHOICES = [
        (STATUS_VACANT, "Vacant"), (STATUS_OCCUPIED, "Occupied"),
        (STATUS_OUT_OF_ORDER, "Out of order"),
    ]
    branch = models.ForeignKey("departments.Branch", on_delete=models.PROTECT, related_name="hotel_rooms")
    room_type = models.ForeignKey(RoomType, on_delete=models.PROTECT, related_name="rooms")
    number = models.CharField(max_length=20)
    floor = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_VACANT)
    housekeeping_status = models.CharField(max_length=20, choices=[
        ("clean", "Clean"), ("dirty", "Dirty"), ("inspected", "Inspected"),
    ], default="dirty")
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        ordering = ("branch__name", "number")
        constraints = [
            models.UniqueConstraint(fields=("branch", "number"), name="unique_room_number_per_property"),
        ]

    def clean(self):
        super().clean()
        if self.room_type_id and self.branch_id and self.room_type.branch_id != self.branch_id:
            raise ValidationError({"room_type": "Room type must belong to the room's property."})

    def __str__(self):
        return f"{self.branch}: Room {self.number}"


class Reservation(BaseModel):
    STATUS_RESERVED = "reserved"
    STATUS_CHECKED_IN = "checked_in"
    STATUS_CHECKED_OUT = "checked_out"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_RESERVED, "Reserved"), (STATUS_CHECKED_IN, "Checked in"),
        (STATUS_CHECKED_OUT, "Checked out"), (STATUS_CANCELLED, "Cancelled"),
    ]
    branch = models.ForeignKey("departments.Branch", on_delete=models.PROTECT, related_name="hotel_reservations")
    customer = models.ForeignKey("customers.Customer", on_delete=models.PROTECT, related_name="hotel_reservations")
    room = models.ForeignKey(Room, on_delete=models.PROTECT, related_name="reservations", null=True, blank=True)
    reference = models.CharField(max_length=60, unique=True)
    arrival_date = models.DateField()
    departure_date = models.DateField()
    adults = models.PositiveSmallIntegerField(default=1)
    children = models.PositiveSmallIntegerField(default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_RESERVED)
    notes = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-arrival_date", "reference")

    def clean(self):
        super().clean()
        if self.arrival_date and self.departure_date and self.departure_date <= self.arrival_date:
            raise ValidationError({"departure_date": "Departure must be after arrival."})
        if self.room_id and self.branch_id and self.room.branch_id != self.branch_id:
            raise ValidationError({"room": "Reservation room belongs to a different property."})
        if self.status == self.STATUS_CHECKED_IN and not self.room_id:
            raise ValidationError({"room": "A checked-in reservation must have a room."})
        # Overlap checks are advisory at model-validation time; the booking
        # service must take property/room locks before writing reservations.
        if self.room_id and self.arrival_date and self.departure_date and self.status in (
            self.STATUS_RESERVED, self.STATUS_CHECKED_IN,
        ):
            conflicts = Reservation.objects.filter(
                room_id=self.room_id,
                status__in=(self.STATUS_RESERVED, self.STATUS_CHECKED_IN),
                arrival_date__lt=self.departure_date,
                departure_date__gt=self.arrival_date,
            )
            if self.pk:
                conflicts = conflicts.exclude(pk=self.pk)
            if conflicts.exists():
                raise ValidationError({"room": "The room has another reservation during these dates."})


class POSCheck(BaseModel):
    STATUS_OPEN = "open"
    STATUS_SETTLED = "settled"
    STATUS_VOID = "void"
    STATUS_CHOICES = [
        (STATUS_OPEN, "Open"), (STATUS_SETTLED, "Settled"), (STATUS_VOID, "Voided"),
    ]
    branch = models.ForeignKey("departments.Branch", on_delete=models.PROTECT, related_name="pos_checks")
    outlet = models.ForeignKey(
        "inventory.StoreLocation", on_delete=models.PROTECT, related_name="hospitality_pos_checks"
    )
    reference = models.CharField(max_length=60, unique=True)
    reservation = models.ForeignKey(
        Reservation, on_delete=models.PROTECT, related_name="pos_checks", null=True, blank=True,
    )
    table_reference = models.CharField(max_length=30, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_OPEN)
    opened_by = models.ForeignKey(
        "employees.Employee", on_delete=models.PROTECT, related_name="opened_pos_checks",
    )
    notes = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def clean(self):
        super().clean()
        if self.outlet_id and self.branch_id and self.outlet.branch_id != self.branch_id:
            raise ValidationError({"outlet": "POS outlet must belong to the selected property."})
        if self.reservation_id and self.branch_id and self.reservation.branch_id != self.branch_id:
            raise ValidationError({"reservation": "Room charge may not cross property boundaries."})
        if self.opened_by_id and self.branch_id and self.opened_by.branch_id != self.branch_id:
            raise ValidationError({"opened_by": "POS operator must belong to the selected property."})


class PropertyGuest(BaseModel):
    """Property-specific visibility for a shared Customer/guest record."""
    branch = models.ForeignKey("departments.Branch", on_delete=models.PROTECT, related_name="registered_guests")
    customer = models.ForeignKey("customers.Customer", on_delete=models.PROTECT, related_name="property_registrations")
    registered_by = models.ForeignKey("employees.Employee", on_delete=models.PROTECT, related_name="registered_hotel_guests")

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=("branch", "customer"), name="unique_guest_property_registration"),
        ]
        ordering = ("-created_at",)


class POSOrderLine(BaseModel):
    """Draft POS sales line. No financial, folio or stock posting occurs here."""
    check = models.ForeignKey(POSCheck, on_delete=models.PROTECT, related_name="order_lines")
    recipe = models.ForeignKey("materials_control.Recipe", on_delete=models.PROTECT, related_name="pos_draft_lines")
    client_reference = models.CharField(max_length=80)
    item_name_snapshot = models.CharField(max_length=180)
    quantity = models.DecimalField(max_digits=14, decimal_places=4)
    unit_price_snapshot = models.DecimalField(max_digits=15, decimal_places=2)
    line_total = models.DecimalField(max_digits=17, decimal_places=2)
    entered_by = models.ForeignKey("employees.Employee", on_delete=models.PROTECT, related_name="entered_pos_lines")

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=("check", "client_reference"), name="unique_pos_line_client_reference"),
        ]
        ordering = ("created_at",)

    def clean(self):
        super().clean()
        if self.quantity is not None and self.quantity <= 0:
            raise ValidationError({"quantity": "Order quantity must be positive."})
        if self.check_id and self.recipe_id and self.recipe.outlet_id != self.check.outlet_id:
            raise ValidationError({"recipe": "Menu item belongs to a different outlet."})
