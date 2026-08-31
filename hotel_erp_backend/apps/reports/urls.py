from django.urls import path

from apps.reports.views import (
    ConsumptionReportView,
    DepartmentRequestRegisterReportView,
    StoreIssueRegisterReportView,
    PurchaseRequisitionRegisterReportView,
    PurchaseOrderRegisterReportView,
    GoodsReceiptRegisterReportView,
    ExpiryReportView,
    LowStockReportView,
    ProcurementSummaryReportView,
    StockCardReportView,
    StockSummaryReportView,
    ControlReportView,
)


urlpatterns = [
    path("reports/department-requests/", DepartmentRequestRegisterReportView.as_view(), name="report-department-requests"),
    path("reports/store-issues/", StoreIssueRegisterReportView.as_view(), name="report-store-issues"),
    path("reports/purchase-requisitions/", PurchaseRequisitionRegisterReportView.as_view(), name="report-purchase-requisitions"),
    path("reports/purchase-orders/", PurchaseOrderRegisterReportView.as_view(), name="report-purchase-orders"),
    path("reports/goods-receipts/", GoodsReceiptRegisterReportView.as_view(), name="report-goods-receipts"),
    path("reports/stock-summary/", StockSummaryReportView.as_view(), name="report-stock-summary"),
    path("reports/low-stock/", LowStockReportView.as_view(), name="report-low-stock"),
    path("reports/expiry/", ExpiryReportView.as_view(), name="report-expiry"),
    path("reports/consumption/", ConsumptionReportView.as_view(), name="report-consumption"),
    path("reports/procurement-summary/", ProcurementSummaryReportView.as_view(), name="report-procurement-summary"),
    path("reports/stock-card/", StockCardReportView.as_view(), name="report-stock-card"),
    path("reports/daily-crucial-activities/", ControlReportView.as_view(report_kind="daily"), name="report-daily-crucial-activities"),
    path("reports/pending-actions/", ControlReportView.as_view(report_kind="pending"), name="report-pending-actions"),
    path("reports/exceptions/", ControlReportView.as_view(report_kind="exceptions"), name="report-exceptions"),
    path("reports/user-activity/", ControlReportView.as_view(report_kind="user_activity"), name="report-user-activity"),
    path("reports/stock-movement-control/", ControlReportView.as_view(report_kind="stock_movements"), name="report-stock-movement-control"),
    path("reports/approval-trail/", ControlReportView.as_view(report_kind="approval_trail"), name="report-approval-trail"),
    path("reports/direct-workspace/", ControlReportView.as_view(report_kind="direct_workspace"), name="report-direct-workspace"),
    path("reports/supplier-price-changes/", ControlReportView.as_view(report_kind="supplier_price_changes"), name="report-supplier-price-changes"),
    path("reports/management-summary/", ControlReportView.as_view(report_kind="management_summary"), name="report-management-summary"),
]
