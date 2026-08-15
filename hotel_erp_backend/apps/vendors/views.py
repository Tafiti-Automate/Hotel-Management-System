from rest_framework.viewsets import ModelViewSet
from rest_framework.exceptions import PermissionDenied

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

    def _require_cost_controller(self):
        user = self.request.user
        if not (
            user.is_superuser
            or user.groups.filter(name__in=("System Administrator", "Cost Controller")).exists()
        ):
            raise PermissionDenied("Only the Cost Controller can register or change suppliers.")

    def perform_create(self, serializer):
        self._require_cost_controller()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_cost_controller()
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        self._require_cost_controller()
        super().perform_destroy(instance)
