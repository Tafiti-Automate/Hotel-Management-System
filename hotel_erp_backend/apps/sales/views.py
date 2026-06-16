from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.sales.models import Sale, SaleItem
from apps.sales.serializers import SaleItemSerializer, SaleSerializer
from core.mixins.viewsets import CreatedByModelMixin


def raise_drf_validation_error(error):
    raise ValidationError(getattr(error, "messages", str(error)))


class SaleViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Sale.objects.select_related("customer", "store", "recorded_by", "payment_method", "cancelled_by")
    serializer_class = SaleSerializer
    filterset_fields = ("customer", "store", "status", "payment_method", "is_cancelled")
    search_fields = ("receipt_no", "customer__name", "store__name", "note")
    ordering_fields = ("sale_date", "total_amount", "balance", "created_at")

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        sale = self.get_object()
        try:
            sale.complete_sale()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(sale)
        return Response(serializer.data)


class SaleItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = SaleItem.objects.select_related("sale", "item", "unit")
    serializer_class = SaleItemSerializer
    filterset_fields = ("sale", "item", "unit")
    search_fields = ("sale__receipt_no", "item__name", "item__sku")
    ordering_fields = ("quantity", "base_quantity", "unit_price", "created_at")
