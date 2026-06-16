from rest_framework.viewsets import ModelViewSet

from apps.departments.models import Branch, Department
from apps.departments.serializers import BranchSerializer, DepartmentSerializer
from core.mixins.viewsets import CreatedByModelMixin
from core.permissions.base import IsAdminOrReadOnly


class DepartmentViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    permission_classes = [IsAdminOrReadOnly]
    search_fields = ("name", "description")
    ordering_fields = ("name", "created_at")


class BranchViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Branch.objects.select_related("hotel").all()
    serializer_class = BranchSerializer
    permission_classes = [IsAdminOrReadOnly]
    filterset_fields = ("hotel", "branch_type", "is_head_office", "is_active", "country", "city")
    search_fields = (
        "name",
        "branch_code",
        "location",
        "physical_address",
        "city",
        "country",
        "contact_person",
        "contact",
        "email",
        "hotel__name",
    )
    ordering_fields = ("name", "branch_code", "created_at", "city", "country")
