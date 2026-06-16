from rest_framework.viewsets import ModelViewSet

from apps.customers.models import Customer, CustomerLedger, Payment, PaymentAllocation
from apps.customers.serializers import (
    CustomerLedgerSerializer,
    CustomerSerializer,
    PaymentAllocationSerializer,
    PaymentSerializer,
)
from core.mixins.viewsets import CreatedByModelMixin


class CustomerViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer
    filterset_fields = ("is_active",)
    search_fields = ("name", "company", "phone", "email")
    ordering_fields = ("name", "balance", "created_at")


class CustomerLedgerViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = CustomerLedger.objects.select_related("customer")
    serializer_class = CustomerLedgerSerializer
    filterset_fields = ("customer", "transaction_type")
    search_fields = ("customer__name", "reference", "note")
    ordering_fields = ("created_at", "debit", "credit", "balance_after")


class PaymentViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Payment.objects.select_related("customer", "payment_method", "received_by")
    serializer_class = PaymentSerializer
    filterset_fields = ("customer", "payment_method", "received_by")
    search_fields = ("customer__name", "reference", "note")
    ordering_fields = ("amount", "created_at")


class PaymentAllocationViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = PaymentAllocation.objects.select_related("payment", "sale")
    serializer_class = PaymentAllocationSerializer
    filterset_fields = ("payment", "sale")
    search_fields = ("payment__customer__name", "sale__receipt_no")
    ordering_fields = ("amount", "created_at")
