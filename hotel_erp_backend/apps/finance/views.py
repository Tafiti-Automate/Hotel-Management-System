from rest_framework.viewsets import ModelViewSet

from apps.finance.models import (
    BankAccount,
    BankTransaction,
    CashFlow,
    DailyCashSummary,
    Expense,
    ExpenseCategory,
    PaymentMethod,
)
from apps.finance.serializers import (
    BankAccountSerializer,
    BankTransactionSerializer,
    CashFlowSerializer,
    DailyCashSummarySerializer,
    ExpenseCategorySerializer,
    ExpenseSerializer,
    PaymentMethodSerializer,
)
from core.mixins.viewsets import CreatedByModelMixin


class PaymentMethodViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = PaymentMethod.objects.all()
    serializer_class = PaymentMethodSerializer
    filterset_fields = ("is_active", "is_default")
    search_fields = ("name", "description")
    ordering_fields = ("name", "created_at")


class CashFlowViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = CashFlow.objects.select_related("store", "payment_method")
    serializer_class = CashFlowSerializer
    filterset_fields = ("store", "transaction_type", "payment_method", "date")
    search_fields = ("reference", "note", "store__name")
    ordering_fields = ("date", "amount", "created_at")


class DailyCashSummaryViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = DailyCashSummary.objects.select_related("store")
    serializer_class = DailyCashSummarySerializer
    filterset_fields = ("store", "date")
    search_fields = ("store__name", "note")
    ordering_fields = ("date", "closing_balance")


class BankAccountViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = BankAccount.objects.all()
    serializer_class = BankAccountSerializer
    filterset_fields = ("is_active", "bank_name")
    search_fields = ("name", "account_number", "bank_name")
    ordering_fields = ("bank_name", "name", "created_at")


class BankTransactionViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = BankTransaction.objects.select_related("bank_account", "store", "related_cashflow")
    serializer_class = BankTransactionSerializer
    filterset_fields = ("bank_account", "store", "transaction_type", "date")
    search_fields = ("reference", "note", "bank_account__account_number", "store__name")
    ordering_fields = ("date", "amount", "created_at")


class ExpenseCategoryViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = ExpenseCategory.objects.all()
    serializer_class = ExpenseCategorySerializer
    search_fields = ("name", "description")
    ordering_fields = ("name", "created_at")


class ExpenseViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Expense.objects.select_related(
        "store",
        "category",
        "related_purchase",
        "related_cashflow",
        "payment_method",
    )
    serializer_class = ExpenseSerializer
    filterset_fields = ("store", "category", "payment_method", "date")
    search_fields = ("reference", "description", "store__name", "category__name")
    ordering_fields = ("date", "amount", "created_at")
