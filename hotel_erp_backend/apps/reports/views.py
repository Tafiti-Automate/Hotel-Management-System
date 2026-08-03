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
    StockCountItem,
    StoreRequisition,
    SupplierItemPriceHistory,
)
from apps.procurement.models import GoodsReceiptItem, GoodsReceiptNote, GoodsInspectionItem, PurchaseOrder, PurchaseRequisition, RequisitionHistory, SupplierReturn
from apps.approvals.models import ApprovalWorkflow
from apps.audit_logs.models import AuditLog
from apps.finance.models import SupplierInvoice
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


def control_row(**values):
    defaults = {
        "date": "", "document_type": "", "reference": "", "action": "", "status": "",
        "actor": "", "branch": "", "department": "", "store_workspace": "", "supplier": "",
        "item": "", "quantity": "", "value": "", "detail": "", "drilldown_type": "", "drilldown_id": "",
    }
    defaults.update(values)
    return defaults


def employee_id_for_user(user):
    profile = getattr(user, "employee_profile", None) if user else None
    return str(profile.id) if profile else ""


def filter_control_rows(rows, request):
    mappings = {
        "branch": "_branch_id", "department": "_department_id", "store": "_store_id",
        "employee": "_employee_id", "supplier": "_supplier_id", "item": "_item_id",
        "category": "_category_id", "document_type": "document_type", "action_type": "action", "status": "status",
    }
    for parameter, key in mappings.items():
        value = request.query_params.get(parameter)
        if value:
            rows = [row for row in rows if str(row.get(key, "")).lower() == value.lower()]
    date_from = parse_date(request.query_params.get("date_from", "")) if request.query_params.get("date_from") else None
    date_to = parse_date(request.query_params.get("date_to", "")) if request.query_params.get("date_to") else None
    if date_from:
        rows = [row for row in rows if row.get("_date") and row["_date"] >= date_from]
    if date_to:
        rows = [row for row in rows if row.get("_date") and row["_date"] <= date_to]
    raw_minimum = request.query_params.get("value_min")
    if raw_minimum:
        try:
            minimum = Decimal(raw_minimum)
        except Exception as error:
            raise ValidationError({"value_min": "Enter a valid monetary threshold."}) from error
        rows = [row for row in rows if Decimal(str(row.get("_value", 0) or 0)) >= minimum]
    return [{key: value for key, value in row.items() if not key.startswith("_")} for row in rows]


