from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from django.http import HttpResponse
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from apps.materials_control.models import (
    BudgetOverride,
    CostCenterBudget,
    FiscalPeriod,
    GLExport,
    IntegrationConfig,
    OutletAssignment,
    POSImportBatch,
    POSPLUMapping,
    POSSaleLine,
    Recipe,
    RecipeIngredient,
    WasteRecord,
)
from apps.materials_control.serializers import (
    BudgetOverrideSerializer,
    CostCenterBudgetSerializer,
    FiscalPeriodSerializer,
    GLExportSerializer,
    IntegrationConfigSerializer,
    OutletAssignmentSerializer,
    POSImportBatchSerializer,
    POSPLUMappingSerializer,
    POSSaleLineSerializer,
    RecipeIngredientSerializer,
    RecipeSerializer,
    WasteRecordSerializer,
)
from core.mixins.viewsets import CreatedByModelMixin


ROLE_ALIASES = {
    "outlet": {"Department Supervisor", "Outlet Supervisor"},
    "department": {"Department Head"},
    "cost": {"Cost Controller", "F&B Cost Controller"},
    "purchasing": {"Procurement Manager", "Procurement Officer", "Purchasing Officer"},
    "ap": {"Accounts Payable Clerk"},
    "finance": {"Financial Manager", "Financial Controller"},
    "management": {"General Manager"},
    "admin": {"System Administrator"},
}


def has_role(user, *families):
    names = set()
    for family in families:
        names.update(ROLE_ALIASES.get(family, {family}))
    return bool(user and user.is_authenticated and user.groups.filter(name__in=names).exists())


def employee_for(user):
    return getattr(user, "employee_profile", None)


def raise_model_error(error):
    detail = getattr(error, "message_dict", None) or getattr(error, "messages", None) or str(error)
    raise ValidationError(detail)


def hotel_scope(queryset, user, branch_path):
    if user.is_superuser or has_role(user, "admin"):
        return queryset
    employee = employee_for(user)
    if not employee or not employee.branch_id:
        return queryset.none()
    if employee.branch.hotel_id:
        return queryset.filter(**{f"{branch_path}__hotel_id": employee.branch.hotel_id})
    return queryset.filter(**{f"{branch_path}_id": employee.branch_id})


class OutletAssignmentViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = OutletAssignment.objects.select_related("employee__user", "outlet__branch")
    serializer_class = OutletAssignmentSerializer
    filterset_fields = ("employee", "outlet", "is_primary", "is_active")
    search_fields = ("employee__user__username", "outlet__name")

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.is_superuser or has_role(self.request.user, "admin"):
            return queryset
        employee = employee_for(self.request.user)
        if has_role(self.request.user, "outlet") and employee:
            return queryset.filter(employee=employee)
        if has_role(self.request.user, "department") and employee:
            return queryset.filter(employee__department=employee.department, employee__branch=employee.branch)
        return queryset.none()

    def _require_admin(self):
        if not (self.request.user.is_superuser or has_role(self.request.user, "admin")):
            raise PermissionDenied("Only the System Administrator can assign operational outlets.")

    def perform_create(self, serializer):
        self._require_admin()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_admin()
        serializer.save()

    def perform_destroy(self, instance):
        self._require_admin()
        instance.delete()


class WasteRecordViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = WasteRecord.objects.select_related(
        "outlet__branch__hotel", "department", "item", "unit", "reported_by__user", "reviewed_by__user"
    )
    serializer_class = WasteRecordSerializer
    filterset_fields = ("outlet", "department", "item", "reason_code", "status")
    search_fields = ("item__name", "item__sku", "note", "review_note", "outlet__name")
    ordering_fields = ("created_at", "submitted_at", "quantity", "status")

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        employee = employee_for(user)
        if user.is_superuser or has_role(user, "admin", "cost", "finance", "management"):
            return hotel_scope(queryset, user, "outlet__branch")
        if has_role(user, "department") and employee:
            return queryset.filter(department=employee.department, outlet__branch=employee.branch)
        if has_role(user, "outlet") and employee:
            outlet_ids = OutletAssignment.objects.filter(
                employee=employee, is_active=True
            ).values_list("outlet_id", flat=True)
            return queryset.filter(outlet_id__in=outlet_ids, reported_by=employee)
        return queryset.none()

    def perform_create(self, serializer):
        employee = employee_for(self.request.user)
        if not (employee and has_role(self.request.user, "outlet")):
            raise PermissionDenied("Only an assigned Outlet Supervisor can log waste.")
        outlet = serializer.validated_data["outlet"]
        if not OutletAssignment.objects.filter(employee=employee, outlet=outlet, is_active=True).exists():
            raise PermissionDenied("This outlet is not assigned to your account.")
        serializer.save(
            reported_by=employee,
            department=employee.department,
            created_by=self.request.user,
        )

    def perform_update(self, serializer):
        if serializer.instance.reported_by_id != getattr(employee_for(self.request.user), "id", None):
            raise PermissionDenied("You can only edit your own draft waste records.")
        serializer.save()

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        waste = self.get_object()
        if waste.reported_by_id != getattr(employee_for(request.user), "id", None):
            raise PermissionDenied("Only the reporting Outlet Supervisor can submit this record.")
        try:
            waste.submit(request.user)
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(self.get_serializer(waste).data)

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        if not has_role(request.user, "department", "cost"):
            raise PermissionDenied("Only the Department Head or Cost Controller can review waste.")
        reviewer = employee_for(request.user)
        if not reviewer:
            raise PermissionDenied("An employee profile is required to review waste.")
        waste = self.get_object()
        try:
            waste.review(
                reviewer,
                flagged=bool(request.data.get("flagged")),
                note=request.data.get("note", ""),
            )
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(self.get_serializer(waste).data)


class RecipeViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Recipe.objects.select_related("outlet__branch__hotel", "published_by").prefetch_related(
        "ingredients"
    )
    serializer_class = RecipeSerializer
    filterset_fields = ("outlet", "status", "is_sub_recipe")
    search_fields = ("code", "name", "note", "outlet__name")
    ordering_fields = ("name", "status", "published_at", "created_at")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "outlet__branch")

    def _require_recipe_editor(self):
        if not has_role(self.request.user, "department", "cost"):
            raise PermissionDenied("Only Department leadership or F&B Cost Control can maintain recipes.")

    def perform_create(self, serializer):
        self._require_recipe_editor()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_recipe_editor()
        serializer.save()

    def perform_destroy(self, instance):
        self._require_recipe_editor()
        if instance.status == Recipe.STATUS_PUBLISHED:
            raise ValidationError("Published recipes must be archived, not deleted.")
        instance.delete()

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        self._require_recipe_editor()
        recipe = self.get_object()
        try:
            recipe.publish(request.user)
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(self.get_serializer(recipe).data)

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        self._require_recipe_editor()
        recipe = self.get_object()
        recipe.status = Recipe.STATUS_ARCHIVED
        recipe.save(update_fields=("status", "updated_at"))
        return Response(self.get_serializer(recipe).data)


class RecipeIngredientViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = RecipeIngredient.objects.select_related(
        "recipe__outlet__branch__hotel", "item__base_unit", "unit"
    )
    serializer_class = RecipeIngredientSerializer
    filterset_fields = ("recipe", "item", "unit")
    search_fields = ("recipe__name", "item__name", "item__sku")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "recipe__outlet__branch")

    def _require_editor(self):
        if not has_role(self.request.user, "department", "cost"):
            raise PermissionDenied("Only Department leadership or F&B Cost Control can edit ingredients.")

    def perform_create(self, serializer):
        self._require_editor()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_editor()
        serializer.save()

    def perform_destroy(self, instance):
        self._require_editor()
        instance.delete()


class POSPLUMappingViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = POSPLUMapping.objects.select_related("outlet__branch__hotel", "recipe")
    serializer_class = POSPLUMappingSerializer
    filterset_fields = ("outlet", "recipe", "is_active")
    search_fields = ("external_plu", "external_name", "recipe__name")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "outlet__branch")

    def _require_cost_control(self):
        if not has_role(self.request.user, "cost"):
            raise PermissionDenied("Only F&B Cost Control can maintain POS PLU mappings.")

    def perform_create(self, serializer):
        self._require_cost_control()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_cost_control()
        serializer.save()

    def perform_destroy(self, instance):
        self._require_cost_control()
        instance.delete()


class POSImportBatchViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = POSImportBatch.objects.select_related("outlet__branch__hotel", "processed_by").prefetch_related(
        "lines"
    )
    serializer_class = POSImportBatchSerializer
    filterset_fields = ("outlet", "business_date", "source", "status")
    search_fields = ("source", "source_reference", "outlet__name", "error_message")
    ordering_fields = ("business_date", "status", "created_at")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "outlet__branch")

    def _require_cost_control(self):
        if not has_role(self.request.user, "cost"):
            raise PermissionDenied("Only F&B Cost Control can operate POS depletion imports.")

    def perform_create(self, serializer):
        self._require_cost_control()
        super().perform_create(serializer)

    @action(detail=True, methods=["post"], url_path="run-depletion")
    def run_depletion(self, request, pk=None):
        self._require_cost_control()
        batch = self.get_object()
        try:
            batch.process(request.user)
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(self.get_serializer(batch).data)


class POSSaleLineViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = POSSaleLine.objects.select_related(
        "batch__outlet__branch__hotel", "mapping__recipe"
    )
    serializer_class = POSSaleLineSerializer
    filterset_fields = ("batch", "external_plu", "inventory_changes_applied")
    search_fields = ("external_plu", "external_name", "external_reference")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "batch__outlet__branch")

    def _require_cost_control(self):
        if not has_role(self.request.user, "cost"):
            raise PermissionDenied("Only F&B Cost Control can load POS sale lines.")

    def perform_create(self, serializer):
        self._require_cost_control()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_cost_control()
        if serializer.instance.inventory_changes_applied:
            raise ValidationError("A depleted POS line is immutable.")
        serializer.save()

    def perform_destroy(self, instance):
        self._require_cost_control()
        if instance.inventory_changes_applied:
            raise ValidationError("A depleted POS line cannot be deleted.")
        instance.delete()


class CostCenterBudgetViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = CostCenterBudget.objects.select_related("branch__hotel", "department")
    serializer_class = CostCenterBudgetSerializer
    filterset_fields = ("branch", "department", "period_month", "enforce_hard_block", "is_active")
    search_fields = ("branch__name", "department__name", "note")
    ordering_fields = ("period_month", "spending_cap", "department__name")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "branch")

    def _require_finance(self):
        if not has_role(self.request.user, "finance"):
            raise PermissionDenied("Only the Financial Controller can maintain cost-center budgets.")

    def perform_create(self, serializer):
        self._require_finance()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_finance()
        serializer.save()

    def perform_destroy(self, instance):
        self._require_finance()
        if instance.overrides.exists():
            raise ValidationError("A budget with override history cannot be deleted.")
        instance.delete()


class BudgetOverrideViewSet(ReadOnlyModelViewSet):
    queryset = BudgetOverride.objects.select_related(
        "budget__branch__hotel", "budget__department", "requisition", "decided_by"
    )
    serializer_class = BudgetOverrideSerializer
    filterset_fields = ("budget", "requisition", "status")
    search_fields = ("requisition__requisition_number", "reason", "decision_note")
    ordering_fields = ("status", "overage_amount", "created_at")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "budget__branch")

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        if not has_role(request.user, "finance"):
            raise PermissionDenied("Only the Financial Controller can decide a budget override.")
        override = self.get_object()
        decision = str(request.data.get("decision") or "").strip().lower()
        if decision not in {"approve", "reject"}:
            raise ValidationError({"decision": "Choose approve or reject."})
        try:
            override.decide(
                request.user,
                approve=decision == "approve",
                note=request.data.get("note", ""),
            )
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(self.get_serializer(override).data)


class FiscalPeriodViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = FiscalPeriod.objects.select_related("branch__hotel", "closed_by")
    serializer_class = FiscalPeriodSerializer
    filterset_fields = ("branch", "status", "start_date", "end_date")
    search_fields = ("name", "branch__name", "close_note")
    ordering_fields = ("start_date", "end_date", "status", "created_at")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "branch")

    def _require_finance(self):
        if not has_role(self.request.user, "finance"):
            raise PermissionDenied("Only the Financial Controller can operate fiscal periods.")

    def perform_create(self, serializer):
        self._require_finance()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_finance()
        if serializer.instance.status == FiscalPeriod.STATUS_CLOSED:
            raise ValidationError("Closed fiscal periods are immutable.")
        serializer.save()

    def perform_destroy(self, instance):
        self._require_finance()
        if instance.status == FiscalPeriod.STATUS_CLOSED:
            raise ValidationError("Closed fiscal periods cannot be deleted.")
        instance.delete()

    @action(detail=True, methods=["get"], url_path="pre-close-checklist")
    def pre_close_checklist(self, request, pk=None):
        return Response(self.get_object().pre_close_checklist())

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        self._require_finance()
        period = self.get_object()
        try:
            period.close(request.user, request.data.get("note", ""))
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(self.get_serializer(period).data)

    @action(detail=True, methods=["post"], url_path="generate-gl-export")
    def generate_gl_export(self, request, pk=None):
        self._require_finance()
        try:
            export = GLExport.generate(self.get_object(), request.user)
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(GLExportSerializer(export, context=self.get_serializer_context()).data)


class GLExportViewSet(ReadOnlyModelViewSet):
    queryset = GLExport.objects.select_related("period__branch__hotel", "generated_by")
    serializer_class = GLExportSerializer
    filterset_fields = ("period", "format", "generated_by")
    search_fields = ("period__name", "checksum")
    ordering_fields = ("generated_at", "row_count")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "period__branch")

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        export = self.get_object()
        response = HttpResponse(export.payload, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = (
            f'attachment; filename="gl-export-{export.period.start_date}-{export.period.end_date}.csv"'
        )
        response["X-Content-SHA256"] = export.checksum
        return response


class IntegrationConfigViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = IntegrationConfig.objects.select_related("branch__hotel")
    serializer_class = IntegrationConfigSerializer
    filterset_fields = ("branch", "integration_type", "provider", "is_active", "health")
    search_fields = ("name", "provider", "endpoint_hint", "last_message")
    ordering_fields = ("integration_type", "name", "health", "last_sync_at")

    def _require_admin(self):
        if not (self.request.user.is_superuser or has_role(self.request.user, "admin")):
            raise PermissionDenied("Only the System Administrator can configure integrations.")

    def get_queryset(self):
        self._require_admin()
        return super().get_queryset()

    def perform_create(self, serializer):
        self._require_admin()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_admin()
        serializer.save()

    def perform_destroy(self, instance):
        self._require_admin()
        instance.delete()

