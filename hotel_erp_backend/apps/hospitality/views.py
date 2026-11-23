"""Conservative Phase 1B endpoints; no posting, settlement or check-in actions."""
from datetime import date
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.hospitality.models import CashierSession, GuestFolio, POSCheck, POSOrderLine, PropertyGuest, Reservation, Room, RoomType
from apps.hospitality.serializers import (
    CashierSessionSerializer, GuestFolioSerializer, POSCheckSerializer, POSOrderLineSerializer, PropertyGuestSerializer, ReservationSerializer, RoomSerializer, RoomTypeSerializer,
)
from apps.hospitality.services import (
    add_pos_line, assigned_employee, change_room_condition, close_cashier_session, move_reservation_room, open_cashier_session, open_guest_folio, register_property_guest, require_outlet, require_property, room_availability, save_reservation, transition_reservation, void_pos_order_line,
)
from apps.materials_control.models import OutletAssignment, Recipe
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from core.permissions.roles import HotelDjangoModelPermissions


class PropertyGuestViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = (HotelDjangoModelPermissions,)
    queryset = PropertyGuest.objects.select_related('customer', 'branch')
    serializer_class = PropertyGuestSerializer
    http_method_names = ('get', 'head', 'options')

    def get_queryset(self):
        employee = assigned_employee(self.request.user)
        rows = super().get_queryset().filter(branch_id=employee.branch_id)
        term = self.request.query_params.get('q', '').strip()
        if term:
            from django.db.models import Q
            rows = rows.filter(Q(customer__name__icontains=term) | Q(customer__phone__icontains=term))
        return rows.order_by('customer__name')[:100]


class GuestRegistrationView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        if not request.user.has_perm('hospitality.add_propertyguest'):
            raise PermissionDenied('Guest registration permission is required.')
        from rest_framework import serializers as drf_serializers
        class Input(drf_serializers.Serializer):
            name = drf_serializers.CharField(max_length=200)
            phone = drf_serializers.CharField(max_length=30, required=False, allow_blank=True)
            email = drf_serializers.EmailField(required=False, allow_blank=True)
        form = Input(data=request.data)
        form.is_valid(raise_exception=True)
        row = register_property_guest(request.user, **form.validated_data)
        return Response(PropertyGuestSerializer(row).data, status=201)


class PropertyScopedMixin:
    permission_classes = (HotelDjangoModelPermissions,)
    http_method_names = ("get", "post", "head", "options")

    def property_id(self):
        return assigned_employee(self.request.user).branch_id

    def get_queryset(self):
        return super().get_queryset().filter(branch_id=self.property_id())


class RoomMasterDataMixin:
    """Hotel room master configuration, never guest or housekeeping posting.

    Property managers can access only their assigned branch; IT administrators
    can configure properties, including when they have no Employee record.
    """

    permission_classes = (HotelDjangoModelPermissions,)
    http_method_names = ("get", "post", "patch", "head", "options")

    def _is_administrator(self):
        user = self.request.user
        return user.is_superuser or user.groups.filter(name="System Administrator").exists()

    def _require_editor(self):
        if not self._is_administrator() and not self.request.user.groups.filter(
            name="Front Office Manager"
        ).exists():
            raise PermissionDenied("Room configuration is restricted to System Administrator and Front Office Manager.")

    def _require_property(self, branch):
        if not branch or not branch.is_active:
            raise ValidationError({"branch": "Choose an active hotel property."})
        if not self._is_administrator():
            require_property(self.request.user, branch.pk)

    def get_queryset(self):
        qs = super().get_queryset()
        if self._is_administrator():
            return qs
        return qs.filter(branch_id=assigned_employee(self.request.user).branch_id)

    def _validate_and_save(self, instance, serializer):
        for key, value in serializer.validated_data.items():
            setattr(instance, key, value)
        try:
            instance.full_clean()
        except DjangoValidationError as error:
            raise ValidationError(getattr(error, "message_dict", None) or error.messages)
        instance.save()
        serializer.instance = instance


