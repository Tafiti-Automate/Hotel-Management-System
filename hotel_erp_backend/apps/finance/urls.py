from django.urls import path
from rest_framework.routers import DefaultRouter
from .financial_reports import FinancialStatements, FinancialAccounts, FinancialJournals, FinancialJournalAction, FinancialAssets, FinancialAssetDepreciation

from apps.finance.views import (
    BankAccountViewSet,
    BankTransactionViewSet,
    CashFlowViewSet,
    DailyCashSummaryViewSet,
    ExpenseCategoryViewSet,
    ExpenseViewSet,
    PaymentMethodViewSet,
    SupplierInvoiceViewSet,
    SupplierInvoiceItemViewSet,
    SupplierPaymentViewSet,
    SupplierCreditNoteViewSet,
    SupplierPaymentReconciliationViewSet,
)


router = DefaultRouter()
router.register("payment-methods", PaymentMethodViewSet, basename="payment-method")
router.register("cashflows", CashFlowViewSet, basename="cashflow")
router.register("daily-cash-summaries", DailyCashSummaryViewSet, basename="daily-cash-summary")
router.register("bank-accounts", BankAccountViewSet, basename="bank-account")
router.register("bank-transactions", BankTransactionViewSet, basename="bank-transaction")
router.register("expense-categories", ExpenseCategoryViewSet, basename="expense-category")
router.register("expenses", ExpenseViewSet, basename="expense")
router.register("supplier-invoices", SupplierInvoiceViewSet, basename="supplier-invoice")
router.register("supplier-invoice-items", SupplierInvoiceItemViewSet, basename="supplier-invoice-item")
router.register("supplier-payments", SupplierPaymentViewSet, basename="supplier-payment")
router.register("supplier-credit-notes", SupplierCreditNoteViewSet, basename="supplier-credit-note")
router.register("supplier-payment-reconciliations", SupplierPaymentReconciliationViewSet, basename="supplier-payment-reconciliation")

urlpatterns = router.urls + [
    path('financial-reports/assets/', FinancialAssets.as_view()),
    path('financial-reports/assets/<uuid:asset_id>/depreciation/', FinancialAssetDepreciation.as_view()),
    path('financial-reports/statements/', FinancialStatements.as_view()),
    path('financial-reports/accounts/', FinancialAccounts.as_view()),
    path('financial-reports/journals/', FinancialJournals.as_view()),
    path('financial-reports/journals/<uuid:journal_id>/<str:action>/', FinancialJournalAction.as_view()),
]