class ControlReportView(ReportAPIView):
    report_kind = "daily"

    def get(self, request):
        builders = {
            "daily": self.audit_rows,
            "pending": self.pending_rows,
            "exceptions": self.exception_rows,
            "user_activity": self.audit_rows,
            "stock_movements": self.stock_movement_rows,
            "approval_trail": self.approval_rows,
            "direct_workspace": self.direct_workspace_rows,
            "supplier_price_changes": self.price_change_rows,
            "management_summary": self.management_rows,
        }
        rows = builders[self.report_kind](request)
        if self.report_kind == "daily" and not request.query_params.get("date_from") and not request.query_params.get("date_to"):
            rows = [row for row in rows if row.get("_date") == timezone.localdate()]
        rows = filter_control_rows(rows, request)
        return Response({"report": self.report_kind, "generated_at": timezone.now(), "count": len(rows), "results": rows})

    def audit_rows(self, request):
        rows = []
        for event in AuditLog.objects.select_related("actor").all()[:5000]:
            metadata = event.metadata or {}
            rows.append(control_row(
                date=event.created_at, document_type=event.entity_type, reference=str(event.entity_id or ""),
                action=event.action, status=str(metadata.get("status", "")),
                actor=(event.actor.get_full_name() or event.actor.username) if event.actor else "System",
                detail=str(metadata.get("description") or metadata.get("changes") or "Recorded system activity"),
                drilldown_type=event.entity_type, drilldown_id=str(event.entity_id or ""),
                _date=event.created_at.date(), _employee_id=employee_id_for_user(event.actor),
                _branch_id=str(metadata.get("branch_id", "")), _department_id=str(metadata.get("department_id", "")),
            ))
        return rows

    def pending_rows(self, request):
        rows = []
        for req in PurchaseRequisition.objects.select_related("branch", "department", "requester__user").exclude(status__in=("fulfilled", "closed", "cancelled", "rejected")):
            rows.append(control_row(date=req.updated_at, document_type="purchase_requisition", reference=req.requisition_number, action="Pending workflow", status=req.status, actor=req.requester.user.get_full_name() if req.requester_id else "", branch=str(req.branch or ""), department=str(req.department or ""), value=decimal_string(req.estimated_total), detail=req.reason, drilldown_type="requisitions", drilldown_id=str(req.id), _date=req.updated_at.date(), _value=req.estimated_total, _branch_id=str(req.branch_id or ""), _department_id=str(req.department_id or ""), _employee_id=str(req.requester_id or "")))
        for order in PurchaseOrder.objects.select_related("requisition__branch", "supplier").filter(status__in=("issued", "partially_received")):
            rows.append(control_row(date=order.updated_at, document_type="purchase_order", reference=order.po_number, action="Awaiting receipt", status=order.status, branch=str(order.requisition.branch or ""), supplier=str(order.supplier), value=decimal_string(order.total_amount), detail=f"Expected {order.expected_date or 'not set'}", drilldown_type="orders", drilldown_id=str(order.id), _date=order.updated_at.date(), _value=order.total_amount, _branch_id=str(order.requisition.branch_id or ""), _supplier_id=str(order.supplier_id)))
        for grn in GoodsReceiptNote.objects.select_related("purchase_order__requisition__branch").filter(posted_at__isnull=True):
            rows.append(control_row(date=grn.created_at, document_type="goods_receipt", reference=grn.grn_number, action="Awaiting inspection/posting", status="pending", branch=str(grn.purchase_order.requisition.branch or ""), drilldown_type="grns", drilldown_id=str(grn.id), _date=grn.created_at.date(), _branch_id=str(grn.purchase_order.requisition.branch_id or "")))
        return rows

    def exception_rows(self, request):
        rows = []
        today = timezone.localdate()
        for order in PurchaseOrder.objects.select_related("supplier", "requisition__branch").filter(status__in=("issued", "partially_received"), expected_date__lt=today):
            rows.append(control_row(date=order.expected_date, document_type="purchase_order", reference=order.po_number, action="Overdue delivery", status=order.status, supplier=str(order.supplier), branch=str(order.requisition.branch or ""), value=decimal_string(order.total_amount), detail=f"Expected {order.expected_date}", drilldown_type="orders", drilldown_id=str(order.id), _date=order.expected_date, _value=order.total_amount, _branch_id=str(order.requisition.branch_id or ""), _supplier_id=str(order.supplier_id)))
        for line in GoodsInspectionItem.objects.select_related("inspection__goods_receipt", "goods_receipt_item__item").filter(quantity_rejected__gt=0):
            item = line.goods_receipt_item.item
            rows.append(control_row(date=line.created_at, document_type="inspection", reference=str(line.inspection.goods_receipt), action="Rejected delivery", status="exception", item=str(item), quantity=decimal_string(line.quantity_rejected), detail=line.rejection_reason, drilldown_type="inspections", drilldown_id=str(line.inspection_id), _date=line.created_at.date(), _item_id=str(item.id), _category_id=str(item.category_id)))
        for invoice in SupplierInvoice.objects.select_related("supplier", "purchase_order__requisition__branch").filter(status="exception"):
            rows.append(control_row(date=invoice.updated_at, document_type="supplier_invoice", reference=invoice.invoice_number, action="Invoice mismatch", status=invoice.status, supplier=str(invoice.supplier), value=decimal_string(invoice.total_amount), detail=invoice.match_notes, drilldown_type="supplier-invoices", drilldown_id=str(invoice.id), _date=invoice.updated_at.date(), _value=invoice.total_amount, _supplier_id=str(invoice.supplier_id), _branch_id=str(invoice.purchase_order.requisition.branch_id or "")))
        for line in StockCountItem.objects.select_related("stock_count__store", "item").all():
            if line.variance:
                rows.append(control_row(date=line.updated_at, document_type="stock_count", reference=line.stock_count.count_no, action="Count variance", status=line.stock_count.status, store_workspace=str(line.stock_count.store), item=str(line.item), quantity=decimal_string(line.variance), detail=f"System {line.system_quantity}; physical {line.physical_quantity}", drilldown_type="stock-counts", drilldown_id=str(line.stock_count_id), _date=line.updated_at.date(), _store_id=str(line.stock_count.store_id), _item_id=str(line.item_id), _category_id=str(line.item.category_id)))
        for req in StoreRequisition.objects.select_related("store__branch", "department").filter(status="awaiting_procurement"):
            rows.append(control_row(date=req.updated_at, document_type="store_requisition", reference=req.requisition_no, action="Stock shortage", status=req.status, branch=str(req.store.branch or ""), department=str(req.department), detail=req.purpose, drilldown_type="store-requisitions", drilldown_id=str(req.id), _date=req.updated_at.date(), _branch_id=str(req.store.branch_id or ""), _department_id=str(req.department_id)))
        return rows

    def stock_movement_rows(self, request):
        rows = []
        for move in StockLedger.objects.select_related("item__category", "store__branch", "created_by").all():
            quantity = move.quantity_in if move.quantity_in else -move.quantity_out
            rows.append(control_row(date=move.created_at, document_type=move.reference_type, reference=str(move.reference_id), action="Stock in" if quantity > 0 else "Stock out", status="posted", actor=(move.created_by.get_full_name() or move.created_by.username) if move.created_by else "System", branch=str(move.store.branch or "") if move.store_id else "", store_workspace=str(move.store or ""), item=str(move.item), quantity=decimal_string(quantity), detail=move.note, drilldown_type=move.reference_type, drilldown_id=str(move.reference_id), _date=move.created_at.date(), _branch_id=str(move.store.branch_id or "") if move.store_id else "", _store_id=str(move.store_id or ""), _employee_id=employee_id_for_user(move.created_by), _item_id=str(move.item_id), _category_id=str(move.item.category_id)))
        return rows

    def approval_rows(self, request):
        rows = []
        for step in ApprovalWorkflow.objects.select_related("requisition__branch", "requisition__department", "approver__user", "decided_by").all():
            actor = step.decided_by or step.approver.user
            rows.append(control_row(date=step.decided_at or step.created_at, document_type="purchase_requisition", reference=step.requisition.requisition_number, action=step.stage_name or f"Approval stage {step.stage}", status=step.status, actor=actor.get_full_name() or actor.username, branch=str(step.requisition.branch or ""), department=str(step.requisition.department or ""), detail=step.comments, drilldown_type="requisitions", drilldown_id=str(step.requisition_id), _date=(step.decided_at or step.created_at).date(), _branch_id=str(step.requisition.branch_id or ""), _department_id=str(step.requisition.department_id or ""), _employee_id=employee_id_for_user(actor)))
        return rows

    def direct_workspace_rows(self, request):
        rows = []
        queryset = GoodsReceiptItem.objects.select_related("goods_receipt__purchase_order__supplier", "goods_receipt__purchase_order__requisition__branch", "goods_receipt__posted_by__user", "direct_issue_department", "item__category").filter(direct_issue_department__isnull=False)
        for line in queryset:
            receipt = line.goods_receipt
            actor = receipt.posted_by.user if receipt.posted_by_id else None
            rows.append(control_row(date=receipt.posted_at or receipt.created_at, document_type="direct_workspace_receipt", reference=receipt.grn_number, action="Direct delivery posted" if line.inventory_changes_applied else "Direct delivery pending", status="posted" if line.inventory_changes_applied else "pending", actor=(actor.get_full_name() or actor.username) if actor else "", branch=str(receipt.purchase_order.requisition.branch or ""), department=str(line.direct_issue_department), store_workspace=str(line.direct_issue_department), supplier=str(receipt.purchase_order.supplier), item=str(line.item), quantity=decimal_string(line.base_quantity), value=decimal_string(line.base_quantity * line.base_unit_cost), detail=line.purchase_order_item.destination_justification, drilldown_type="grns", drilldown_id=str(receipt.id), _date=(receipt.posted_at or receipt.created_at).date(), _value=line.base_quantity * line.base_unit_cost, _branch_id=str(receipt.purchase_order.requisition.branch_id or ""), _department_id=str(line.direct_issue_department_id), _supplier_id=str(receipt.purchase_order.supplier_id), _item_id=str(line.item_id), _category_id=str(line.item.category_id), _employee_id=str(receipt.posted_by_id or "")))
        return rows

    def price_change_rows(self, request):
        rows = []
        for change in SupplierItemPriceHistory.objects.select_related("supplier", "item__category", "changed_by", "supplier_item_price").all():
            new_price = change.supplier_item_price.unit_price
            percentage = ((new_price - change.unit_price) / change.unit_price * 100) if change.unit_price else Decimal("0")
            rows.append(control_row(date=change.created_at, document_type="supplier_price", reference=str(change.supplier_item_price_id), action="Supplier price changed", status="active" if change.supplier_item_price.is_active else "inactive", actor=(change.changed_by.get_full_name() or change.changed_by.username) if change.changed_by else "System", supplier=str(change.supplier), item=str(change.item), value=decimal_string(new_price), detail=f"{change.currency} {change.unit_price} → {new_price} ({percentage.quantize(Decimal('0.01'))}%)", drilldown_type="supplierItems", drilldown_id=str(change.supplier_item_price_id), _date=change.created_at.date(), _value=new_price, _supplier_id=str(change.supplier_id), _item_id=str(change.item_id), _category_id=str(change.item.category_id), _employee_id=employee_id_for_user(change.changed_by)))
        return rows

    def management_rows(self, request):
        today = timezone.localdate()
        open_pos = PurchaseOrder.objects.filter(status__in=("issued", "partially_received"))
        exception_invoices = SupplierInvoice.objects.filter(status="exception")
        direct_value = sum((line.base_quantity * line.base_unit_cost for line in GoodsReceiptItem.objects.select_related("purchase_order_item").filter(direct_issue_department__isnull=False, inventory_changes_applied=True)), Decimal("0"))
        metrics = [
            ("Open purchase commitments", open_pos.count(), open_pos.aggregate(total=Sum("total_amount"))["total"] or 0),
            ("Overdue purchase orders", open_pos.filter(expected_date__lt=today).count(), 0),
            ("Invoice exceptions", exception_invoices.count(), sum((invoice.total_amount for invoice in exception_invoices), Decimal("0"))),
            ("Direct workspace consumption", GoodsReceiptItem.objects.filter(direct_issue_department__isnull=False, inventory_changes_applied=True).count(), direct_value),
            ("Low-stock balances", sum(1 for balance in InventoryBalance.objects.all() if balance.is_below_reorder), 0),
        ]
        return [control_row(date=today, document_type="management_metric", reference=name, action="Management summary", status="current", quantity=str(count), value=decimal_string(Decimal(value)), detail=name, _date=today, _value=Decimal(value)) for name, count, value in metrics]