class RoomTypeViewSet(RoomMasterDataMixin, viewsets.ModelViewSet):
    queryset = RoomType.objects.select_related("branch")
    serializer_class = RoomTypeSerializer

    @transaction.atomic
    def perform_create(self, serializer):
        self._require_editor()
        branch = serializer.validated_data.get("branch")
        self._require_property(branch)
        from apps.departments.models import Branch
        Branch.objects.select_for_update().get(pk=branch.pk)
        self._validate_and_save(RoomType(created_by=self.request.user), serializer)

    @transaction.atomic
    def perform_update(self, serializer):
        self._require_editor()
        current = self.get_object()
        self._require_property(current.branch)
        from apps.departments.models import Branch
        Branch.objects.select_for_update().get(pk=current.branch_id)
        proposed = serializer.validated_data
        if "branch" in proposed and proposed["branch"].pk != current.branch_id:
            raise ValidationError({"branch": "An existing room type cannot move to another hotel property."})
        if "code" in proposed and proposed["code"] != current.code and current.rooms.exists():
            raise ValidationError({"code": "Room type codes in use cannot be changed."})
        if proposed.get("is_active") is False and current.is_active and current.rooms.filter(is_active=True).exists():
            raise ValidationError({"is_active": "Deactivate or reassign active rooms before disabling this type."})
        self._validate_and_save(current, serializer)


class RoomViewSet(RoomMasterDataMixin, viewsets.ModelViewSet):
    queryset = Room.objects.select_related("room_type", "branch")
    serializer_class = RoomSerializer

    @action(detail=True, methods=("post",), url_path="change-condition")
    def change_condition(self, request, pk=None):
        room = change_room_condition(
            request.user, self.get_object(), request.data.get("condition"), request.data.get("reason"),
        )
        return Response(self.get_serializer(room).data)

    def _no_operational_fields(self):
        forbidden = {"status", "housekeeping_status"} & set(self.request.data)
        if forbidden:
            raise ValidationError({
                "detail": "Occupancy and housekeeping conditions must be changed through authorized front-desk and housekeeping workflows."
            })

    @transaction.atomic
    def perform_create(self, serializer):
        self._require_editor()
        self._no_operational_fields()
        branch = serializer.validated_data.get("branch")
        self._require_property(branch)
        from apps.departments.models import Branch
        Branch.objects.select_for_update().get(pk=branch.pk)
        room_type = serializer.validated_data.get("room_type")
        if not room_type or not room_type.is_active or room_type.branch_id != branch.pk:
            raise ValidationError({"room_type": "Choose an active room type from this hotel property."})
        self._validate_and_save(Room(created_by=self.request.user), serializer)

    @transaction.atomic
    def perform_update(self, serializer):
        self._require_editor()
        self._no_operational_fields()
        current = self.get_object()
        self._require_property(current.branch)
        from apps.departments.models import Branch
        Branch.objects.select_for_update().get(pk=current.branch_id)
        proposed = serializer.validated_data
        if "branch" in proposed and proposed["branch"].pk != current.branch_id:
            raise ValidationError({"branch": "Existing rooms cannot be moved between properties."})
        room_type = proposed.get("room_type", current.room_type)
        if not room_type.is_active or room_type.branch_id != current.branch_id:
            raise ValidationError({"room_type": "Choose an active room type belonging to this property."})
        reservations = current.reservations
        if reservations.exists() and any(
            field in proposed and proposed[field] != getattr(current, field)
            for field in ("number", "room_type")
        ):
            raise ValidationError({"detail": "A room with reservation history cannot be renumbered or retyped."})
        if proposed.get("is_active") is False and current.is_active and reservations.filter(
            status__in=(Reservation.STATUS_RESERVED, Reservation.STATUS_CHECKED_IN)
        ).exists():
            raise ValidationError({"is_active": "Cancel or resolve active reservations before deactivating this room."})
        self._validate_and_save(current, serializer)


class GuestFolioViewSet(PropertyScopedMixin, viewsets.ReadOnlyModelViewSet):
    queryset = GuestFolio.objects.select_related("reservation")
    serializer_class = GuestFolioSerializer
    http_method_names = ("get", "post", "head", "options")

    @action(detail=False, methods=("post",), url_path="open")
    def open(self, request):
        reservation_id = request.data.get("reservation")
        try:
            reservation = Reservation.objects.get(
                pk=reservation_id, branch_id=self.property_id(),
            )
        except (Reservation.DoesNotExist, ValueError, TypeError):
            raise ValidationError({"reservation": "Valid reservation at your property required."})
        folio = open_guest_folio(request.user, reservation)
        return Response(self.get_serializer(folio).data, status=200)


