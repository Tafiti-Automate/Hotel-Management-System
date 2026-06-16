from django.urls import path

from apps.reports.views import (
    ConsumptionReportView,
    ExpiryReportView,
    LowStockReportView,
    ProcurementSummaryReportView,
    StockCardReportView,
    StockSummaryReportView,
)


urlpatterns = [
    path("reports/stock-summary/", StockSummaryReportView.as_view(), name="report-stock-summary"),
    path("reports/low-stock/", LowStockReportView.as_view(), name="report-low-stock"),
    path("reports/expiry/", ExpiryReportView.as_view(), name="report-expiry"),
    path("reports/consumption/", ConsumptionReportView.as_view(), name="report-consumption"),
    path("reports/procurement-summary/", ProcurementSummaryReportView.as_view(), name="report-procurement-summary"),
    path("reports/stock-card/", StockCardReportView.as_view(), name="report-stock-card"),
]
