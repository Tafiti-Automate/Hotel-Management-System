from rest_framework.viewsets import ModelViewSet

from apps.organization.models import Hotel
from apps.organization.serializers import HotelSerializer
from core.mixins.viewsets import CreatedByModelMixin
from core.permissions.base import IsAdminOrReadOnly


class HotelViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Hotel.objects.all()
    serializer_class = HotelSerializer
    permission_classes = [IsAdminOrReadOnly]
    filterset_fields = ("business_type", "is_active", "country", "currency")
    search_fields = (
        "name",
        "legal_name",
        "registration_number",
        "tax_identification_number",
        "email",
        "phone",
        "city",
        "country",
    )
    ordering_fields = ("name", "created_at", "country", "city")