class CashierSessionViewSet(PropertyScopedMixin, viewsets.ReadOnlyModelViewSet):
    queryset = CashierSession.objects.select_related("outlet", "cashier")
    serializer_class = CashierSessionSerializer
    http_method_names = ("get", "post", "head", "options")

    def get_queryset(self):
        employee = assigned_employee(self.request.user)
        base = super().get_queryset()
        if self.request.user.groups.filter(name="Cashier").exists():
            return base.filter(cashier=employee)
        if self.request.user.groups.filter(name__in=("Bar Supervisor", "F&B Manager")).exists():
            outlet_ids = OutletAssignment.objects.filter(
                employee=employee, is_active=True,
                outlet__is_active=True, outlet__branch_id=employee.branch_id,
            ).values_list("outlet_id", flat=True)
            return base.filter(outlet_id__in=outlet_ids)
        return base.none()

    @action(detail=False, methods=("post",), url_path="open")
    def open(self, request):
        from apps.inventory.models import StoreLocation
        try:
            outlet = StoreLocation.objects.get(pk=request.data.get("outlet"))
        except (StoreLocation.DoesNotExist, ValueError, TypeError):
            raise ValidationError({"outlet": "Valid assigned outlet required."})
        try:
            amount = Decimal(str(request.data.get("opening_float", "")))
        except (InvalidOperation, TypeError, ValueError):
            raise ValidationError({"opening_float": "Valid monetary amount required."})
        if not amount.is_finite() or amount.as_tuple().exponent < -2:
            raise ValidationError({"opening_float": "Opening float supports at most two decimals."})
        session = open_cashier_session(request.user, outlet, amount)
        return Response(self.get_serializer(session).data, status=201)

    @action(detail=True, methods=("post",), url_path="close")
    def close(self, request, pk=None):
        session = self.get_object()
        try:
            count = Decimal(str(request.data.get("closing_count", "")))
        except (InvalidOperation, ValueError, TypeError):
            raise ValidationError({"closing_count": "Valid cash count required."})
        closed = close_cashier_session(request.user, session, count, request.data.get("note", ""))
        return Response(self.get_serializer(closed).data)



class ReservationViewSet(PropertyScopedMixin, viewsets.ModelViewSet):
    queryset = Reservation.objects.select_related("room", "customer", "branch")
    serializer_class = ReservationSerializer
    http_method_names = ("get", "post", "put", "patch", "head", "options")
    filterset_fields = ("status", "room", "arrival_date", "departure_date")

    def _validate_guest(self, customer):
        if not PropertyGuest.objects.filter(customer=customer, branch_id=self.property_id()).exists():
            raise ValidationError({'customer': 'Guest must be registered at this property.'})

    def perform_create(self, serializer):
        self._validate_guest(serializer.validated_data['customer'])
        reservation = save_reservation(serializer.validated_data, self.request.user)
        serializer.instance = reservation

    def perform_update(self, serializer):
        # Property and status changes are deliberately forbidden.
        previous = self.get_object()
        if "branch" in serializer.validated_data and (
            serializer.validated_data["branch"].pk != previous.branch_id
        ):
            raise PermissionDenied("A reservation cannot be transferred between properties.")
        if "customer" in serializer.validated_data and (
            serializer.validated_data["customer"].pk != previous.customer_id
        ):
            raise ValidationError({"customer": "Guest identity cannot be changed on a booked reservation."})
        payload = {
            name: getattr(previous, name) for name in (
                "branch", "customer", "room", "reference", "arrival_date",
                "departure_date", "adults", "children", "notes",
            )
        }
        payload.update(serializer.validated_data)
        self._validate_guest(payload['customer'])
        reservation = save_reservation(payload, self.request.user, instance=previous)
        serializer.instance = reservation

    @action(detail=True, methods=("post",), url_path="check-in")
    def check_in(self, request, pk=None):
        reservation = transition_reservation(request.user, self.get_object(), "check-in")
        return Response(self.get_serializer(reservation).data)

    @action(detail=True, methods=("post",), url_path="move-room")
    def move_room(self, request, pk=None):
        reservation = move_reservation_room(
            request.user, self.get_object(), request.data.get("target_room"), request.data.get("reason"),
        )
        return Response(self.get_serializer(reservation).data)

    @action(detail=True, methods=("post",), url_path="cancel")
    def cancel(self, request, pk=None):
        reservation = transition_reservation(request.user, self.get_object(), "cancel")
        return Response(self.get_serializer(reservation).data)

    @action(detail=False, methods=("get",), url_path="availability")
    def availability(self, request):
        branch_id = self.property_id()
        try:
            arrival = date.fromisoformat(request.query_params["arrival"])
            departure = date.fromisoformat(request.query_params["departure"])
        except (ValueError, KeyError, TypeError):
            raise ValidationError({"dates": "Supply ISO arrival and departure dates (YYYY-MM-DD)."})
        rows = room_availability(branch_id, arrival, departure, request.user)
        return Response(RoomSerializer(rows, many=True).data)


