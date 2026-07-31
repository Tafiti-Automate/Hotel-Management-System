from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.employees.models import Employee
from apps.inventory.models import (
    Category,
    DepartmentConsumption,
    InventoryBalance,
    InventoryBatch,
    ReorderRule,
    Item,
    ItemUnitPrice,
    StockAdjustment,
    StockAdjustmentItem,
    StockCount,
    StockCountItem,
    StockIssue,
    StockIssueItem,
    StockLedger,
    StockTransfer,
    StockTransferItem,
    StoreLocation,
    StoreRequisition,
    StoreRequisitionItem,
    StoreReturn,
    StoreReturnItem,
    SupplierItemPrice,
    UnitOfMeasure,
)
from apps.inventory.serializers import (
    CategorySerializer,
    DepartmentConsumptionSerializer,
    InventoryBalanceSerializer,
    InventoryBatchSerializer,
    ReorderRuleSerializer,
    ItemSerializer,
    ItemUnitPriceSerializer,
    StockAdjustmentItemSerializer,
    StockAdjustmentSerializer,
    StockCountItemSerializer,
    StockCountSerializer,
    StockIssueItemSerializer,
    StockIssueSerializer,
    StockLedgerSerializer,
    StockTransferItemSerializer,
    StockTransferSerializer,
    StoreLocationSerializer,
    StoreRequisitionItemSerializer,
    StoreRequisitionSerializer,
    StoreReturnItemSerializer,
    StoreReturnSerializer,
    SupplierItemPriceSerializer,
    UnitOfMeasureSerializer,
)
from core.mixins.viewsets import CreatedByModelMixin
from core.constants.choices import StoreRequisitionStatus


def raise_drf_validation_error(error):
    raise ValidationError(getattr(error, "messages", str(error)))


def enforce_readiness(readiness):
    if readiness["blockers"]:
        raise ValidationError(
            {
                "detail": "Complete the required steps before continuing.",
                "blockers": readiness["blockers"],
                "warnings": readiness["warnings"],
            }
        )


class CategoryViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Category.objects.select_related("parent")
    serializer_class = CategorySerializer
    filterset_fields = ("parent", "is_active")
    search_fields = ("name", "code", "description", "parent__name")
    ordering_fields = ("name", "code", "parent__name", "created_at")


class UnitOfMeasureViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = UnitOfMeasure.objects.all()
    serializer_class = UnitOfMeasureSerializer
    filterset_fields = ("is_active",)
    search_fields = ("name", "abbreviation")
    ordering_fields = ("name", "created_at")


class ItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Item.objects.select_related("category", "base_unit")
    serializer_class = ItemSerializer
    filterset_fields = ("category", "unit", "base_unit", "is_active")
    search_fields = ("name", "sku", "barcode", "brand", "category__name")
    ordering_fields = ("name", "sku", "reorder_level", "created_at")


class ItemUnitPriceViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = ItemUnitPrice.objects.select_related("item", "unit")
    serializer_class = ItemUnitPriceSerializer
    filterset_fields = ("item", "unit", "is_active")
    search_fields = ("item__name", "item__sku", "unit__name")
    ordering_fields = ("conversion_factor", "selling_price", "created_at")


class StoreLocationViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StoreLocation.objects.select_related("branch")
    serializer_class = StoreLocationSerializer
    filterset_fields = ("branch", "is_active", "is_default")
    search_fields = ("name", "address", "branch__name")
    ordering_fields = ("name", "created_at")


class InventoryBalanceViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = InventoryBalance.objects.select_related("item", "store")
    serializer_class = InventoryBalanceSerializer
    filterset_fields = ("item", "store")
    search_fields = ("item__name", "item__sku", "store__name")
    ordering_fields = ("quantity_in_stock", "reorder_level", "last_updated")


class SupplierItemPriceViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = SupplierItemPrice.objects.select_related("supplier", "item", "unit")
    serializer_class = SupplierItemPriceSerializer
    filterset_fields = ("supplier", "item", "unit", "is_preferred", "is_active")
    search_fields = ("supplier__name", "item__name", "item__sku", "supplier_sku")
    ordering_fields = ("unit_price", "lead_time_days", "minimum_order_quantity", "last_quoted_at", "created_at")


class StockLedgerViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StockLedger.objects.select_related("item", "store")
    serializer_class = StockLedgerSerializer
    filterset_fields = ("item", "store", "reference_type", "reference_id")
    search_fields = ("item__name", "item__sku", "store__name", "reference_id")
    ordering_fields = ("created_at", "quantity_in", "quantity_out")


class InventoryBatchViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = InventoryBatch.objects.select_related("item", "store", "purchase_order_item")
    serializer_class = InventoryBatchSerializer
    filterset_fields = ("item", "store", "expiry_date", "purchase_order_item")
    search_fields = ("item__name", "item__sku", "store__name")
    ordering_fields = ("expiry_date", "remaining_quantity", "unit_cost", "created_at")


class StockTransferViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StockTransfer.objects.select_related(
        "from_store",
        "to_store",
        "requested_by",
        "approved_by",
    )
    serializer_class = StockTransferSerializer
    filterset_fields = ("from_store", "to_store", "status", "requested_by", "approved_by")
    search_fields = ("from_store__name", "to_store__name", "note")
    ordering_fields = ("status", "required_date", "created_at")

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        transfer = self.get_object()
        try:
            transfer.approve(approved_by=getattr(request.user, "employee_profile", None))
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(transfer).data)

    @action(detail=True, methods=["post"], url_path="dispatch")
    def dispatch_transfer(self, request, pk=None):
        transfer = self.get_object()
        try:
            transfer.dispatch(dispatched_by=getattr(request.user, "employee_profile", None))
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(transfer).data)

    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        transfer = self.get_object()
        try:
            transfer.receive(received_by=getattr(request.user, "employee_profile", None))
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(transfer).data)

    @action(detail=True, methods=["post"])
    def apply(self, request, pk=None):
        transfer = self.get_object()
        try:
            transfer.apply_inventory_changes()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(transfer)
        return Response(serializer.data)


class StockTransferItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StockTransferItem.objects.select_related("stock_transfer", "item", "unit")
    serializer_class = StockTransferItemSerializer
    filterset_fields = ("stock_transfer", "item", "unit")
    search_fields = ("item__name", "item__sku")
    ordering_fields = ("quantity", "base_quantity", "created_at")


class StockAdjustmentViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StockAdjustment.objects.select_related("store", "approved_by")
    serializer_class = StockAdjustmentSerializer
    filterset_fields = ("store", "status", "approved_by")
    search_fields = ("reference", "reason", "note", "store__name")
    ordering_fields = ("status", "created_at")

    @action(detail=True, methods=["post"])
    def apply(self, request, pk=None):
        adjustment = self.get_object()
        try:
            adjustment.apply()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(adjustment)
        return Response(serializer.data)


class StockAdjustmentItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StockAdjustmentItem.objects.select_related("stock_adjustment", "item", "unit")
    serializer_class = StockAdjustmentItemSerializer
    filterset_fields = ("stock_adjustment", "item", "unit")
    search_fields = ("item__name", "item__sku", "reason")
    ordering_fields = ("quantity_change", "created_at")

class ReorderRuleViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = ReorderRule.objects.select_related("item", "store", "preferred_supplier")
    serializer_class = ReorderRuleSerializer
    filterset_fields = ("item", "store", "preferred_supplier", "is_active")
    search_fields = ("item__name", "item__sku", "store__name", "preferred_supplier__name")
    ordering_fields = ("minimum_level", "reorder_quantity", "created_at")

    @action(detail=True, methods=["post"], url_path="create-purchase-requisition")
    def create_purchase_requisition(self, request, pk=None):
        reorder_rule = self.get_object()
        requester = getattr(request.user, "employee_profile", None)
        department = requester.department if requester else None
        try:
            purchase_requisition = reorder_rule.create_purchase_requisition(
                requester=requester,
                department=department,
                reason=request.data.get("reason", ""),
                created_by=request.user if request.user.is_authenticated else None,
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)

        from apps.procurement.serializers import PurchaseRequisitionSerializer

        serializer = PurchaseRequisitionSerializer(
            purchase_requisition,
            context=self.get_serializer_context(),
        )
        return Response(serializer.data)


class StoreRequisitionViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StoreRequisition.objects.select_related("department", "store", "requested_by", "approved_by")
    serializer_class = StoreRequisitionSerializer
    filterset_fields = ("department", "store", "requested_by", "approved_by", "status")
    search_fields = ("requisition_no", "purpose", "department__name", "store__name")
    ordering_fields = ("requisition_no", "status", "required_date", "created_at")

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.is_superuser or user.groups.filter(
            name__in=(
                "System Administrator", "General Manager", "Stores Manager",
                "Store Keeper", "Auditor",
            )
        ).exists():
            return queryset
        employee = getattr(user, "employee_profile", None)
        if not employee:
            return queryset.none()
        if user.groups.filter(name="Department Head").exists():
            return queryset.filter(
                department=employee.department,
                store__branch=employee.branch,
            )
        return queryset.filter(requested_by=employee)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        requisition = self.get_object()
        try:
            requisition.submit()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(requisition).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        requisition = self.get_object()
        try:
            requisition.approve(
                approved_by=getattr(request.user, "employee_profile", None),
                comments=request.data.get("comments", ""),
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(requisition).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        requisition = self.get_object()
        try:
            requisition.reject(reason=request.data.get("reason", ""))
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(requisition).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        requisition = self.get_object()
        try:
            requisition.cancel()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(requisition).data)


class StoreRequisitionItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StoreRequisitionItem.objects.select_related("requisition", "item", "unit")
    serializer_class = StoreRequisitionItemSerializer
    filterset_fields = ("requisition", "item", "unit")
    search_fields = ("requisition__requisition_no", "item__name", "item__sku")
    ordering_fields = ("quantity_requested", "quantity_approved", "quantity_issued", "created_at")

    def perform_destroy(self, instance):
        if instance.requisition.status not in (
            StoreRequisitionStatus.DRAFT,
            StoreRequisitionStatus.REJECTED,
        ):
            raise ValidationError("Only draft or rejected store request lines can be removed.")
        instance.delete()


class StockIssueViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StockIssue.objects.select_related("requisition", "store", "issued_by", "received_by")
    serializer_class = StockIssueSerializer
    filterset_fields = ("requisition", "store", "issued_by", "received_by", "inventory_changes_applied")
    search_fields = ("issue_no", "requisition__requisition_no", "store__name", "received_by_name")
    ordering_fields = ("issue_no", "issue_date", "created_at")

    @action(detail=True, methods=["get"])
    def readiness(self, request, pk=None):
        return Response(self.get_object().posting_readiness())

    @action(detail=True, methods=["post"])
    def apply(self, request, pk=None):
        issue = self.get_object()
        enforce_readiness(issue.posting_readiness())
        try:
            issue.apply_inventory_changes()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(issue).data)

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        issue = self.get_object()
        if not issue.inventory_changes_applied:
            raise ValidationError("Stock must be issued before the department can acknowledge receipt.")
        received_by = None
        if request.data.get("received_by"):
            try:
                received_by = Employee.objects.get(pk=request.data["received_by"])
            except Employee.DoesNotExist:
                raise ValidationError({"received_by": "Selected employee was not found."})
        received_by_name = request.data.get("received_by_name", "").strip()
        if not received_by and not received_by_name:
            raise ValidationError("Select the receiving employee or enter the receiver's name.")
        issue.received_by = received_by
        issue.received_by_name = received_by_name or str(received_by)
        issue.save(update_fields=("received_by", "received_by_name", "updated_at"))
        return Response(self.get_serializer(issue).data)


class StockIssueItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StockIssueItem.objects.select_related("issue", "requisition_item", "item", "unit")
    serializer_class = StockIssueItemSerializer
    filterset_fields = ("issue", "requisition_item", "item", "unit")
    search_fields = ("issue__issue_no", "item__name", "item__sku")
    ordering_fields = ("quantity", "base_quantity", "created_at")


class DepartmentConsumptionViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = DepartmentConsumption.objects.select_related(
        "department", "item", "stock_issue_item", "goods_receipt_item"
    )
    serializer_class = DepartmentConsumptionSerializer
    filterset_fields = ("department", "item", "consumed_on")
    search_fields = ("department__name", "item__name", "item__sku", "purpose")
    ordering_fields = ("consumed_on", "quantity", "unit_cost", "created_at")


class StoreReturnViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StoreReturn.objects.select_related("department", "store", "received_by")
    serializer_class = StoreReturnSerializer
    filterset_fields = ("department", "store", "received_by", "inventory_changes_applied")
    search_fields = ("return_no", "department__name", "store__name", "reason")
    ordering_fields = ("return_no", "return_date", "created_at")

    @action(detail=True, methods=["post"])
    def apply(self, request, pk=None):
        store_return = self.get_object()
        try:
            store_return.apply_inventory_changes()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(store_return).data)


class StoreReturnItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StoreReturnItem.objects.select_related("store_return", "item", "unit")
    serializer_class = StoreReturnItemSerializer
    filterset_fields = ("store_return", "item", "unit")
    search_fields = ("store_return__return_no", "item__name", "item__sku")
    ordering_fields = ("quantity", "base_quantity", "created_at")


class StockCountViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StockCount.objects.select_related("store", "conducted_by", "approved_by")
    serializer_class = StockCountSerializer
    filterset_fields = ("store", "conducted_by", "approved_by", "status", "inventory_changes_applied")
    search_fields = ("count_no", "store__name", "note")
    ordering_fields = ("count_no", "count_date", "status", "created_at")

    @action(detail=True, methods=["post"])
    def populate(self, request, pk=None):
        stock_count = self.get_object()
        stock_count.populate_from_system_balances()
        return Response(self.get_serializer(stock_count).data)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        stock_count = self.get_object()
        try:
            stock_count.submit()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(stock_count).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        stock_count = self.get_object()
        try:
            stock_count.approve(approved_by=getattr(request.user, "employee_profile", None))
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(stock_count).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        stock_count = self.get_object()
        try:
            stock_count.cancel()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(stock_count).data)

    @action(detail=True, methods=["post"])
    def apply(self, request, pk=None):
        stock_count = self.get_object()
        try:
            stock_count.apply_variances()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(stock_count).data)


class StockCountItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = StockCountItem.objects.select_related("stock_count", "item")
    serializer_class = StockCountItemSerializer
    filterset_fields = ("stock_count", "item")
    search_fields = ("stock_count__count_no", "item__name", "item__sku")
    ordering_fields = ("system_quantity", "physical_quantity", "created_at")
    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        adjustment = self.get_object()
        try:
            adjustment.submit()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(adjustment).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        adjustment = self.get_object()
        try:
            adjustment.approve(approved_by=getattr(request.user, "employee_profile", None))
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(adjustment).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        adjustment = self.get_object()
        try:
            adjustment.reject(reason=request.data.get("reason", ""))
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(adjustment).data)
