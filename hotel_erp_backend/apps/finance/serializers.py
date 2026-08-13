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
    SupplierInvoiceItem,
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
    line_count = serializers.IntegerField(source="items.count", read_only=True)

    class Meta:
        model = SupplierInvoice
        fields = "__all__"
        read_only_fields = (
            "id", "status", "quantity_variance", "amount_variance", "match_notes",
            "approved_at", "approved_by", "total_amount", "paid_amount", "balance_due", "line_count", "created_at", "updated_at",
            "created_by",
        )

    def validate(self, attrs):
        supplier = attrs.get("supplier", getattr(self.instance, "supplier", None))
        order = attrs.get("purchase_order", getattr(self.instance, "purchase_order", None))
        invoice_number = str(
            attrs.get("invoice_number", getattr(self.instance, "invoice_number", ""))
        ).strip()
        if supplier and order and order.supplier_id != supplier.id:
            raise serializers.ValidationError(
                {"supplier": "Invoice supplier must match the supplier on the LPO."}
            )
        duplicate = SupplierInvoice.objects.filter(
            supplier=supplier,
            invoice_number__iexact=invoice_number,
        )
        if self.instance:
            duplicate = duplicate.exclude(pk=self.instance.pk)
            if self.instance.status not in (
                SupplierInvoice.STATUS_DRAFT,
                SupplierInvoice.STATUS_EXCEPTION,
            ) and attrs:
                raise serializers.ValidationError(
                    "Matched or approved invoices cannot be edited. Use a credit note or cancellation workflow."
                )
        if supplier and invoice_number and duplicate.exists():
            raise serializers.ValidationError(
                {"invoice_number": "This supplier invoice number has already been recorded."}
            )
        attrs["invoice_number"] = invoice_number
        return attrs


class SupplierInvoiceItemSerializer(serializers.ModelSerializer):
    line_subtotal = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    accepted_base_quantity = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True
    )
    previously_matched_base_quantity = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True
    )
    invoiceable_base_quantity = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True
    )

    class Meta:
        model = SupplierInvoiceItem
        fields = "__all__"
        read_only_fields = (
            "id",
            "item",
            "base_quantity",
            "line_subtotal",
            "accepted_base_quantity",
            "previously_matched_base_quantity",
            "invoiceable_base_quantity",
            "created_at",
            "updated_at",
            "created_by",
        )

    def validate(self, attrs):
        invoice = attrs.get("invoice", getattr(self.instance, "invoice", None))
        order_line = attrs.get(
            "purchase_order_item",
            getattr(self.instance, "purchase_order_item", None),
        )
        if invoice and invoice.status not in (
            SupplierInvoice.STATUS_DRAFT,
            SupplierInvoice.STATUS_EXCEPTION,
        ):
            raise serializers.ValidationError(
                "Matched or approved invoice lines cannot be changed."
            )
        if (
            invoice
            and order_line
            and order_line.purchase_order_id != invoice.purchase_order_id
        ):
            raise serializers.ValidationError(
                {"purchase_order_item": "This Article is not on the invoice's LPO."}
            )
        return attrs


class SupplierPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierPayment
        fields = "__all__"
        read_only_fields = (
            "id", "status", "posted_at", "posted_by", "created_at", "updated_at", "created_by"
        )