class POSCheckViewSet(PropertyScopedMixin, viewsets.ModelViewSet):
    queryset = POSCheck.objects.select_related("branch", "outlet", "reservation")
    serializer_class = POSCheckSerializer
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("outlet", "status")

    def get_queryset(self):
        employee = assigned_employee(self.request.user)
        outlet_ids = OutletAssignment.objects.filter(
            employee=employee, is_active=True, outlet__is_active=True,
            outlet__branch_id=employee.branch_id,
        ).values_list("outlet_id", flat=True)
        return super().get_queryset().filter(outlet_id__in=outlet_ids)

    @action(detail=False, methods=('get',), url_path='menu')
    def menu(self, request):
        employee = assigned_employee(request.user)
        outlet_id = request.query_params.get('outlet', '')
        assignment = OutletAssignment.objects.filter(
            employee=employee, is_active=True, outlet__is_active=True,
            outlet__branch_id=employee.branch_id, outlet_id=outlet_id,
        ).first()
        if not assignment:
            raise PermissionDenied('Assigned outlet required to view menu.')
        recipes = Recipe.objects.filter(
            outlet_id=outlet_id, status=Recipe.STATUS_PUBLISHED,
            is_sub_recipe=False, selling_price__gt=0,
        ).order_by('name')
        return Response([{'id': str(row.pk), 'name': row.name, 'price': str(row.selling_price)} for row in recipes])

    @action(detail=True, methods=('get',), url_path='lines')
    def lines(self, request, pk=None):
        check = self.get_object()
        return Response(POSOrderLineSerializer(check.order_lines.all(), many=True).data)

    @action(detail=True, methods=('post',), url_path='add-line')
    def add_line(self, request, pk=None):
        check = self.get_object()
        try:
            recipe = Recipe.objects.get(pk=request.data.get('recipe'))
        except (Recipe.DoesNotExist, ValueError, TypeError):
            raise ValidationError({'recipe': 'Valid published menu item required.'})
        try:
            quantity = Decimal(str(request.data.get('quantity', '')))
        except (InvalidOperation, ValueError):
            raise ValidationError({'quantity': 'Valid positive quantity required.'})
        if not quantity.is_finite() or quantity <= 0 or quantity.as_tuple().exponent < -4 or quantity >= Decimal('10000000000'):
            raise ValidationError({'quantity': 'Quantity must be positive, with up to four decimals.'})
        reference = str(request.data.get('client_reference', '')).strip()
        if not reference or len(reference) > 80:
            raise ValidationError({'client_reference': 'Unique request reference (max 80 characters) required.'})
        line = add_pos_line(request.user, check, recipe, quantity, reference)
        return Response(POSOrderLineSerializer(line).data, status=201)

    @action(detail=False, methods=("get",), url_path="outlets")
    def outlets(self, request):
        employee = assigned_employee(request.user)
        assignments = OutletAssignment.objects.filter(
            employee=employee, is_active=True, outlet__is_active=True,
            outlet__branch_id=employee.branch_id,
        ).select_related("outlet").order_by("outlet__name")
        return Response([{"id": str(row.outlet_id), "name": row.outlet.name} for row in assignments])

    @action(detail=True, methods=("post",), url_path="void-line")
    def void_line(self, request, pk=None):
        line = void_pos_order_line(request.user, self.get_object(), request.data.get("line"), request.data.get("reason", ""))
        return Response(POSOrderLineSerializer(line).data)

    def perform_create(self, serializer):
        payload = serializer.validated_data
        employee = require_property(self.request.user, payload["branch"].pk)
        require_outlet(employee, payload["outlet"])
        if payload.get("reservation"):
            raise ValidationError({
                "reservation": "Room charges are disabled until guest folio settlement controls are available.",
            })
        with transaction.atomic():
            check = POSCheck(**payload, opened_by=employee, created_by=self.request.user)
            try:
                check.full_clean()
            except DjangoValidationError as error:
                raise ValidationError(getattr(error, "message_dict", None) or error.messages)
            check.save()
        serializer.instance = check
