from pathlib import Path

from django.urls import reverse
from rest_framework import serializers

from core.constants.choices import POStatus, PRStatus
from apps.procurement.models import (
    GoodsInspection,
    GoodsInspectionItem,
    GoodsReceiptItem,
    GoodsReceiptNote,
    PurchaseOrder,
    PurchaseOrderItem,
    ProcurementAttachment,
    ProcurementCommunication,
    PurchaseRequisition,
    RequisitionItem,
    SupplierReturn,
    SupplierReturnItem,
    VendorQuotation,
    VendorQuotationItem,
)


class PurchaseRequisitionSerializer(serializers.ModelSerializer):
    estimated_total = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
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
            "estimated_total",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "status", "created_at", "updated_at", "created_by")


class RequisitionItemSerializer(serializers.ModelSerializer):
    estimated_total = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    class Meta:
        model = RequisitionItem
        fields = (
            "id",
            "requisition",
            "item",
            "quantity",
            "estimated_unit_cost",
            "estimated_total",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "estimated_total", "created_at", "updated_at", "created_by")

    def validate_requisition(self, requisition):
        if requisition.status not in (PRStatus.DRAFT, PRStatus.REJECTED):
            raise serializers.ValidationError(
                "Requisition items can only be changed while the requisition is draft or rejected."
            )
        return requisition

    def validate(self, attrs):
        requisition = attrs.get("requisition") or getattr(self.instance, "requisition", None)
        item = attrs.get("item") or getattr(self.instance, "item", None)
        if requisition and requisition.status not in (PRStatus.DRAFT, PRStatus.REJECTED):
            raise serializers.ValidationError(
                "Requisition items can only be changed while the requisition is draft or rejected."
            )
        duplicate = RequisitionItem.objects.filter(requisition=requisition, item=item)
        if self.instance:
            duplicate = duplicate.exclude(pk=self.instance.pk)
        if requisition and item and duplicate.exists():
            raise serializers.ValidationError(
                {"item": "This Article is already on the requisition. Edit the existing line instead."}
            )
        return attrs


class VendorQuotationSerializer(serializers.ModelSerializer):
    subtotal = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    class Meta:
        model = VendorQuotation
        fields = (
            "id",
            "requisition",
            "supplier",
            "subtotal",
            "total_amount",
            "tax_amount",
            "transport_cost",
            "discount_amount",
            "payment_terms",
            "delivery_date",
            "valid_until",
            "evaluation_score",
            "evaluation_notes",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "subtotal", "total_amount", "created_at", "updated_at", "created_by")

    def validate_requisition(self, requisition):
        if requisition.status in (PRStatus.CANCELLED, PRStatus.REJECTED):
            raise serializers.ValidationError(
                "Quotations cannot be recorded for a cancelled or rejected requisition."
            )
        return requisition

    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        instance.update_total_amount()
        return instance


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
            "sent_at",
            "sent_by",
            "sent_to_email",
            "note",
            "total_amount",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = (
            "id",
            "status",
            "sent_at",
            "sent_by",
            "sent_to_email",
            "total_amount",
            "created_at",
            "updated_at",
            "created_by",
        )

    def validate_requisition(self, requisition):
        if requisition.status != PRStatus.APPROVED:
            raise serializers.ValidationError(
                "Purchase order can only be created from an approved requisition."
            )
        return requisition


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

    def validate(self, attrs):
        order = attrs.get("purchase_order") or getattr(self.instance, "purchase_order", None)
        item = attrs.get("item") or getattr(self.instance, "item", None)
        if order and order.status != POStatus.DRAFT:
            raise serializers.ValidationError("LPO lines can only be changed while the LPO is draft.")
        if order and item and not order.requisition.items.filter(item=item).exists():
            raise serializers.ValidationError(
                {"item": "This Article is not on the source requisition."}
            )
        return attrs


class GoodsReceiptNoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = GoodsReceiptNote
        fields = (
            "id",
            "grn_number",
            "purchase_order",
            "received_by",
            "received_date",
            "delivery_note_no",
            "note",
            "posted_at",
            "posted_by",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "grn_number", "posted_at", "posted_by", "created_at", "updated_at", "created_by")

    def validate_purchase_order(self, purchase_order):
        if purchase_order.status not in (POStatus.ISSUED, POStatus.PARTIALLY_RECEIVED):
            raise serializers.ValidationError(
                "Goods can only be received against a sent purchase order."
            )
        return purchase_order


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

    def validate(self, attrs):
        receipt = attrs.get("goods_receipt") or getattr(self.instance, "goods_receipt", None)
        order_line = attrs.get("purchase_order_item") or getattr(self.instance, "purchase_order_item", None)
        if self.instance and self.instance.inventory_changes_applied:
            raise serializers.ValidationError("Posted GRN lines cannot be changed.")
        if receipt and order_line and order_line.purchase_order_id != receipt.purchase_order_id:
            raise serializers.ValidationError(
                {"purchase_order_item": "This LPO line does not belong to the selected goods receipt."}
            )
        quantity = attrs.get("quantity_received")
        if receipt and order_line and quantity is not None:
            existing = GoodsReceiptItem.objects.filter(
                goods_receipt__purchase_order=receipt.purchase_order,
                purchase_order_item=order_line,
            )
            if self.instance:
                existing = existing.exclude(pk=self.instance.pk)
            already_received = sum((line.quantity_received for line in existing), 0)
            if already_received + quantity > order_line.quantity:
                raise serializers.ValidationError(
                    {"quantity_received": "Delivered quantity exceeds the remaining quantity on the LPO line."}
                )
        return attrs

class VendorQuotationItemSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = VendorQuotationItem
        fields = "__all__"
        read_only_fields = ("id", "item", "line_total", "created_at", "updated_at", "created_by")

    def validate(self, attrs):
        quotation = attrs.get("quotation") or getattr(self.instance, "quotation", None)
        requisition_item = attrs.get("requisition_item") or getattr(self.instance, "requisition_item", None)
        if self.instance and self.instance.selected:
            raise serializers.ValidationError(
                "A selected winning quotation line cannot be changed. Reopen the evaluation first."
            )
        if quotation and requisition_item and requisition_item.requisition_id != quotation.requisition_id:
            raise serializers.ValidationError(
                {"requisition_item": "This line does not belong to the quotation's requisition."}
            )
        duplicate = VendorQuotationItem.objects.filter(
            quotation=quotation,
            requisition_item=requisition_item,
        )
        if self.instance:
            duplicate = duplicate.exclude(pk=self.instance.pk)
        if quotation and requisition_item and duplicate.exists():
            raise serializers.ValidationError(
                {"requisition_item": "This Article is already quoted by this supplier. Edit the existing line instead."}
            )
        return attrs


class GoodsInspectionItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = GoodsInspectionItem
        fields = "__all__"
        read_only_fields = ("id", "item", "created_at", "updated_at", "created_by")

    def validate(self, attrs):
        inspection = attrs.get("inspection") or getattr(self.instance, "inspection", None)
        receipt_item = attrs.get("goods_receipt_item") or getattr(self.instance, "goods_receipt_item", None)
        if inspection and receipt_item and receipt_item.goods_receipt_id != inspection.goods_receipt_id:
            raise serializers.ValidationError(
                {"goods_receipt_item": "This line does not belong to the inspected goods receipt."}
            )
        return attrs


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

    def validate(self, attrs):
        supplier_return = attrs.get("supplier_return") or getattr(self.instance, "supplier_return", None)
        item = attrs.get("item") or getattr(self.instance, "item", None)
        if supplier_return and item and not supplier_return.goods_receipt.items.filter(item=item).exists():
            raise serializers.ValidationError(
                {"item": "Only Articles from the selected goods receipt can be returned."}
            )
        return attrs


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

    def validate(self, attrs):
        supplier = attrs.get("supplier") or getattr(self.instance, "supplier", None)
        receipt = attrs.get("goods_receipt") or getattr(self.instance, "goods_receipt", None)
        if supplier and receipt and receipt.purchase_order.supplier_id != supplier.id:
            raise serializers.ValidationError(
                {"supplier": "The supplier must match the supplier on the goods receipt's LPO."}
            )
        return attrs


class ProcurementAttachmentSerializer(serializers.ModelSerializer):
    MAX_FILE_SIZE = 4 * 1024 * 1024
    ALLOWED_EXTENSIONS = {
        ".pdf",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".doc",
        ".docx",
    }

    file = serializers.FileField(write_only=True)
    download_url = serializers.SerializerMethodField()
    uploaded_by = serializers.CharField(source="created_by.get_full_name", read_only=True)

    class Meta:
        model = ProcurementAttachment
        fields = (
            "id",
            "document_type",
            "document_id",
            "category",
            "file",
            "download_url",
            "original_name",
            "content_type",
            "file_size",
            "note",
            "uploaded_by",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = (
            "id",
            "download_url",
            "original_name",
            "content_type",
            "file_size",
            "uploaded_by",
            "created_at",
            "updated_at",
            "created_by",
        )

    def validate_file(self, uploaded_file):
        extension = Path(uploaded_file.name).suffix.lower()
        if extension not in self.ALLOWED_EXTENSIONS:
            raise serializers.ValidationError(
                "Use a PDF, Word document, PNG, JPEG or WebP file."
            )
        if uploaded_file.size <= 0:
            raise serializers.ValidationError("The selected file is empty.")
        if uploaded_file.size > self.MAX_FILE_SIZE:
            raise serializers.ValidationError("The maximum attachment size is 4 MB.")
        return uploaded_file

    def create(self, validated_data):
        uploaded_file = validated_data.pop("file")
        validated_data["original_name"] = Path(uploaded_file.name).name[:255]
        validated_data["content_type"] = (
            str(getattr(uploaded_file, "content_type", ""))[:150]
            or "application/octet-stream"
        )
        validated_data["file_size"] = uploaded_file.size
        validated_data["file_content"] = b"".join(uploaded_file.chunks())
        return super().create(validated_data)

    def get_download_url(self, attachment):
        request = self.context.get("request")
        path = reverse(
            "procurement-attachment-download",
            kwargs={"pk": attachment.pk},
        )
        return request.build_absolute_uri(path) if request else path


class ProcurementCommunicationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProcurementCommunication
        fields = "__all__"
        read_only_fields = (
            "id", "created_at", "updated_at", "created_by",
        )
