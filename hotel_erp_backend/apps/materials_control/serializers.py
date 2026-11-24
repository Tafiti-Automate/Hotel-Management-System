from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

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


class CleanModelSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = self.instance or self.Meta.model()
        for field, value in attrs.items():
            setattr(instance, field, value)
        try:
            instance.full_clean(exclude=None)
        except DjangoValidationError as error:
            detail = getattr(error, "message_dict", None) or getattr(error, "messages", None) or str(error)
            raise serializers.ValidationError(detail) from error
        return attrs


class OutletAssignmentSerializer(CleanModelSerializer):
    employee_name = serializers.CharField(source="employee.__str__", read_only=True)
    outlet_name = serializers.CharField(source="outlet.name", read_only=True)

    class Meta:
        model = OutletAssignment
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class WasteRecordSerializer(CleanModelSerializer):
    item_name = serializers.CharField(source="item.name", read_only=True)
    item_sku = serializers.CharField(source="item.sku", read_only=True)
    outlet_name = serializers.CharField(source="outlet.name", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True)
    reporter_name = serializers.CharField(source="reported_by.__str__", read_only=True)
    reviewer_name = serializers.CharField(source="reviewed_by.__str__", read_only=True)
    reason_label = serializers.CharField(source="get_reason_code_display", read_only=True)

    class Meta:
        model = WasteRecord
        fields = "__all__"
        read_only_fields = (
            "id",
            "base_quantity",
            "status",
            "reported_by",
            "submitted_at",
            "reviewed_by",
            "reviewed_at",
            "review_note",
            "inventory_changes_applied",
            "created_at",
            "updated_at",
            "created_by",
        )

    def validate(self, attrs):
        if self.instance and self.instance.status != WasteRecord.STATUS_DRAFT:
            mutable = {"review_note"}
            if any(field not in mutable for field in attrs):
                raise serializers.ValidationError("Submitted waste is immutable; use the review action.")
        return super().validate(attrs)


class RecipeSerializer(CleanModelSerializer):
    production_department_name = serializers.CharField(source="production_department.name", read_only=True, allow_null=True)
    outlet_name = serializers.CharField(source="outlet.name", read_only=True)
    total_cost = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    cost_per_yield = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    suggested_selling_price = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    ingredient_count = serializers.IntegerField(source="ingredients.count", read_only=True)

    class Meta:
        model = Recipe
        fields = "__all__"
        read_only_fields = (
            "id",
            "code",
            "status",
            "published_at",
            "published_by",
            "created_at",
            "updated_at",
            "created_by",
        )


class RecipeIngredientSerializer(CleanModelSerializer):
    item_name = serializers.SerializerMethodField()
    item_sku = serializers.CharField(source="item.sku", read_only=True, allow_null=True)
    base_unit_name = serializers.CharField(source="item.base_unit.abbreviation", read_only=True, allow_null=True)
    sub_recipe_name = serializers.CharField(source="sub_recipe.name", read_only=True, allow_null=True)

    def get_item_name(self, obj):
        return obj.sub_recipe.name if obj.sub_recipe_id else obj.item.name

    gross_base_quantity = serializers.DecimalField(max_digits=14, decimal_places=4, read_only=True)
    current_base_unit_cost = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    ingredient_cost = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = RecipeIngredient
        fields = "__all__"
        read_only_fields = ("id", "base_quantity", "created_at", "updated_at", "created_by")


class POSPLUMappingSerializer(CleanModelSerializer):
    outlet_name = serializers.CharField(source="outlet.name", read_only=True)
    recipe_name = serializers.CharField(source="recipe.name", read_only=True)

    class Meta:
        model = POSPLUMapping
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class POSImportBatchSerializer(serializers.ModelSerializer):
    outlet_name = serializers.CharField(source="outlet.name", read_only=True)
    line_count = serializers.IntegerField(source="lines.count", read_only=True)
    unmapped_count = serializers.SerializerMethodField()

    class Meta:
        model = POSImportBatch
        fields = "__all__"
        read_only_fields = (
            "id",
            "status",
            "processed_at",
            "processed_by",
            "error_message",
            "created_at",
            "updated_at",
            "created_by",
        )

    def get_unmapped_count(self, instance):
        return instance.lines.filter(inventory_changes_applied=False).count()


class POSSaleLineSerializer(serializers.ModelSerializer):
    mapping_name = serializers.CharField(source="mapping.recipe.name", read_only=True)

    class Meta:
        model = POSSaleLine
        fields = "__all__"
        read_only_fields = (
            "id",
            "mapping",
            "inventory_changes_applied",
            "processed_at",
            "created_at",
            "updated_at",
            "created_by",
        )

    def validate_batch(self, batch):
        if batch.status == POSImportBatch.STATUS_PROCESSED:
            raise serializers.ValidationError("Processed POS imports cannot receive new lines.")
        return batch


class CostCenterBudgetSerializer(CleanModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True)
    committed_spend = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    remaining_amount = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = CostCenterBudget
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class BudgetOverrideSerializer(serializers.ModelSerializer):
    requisition_number = serializers.CharField(source="requisition.requisition_number", read_only=True)
    department_name = serializers.CharField(source="budget.department.name", read_only=True)
    branch_name = serializers.CharField(source="budget.branch.name", read_only=True)

    class Meta:
        model = BudgetOverride
        fields = "__all__"
        read_only_fields = (
            "id",
            "budget",
            "requisition",
            "requested_amount",
            "overage_amount",
            "reason",
            "status",
            "decided_by",
            "decided_at",
            "decision_note",
            "created_at",
            "updated_at",
            "created_by",
        )


class FiscalPeriodSerializer(CleanModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    checklist = serializers.SerializerMethodField()

    class Meta:
        model = FiscalPeriod
        fields = "__all__"
        read_only_fields = (
            "id",
            "status",
            "closed_at",
            "closed_by",
            "close_note",
            "created_at",
            "updated_at",
            "created_by",
        )

    def get_checklist(self, instance):
        return instance.pre_close_checklist()


class GLAccountMappingSerializer(CleanModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = GLAccountMapping
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class GLExportSerializer(serializers.ModelSerializer):
    period_name = serializers.CharField(source="period.name", read_only=True)

    class Meta:
        model = GLExport
        exclude = ("payload",)
        read_only_fields = (
            "id",
            "format",
            "generated_at",
            "generated_by",
            "row_count",
            "checksum",
            "created_at",
            "updated_at",
            "created_by",
        )


class IntegrationConfigSerializer(CleanModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = IntegrationConfig
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")

