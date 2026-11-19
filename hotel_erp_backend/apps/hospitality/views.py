"""Conservative Phase 1B endpoints; no posting, settlement or check-in actions."""
from datetime import date

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.hospitality.models import POSCheck, Reservation, Room, RoomType
from apps.hospitality.serializers import (
    POSCheckSerializer, ReservationSerializer, RoomSerializer, RoomTypeSerializer,
)
from apps.hospitality.services import (
    assigned_employee, require_outlet, require_property, room_availability, save_reservation,
)
from apps.materials_control.models import OutletAssignment
from core.permissions.roles import HotelDjangoModelPermissions


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

    def perform_create(self, serializer):
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
