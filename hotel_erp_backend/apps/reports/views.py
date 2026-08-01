from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.permissions import BasePermission
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.inventory.models import (
    InventoryBalance,
    InventoryBatch,
    ReorderRule,
    StockLedger,
)
from apps.procurement.models import PurchaseOrder, PurchaseRequisition, SupplierReturn
from core.constants.choices import LedgerReferenceType


class CanViewOperationalReports(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (
                user.is_superuser
                or user.has_perm("inventory.view_inventorybalance")
                or user.has_perm("inventory.view_stockledger")
                or user.has_perm("procurement.view_purchaseorder")
            )
        )


class ReportAPIView(APIView):
    permission_classes = [CanViewOperationalReports]


def apply_store_scope(queryset, request, *, store_field="store"):
    store_id = request.query_params.get("store")
    branch_id = request.query_params.get("branch")
    if store_id:
        queryset = queryset.filter(**{f"{store_field}_id": store_id})
    elif branch_id:
        queryset = queryset.filter(**{f"{store_field}__branch_id": branch_id})
    return queryset


def apply_category_scope(queryset, request, *, item_field="item"):
    category_id = request.query_params.get("category")
    if category_id:
        queryset = queryset.filter(**{f"{item_field}__category_id": category_id})
    return queryset


def apply_date_scope(queryset, request, *, field="created_at"):
    filters = {}
    for parameter, lookup in (("date_from", "date"), ("date_to", "date")):
        raw_value = request.query_params.get(parameter)
        if not raw_value:
            continue
        value = parse_date(raw_value)
        if value is None:
            raise ValidationError({parameter: "Enter a valid date in YYYY-MM-DD format."})
        suffix = "gte" if parameter == "date_from" else "lte"
        filters[f"{field}__{lookup}__{suffix}"] = value
    return queryset.filter(**filters)


def weighted_average_cost(item, store):
    batches = InventoryBatch.objects.filter(
        item=item,
        store=store,
        remaining_quantity__gt=Decimal("0.00"),
    )
    total_quantity = sum((batch.remaining_quantity for batch in batches), Decimal("0.00"))
    if total_quantity <= Decimal("0.00"):
        return Decimal("0.00")
    total_cost = sum(
        (batch.remaining_quantity * batch.unit_cost for batch in batches),
        Decimal("0.00"),
    )
    return total_cost / total_quantity


def decimal_string(value):
    return str(value.quantize(Decimal("0.01")))


class StockSummaryReportView(ReportAPIView):
    def get(self, request):
        queryset = InventoryBalance.objects.select_related("item", "store", "item__category")
        queryset = apply_store_scope(queryset, request)
        queryset = apply_category_scope(queryset, request)

        rows = []
        total_value = Decimal("0.00")
        for balance in queryset:
            average_cost = weighted_average_cost(balance.item, balance.store)
            stock_value = balance.quantity_in_stock * average_cost
            total_value += stock_value
            rows.append(
                {
                    "item": str(balance.item),
                    "sku": balance.item.sku,
                    "category": balance.item.category.name,
                    "store": str(balance.store),
                    "quantity_in_stock": decimal_string(balance.quantity_in_stock),
                    "average_cost": decimal_string(average_cost),
                    "stock_value": decimal_string(stock_value),
                    "below_reorder": balance.is_below_reorder,
                }
            )
        return Response({"total_value": decimal_string(total_value), "results": rows})


class LowStockReportView(ReportAPIView):
    def get(self, request):
        queryset = InventoryBalance.objects.select_related("item", "store")
        queryset = apply_store_scope(queryset, request)
        queryset = apply_category_scope(queryset, request)

        rows = []
        for balance in queryset:
            rule = (
                ReorderRule.objects.filter(item=balance.item, store=balance.store, is_active=True).first()
                or ReorderRule.objects.filter(item=balance.item, store__isnull=True, is_active=True).first()
            )
            minimum_level = rule.minimum_level if rule else (balance.reorder_level or balance.item.reorder_level)
            reorder_quantity = rule.reorder_quantity if rule else Decimal("0.00")
            if balance.quantity_in_stock <= minimum_level:
                rows.append(
                    {
                        "item": str(balance.item),
                        "sku": balance.item.sku,
                        "store": str(balance.store),
                        "quantity_in_stock": decimal_string(balance.quantity_in_stock),
                        "minimum_level": decimal_string(minimum_level),
                        "reorder_quantity": decimal_string(reorder_quantity),
                        "preferred_supplier": str(rule.preferred_supplier) if rule and rule.preferred_supplier else "",
                    }
                )
        return Response({"results": rows})


