from django.urls import path
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.routers import DefaultRouter

from apps.inventory.hod_draft_api import StoreRequisitionViewSet
from apps.inventory.serializers import StoreLocationSerializer
from apps.inventory.transaction_controls import (
    InventoryBalanceViewSet,
    StoreLocationViewSet,
    StoreRequisitionItemViewSet,
    operational_stores_for_user,
)
from apps.inventory.views import (
    CategoryViewSet,
    DepartmentConsumptionViewSet,
    InventoryBatchViewSet,
    ReorderRuleViewSet,
    ItemViewSet,
    ItemUnitPriceViewSet,
    StockAdjustmentItemViewSet,
    StockAdjustmentViewSet,
    StockCountItemViewSet,
    StockCountViewSet,
    StockIssueItemViewSet,
    StockIssueViewSet,
    StockLedgerViewSet,
    StockTransferItemViewSet,
    StockTransferViewSet,
    StoreKeeperAssignmentViewSet,
    StoreReturnItemViewSet,
    StoreReturnViewSet,
    SupplierItemPriceViewSet,
    UnitOfMeasureViewSet,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def store_requisition_store_options(request):
    """Backward-compatible store picker for cached and current ERP clients."""
    stores = operational_stores_for_user(request.user).order_by("name")
    return Response(StoreLocationSerializer(stores, many=True).data)


router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="category")
router.register("units", UnitOfMeasureViewSet, basename="unit")
router.register("items", ItemViewSet, basename="item")
router.register("item-unit-prices", ItemUnitPriceViewSet, basename="item-unit-price")
router.register("stores", StoreLocationViewSet, basename="store")
router.register("store-keeper-assignments", StoreKeeperAssignmentViewSet, basename="store-keeper-assignment")
router.register("inventory-balances", InventoryBalanceViewSet, basename="inventory-balance")
router.register("supplier-item-prices", SupplierItemPriceViewSet, basename="supplier-item-price")
router.register("reorder-rules", ReorderRuleViewSet, basename="reorder-rule")
router.register("stock-ledger", StockLedgerViewSet, basename="stock-ledger")
router.register("inventory-batches", InventoryBatchViewSet, basename="inventory-batch")
router.register("stock-transfers", StockTransferViewSet, basename="stock-transfer")
router.register("stock-transfer-items", StockTransferItemViewSet, basename="stock-transfer-item")
router.register("stock-adjustments", StockAdjustmentViewSet, basename="stock-adjustment")
router.register("stock-adjustment-items", StockAdjustmentItemViewSet, basename="stock-adjustment-item")

router.register("store-requisitions", StoreRequisitionViewSet, basename="store-requisition")
router.register("store-requisition-items", StoreRequisitionItemViewSet, basename="store-requisition-item")
router.register("stock-issues", StockIssueViewSet, basename="stock-issue")
router.register("stock-issue-items", StockIssueItemViewSet, basename="stock-issue-item")
router.register("department-consumption", DepartmentConsumptionViewSet, basename="department-consumption")
router.register("store-returns", StoreReturnViewSet, basename="store-return")
router.register("store-return-items", StoreReturnItemViewSet, basename="store-return-item")
router.register("stock-counts", StockCountViewSet, basename="stock-count")
router.register("stock-count-items", StockCountItemViewSet, basename="stock-count-item")

urlpatterns = [
    path(
        "store-requisitions/store-options/",
        store_requisition_store_options,
        name="store-requisition-store-options",
    ),
] + router.urls
