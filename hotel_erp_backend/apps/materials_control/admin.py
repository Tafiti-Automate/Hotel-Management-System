from django.contrib import admin

from apps.materials_control.models import (
    BudgetOverride,
    CostCenterBudget,
    FiscalPeriod,
    GLExport,
    GLAccountMapping,
    IntegrationConfig,
    OutletAssignment,
    POSImportBatch,
    POSPLUMapping,
    POSSaleLine,
    Recipe,
    RecipeIngredient,
    WasteRecord,
)


admin.site.register(
    (
        OutletAssignment,
        WasteRecord,
        Recipe,
        RecipeIngredient,
        POSPLUMapping,
        POSImportBatch,
        POSSaleLine,
        CostCenterBudget,
        BudgetOverride,
        FiscalPeriod,
        GLExport,
        GLAccountMapping,
        IntegrationConfig,
    )
)