class ExpiryReportView(ReportAPIView):
    def get(self, request):
        raw_days = request.query_params.get("days", "30")
        try:
            days = int(raw_days)
        except (TypeError, ValueError):
            raise ValidationError({"days": "Enter a whole number of days."})
        if days < 0:
            raise ValidationError({"days": "Days cannot be negative."})
        requested_end_date = request.query_params.get("date_to")
        end_date = parse_date(requested_end_date) if requested_end_date else None
        if requested_end_date and end_date is None:
            raise ValidationError({"date_to": "Enter a valid date in YYYY-MM-DD format."})
        end_date = end_date or (timezone.localdate() + timedelta(days=days))
        queryset = InventoryBatch.objects.select_related("item", "store").filter(
            expiry_date__isnull=False,
            expiry_date__lte=end_date,
            remaining_quantity__gt=Decimal("0.00"),
        )
        date_from = request.query_params.get("date_from")
        if date_from:
            start_date = parse_date(date_from)
            if start_date is None:
                raise ValidationError({"date_from": "Enter a valid date in YYYY-MM-DD format."})
            queryset = queryset.filter(expiry_date__gte=start_date)
        queryset = apply_store_scope(queryset, request)
        queryset = apply_category_scope(queryset, request)
        rows = [
            {
                "item": str(batch.item),
                "sku": batch.item.sku,
                "store": str(batch.store),
                "remaining_quantity": decimal_string(batch.remaining_quantity),
                "unit_cost": decimal_string(batch.unit_cost),
                "expiry_date": batch.expiry_date,
            }
            for batch in queryset.order_by("expiry_date", "item__name")
        ]
        return Response({"until": end_date, "results": rows})


class ConsumptionReportView(ReportAPIView):
    def get(self, request):
        queryset = StockLedger.objects.select_related("item", "store").filter(
            quantity_out__gt=Decimal("0.00"),
            reference_type__in=[
                LedgerReferenceType.STOCK_ISSUE,
                LedgerReferenceType.SALE,
                LedgerReferenceType.STOCK_ADJUSTMENT,
            ],
        )
        item_id = request.query_params.get("item")
        queryset = apply_store_scope(queryset, request)
        queryset = apply_category_scope(queryset, request)
        queryset = apply_date_scope(queryset, request)
        if item_id:
            queryset = queryset.filter(item_id=item_id)

        rows = (
            queryset.values("item__name", "item__sku", "store__name", "reference_type")
            .annotate(total_quantity=Sum("quantity_out"))
            .order_by("item__name", "store__name", "reference_type")
        )
        return Response(
            {
                "results": [
                    {
                        "item": row["item__name"],
                        "sku": row["item__sku"],
                        "store": row["store__name"],
                        "reference_type": row["reference_type"],
                        "total_quantity": decimal_string(row["total_quantity"] or Decimal("0.00")),
                    }
                    for row in rows
                ]
            }
        )


class ProcurementSummaryReportView(ReportAPIView):
    def get(self, request):
        requisition_queryset = PurchaseRequisition.objects.all()
        purchase_order_queryset = PurchaseOrder.objects.all()
        supplier_return_queryset = SupplierReturn.objects.all()
        branch_id = request.query_params.get("branch")
        if branch_id:
            requisition_queryset = requisition_queryset.filter(branch_id=branch_id)
            purchase_order_queryset = purchase_order_queryset.filter(requisition__branch_id=branch_id)
            supplier_return_queryset = supplier_return_queryset.filter(store__branch_id=branch_id)
        requisition_queryset = apply_date_scope(requisition_queryset, request)
        purchase_order_queryset = apply_date_scope(purchase_order_queryset, request)
        supplier_return_queryset = apply_date_scope(supplier_return_queryset, request)
        requisitions = (
            requisition_queryset.values("status")
            .annotate(count=Count("id"))
            .order_by("status")
        )
        purchase_orders = (
            purchase_order_queryset.values("status")
            .annotate(count=Count("id"), total_amount=Sum("total_amount"))
            .order_by("status")
        )
        supplier_returns = (
            supplier_return_queryset.values("status")
            .annotate(count=Count("id"))
            .order_by("status")
        )
        return Response(
            {
                "requisitions": list(requisitions),
                "purchase_orders": [
                    {
                        "status": row["status"],
                        "count": row["count"],
                        "total_amount": decimal_string(row["total_amount"] or Decimal("0.00")),
                    }
                    for row in purchase_orders
                ],
                "supplier_returns": list(supplier_returns),
            }
        )


class StockCardReportView(ReportAPIView):
    def get(self, request):
        item_id = request.query_params.get("item")
        if not item_id:
            return Response({"detail": "item query parameter is required."}, status=400)

        queryset = StockLedger.objects.select_related("item", "store").filter(item_id=item_id)
        queryset = apply_store_scope(queryset, request)
        running_balance = Decimal("0.00")
        date_from = request.query_params.get("date_from")
        if date_from:
            start_date = parse_date(date_from)
            if start_date is None:
                raise ValidationError({"date_from": "Enter a valid date in YYYY-MM-DD format."})
            opening = queryset.filter(created_at__date__lt=start_date).aggregate(
                quantity_in=Sum("quantity_in"),
                quantity_out=Sum("quantity_out"),
            )
            running_balance = (
                (opening["quantity_in"] or Decimal("0.00"))
                - (opening["quantity_out"] or Decimal("0.00"))
            )
        queryset = apply_date_scope(queryset, request)

        rows = []
        for movement in queryset.order_by("created_at", "id"):
            running_balance += movement.net_quantity
            rows.append(
                {
                    "date": movement.created_at,
                    "item": str(movement.item),
                    "store": str(movement.store) if movement.store else "",
                    "quantity_in": decimal_string(movement.quantity_in),
                    "quantity_out": decimal_string(movement.quantity_out),
                    "reference_type": movement.reference_type,
                    "reference_id": movement.reference_id,
                    "note": movement.note,
                    "running_balance": decimal_string(running_balance),
                }
            )
        return Response({"results": rows})
