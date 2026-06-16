from rest_framework.viewsets import ModelViewSet

from apps.vendors.models import Supplier
from apps.vendors.serializers import SupplierSerializer
from core.mixins.viewsets import CreatedByModelMixin


class SupplierViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    filterset_fields = ("is_active",)
    search_fields = (
        "name",
        "supplier_code",
        "email",
        "phone",
        "contact_person",
        "tin_number",
        "registration_number",
    )
    ordering_fields = ("name", "supplier_code", "created_at")
