from rest_framework import serializers

from apps.finance.models import (
    BankAccount,
    BankTransaction,
    CashFlow,
    DailyCashSummary,
    Expense,
    ExpenseCategory,
    PaymentMethod,
    SupplierInvoice,
    SupplierPayment,
)


class PaymentMethodSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentMethod
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class CashFlowSerializer(serializers.ModelSerializer):
    abs_amount = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    is_inflow = serializers.BooleanField(read_only=True)
    is_outflow = serializers.BooleanField(read_only=True)

    class Meta:
        model = CashFlow
        fields = "__all__"
        read_only_fields = (
            "id",
            "abs_amount",
            "is_inflow",
            "is_outflow",
            "created_at",
            "updated_at",
            "created_by",
        )


class DailyCashSummarySerializer(serializers.ModelSerializer):
    net_flow = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    discrepancy = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = DailyCashSummary
        fields = "__all__"
        read_only_fields = ("id", "net_flow", "discrepancy", "created_at", "updated_at", "created_by")


class BankAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = BankAccount
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class BankTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = BankTransaction
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class ExpenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Expense
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class SupplierInvoiceSerializer(serializers.ModelSerializer):
    total_amount = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    paid_amount = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    balance_due = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = SupplierInvoice
        fields = "__all__"
        read_only_fields = (
            "id", "status", "quantity_variance", "amount_variance", "match_notes",
            "total_amount", "paid_amount", "balance_due", "created_at", "updated_at",
            "created_by",
        )


class SupplierPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierPayment
        fields = "__all__"
        read_only_fields = ("id", "status", "created_at", "updated_at", "created_by")
