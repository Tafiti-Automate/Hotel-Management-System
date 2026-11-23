from rest_framework.permissions import SAFE_METHODS, BasePermission
from rest_framework.viewsets import ModelViewSet

from apps.departments.models import Branch, Department
from apps.departments.serializers import BranchSerializer, DepartmentSerializer
from core.mixins.viewsets import CreatedByModelMixin
from core.permissions.base import IsAdminOrReadOnly


class DepartmentMasterDataPermission(BasePermission):
    """Keep existing staff administration; allow Cost Control to create only.

    Department records are global organizational master data, not per-property
    records. The Cost Controller is not allowed to edit or delete departments
    with this grant.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        if user.is_staff:
            return True
        return bool(
            request.method == "POST"
            and user.is_active
            and user.groups.filter(name="Cost Controller").exists()
            and user.has_perm("departments.add_department")
        )


class DepartmentViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    permission_classes = [DepartmentMasterDataPermission]
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
