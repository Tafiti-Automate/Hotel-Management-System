from rest_framework.permissions import SAFE_METHODS, BasePermission
from rest_framework.exceptions import ValidationError
from rest_framework.viewsets import ModelViewSet

from apps.departments.models import Branch, Department
from apps.departments.serializers import BranchSerializer, DepartmentSerializer
from core.mixins.viewsets import CreatedByModelMixin
from core.permissions.base import IsAdminOrReadOnly


class DepartmentMasterDataPermission(BasePermission):
    """Keep staff administration; allow Cost Control create and edit, never delete.

    Departments are global organizational records, not property-specific.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        # Cost Controller restrictions also apply to staff-account holders.
        # Being staff does not give a Cost Controller permission to delete.
        if user.groups.filter(name="Cost Controller").exists() and not user.is_superuser:
            if not user.is_active:
                return False
            if request.method == "POST":
                return user.has_perm("departments.add_department")
            if request.method in ("PUT", "PATCH"):
                return user.has_perm("departments.change_department")
            return False
        return bool(user.is_staff)


class DepartmentViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    permission_classes = [DepartmentMasterDataPermission]
    search_fields = ("name", "description")
    ordering_fields = ("name", "created_at")

    def perform_update(self, serializer):
        # Prevent a cost centre with active employees from disappearing from
        # operational selection screens while people still belong to it.
        user = self.request.user
        if (user.groups.filter(name="Cost Controller").exists()
                and not user.is_superuser
                and serializer.validated_data.get("is_active") is False
                and serializer.instance.employees.filter(is_active=True).exists()):
            raise ValidationError({
                "is_active": "Reassign active employees before deactivating this department."
            })
        serializer.save()


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
