from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
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
    SupplierCreditNote,
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
    SupplierCreditNoteSerializer,
)
from core.mixins.viewsets import CreatedByModelMixin


def require_accounts_payable_action(user):
    """Financial controls: only active Accounts Payable staff run invoice/payment actions.

    Django model permissions still govern ordinary record access and changes.
    IT administrators and superusers must not become payment operators.
    """
    if (
        not user.is_authenticated or not user.is_active
        or user.is_superuser
        or user.groups.filter(name="System Administrator").exists()
        or not user.groups.filter(name="Accounts Payable Clerk").exists()
    ):
        raise PermissionDenied("Only Accounts Payable staff may process supplier invoices and payments.")


def scope_supplier_finance_records(queryset, user, purchase_order_path):
    """Finance records are visible only within the actor's assigned property."""
    if user.is_superuser:
        return queryset
    employee = getattr(user, "employee_profile", None)
    if not employee or not employee.is_active or not employee.branch_id:
        return queryset.none()
    branch = employee.branch
    if getattr(branch, "hotel_id", None):
        return queryset.filter(
            **{f"{purchase_order_path}__requisition__branch__hotel_id": branch.hotel_id}
        )
    return queryset.filter(
        **{f"{purchase_order_path}__requisition__branch_id": branch.pk}
    )


def require_finance_property(user, purchase_order):
    """Validate FK targets on CREATE, when get_queryset cannot protect them."""
    if not purchase_order:
        raise ValidationError("Choose a purchase order in your assigned hotel.")
    if user.is_superuser:
        raise PermissionDenied("Technical accounts cannot create supplier payment records.")
    employee = getattr(user, "employee_profile", None)
    if not employee or not employee.is_active or not employee.branch_id:
        raise PermissionDenied("An active employee and assigned property are required.")
    branch_id = purchase_order.requisition.branch_id
    hotel_id = getattr(employee.branch, "hotel_id", None)
    order_branch = purchase_order.requisition.branch
    if hotel_id:
        allowed = getattr(order_branch, "hotel_id", None) == hotel_id
    else:
        allowed = branch_id == employee.branch_id
    if not allowed:
        raise PermissionDenied("This purchase order belongs to another property.")


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

    def perform_create(self, serializer):
        require_accounts_payable_action(self.request.user)
        require_finance_property(
            self.request.user, serializer.validated_data["purchase_order"]
        )
        super().perform_create(serializer)

    def perform_update(self, serializer):
        require_accounts_payable_action(self.request.user)
        require_finance_property(self.request.user, serializer.instance.purchase_order)
        require_finance_property(
            self.request.user,
            serializer.validated_data.get("purchase_order", serializer.instance.purchase_order),
        )
        super().perform_update(serializer)

    def get_queryset(self):
        return scope_supplier_finance_records(
            super().get_queryset(), self.request.user, "purchase_order"
        )

    def perform_destroy(self, instance):
        if instance.status != SupplierInvoice.STATUS_DRAFT:
            raise ValidationError(
                "An invoice that entered matching or approval cannot be deleted. Cancel or reverse it instead."
            )
        instance.delete()

    @action(detail=True, methods=["post"], url_path="match")
    def match_invoice(self, request, pk=None):
        require_accounts_payable_action(request.user)
        try:
            with transaction.atomic():
                invoice = SupplierInvoice.objects.select_for_update().get(
                    pk=self.get_object().pk
                )
                PurchaseOrder.objects.select_for_update().get(pk=invoice.purchase_order_id)
                invoice.perform_three_way_match()
        except DjangoValidationError as error:
            raise ValidationError(getattr(error, "messages", str(error)))
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="approve-for-payment")
    def approve_for_payment(self, request, pk=None):
        require_accounts_payable_action(request.user)
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

    def perform_create(self, serializer):
        require_accounts_payable_action(self.request.user)
        require_finance_property(
            self.request.user, serializer.validated_data["invoice"].purchase_order
        )
        super().perform_create(serializer)

    def perform_update(self, serializer):
        require_accounts_payable_action(self.request.user)
        require_finance_property(self.request.user, serializer.instance.invoice.purchase_order)
        invoice = serializer.validated_data.get("invoice", serializer.instance.invoice)
        require_finance_property(self.request.user, invoice.purchase_order)
        super().perform_update(serializer)

    def get_queryset(self):
        return scope_supplier_finance_records(
            super().get_queryset(), self.request.user, "invoice__purchase_order"
        )

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

    def perform_create(self, serializer):
        require_accounts_payable_action(self.request.user)
        require_finance_property(
            self.request.user, serializer.validated_data["invoice"].purchase_order
        )
        super().perform_create(serializer)

    def perform_update(self, serializer):
        require_accounts_payable_action(self.request.user)
        require_finance_property(self.request.user, serializer.instance.invoice.purchase_order)
        invoice = serializer.validated_data.get("invoice", serializer.instance.invoice)
        require_finance_property(self.request.user, invoice.purchase_order)
        super().perform_update(serializer)

    def get_queryset(self):
        return scope_supplier_finance_records(
            super().get_queryset(), self.request.user, "invoice__purchase_order"
        )

    def perform_destroy(self, instance):
        if instance.status != SupplierPayment.STATUS_DRAFT:
            raise ValidationError(
                "A posted supplier payment cannot be deleted. Record a controlled reversal instead."
            )
        instance.delete()

    @action(detail=True, methods=["post"])
    def post(self, request, pk=None):
        require_accounts_payable_action(request.user)
        payment = self.get_object()
        try:
            payment.post(posted_by=request.user)
        except DjangoValidationError as error:
            raise ValidationError(getattr(error, "messages", str(error)))
        return Response(self.get_serializer(payment).data)


class SupplierCreditNoteViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = SupplierCreditNote.objects.select_related(
        "invoice__purchase_order__requisition__branch",
        "supplier_return__goods_receipt", "created_by", "approved_by", "posted_by",
    )
    serializer_class = SupplierCreditNoteSerializer
    filterset_fields = ("invoice", "supplier_return", "status", "credit_date")
    search_fields = ("invoice__invoice_number", "supplier_return__credit_note_number")
    ordering_fields = ("credit_date", "status", "created_at")

    def get_queryset(self):
        return scope_supplier_finance_records(
            super().get_queryset(), self.request.user, "invoice__purchase_order"
        )

    def perform_create(self, serializer):
        require_accounts_payable_action(self.request.user)
        invoice = serializer.validated_data["invoice"]
        require_finance_property(self.request.user, invoice.purchase_order)
        # Validate the actual posted return and its LPO before any INSERT.
        credit = SupplierCreditNote(
            **serializer.validated_data, created_by=self.request.user,
        )
        try:
            credit.full_clean()
        except DjangoValidationError as error:
            raise ValidationError(getattr(error, "message_dict", getattr(error, "messages", str(error))))
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        require_accounts_payable_action(self.request.user)
        credit = serializer.instance
        if (("invoice" in serializer.validated_data
             and serializer.validated_data["invoice"].pk != credit.invoice_id)
                or ("supplier_return" in serializer.validated_data
                    and serializer.validated_data["supplier_return"].pk != credit.supplier_return_id)):
            raise ValidationError("Credit note source return and invoice cannot be reassigned.")
        require_finance_property(self.request.user, credit.invoice.purchase_order)
        serializer.save()

    def perform_destroy(self, instance):
        require_accounts_payable_action(self.request.user)
        if instance.status != SupplierCreditNote.STATUS_DRAFT:
            raise ValidationError("Approved or posted supplier credits cannot be deleted.")
        instance.delete()

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        user = request.user
        if (not user.is_authenticated or not user.is_active or user.is_superuser
                or user.groups.filter(name="System Administrator").exists()
                or not user.groups.filter(name="Financial Manager").exists()):
            raise PermissionDenied("Only the Financial Manager can approve supplier credit notes.")
        credit = self.get_object()
        try:
            credit.approve(actor=user)
        except DjangoValidationError as error:
            raise ValidationError(getattr(error, "messages", str(error)))
        return Response(self.get_serializer(credit).data)

    @action(detail=True, methods=["post"])
    def post(self, request, pk=None):
        require_accounts_payable_action(request.user)
        credit = self.get_object()
        try:
            credit.post(actor=request.user)
        except DjangoValidationError as error:
            raise ValidationError(getattr(error, "messages", str(error)))
        return Response(self.get_serializer(credit).data)
