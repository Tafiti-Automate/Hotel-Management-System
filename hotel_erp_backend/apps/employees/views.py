from rest_framework.viewsets import ModelViewSet

from apps.employees.models import Designation, Employee
from apps.employees.serializers import DesignationSerializer, EmployeeSerializer
from core.mixins.viewsets import CreatedByModelMixin


class EmployeeViewSet(CreatedByModelMixin, ModelViewSet):
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


class DesignationViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Designation.objects.select_related("department")
    serializer_class = DesignationSerializer
    filterset_fields = ("department", "is_active")
    search_fields = ("title", "department__name", "description")
    ordering_fields = ("title", "department__name", "created_at")
