from rest_framework import serializers

from core.constants.choices import PRStatus
from apps.procurement.models import (
    GoodsInspection,
    GoodsInspectionItem,
    GoodsReceiptItem,
    GoodsReceiptNote,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseRequisition,
    RequisitionItem,
    SupplierReturn,
    SupplierReturnItem,
    VendorQuotation,
    VendorQuotationItem,
)


class PurchaseRequisitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PurchaseRequisition
        fields = (
            "id",
            "request_type",
            "requester",
            "department",
            "preferred_supplier",
            "status",
            "reason",
            "expected_date",
            "control_notes",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "status", "created_at", "updated_at", "created_by")


class RequisitionItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = RequisitionItem
        fields = (
            "id",
            "requisition",
            "item",
            "quantity",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "total_amount", "created_at", "updated_at", "created_by")

    def validate_requisition(self, requisition):
        if requisition.status != PRStatus.APPROVED:
            raise serializers.ValidationError(
                "Purchase order can only be created from an approved requisition."
            )
        return requisition


class VendorQuotationSerializer(serializers.ModelSerializer):
    class Meta:
        model = VendorQuotation
        fields = (
            "id",
            "requisition",
            "supplier",
            "total_amount",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class PurchaseOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = PurchaseOrder
        fields = (
            "id",
            "requisition",
            "supplier",
            "ordered_by",
            "store",
            "po_number",
            "status",
            "expected_date",
            "note",
            "total_amount",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = PurchaseOrderItem
        fields = "__all__"
        read_only_fields = (
            "id",
            "base_quantity",
            "line_total",
            "created_at",
            "updated_at",
            "created_by",
        )


class GoodsReceiptNoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = GoodsReceiptNote
        fields = (
            "id",
            "purchase_order",
            "received_by",
            "received_date",
            "note",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class GoodsReceiptItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = GoodsReceiptItem
        fields = "__all__"
        read_only_fields = (
            "id",
            "item",
            "base_quantity",
            "inventory_changes_applied",
            "created_at",
            "updated_at",
            "created_by",
        )

class VendorQuotationItemSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = VendorQuotationItem
        fields = "__all__"
        read_only_fields = ("id", "item", "line_total", "created_at", "updated_at", "created_by")


class GoodsInspectionItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = GoodsInspectionItem
        fields = "__all__"
        read_only_fields = ("id", "item", "created_at", "updated_at", "created_by")


class GoodsInspectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = GoodsInspection
        fields = "__all__"
        read_only_fields = ("id", "status", "created_at", "updated_at", "created_by")


class SupplierReturnItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierReturnItem
        fields = "__all__"
        read_only_fields = ("id", "base_quantity", "created_at", "updated_at", "created_by")


class SupplierReturnSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierReturn
        fields = "__all__"
        read_only_fields = (
            "id",
            "return_no",
            "status",
            "inventory_changes_applied",
            "created_at",
            "updated_at",
            "created_by",
        )
