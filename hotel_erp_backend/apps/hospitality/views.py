"""Conservative Phase 1B endpoints; no posting, settlement or check-in actions."""
from datetime import date
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.hospitality.models import POSCheck, POSOrderLine, PropertyGuest, Reservation, Room, RoomType
from apps.hospitality.serializers import (
    POSCheckSerializer, POSOrderLineSerializer, PropertyGuestSerializer, ReservationSerializer, RoomSerializer, RoomTypeSerializer,
)
from apps.hospitality.services import (
    add_pos_line, assigned_employee, register_property_guest, require_outlet, require_property, room_availability, save_reservation,
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


class RoomTypeViewSet(PropertyScopedMixin, viewsets.ReadOnlyModelViewSet):
    queryset = RoomType.objects.select_related("branch")
    serializer_class = RoomTypeSerializer
    http_method_names = ("get", "head", "options")


class RoomViewSet(PropertyScopedMixin, viewsets.ReadOnlyModelViewSet):
    queryset = Room.objects.select_related("room_type", "branch")
    serializer_class = RoomSerializer
    http_method_names = ("get", "head", "options")


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
