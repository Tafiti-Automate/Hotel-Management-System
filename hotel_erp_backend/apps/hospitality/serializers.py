"""Narrow operational serializers: no guest PII beyond the customer identifier."""
from rest_framework import serializers

from apps.hospitality.models import POSCheck, Reservation, Room, RoomType


class RoomTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomType
        fields = ("id", "branch", "code", "name", "capacity", "is_active")


class RoomSerializer(serializers.ModelSerializer):
    class Meta:
        model = Room
        fields = ("id", "branch", "room_type", "number", "floor", "status", "housekeeping_status", "is_active")


class ReservationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Reservation
        fields = (
            "id", "reference", "branch", "customer", "room",
            "arrival_date", "departure_date", "adults", "children", "status", "notes",
            "created_at",
        )
        read_only_fields = ("id", "status", "created_at")

    def validate(self, attrs):
        branch = attrs.get("branch", getattr(self.instance, "branch", None))
        room = attrs.get("room", getattr(self.instance, "room", None))
        if room and branch and room.branch_id != branch.pk:
            raise serializers.ValidationError({"room": "Room belongs to another property."})
        if room and not room.is_active:
            raise serializers.ValidationError({"room": "Room is inactive."})
        if room and room.status == Room.STATUS_OUT_OF_ORDER:
            raise serializers.ValidationError({"room": "Out-of-order rooms cannot be reserved."})
        return attrs


class POSCheckSerializer(serializers.ModelSerializer):
    class Meta:
        model = POSCheck
        fields = (
            "id", "reference", "branch", "outlet", "reservation",
            "table_reference", "status", "opened_by", "notes", "created_at",
        )
        read_only_fields = ("id", "status", "opened_by", "created_at")
