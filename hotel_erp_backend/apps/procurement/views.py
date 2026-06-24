from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework import status
from rest_framework.viewsets import ModelViewSet

from apps.employees.models import Employee
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
from apps.vendors.models import Supplier
from apps.procurement.serializers import (
    GoodsInspectionItemSerializer,
    GoodsInspectionSerializer,
    GoodsReceiptItemSerializer,
    GoodsReceiptNoteSerializer,
    PurchaseOrderSerializer,
    PurchaseOrderItemSerializer,
    PurchaseRequisitionSerializer,
    RequisitionItemSerializer,
    SupplierReturnItemSerializer,
    SupplierReturnSerializer,
    VendorQuotationItemSerializer,
    VendorQuotationSerializer,
)
from core.mixins.viewsets import CreatedByModelMixin


def raise_drf_validation_error(error):
    raise ValidationError(getattr(error, "messages", str(error)))


class PurchaseRequisitionViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = PurchaseRequisition.objects.select_related(
        "requester",
        "department",
        "preferred_supplier",
    )
    serializer_class = PurchaseRequisitionSerializer
    filterset_fields = ("request_type", "status", "requester", "department", "preferred_supplier")
    search_fields = (
        "reason",
        "control_notes",
        "requester__user__employee_code",
        "department__name",
        "preferred_supplier__name",
    )
    ordering_fields = ("status", "created_at")

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        requisition = self.get_object()
        try:
            requisition.submit()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(requisition)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        requisition = self.get_object()
        try:
            requisition.cancel()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(requisition)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="create-purchase-order")
    def create_purchase_order(self, request, pk=None):
        requisition = self.get_object()
        try:
            supplier = self._optional_object(Supplier, request.data.get("supplier"))
            ordered_by = self._optional_object(Employee, request.data.get("ordered_by"))
            store = None
            if request.data.get("store"):
                from apps.inventory.models import StoreLocation

                store = self._optional_object(StoreLocation, request.data.get("store"))
            if not ordered_by:
                ordered_by = getattr(request.user, "employee_profile", None)

            order = requisition.create_purchase_order(
                supplier=supplier,
                ordered_by=ordered_by,
                store=store,
                po_number=request.data.get("po_number", ""),
                expected_date=request.data.get("expected_date") or None,
                note=request.data.get("note", ""),
                created_by=request.user if request.user.is_authenticated else None,
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)

        serializer = PurchaseOrderSerializer(order, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def _optional_object(self, model, pk):
        if not pk:
            return None
        try:
            return model.objects.get(pk=pk)
        except model.DoesNotExist:
            raise ValidationError({model._meta.model_name: "Selected record was not found."})


class RequisitionItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = RequisitionItem.objects.select_related("requisition", "item")
    serializer_class = RequisitionItemSerializer
    filterset_fields = ("requisition", "item")
    search_fields = ("item__name", "item__sku")
    ordering_fields = ("quantity", "created_at")


class VendorQuotationViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = VendorQuotation.objects.select_related("requisition", "supplier")
    serializer_class = VendorQuotationSerializer
    filterset_fields = ("requisition", "supplier")
    search_fields = ("supplier__name",)
    ordering_fields = ("total_amount", "created_at")


class PurchaseOrderViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = PurchaseOrder.objects.select_related("requisition", "supplier", "ordered_by", "store", "sent_by")
    serializer_class = PurchaseOrderSerializer
    filterset_fields = ("status", "requisition", "supplier", "ordered_by", "store")
    search_fields = ("po_number", "supplier__name", "ordered_by__user__employee_code", "store__name")
    ordering_fields = ("po_number", "status", "created_at")

    @action(detail=True, methods=["post"])
    def issue(self, request, pk=None):
        order = self.get_object()
        sent_by = None
        if request.data.get("sent_by"):
            try:
                sent_by = Employee.objects.get(pk=request.data.get("sent_by"))
            except Employee.DoesNotExist:
                raise ValidationError({"sent_by": "Selected employee was not found."})
        else:
            sent_by = getattr(request.user, "employee_profile", None)
        try:
            order.issue(
                sent_by=sent_by,
                sent_to_email=request.data.get("sent_to_email", ""),
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(order)
        return Response(serializer.data)


class PurchaseOrderItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = PurchaseOrderItem.objects.select_related("purchase_order", "item", "unit")
    serializer_class = PurchaseOrderItemSerializer
    filterset_fields = ("purchase_order", "item", "unit")
    search_fields = ("purchase_order__po_number", "item__name", "item__sku", "unit__name")
    ordering_fields = ("quantity", "base_quantity", "unit_cost", "created_at")


class GoodsReceiptNoteViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = GoodsReceiptNote.objects.select_related("purchase_order", "received_by")
    serializer_class = GoodsReceiptNoteSerializer
    filterset_fields = ("purchase_order", "received_by", "received_date")
    search_fields = ("purchase_order__po_number", "received_by__user__employee_code")
    ordering_fields = ("received_date", "created_at")

    @action(detail=True, methods=["post"], url_path="post-to-inventory")
    def post_to_inventory(self, request, pk=None):
        receipt = self.get_object()
        try:
            receipt.post_to_inventory()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(receipt)
        return Response(serializer.data)


class GoodsReceiptItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = GoodsReceiptItem.objects.select_related(
        "goods_receipt",
        "purchase_order_item",
        "item",
        "store",
    )
    serializer_class = GoodsReceiptItemSerializer
    filterset_fields = ("goods_receipt", "purchase_order_item", "item", "store", "expiry_date")
    search_fields = ("goods_receipt__purchase_order__po_number", "item__name", "item__sku", "store__name")
    ordering_fields = ("quantity_received", "base_quantity", "unit_cost", "created_at")

    @action(detail=True, methods=["post"], url_path="post-to-inventory")
    def post_to_inventory(self, request, pk=None):
        receipt_item = self.get_object()
        try:
            receipt_item.post_to_inventory()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(receipt_item)
        return Response(serializer.data)

class VendorQuotationItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = VendorQuotationItem.objects.select_related("quotation", "requisition_item", "item", "unit")
    serializer_class = VendorQuotationItemSerializer
    filterset_fields = ("quotation", "requisition_item", "item", "unit", "selected")
    search_fields = ("quotation__supplier__name", "item__name", "item__sku", "selection_reason")
    ordering_fields = ("quantity", "unit_price", "delivery_days", "created_at")


class GoodsInspectionViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = GoodsInspection.objects.select_related("goods_receipt", "inspected_by")
    serializer_class = GoodsInspectionSerializer
    filterset_fields = ("goods_receipt", "inspected_by", "status", "inspection_date")
    search_fields = ("delivery_note_no", "remarks", "goods_receipt__purchase_order__po_number")
    ordering_fields = ("inspection_date", "status", "created_at")


class GoodsInspectionItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = GoodsInspectionItem.objects.select_related("inspection", "goods_receipt_item", "item")
    serializer_class = GoodsInspectionItemSerializer
    filterset_fields = ("inspection", "goods_receipt_item", "item")
    search_fields = ("item__name", "item__sku", "rejection_reason")
    ordering_fields = ("quantity_received", "quantity_accepted", "quantity_rejected", "created_at")


class SupplierReturnViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = SupplierReturn.objects.select_related("supplier", "goods_receipt", "store", "returned_by")
    serializer_class = SupplierReturnSerializer
    filterset_fields = ("supplier", "goods_receipt", "store", "returned_by", "status", "inventory_changes_applied")
    search_fields = ("return_no", "supplier__name", "goods_receipt__purchase_order__po_number", "reason")
    ordering_fields = ("return_no", "return_date", "status", "created_at")

    @action(detail=True, methods=["post"])
    def apply(self, request, pk=None):
        supplier_return = self.get_object()
        try:
            supplier_return.apply_inventory_changes()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(supplier_return).data)


class SupplierReturnItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = SupplierReturnItem.objects.select_related("supplier_return", "item", "unit")
    serializer_class = SupplierReturnItemSerializer
    filterset_fields = ("supplier_return", "item", "unit")
    search_fields = ("supplier_return__return_no", "item__name", "item__sku", "reason")
    ordering_fields = ("quantity", "base_quantity", "created_at")
