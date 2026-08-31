from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

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
from apps.procurement.models import PurchaseOrder
from apps.finance.serializers import (
    BankAccountSerializer,
    BankTransactionSerializer,
    CashFlowSerializer,
    DailyCashSummarySerializer,
    ExpenseCategorySerializer,
    ExpenseSerializer,
    PaymentMethodSerializer,
    SupplierInvoiceSerializer,
    SupplierInvoiceItemSerializer,
    SupplierPaymentSerializer,
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


class SupplierInvoiceViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = SupplierInvoice.objects.select_related("supplier", "purchase_order")
    serializer_class = SupplierInvoiceSerializer
    filterset_fields = ("supplier", "purchase_order", "status", "invoice_date", "due_date")
    search_fields = ("invoice_number", "supplier__name", "purchase_order__po_number")
    ordering_fields = ("invoice_date", "due_date", "subtotal", "status", "created_at")

    def perform_destroy(self, instance):
        if instance.status != SupplierInvoice.STATUS_DRAFT:
            raise ValidationError(
                "An invoice that entered matching or approval cannot be deleted. Cancel or reverse it instead."
            )
        instance.delete()

    @action(detail=True, methods=["post"], url_path="match")
    def match_invoice(self, request, pk=None):
        with transaction.atomic():
            invoice = SupplierInvoice.objects.select_for_update().get(
                pk=self.get_object().pk
            )
            PurchaseOrder.objects.select_for_update().get(pk=invoice.purchase_order_id)
            invoice.perform_three_way_match()
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="approve-for-payment")
    def approve_for_payment(self, request, pk=None):
        invoice = self.get_object()
        try:
            invoice.approve_for_payment(approved_by=request.user)
        except DjangoValidationError as error:
            raise ValidationError(getattr(error, "messages", str(error)))
        return Response(self.get_serializer(invoice).data)


class SupplierInvoiceItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = SupplierInvoiceItem.objects.select_related(
        "invoice",
        "invoice__purchase_order",
        "purchase_order_item",
        "item",
        "unit",
    )
    serializer_class = SupplierInvoiceItemSerializer
    filterset_fields = ("invoice", "purchase_order_item", "item", "unit")
    search_fields = (
        "invoice__invoice_number",
        "invoice__purchase_order__po_number",
        "item__name",
        "item__sku",
    )
    ordering_fields = ("quantity", "unit_price", "created_at")

    def perform_destroy(self, instance):
        if instance.invoice.status not in (
            SupplierInvoice.STATUS_DRAFT,
            SupplierInvoice.STATUS_EXCEPTION,
        ):
            raise ValidationError("Matched or approved invoice lines cannot be removed.")
        instance.delete()

class SupplierPaymentViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = SupplierPayment.objects.select_related(
        "invoice", "invoice__supplier", "payment_method", "bank_account"
    )
    serializer_class = SupplierPaymentSerializer
    filterset_fields = ("invoice", "payment_method", "bank_account", "status", "payment_date")
    search_fields = ("reference", "invoice__invoice_number", "invoice__supplier__name")
    ordering_fields = ("payment_date", "amount", "status", "created_at")

    def perform_destroy(self, instance):
        if instance.status != SupplierPayment.STATUS_DRAFT:
            raise ValidationError(
                "A posted supplier payment cannot be deleted. Record a controlled reversal instead."
            )
        instance.delete()

    @action(detail=True, methods=["post"])
    def post(self, request, pk=None):
        payment = self.get_object()
        try:
            payment.post(posted_by=request.user)
        except DjangoValidationError as error:
            raise ValidationError(getattr(error, "messages", str(error)))
        return Response(self.get_serializer(payment).data)
