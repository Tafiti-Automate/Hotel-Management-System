from rest_framework.routers import DefaultRouter

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

urlpatterns = router.urls
