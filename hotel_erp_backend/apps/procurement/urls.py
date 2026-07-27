from rest_framework.routers import DefaultRouter

from apps.procurement.views import (
    GoodsInspectionItemViewSet,
    GoodsInspectionViewSet,
    GoodsReceiptItemViewSet,
    GoodsReceiptNoteViewSet,
    PurchaseOrderViewSet,
    PurchaseOrderItemViewSet,
    ProcurementAttachmentViewSet,
    ProcurementCommunicationViewSet,
    PurchaseRequisitionViewSet,
    RequisitionItemViewSet,
    SupplierReturnItemViewSet,
    SupplierReturnViewSet,
    VendorQuotationItemViewSet,
    VendorQuotationViewSet,
)


router = DefaultRouter()
router.register("requisitions", PurchaseRequisitionViewSet, basename="requisition")
router.register("requisition-items", RequisitionItemViewSet, basename="requisition-item")
router.register("quotations", VendorQuotationViewSet, basename="quotation")
router.register("quotation-items", VendorQuotationItemViewSet, basename="quotation-item")
router.register("purchase-orders", PurchaseOrderViewSet, basename="purchase-order")
router.register("purchase-order-items", PurchaseOrderItemViewSet, basename="purchase-order-item")
router.register("grns", GoodsReceiptNoteViewSet, basename="grn")
router.register("grn-items", GoodsReceiptItemViewSet, basename="grn-item")
router.register("goods-inspections", GoodsInspectionViewSet, basename="goods-inspection")
router.register("goods-inspection-items", GoodsInspectionItemViewSet, basename="goods-inspection-item")
router.register("supplier-returns", SupplierReturnViewSet, basename="supplier-return")
router.register("supplier-return-items", SupplierReturnItemViewSet, basename="supplier-return-item")
router.register("procurement-attachments", ProcurementAttachmentViewSet, basename="procurement-attachment")
router.register("procurement-communications", ProcurementCommunicationViewSet, basename="procurement-communication")

urlpatterns = router.urls
