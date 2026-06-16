from rest_framework.routers import DefaultRouter

from apps.inventory.views import (
    CategoryViewSet,
    InventoryBalanceViewSet,
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
    StoreLocationViewSet,
    StoreRequisitionItemViewSet,
    StoreRequisitionViewSet,
    StoreReturnItemViewSet,
    StoreReturnViewSet,
    SupplierItemPriceViewSet,
    UnitOfMeasureViewSet,
)


router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="category")
router.register("units", UnitOfMeasureViewSet, basename="unit")
router.register("items", ItemViewSet, basename="item")
router.register("item-unit-prices", ItemUnitPriceViewSet, basename="item-unit-price")
router.register("stores", StoreLocationViewSet, basename="store")
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
router.register("store-returns", StoreReturnViewSet, basename="store-return")
router.register("store-return-items", StoreReturnItemViewSet, basename="store-return-item")
router.register("stock-counts", StockCountViewSet, basename="stock-count")
router.register("stock-count-items", StockCountItemViewSet, basename="stock-count-item")

urlpatterns = router.urls
