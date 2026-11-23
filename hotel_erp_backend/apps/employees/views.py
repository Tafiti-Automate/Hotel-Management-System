from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.exceptions import PermissionDenied
from rest_framework.viewsets import ModelViewSet

from apps.employees.models import Designation, Employee
from apps.employees.serializers import DesignationSerializer, EmployeeSerializer
from apps.employees.security import (
    employee_queryset_for_user, is_system_administrator, require_employee_write_scope,
)
from core.mixins.viewsets import CreatedByModelMixin


PROTECTED_ACCOUNT_ROLES = frozenset({
    'System Administrator', 'HR Manager', 'Payroll Officer',
    'Financial Manager', 'Financial Controller', 'General Manager',
})


class EmployeeViewSet(CreatedByModelMixin, ModelViewSet):
    parser_classes = (JSONParser, FormParser, MultiPartParser)
    queryset = Employee.objects.select_related("user", "department", "branch", "designation_record")
    serializer_class = EmployeeSerializer
    filterset_fields = ("department", "branch", "designation_record", "is_active")
    search_fields = (
        "user__username",
        "user__employee_code",
        "user__first_name",
        "user__last_name",
        "designation",
        "department__name",
    )
    ordering_fields = ("designation", "created_at", "department__name")

    def get_queryset(self):
        return employee_queryset_for_user(super().get_queryset(), self.request.user)

    def perform_create(self, serializer):
        require_employee_write_scope(self.request.user, serializer.validated_data.get("branch"))
        super().perform_create(serializer)

    def perform_update(self, serializer):
        # Check both the original and proposed property to prevent cross-hotel reassignment.
        require_employee_write_scope(self.request.user, serializer.instance.branch)
        require_employee_write_scope(
            self.request.user, serializer.validated_data.get("branch", serializer.instance.branch),
        )
        serializer.save()

    def perform_destroy(self, instance):
        """Retain employment history while immediately disabling system access."""
        actor = self.request.user
        require_employee_write_scope(actor, instance.branch)
        if not is_system_administrator(actor) and (
            instance.user_id == actor.pk or instance.user.groups.filter(
                name__in=PROTECTED_ACCOUNT_ROLES,
            ).exists()
        ):
            raise PermissionDenied("Only the System Administrator may deactivate a protected account.")
        instance.is_active = False
        instance.save(update_fields=("is_active", "updated_at"))
        instance.user.is_active = False
        instance.user.save(update_fields=("is_active",))


class DesignationViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Designation.objects.select_related("department")
    serializer_class = DesignationSerializer
    filterset_fields = ("department", "is_active")
    search_fields = ("title", "department__name", "description")
    ordering_fields = ("title", "department__name", "created_at")
