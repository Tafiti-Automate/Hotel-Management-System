from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.materials_control.views import (
    BudgetOverrideViewSet,
    PeriodContextView,
    GlobalCommandSearchView,
    DocumentAuditTimelineView,
    CostCenterBudgetViewSet,
    FiscalPeriodViewSet,
    GLExportViewSet,
    GLAccountMappingViewSet,
    IntegrationConfigViewSet,
    OutletAssignmentViewSet,
    POSImportBatchViewSet,
    POSPLUMappingViewSet,
    POSSaleLineViewSet,
    RecipeIngredientViewSet,
    RecipeViewSet,
    WasteRecordViewSet,
)


router = DefaultRouter()
router.register("outlet-assignments", OutletAssignmentViewSet, basename="outlet-assignment")
router.register("waste-records", WasteRecordViewSet, basename="waste-record")
router.register("recipes", RecipeViewSet, basename="recipe")
router.register("recipe-ingredients", RecipeIngredientViewSet, basename="recipe-ingredient")
router.register("pos-plu-mappings", POSPLUMappingViewSet, basename="pos-plu-mapping")
router.register("pos-imports", POSImportBatchViewSet, basename="pos-import")
router.register("pos-sale-lines", POSSaleLineViewSet, basename="pos-sale-line")
router.register("cost-center-budgets", CostCenterBudgetViewSet, basename="cost-center-budget")
router.register("budget-overrides", BudgetOverrideViewSet, basename="budget-override")
router.register("fiscal-periods", FiscalPeriodViewSet, basename="fiscal-period")
router.register("gl-exports", GLExportViewSet, basename="gl-export")
router.register("gl-account-mappings", GLAccountMappingViewSet, basename="gl-account-mapping")
router.register("integration-configs", IntegrationConfigViewSet, basename="integration-config")

urlpatterns = [
    path("period-context/", PeriodContextView.as_view(), name="materials-period-context"),
    path("global-command-search/", GlobalCommandSearchView.as_view(), name="global-command-search"),
    path("document-audit/<str:kind>/<uuid:document_id>/", DocumentAuditTimelineView.as_view(), name="materials-document-audit"),
] + router.urls

