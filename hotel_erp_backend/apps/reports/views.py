from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Sum, Q
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
    StockIssue,
    StoreReturnItem,
    StoreKeeperAssignment,
    StoreRequisition,
    SupplierItemPrice,
    SupplierItemPriceHistory,
)
from apps.procurement.models import (
    GoodsReceiptItem,
    GoodsReceiptNote,
    GoodsInspectionItem,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseRequisition,
    RequisitionHistory,
    SupplierReturn,
    SupplierReturnItem,
)
from apps.approvals.models import ApprovalWorkflow
from apps.audit_logs.models import AuditLog
from apps.finance.models import Expense, SupplierInvoice
from apps.sales.models import Sale, SaleItem
from core.constants.choices import LedgerReferenceType, POStatus, GoodsReceiptStatus


def classify_menu_recipes(grouped):
    """Deterministic four-quadrant classification; never invent unknown costs.

    Revenue and frozen COGS are aggregated at the recipe level before calculating
    contribution per portion. All arithmetic uses Decimal, not binary floats.
    """
    entries = list(grouped)
    valid = [
        row for row in entries
        if row["unpriced"] == 0 and row["sales"] > 0 and row["quantity"] > 0
    ]
    count = len(valid)
    popularity = (
        sum((row["quantity"] for row in valid), Decimal("0")) / count
        if count else None
    )
    contribution = (
        sum(((row["sales"] - row["cogs"]) / row["quantity"] for row in valid), Decimal("0")) / count
        if count else None
    )
    actions = {
        "Star": "Maintain quality and visibility",
        "Plowhorse": "Improve portion cost or selling price",
        "Puzzle": "Promote a high-contribution dish",
        "Dog": "Review recipe, price or menu placement",
        "Unclassified": "Resolve missing cost or invalid sales data",
    }
    rows = []
    for row in sorted(entries, key=lambda entry: (entry["article"], entry["sku"])):
        priced = row in valid
        profit = row["sales"] - row["cogs"] if priced else None
        per_portion = profit / row["quantity"] if priced else None
        margin = (profit / row["sales"]) * Decimal("100") if priced else None
        if not priced:
            category = "Unclassified"
        elif row["quantity"] >= popularity and per_portion >= contribution:
            category = "Star"
        elif row["quantity"] >= popularity:
            category = "Plowhorse"
        elif per_portion >= contribution:
            category = "Puzzle"
        else:
            category = "Dog"
        rows.append({
            "sku": row["sku"], "article": row["article"],
            "classification": category,
            "quantity": str(row["quantity"].quantize(Decimal("0.0001"))),
            "sales": str(row["sales"].quantize(Decimal("0.01"))),
            "cogs": str(row["cogs"].quantize(Decimal("0.01"))) if priced else None,
            "profit": str(profit.quantize(Decimal("0.01"))) if priced else None,
            "unit_contribution": str(per_portion.quantize(Decimal("0.01"))) if priced else None,
            "margin_percent": str(margin.quantize(Decimal("0.01"))) if priced else None,
            "transactions": row["transactions"],
            "unpriced_transactions": row["unpriced"],
            "recommended_action": actions[category],
        })
    return rows, {
        "eligible_recipes": count, "unclassified_recipes": len(entries) - count,
        "popularity_threshold": (
            str(popularity.quantize(Decimal("0.0001"))) if popularity is not None else "N/A"
        ),
        "unit_contribution_threshold": (
            str(contribution.quantize(Decimal("0.01"))) if contribution is not None else "N/A"
        ),
    }



REPORT_ROLE_ACCESS = {
    "departmentRequests": {"Requester", "Department Head", "Store Keeper", "General Manager"},
    "storeIssues": {"Requester", "Department Head", "Store Keeper", "General Manager"},
    "returnRegisters": {"Store Keeper", "Financial Manager", "General Manager"},
    "purchaseRequisitions": {"Procurement Manager", "Procurement Officer", "General Manager"},
    "purchaseOrders": {"Procurement Manager", "Procurement Officer", "Financial Manager", "Accounts Payable Clerk", "General Manager", "Receiving Clerk"},
    "goodsReceipts": {"Store Keeper", "Procurement Manager", "Procurement Officer", "Financial Manager", "Accounts Payable Clerk", "General Manager", "Receiving Clerk"},
    "valuation": {"Store Keeper", "General Manager"},
    "lowstock": {"Store Keeper", "Cost Controller"},
    "movement": {"Store Keeper"},
    "aging": {"Store Keeper"},
    "consumption": {"Store Keeper", "General Manager"},
    "procurement": {"Cost Controller", "Procurement Manager", "Procurement Officer", "Financial Manager", "General Manager"},
    "pendingActions": {"Procurement Manager", "Procurement Officer", "Financial Manager", "Accounts Payable Clerk", "General Manager", "Receiving Clerk"},
    "exceptions": {"Procurement Manager", "Procurement Officer", "Financial Manager", "Accounts Payable Clerk", "General Manager", "Receiving Clerk"},
    "userActivity": set(),
    "stockMovementControl": {"Store Keeper", "General Manager"},
    "approvalTrail": {"Procurement Manager", "Procurement Officer", "Financial Manager", "General Manager"},
    "directWorkspace": {"Procurement Manager", "Procurement Officer", "General Manager", "Receiving Clerk"},
    "supplierPriceChanges": {"Cost Controller", "Procurement Manager", "Procurement Officer"},
    "managementSummary": {"Financial Manager", "General Manager"},
    "dailyActivities": {"Procurement Manager", "Procurement Officer", "General Manager"},
    # Materials analysis catalogue. These reports deliberately use the existing
    # operational records rather than introducing a second, browser-only set of
    # figures for the Oracle-style report menu.
    "purchasePrices": {"Cost Controller", "Procurement Manager", "Procurement Officer", "Financial Manager", "General Manager"},
    "purchaseStatisticsItem": {"Cost Controller", "Procurement Manager", "Procurement Officer", "Financial Manager", "General Manager"},
    "reorderProposal": {"Cost Controller", "Procurement Manager", "Procurement Officer", "General Manager"},
    "purchaseStatisticsSupplier": {"Cost Controller", "Procurement Manager", "Procurement Officer", "Financial Manager", "General Manager"},
    "purchaseReceivingDeviation": {"Cost Controller", "Procurement Manager", "Procurement Officer", "Financial Manager", "Accounts Payable Clerk", "General Manager"},
    "abcAnalysis": {"Cost Controller", "Procurement Manager", "Procurement Officer", "General Manager"},
    "priceVariance": {"Cost Controller", "Procurement Manager", "Procurement Officer", "General Manager"},
    "receiptsJournal": {"Cost Controller", "Procurement Manager", "Procurement Officer", "Financial Manager", "Accounts Payable Clerk", "General Manager", "Receiving Clerk"},
    "supplierInvoices": {"Financial Manager", "Accounts Payable Clerk", "General Manager"},
    "salesOverview": {"Cost Controller", "Financial Manager", "General Manager"},
    "salesStatistics": {"Cost Controller", "Financial Manager", "General Manager"},
    "salesTaxAnalysis": {"Financial Manager", "General Manager"},
    "salesActivity": {"Cost Controller", "Financial Manager", "General Manager"},
    "articlePotentialUsage": {"Cost Controller", "Financial Manager", "General Manager"},
    "menuEngineering": {"Cost Controller", "Financial Manager", "General Manager"},
    "requirementsUsage": {"Cost Controller", "Procurement Manager", "Procurement Officer", "General Manager"},
    "costOfSalesLocation": {"Cost Controller", "Financial Manager", "General Manager"},
    "warehouseStatistics": {"Cost Controller", "General Manager"},
    "costCenterComparison": {"Cost Controller", "Financial Manager", "General Manager"},
    "dailyFood": {"Cost Controller", "Financial Manager", "General Manager"},
    "groupAnalysis": {"Cost Controller", "Financial Manager", "General Manager"},
    "majorGroupLists": {"Cost Controller", "General Manager"},
    "fbResult": {"Financial Manager", "General Manager"},
    "monthlyReport": {"Cost Controller", "Financial Manager", "General Manager"},
    "lastEstimate": {"Cost Controller", "Procurement Manager", "Procurement Officer", "Financial Manager", "General Manager"},
    "fbBudget": {"Financial Manager", "General Manager"},
}

# Client-approved read-only catalogue for Cost Control and Finance.
# This does not grant approval, payment, or journal mutation permissions.
MATERIALS_SHARED_REPORT_IDS = ("purchasePrices", "purchaseStatisticsItem", "reorderProposal", "purchaseStatisticsSupplier", "purchaseReceivingDeviation", "abcAnalysis", "priceVariance", "receiptsJournal", "purchaseOrders", "supplierInvoices", "goodsReceipts", "stockMovementControl", "movement", "consumption", "salesOverview", "salesStatistics", "salesTaxAnalysis", "salesActivity", "articlePotentialUsage", "menuEngineering", "requirementsUsage", "costOfSalesLocation", "warehouseStatistics", "costCenterComparison", "dailyFood", "groupAnalysis", "majorGroupLists", "fbResult", "monthlyReport", "lastEstimate", "fbBudget", "issueDeviation", "issueDeviationReason", "requestTransfer", "monthlyStoreBalance", "dailyOutOfStock", "stockForecast", "articleDocumentHistory", "bookingJournal", "stockCover", "stockTakeLinewise", "usageStatistics", "consumptionInventory",)
for _report_id in MATERIALS_SHARED_REPORT_IDS:
    REPORT_ROLE_ACCESS.setdefault(_report_id, set()).update({"Cost Controller", "Financial Manager"})

# Client moved analysis/report center ownership away from Store Keeper.
for _report_key, _roles in REPORT_ROLE_ACCESS.items():
    # Return reconciliation is embedded operational evidence, not the
    # analytics workspace; Storekeepers must retain their return workflow.
    if _report_key != "returnRegisters":
        _roles.discard("Store Keeper")
for _report_id in ("departmentRequests","storeIssues","valuation","aging"):
    REPORT_ROLE_ACCESS[_report_id].add("Cost Controller")

CONTROL_REPORT_KEYS = {
    "daily": "dailyActivities",
    "pending": "pendingActions",
    "exceptions": "exceptions",
    "user_activity": "userActivity",
    "stock_movements": "stockMovementControl",
    "approval_trail": "approvalTrail",
    "direct_workspace": "directWorkspace",
    "supplier_price_changes": "supplierPriceChanges",
    "management_summary": "managementSummary",
}


def user_role_names(user):
    if not user or not user.is_authenticated:
        return set()
    return set(user.groups.values_list("name", flat=True))


def is_report_administrator(user):
    return bool(
        user
        and user.is_authenticated
        and (user.is_superuser or user.groups.filter(name="System Administrator").exists())
    )


def report_key_for_view(view):
    key = getattr(view, "report_key", "")
    if key:
        return key
    routed_key = getattr(view, "kwargs", {}).get("report_kind", "")
    if routed_key:
        return routed_key
    return CONTROL_REPORT_KEYS.get(getattr(view, "report_kind", ""), "")


class CanViewOperationalReports(BasePermission):
    """Server-side report entitlement; frontend visibility is never trusted alone."""

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if is_report_administrator(user):
            return True
        report_key = report_key_for_view(view)
        allowed = REPORT_ROLE_ACCESS.get(report_key, set())
        return bool(user_role_names(user).intersection(allowed))


def assigned_store_ids_for_reports(user):
    employee = getattr(user, "employee_profile", None)
    if not employee:
        return []
    return list(
        StoreKeeperAssignment.objects.filter(
            employee=employee,
            is_active=True,
            store__is_active=True,
        ).values_list("store_id", flat=True)
    )


def employee_branch_id(user):
    employee = getattr(user, "employee_profile", None)
    return str(getattr(employee, "branch_id", "") or "")


def apply_branch_scope(queryset, request, *, branch_field="branch"):
    requested = str(request.query_params.get("branch", "") or "")
    if is_report_administrator(request.user):
        return queryset.filter(**{f"{branch_field}_id": requested}) if requested else queryset
    branch_id = employee_branch_id(request.user)
    if not branch_id:
        return queryset.none()
    if requested and requested != branch_id:
        return queryset.none()
    return queryset.filter(**{f"{branch_field}_id": branch_id})


class ReportAPIView(APIView):
    permission_classes = [CanViewOperationalReports]


def apply_store_scope(queryset, request, *, store_field="store"):
    store_id = str(request.query_params.get("store", "") or "")
    branch_id = str(request.query_params.get("branch", "") or "")
    roles = user_role_names(request.user)

    if is_report_administrator(request.user):
        if branch_id:
            queryset = queryset.filter(**{f"{store_field}__branch_id": branch_id})
        if store_id:
            queryset = queryset.filter(**{f"{store_field}_id": store_id})
        return queryset

    if "Store Keeper" in roles:
        allowed_store_ids = {str(value) for value in assigned_store_ids_for_reports(request.user)}
        if not allowed_store_ids:
            return queryset.none()
        if store_id and store_id not in allowed_store_ids:
            return queryset.none()
        queryset = queryset.filter(**{f"{store_field}_id__in": allowed_store_ids})
        return queryset.filter(**{f"{store_field}_id": store_id}) if store_id else queryset

    employee = getattr(request.user, "employee_profile", None)
    employee_branch = str(getattr(employee, "branch_id", "") or "")
    if not employee_branch:
        return queryset.none()
    if branch_id and branch_id != employee_branch:
        return queryset.none()
    queryset = queryset.filter(**{f"{store_field}__branch_id": employee_branch})
    if store_id:
        queryset = queryset.filter(**{f"{store_field}_id": store_id})
    return queryset


def apply_category_scope(queryset, request, *, item_field="item"):
    category_id = request.query_params.get("category")
    if category_id:
        queryset = queryset.filter(**{f"{item_field}__category_id": category_id})
    return queryset


def apply_date_scope(queryset, request, *, field="created_at"):
    accounting = queryset.model is StockLedger and field == "created_at"
    if accounting:
        queryset = queryset.with_accounting_date()
    filters = {}
    for parameter, lookup in (("date_from", "date"), ("date_to", "date")):
        raw_value = request.query_params.get(parameter)
        if not raw_value:
            continue
        value = parse_date(raw_value)
        if value is None:
            raise ValidationError({parameter: "Enter a valid date in YYYY-MM-DD format."})
        suffix = "gte" if parameter == "date_from" else "lte"
        field_type = queryset.model
        path = field.split("__")
        for component in path[:-1]:
            field_type = field_type._meta.get_field(component).related_model
        date_field = field_type._meta.get_field(path[-1])
        from django.db.models import DateField, DateTimeField
        is_date = isinstance(date_field, DateField) and not isinstance(date_field, DateTimeField)
        filters[f"accounting_date__{suffix}" if accounting else f"{field}__{suffix}" if is_date else f"{field}__{lookup}__{suffix}"] = value
    return queryset.filter(**filters)


def weighted_average_cost(item, store):
    # The inventory posting engine maintains WAC even for non-batch stock.
    # Legacy batch-only records are a fallback, not a replacement for WAC.
    cost = InventoryBalance.objects.filter(item=item, store=store).values_list("weighted_average_cost", flat=True).first()
    if cost is not None and cost > 0:
        return cost
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


class ReturnReconciliationRegisterReportView(ReportAPIView):
    """Return-note lines reconciled against the actual physical stock ledger."""
    report_key = "returnRegisters"

    def get(self, request):
        kind = str(request.query_params.get("type", "department")).lower()
        if kind not in ("department", "supplier"):
            raise ValidationError({"type": "Choose department or supplier."})
        supplier = kind == "supplier"
        source_field = "supplier_return" if supplier else "store_return"
        queryset = (SupplierReturnItem if supplier else StoreReturnItem).objects.select_related(
            source_field + "__store", "item", source_field
        )
        queryset = apply_store_scope(queryset, request, store_field=source_field + "__store")
        ledgertype = LedgerReferenceType.RETURN_TO_VENDOR if supplier else LedgerReferenceType.STORE_RETURN
        rows = []
        for line in queryset.order_by("-created_at")[:1000]:
            doc = getattr(line, source_field)
            posted = bool(doc.inventory_changes_applied)
            actual = StockLedger.objects.filter(
                reference_type=ledgertype, reference_id=doc.pk, item_id=line.item_id,
                store_id=doc.store_id,
            ).aggregate(q=Sum("quantity_out" if supplier else "quantity_in"))["q"] or Decimal("0")
            expected = line.base_quantity if posted else Decimal("0")
            rows.append({
                "date": doc.return_date,
                "reference": doc.return_no,
                "return_type": kind,
                "article": line.item.name,
                "sku": line.item.sku,
                "quantity": str(line.base_quantity),
                "ledger_quantity": str(actual),
                "difference": str(expected - actual),
                "reconciled": actual == expected,
                "posted": posted,
                "store": doc.store.name,
                "store_id": str(doc.store_id),
                "reason": line.reason if supplier else (line.condition_note or doc.reason),
                "supplier_credit_note": doc.credit_note_number if supplier else "",
                "status": doc.status if supplier else ("posted" if posted else "draft"),
            })
        return Response({
            "count": len(rows), "results": rows,
            "unreconciled_count": sum(not row["reconciled"] for row in rows),
            "report": "Supplier Return Reconciliation" if supplier else "Department Return Reconciliation",
            "is_truncated": len(rows) == 1000,
        })


def register_article_details(queryset, rows, family, request):
    """Expand only already-authorized document records; keep legacy register API."""
    by_id = {row["drilldown_id"]: row for row in rows}
    columns = [{"key": key, "label": label, "kind": kind} for key, label, kind in (
        ("reference", "Reference", "text"), ("date", "Date", "text"),
        ("department", "Department", "text"), ("store", "Store", "text"),
        ("supplier", "Supplier", "text"), ("article", "Article", "text"),
        ("sku", "SKU", "text"), ("unit", "UOM", "text"), ("status", "Status", "text"),
    )]
    measures = {
        "departmentRequests": [("requested", "Requested base qty", "number"), ("approved", "Approved base qty", "number"), ("issued", "Issued base qty", "number")],
        "storeIssues": [("issued", "Issue base qty", "number")],
        "purchaseRequisitions": [("requested", "Requested qty", "number"), ("approved", "Approved qty", "number")],
        "purchaseOrders": [("ordered", "Approved order qty", "number")],
        "goodsReceipts": [("delivered", "Delivered base qty", "number"), ("accepted", "Accepted base qty", "number"), ("rejected", "Rejected base qty", "number")],
    }[family]
    roles = user_role_names(request.user)
    valued = is_report_administrator(request.user) or bool(set(roles).intersection({
        "Store Keeper", "Cost Controller", "F&B Cost Controller", "Financial Manager", "Financial Controller",
        "General Manager", "Procurement Manager", "Accounts Payable Clerk",
    }))
    if valued and family in ("purchaseOrders", "purchaseRequisitions", "storeIssues"):
        measures = measures + [("line_value", "Recorded line value", "money")]
    columns += [{"key": key, "label": label, "kind": kind} for key, label, kind in measures]
    details = []
    for document in queryset.prefetch_related("items__item__base_unit", "items__unit") if family != "goodsReceipts" else queryset.prefetch_related("items__item__base_unit", "items__purchase_order_item__unit", "items__inspection_items"):
        header = by_id.get(str(document.pk))
        if header is None:
            continue
        for line in document.items.all():
            item = line.item
            base = item.base_unit.abbreviation if item.base_unit_id else item.unit
            unit = base
            if family in ("purchaseRequisitions", "purchaseOrders"):
                unit = line.unit.abbreviation if line.unit_id else base
            row = {key: header.get(key, "") for key in ("reference", "date", "department", "store", "supplier", "status", "drilldown_type", "drilldown_id")}
            row.update(article=item.name, sku=item.sku, unit=unit)
            if family == "departmentRequests":
                row.update(requested=str(line.base_quantity_requested), approved=str(line.quantity_approved), issued=str(line.quantity_issued))
            elif family == "storeIssues":
                row["issued"] = str(line.base_quantity) if document.inventory_changes_applied else "0.0000"
                if valued:
                    cost = line.dispatched_unit_cost
                    row["line_value"] = str(line.base_quantity * cost) if document.inventory_changes_applied and cost > 0 else None
            elif family == "purchaseRequisitions":
                row.update(requested=str(line.quantity), approved=str(line.approved_quantity))
                if valued:
                    row["line_value"] = str(line.estimated_total)
            elif family == "purchaseOrders":
                row.update(ordered=str(line.approved_quantity))
                if valued:
                    row["line_value"] = str(line.gross_line_total)
            else:
                row["department"] = document.purchase_order.requisition.department.name if document.purchase_order.requisition.department_id else ""
                row["store"] = line.store.name if line.store_id else ""
                decision = next(iter(line.inspection_items.all()), None)
                complete = decision is not None and decision.quantity_received == line.base_quantity and decision.quantity_accepted + decision.quantity_rejected == line.base_quantity
                row.update(delivered=str(line.base_quantity),
                           accepted=str(decision.quantity_accepted) if complete else None,
                           rejected=str(decision.quantity_rejected) if complete else None)
            details.append(row)
    return {"detail_columns": columns, "detail_results": details}


class DepartmentRequestRegisterReportView(ReportAPIView):
    report_key = "departmentRequests"

    def get(self, request):
        queryset = StoreRequisition.objects.select_related(
            "department", "store__branch", "requested_by__user", "requested_by__branch"
        ).annotate(item_count=Count("items"))
        roles = user_role_names(request.user)
        employee = getattr(request.user, "employee_profile", None)

        if not is_report_administrator(request.user):
            if not employee:
                queryset = queryset.none()
            elif "Requester" in roles:
                queryset = queryset.filter(requested_by=employee)
            elif "Department Head" in roles:
                queryset = queryset.filter(
                    department=employee.department,
                    requested_by__branch=employee.branch,
                ).exclude(status="draft")
            elif "Store Keeper" in roles:
                store_ids = assigned_store_ids_for_reports(request.user)
                queryset = queryset.filter(store_id__in=store_ids, department_approved_by__isnull=False)
            else:
                queryset = apply_branch_scope(queryset, request, branch_field="requested_by__branch")
        else:
            branch = str(request.query_params.get("branch", "") or "")
            if branch:
                queryset = queryset.filter(requested_by__branch_id=branch)

        queryset = apply_date_scope(queryset, request)
        status = str(request.query_params.get("status", "") or "")
        store_id = str(request.query_params.get("store", "") or "")
        department_id = str(request.query_params.get("department", "") or "")
        if status:
            queryset = queryset.filter(status=status)
        if store_id:
            queryset = queryset.filter(store_id=store_id)
        if department_id:
            queryset = queryset.filter(department_id=department_id)
        rows = [{
            "date": req.created_at,
            "reference": req.requisition_no,
            "department": str(req.department),
            "requester": str(req.requested_by),
            "store": str(req.store) if req.store_id else "",
            "item_count": req.item_count,
            "status": req.status,
            "detail": req.purpose,
            "drilldown_type": "store-requisitions",
            "drilldown_id": str(req.id),
        } for req in queryset.order_by("-created_at")]
        return Response({"results": rows, **register_article_details(queryset, rows, "departmentRequests", request)})


class StoreIssueRegisterReportView(ReportAPIView):
    report_key = "storeIssues"

    def get(self, request):
        queryset = StockIssue.objects.select_related(
            "requisition__department", "requisition__requested_by", "store__branch", "issued_by"
        ).annotate(item_count=Count("items"))
        roles = user_role_names(request.user)
        employee = getattr(request.user, "employee_profile", None)
        if not is_report_administrator(request.user):
            if not employee:
                queryset = queryset.none()
            elif "Requester" in roles:
                queryset = queryset.filter(requisition__requested_by=employee)
            elif "Department Head" in roles:
                queryset = queryset.filter(
                    requisition__department=employee.department,
                    requisition__requested_by__branch=employee.branch,
                )
            elif "Store Keeper" in roles:
                queryset = queryset.filter(store_id__in=assigned_store_ids_for_reports(request.user))
            else:
                queryset = apply_branch_scope(queryset, request, branch_field="store__branch")
        else:
            branch = str(request.query_params.get("branch", "") or "")
            if branch:
                queryset = queryset.filter(store__branch_id=branch)
        queryset = apply_date_scope(queryset, request)
        store_id = str(request.query_params.get("store", "") or "")
        department_id = str(request.query_params.get("department", "") or "")
        if store_id:
            queryset = queryset.filter(store_id=store_id)
        if department_id:
            queryset = queryset.filter(requisition__department_id=department_id)
        rows = [{
            "date": issue.issue_date,
            "reference": issue.issue_no,
            "request_reference": issue.requisition.requisition_no,
            "department": str(issue.requisition.department),
            "store": str(issue.store),
            "actor": str(issue.issued_by),
            "item_count": issue.item_count,
            "status": "posted" if issue.inventory_changes_applied else "pending",
            "drilldown_type": "stock_issue",
            "drilldown_id": str(issue.id),
        } for issue in queryset.order_by("-issue_date", "-created_at")]
        return Response({"results": rows, **register_article_details(queryset, rows, "storeIssues", request)})


class PurchaseRequisitionRegisterReportView(ReportAPIView):
    report_key = "purchaseRequisitions"

    def get(self, request):
        queryset = PurchaseRequisition.objects.select_related(
            "branch", "department", "requester__user"
        ).annotate(item_count=Count("items"))
        queryset = apply_branch_scope(queryset, request, branch_field="branch")
        queryset = apply_date_scope(queryset, request)
        status = str(request.query_params.get("status", "") or "")
        department_id = str(request.query_params.get("department", "") or "")
        if status:
            queryset = queryset.filter(status=status)
        if department_id:
            queryset = queryset.filter(department_id=department_id)
        rows = [{
            "date": req.created_at,
            "reference": req.requisition_number,
            "department": str(req.department) if req.department_id else "",
            "requester": str(req.requester) if req.requester_id else "",
            "item_count": req.item_count,
            "value": decimal_string(req.estimated_total),
            "status": req.status,
            "detail": req.reason,
            "drilldown_type": "requisitions",
            "drilldown_id": str(req.id),
        } for req in queryset.order_by("-created_at")]
        return Response({"results": rows, **register_article_details(queryset, rows, "purchaseRequisitions", request)})


class PurchaseOrderRegisterReportView(ReportAPIView):
    report_key = "purchaseOrders"

    def get(self, request):
        queryset = PurchaseOrder.objects.select_related(
            "supplier", "requisition__branch", "requisition__department", "store"
        ).prefetch_related("print_records")
        queryset = apply_branch_scope(queryset, request, branch_field="requisition__branch")
        queryset = apply_date_scope(queryset, request)
        status = str(request.query_params.get("status", "") or "")
        store_id = str(request.query_params.get("store", "") or "")
        department_id = str(request.query_params.get("department", "") or "")
        supplier_id = str(request.query_params.get("supplier", "") or "")
        if status:
            queryset = queryset.filter(status=status)
        if store_id:
            queryset = queryset.filter(store_id=store_id)
        if department_id:
            queryset = queryset.filter(requisition__department_id=department_id)
        if supplier_id:
            queryset = queryset.filter(supplier_id=supplier_id)
        total_value = Decimal("0.00")
        rows = []
        for order in queryset.order_by("-created_at"):
            total_value += order.total_amount
            print_count = len(order.print_records.all())
            rows.append({
                "date": order.created_at,
                "reference": order.lpo_number or order.po_number,
                "supplier": str(order.supplier),
                "department": str(order.requisition.department) if order.requisition.department_id else "",
                "store": str(order.store) if order.store_id else "",
                "expected_date": order.expected_date,
                "value": decimal_string(order.total_amount),
                "status": order.status,
                "copy_classification": "ORIGINAL COPY" if print_count == 0 else "COPY OF ORIGINAL",
                "print_count": print_count,
                "drilldown_type": "orders",
                "drilldown_id": str(order.id),
            })
        return Response({"total_value": decimal_string(total_value), "results": rows, **register_article_details(queryset, rows, "purchaseOrders", request)})


class GoodsReceiptRegisterReportView(ReportAPIView):
    report_key = "goodsReceipts"

    def get(self, request):
        queryset = GoodsReceiptNote.objects.select_related(
            "purchase_order__supplier", "purchase_order__requisition__branch", "received_by", "posted_by"
        ).annotate(item_count=Count("items"))
        roles = user_role_names(request.user)
        if not is_report_administrator(request.user) and "Store Keeper" in roles:
            branch_id = employee_branch_id(request.user)
            requested_branch = str(request.query_params.get("branch", "") or "")
            if not branch_id or (requested_branch and requested_branch != branch_id):
                queryset = queryset.none()
            else:
                queryset = queryset.filter(
                    purchase_order__store_id__in=assigned_store_ids_for_reports(request.user),
                    purchase_order__requisition__branch_id=branch_id,
                )
        else:
            queryset = apply_branch_scope(queryset, request, branch_field="purchase_order__requisition__branch")
        queryset = apply_date_scope(queryset, request)
        status = str(request.query_params.get("status", "") or "")
        store_id = str(request.query_params.get("store", "") or "")
        department_id = str(request.query_params.get("department", "") or "")
        supplier_id = str(request.query_params.get("supplier", "") or "")
        if status:
            queryset = queryset.filter(status=status)
        if store_id:
            queryset = queryset.filter(purchase_order__store_id=store_id)
        if department_id:
            queryset = queryset.filter(purchase_order__requisition__department_id=department_id)
        if supplier_id:
            queryset = queryset.filter(purchase_order__supplier_id=supplier_id)
        rows = [{
            "date": grn.received_date,
            "reference": grn.grn_number,
            "lpo_reference": grn.purchase_order.lpo_number or grn.purchase_order.po_number,
            "supplier": str(grn.purchase_order.supplier),
            "actor": str(grn.received_by),
            "item_count": grn.item_count,
            "status": grn.status,
            "posted_at": grn.posted_at,
            "posted_by": str(grn.posted_by) if grn.posted_by_id else "",
            "delivery_note_no": grn.delivery_note_no,
            "supplier_invoice_no": grn.supplier_invoice_no,
            "drilldown_type": "grns",
            "drilldown_id": str(grn.id),
        } for grn in queryset.order_by("-received_date", "-created_at")]
        return Response({"results": rows, **register_article_details(queryset, rows, "goodsReceipts", request)})


class StockSummaryReportView(ReportAPIView):
    report_key = "valuation"
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
    report_key = "lowstock"
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
    report_key = "aging"

    def get(self, request):
        today = timezone.localdate()
        raw_days = request.query_params.get("days")
        end_date = None
        if raw_days is not None:
            try:
                days = int(raw_days)
                if not 0 <= days <= 36500:
                    raise ValueError
                end_date = today + timedelta(days=days)
            except (TypeError, ValueError, OverflowError):
                raise ValidationError({"days": "Enter a whole number between 0 and 36500."})
        requested_end = request.query_params.get("date_to")
        if requested_end:
            end_date = parse_date(requested_end)
            if end_date is None:
                raise ValidationError({"date_to": "Enter a valid date in YYYY-MM-DD format."})
        queryset = InventoryBatch.objects.select_related("item__base_unit", "store").filter(remaining_quantity__gt=0)
        if end_date:
            queryset = queryset.filter(expiry_date__lte=end_date)
        if request.query_params.get("date_from"):
            start_date = parse_date(request.query_params["date_from"])
            if start_date is None:
                raise ValidationError({"date_from": "Enter a valid date in YYYY-MM-DD format."})
            queryset = queryset.filter(expiry_date__gte=start_date)
        queryset = apply_category_scope(apply_store_scope(queryset, request), request)
        if request.query_params.get("item"):
            queryset = queryset.filter(item_id=request.query_params["item"])
        status_filter = request.query_params.get("status")
        statuses = ("Expired", "Expires today", "Critical", "Expiring soon", "Valid", "Missing expiry", "Not applicable")
        if status_filter and status_filter not in statuses:
            raise ValidationError({"status": "Select a valid expiry status."})
        rows = []
        for batch in queryset.order_by("expiry_date", "item__name", "pk"):
            days = (batch.expiry_date - today).days if batch.expiry_date else None
            if days is None:
                status = "Missing expiry" if batch.item.expiry_tracking else "Not applicable"
            elif days < 0:
                status = "Expired"
            elif days == 0:
                status = "Expires today"
            elif days <= 7:
                status = "Critical"
            elif days <= 30:
                status = "Expiring soon"
            else:
                status = "Valid"
            if status_filter and status_filter != status:
                continue
            rows.append({"item":batch.item.name,"article":batch.item.name,"sku":batch.item.sku,
                         "batch":batch.batch_number,"store":str(batch.store),
                         "unit":batch.item.base_unit.abbreviation if batch.item.base_unit_id else batch.item.unit,
                         "remaining_quantity":str(batch.remaining_quantity),"unit_cost":decimal_string(batch.unit_cost),
                         "expiry_date":batch.expiry_date,"days_remaining":days,"status":status})
        priority = {status: index for index,status in enumerate(("Expired","Expires today","Missing expiry","Critical","Expiring soon","Valid","Not applicable"))}
        rows.sort(key=lambda row:(priority[row["status"]], row["days_remaining"] if row["days_remaining"] is not None else 0, row["article"]))
        return Response({"as_of":today,"until":end_date,"results":rows})



class ConsumptionReportView(ReportAPIView):
    report_key = "consumption"
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
    report_key = "procurement"
    def get(self, request):
        requisition_queryset = apply_branch_scope(
            PurchaseRequisition.objects.all(), request, branch_field="branch"
        )
        purchase_order_queryset = apply_branch_scope(
            PurchaseOrder.objects.all(), request, branch_field="requisition__branch"
        )
        supplier_return_queryset = apply_branch_scope(
            SupplierReturn.objects.all(), request, branch_field="store__branch"
        )
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
    report_key = "movement"
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
            opening = queryset.with_accounting_date().filter(accounting_date__lt=start_date).aggregate(
                quantity_in=Sum("quantity_in"),
                quantity_out=Sum("quantity_out"),
            )
            running_balance = (
                (opening["quantity_in"] or Decimal("0.00"))
                - (opening["quantity_out"] or Decimal("0.00"))
            )
        queryset = apply_date_scope(queryset, request)

        rows = []
        for movement in queryset.order_by("accounting_date", "created_at", "id"):
            running_balance += movement.net_quantity
            rows.append(
                {
                    "date": movement.accounting_date,
                    "posted_at": movement.created_at,
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


def analysis_response(title, subtitle, columns, rows, *, notice=""):
    """Return a uniform, exportable read-model for the Materials report catalogue."""
    return Response(
        {
            "title": title,
            "subtitle": subtitle,
            "columns": columns,
            "results": rows,
            "count": len(rows),
            "notice": notice,
        }
    )


def analysis_purchase_lines(request):
    queryset = PurchaseOrderItem.objects.select_related(
        "purchase_order__supplier",
        "purchase_order__store",
        "purchase_order__requisition__branch",
        "item__category", "item__base_unit", "destination_store", "destination_department",
        "unit",
    ).filter(purchase_order__status__in=(POStatus.APPROVED, POStatus.ISSUED, POStatus.PARTIALLY_RECEIVED, POStatus.RECEIVED))
    queryset = apply_branch_scope(queryset, request, branch_field="purchase_order__requisition__branch")
    queryset = apply_date_scope(queryset, request, field="purchase_order__created_at")
    if request.query_params.get("store"):
        queryset = queryset.filter(Q(destination_store_id=request.query_params["store"]) | Q(destination_store__isnull=True, destination_department__isnull=True, purchase_order__store_id=request.query_params["store"]))
    if request.query_params.get("supplier"):
        queryset = queryset.filter(purchase_order__supplier_id=request.query_params["supplier"])
    if request.query_params.get("category"):
        queryset = queryset.filter(item__category_id=request.query_params["category"])
    if request.query_params.get("item"):
        queryset = queryset.filter(item_id=request.query_params["item"])
    return queryset


def analysis_sales(request):
    queryset = Sale.objects.select_related("store__branch", "customer", "payment_method")
    branch_id = str(request.query_params.get("branch", "") or "")
    store_id = str(request.query_params.get("store", "") or "")
    if is_report_administrator(request.user):
        if branch_id:
            queryset = queryset.filter(store__branch_id=branch_id)
    else:
        employee_branch = employee_branch_id(request.user)
        if not employee_branch or (branch_id and branch_id != employee_branch):
            return queryset.none()
        queryset = queryset.filter(store__branch_id=employee_branch)
    if store_id:
        queryset = queryset.filter(store_id=store_id)
    return apply_date_scope(queryset, request, field="sale_date")


class MaterialsAnalysisReportView(ReportAPIView):
    """Read-only report catalogue corresponding to the supplied Materials menus.

    There is intentionally no report persistence or browser-only aggregation:
    every row comes from posted operational records and is constrained by the
    same branch/store scope used by the existing report endpoints.
    """

    def get(self, request, report_kind):
        builders = {
            "purchasePrices": self.purchase_prices,
            "purchaseStatisticsItem": self.purchase_statistics_item,
            "reorderProposal": self.reorder_proposal,
            "purchaseStatisticsSupplier": self.purchase_statistics_supplier,
            "purchaseReceivingDeviation": self.purchase_receiving_deviation,
            "abcAnalysis": self.abc_analysis,
            "priceVariance": self.price_variance,
            "receiptsJournal": self.receipts_journal,
            "supplierInvoices": self.supplier_invoices,
            "salesOverview": self.sales_overview,
            "salesStatistics": self.sales_statistics,
            "salesTaxAnalysis": self.sales_tax_analysis,
            "salesActivity": self.sales_activity,
            "articlePotentialUsage": self.article_potential_usage,
            "menuEngineering": self.sales_statistics,
            "requirementsUsage": self.requirements_usage,
            "costOfSalesLocation": self.pos_cost_of_sales,
            "warehouseStatistics": self.warehouse_statistics,
            "costCenterComparison": self.sales_by_store,
            "dailyFood": self.sales_by_category,
            "groupAnalysis": self.sales_by_category,
            "majorGroupLists": self.major_group_lists,
            "fbResult": self.fb_result,
            "monthlyReport": self.monthly_report,
            "lastEstimate": self.last_estimate,
            "fbBudget": self.fb_budget,
            "issueDeviation": self.issue_deviation,
            "issueDeviationReason": self.issue_deviation,
            "requestTransfer": self.request_transfer,
            "monthlyStoreBalance": self.month_end_stock,
            "dailyOutOfStock": self.out_of_stock,
            "stockForecast": self.stock_projection,
            "articleDocumentHistory": self.ledger_register,
            "bookingJournal": self.ledger_register,
            "stockCover": self.stock_projection,
            "stockTakeLinewise": self.month_end_stock,
            "usageStatistics": self.ledger_register,
            "consumptionInventory": self.consumption_inventory,
        }
        builder = builders.get(report_kind)
        if not builder:
            raise ValidationError({"report_kind": "Unknown Materials analysis report."})
        return builder(request, report_kind)


    @staticmethod
    def _columns(spec):
        return [{"key": key, "label": label, "kind": kind} for key, label, kind in spec]

    def _request_lines(self, request):
        from apps.inventory.models import StoreRequisitionItem
        lines = apply_store_scope(StoreRequisitionItem.objects.select_related(
            "requisition__store", "requisition__department", "item__base_unit",
        ), request, store_field="requisition__store")
        lines = apply_date_scope(lines, request, field="requisition__created_at")
        lines = apply_category_scope(lines, request)
        if request.query_params.get("item"):
            lines = lines.filter(item_id=request.query_params["item"])
        if request.query_params.get("department"):
            lines = lines.filter(requisition__department_id=request.query_params["department"])
        return lines

    @staticmethod
    def _base_unit(item):
        return item.base_unit.abbreviation if item.base_unit_id else item.unit

    def issue_deviation(self, request, report_kind):
        rows = []
        for line in self._request_lines(request).exclude(requisition__status="draft"):
            req = line.requisition
            rows.append({"reference": req.requisition_no, "date": req.created_at, "store": str(req.store or ""),
                         "department": str(req.department), "article": line.item.name, "sku": line.item.sku,
                         "unit": self._base_unit(line.item), "requested": str(line.base_quantity_requested),
                         "approved": str(line.quantity_approved), "issued": str(line.quantity_issued),
                         "deviation": str(line.quantity_approved - line.quantity_issued),
                         "reason": line.rejection_stage or ("Storekeeper comment" if line.storekeeper_comment else "Not recorded"),
                         "remarks": line.rejection_reason or line.storekeeper_comment or line.remarks,
                         "status": req.status})
        title = "Issue/Transfer Deviation per Reason Code" if report_kind == "issueDeviationReason" else "Issue/Transfer Deviation Statistics"
        return analysis_response(title, "Department request line deviations (approved less issued). Reason codes use recorded workflow stages, not inferred causes; inter-store transfer variance evidence is not yet recorded separately.", self._columns([
            ("reference","Request","text"),("date","Date","text"),("store","Store","text"),("department","Department","text"),
            ("article","Article","text"),("sku","SKU","text"),("unit","UOM","text"),
            ("requested","Requested","number"),("approved","Approved","number"),("issued","Issued","number"),
            ("deviation","Approved less issued","number"),("reason","Reason","text"),("remarks","Remarks","text"),("status","Status","text"),
        ]), rows)

    def request_transfer(self, request, report_kind):
        from apps.inventory.models import StockTransferItem
        rows = []
        department = request.query_params.get("department")
        for line in self._request_lines(request):
            req = line.requisition
            rows.append({"reference":req.requisition_no,"date":req.created_at,"source":"Department request",
                         "store":str(req.store or ""),"destination":str(req.department),"article":line.item.name,
                         "sku":line.item.sku,"unit":self._base_unit(line.item),"requested":str(line.base_quantity_requested),
                         "issued":str(line.quantity_issued),"status":req.status})
        if not department:
            lines = apply_store_scope(StockTransferItem.objects.select_related(
                "stock_transfer__from_store","stock_transfer__to_store","item__base_unit",
            ), request, store_field="stock_transfer__from_store")
            lines = apply_date_scope(lines, request, field="stock_transfer__created_at")
            lines = apply_category_scope(lines, request)
            if request.query_params.get("item"):
                lines = lines.filter(item_id=request.query_params["item"])
            for line in lines:
                tr = line.stock_transfer
                rows.append({"reference":str(tr.pk),"date":tr.created_at,"source":"Inter-store transfer",
                             "store":str(tr.from_store),"destination":str(tr.to_store),"article":line.item.name,
                             "sku":line.item.sku,"unit":self._base_unit(line.item),"requested":str(line.base_quantity),
                             "issued":str(line.base_quantity) if tr.dispatched_at or tr.inventory_changes_applied else "0.0000",
                             "status":tr.status})
        return analysis_response("Request and Transfer Report","Requested and dispatched quantities; dispatch is not proof of departmental pickup.",self._columns([
            ("reference","Reference","text"),("date","Date","text"),("source","Source","text"),("store","Store","text"),
            ("destination","Destination","text"),("article","Article","text"),("sku","SKU","text"),("unit","UOM","text"),
            ("requested","Requested","number"),("issued","Dispatched / issued","number"),("status","Status","text"),
        ]),rows)

    def _stock_positions(self, request):
        rows = apply_store_scope(InventoryBalance.objects.select_related("store","item__base_unit"), request)
        rows = apply_category_scope(rows, request).filter(store__is_active=True,store__is_virtual_transit=False)
        if request.query_params.get("item"):
            rows = rows.filter(item_id=request.query_params["item"])
        return rows

    def out_of_stock(self, request, report_kind):
        rows = [{"date":timezone.localdate(),"store":str(b.store),"article":b.item.name,"sku":b.item.sku,
                 "unit":self._base_unit(b.item),"available":str(b.available_quantity)}
                for b in self._stock_positions(request) if b.available_quantity <= 0]
        return analysis_response("Daily Out of Stock Report","Current available quantity at or below zero, not a historical daily snapshot.",
            self._columns([("date","As of","text"),("store","Store","text"),("article","Article","text"),("sku","SKU","text"),
                           ("unit","UOM","text"),("available","Available","number")]),rows)

    @staticmethod
    def _usage_sources():
        return (LedgerReferenceType.STOCK_ISSUE, LedgerReferenceType.TRANSIT_PICKUP, LedgerReferenceType.POS_DEPLETION,
                LedgerReferenceType.SALE, LedgerReferenceType.WASTE)

    def stock_projection(self, request, report_kind):
        today = timezone.localdate()
        start = today - timedelta(days=30)
        # Use dispatch rather than pickup for the physical issuing store; never
        # count both sides of the virtual transit movement.
        sources = (LedgerReferenceType.STOCK_ISSUE, LedgerReferenceType.TRANSIT_DISPATCH,
                   LedgerReferenceType.POS_DEPLETION, LedgerReferenceType.SALE, LedgerReferenceType.WASTE)
        movements = apply_store_scope(StockLedger.objects.with_accounting_date().filter(
            accounting_date__gte=start,accounting_date__lt=today,quantity_out__gt=0,
            reference_type__in=sources,store__is_virtual_transit=False),request)
        used = {(row["store_id"],row["item_id"]):row["qty"] for row in movements.values("store_id","item_id").annotate(qty=Sum("quantity_out"))}
        rows = []
        for b in self._stock_positions(request):
            quantity = used.get((b.store_id,b.item_id),Decimal("0"))
            daily = quantity / Decimal("30")
            rows.append({"store":str(b.store),"article":b.item.name,"sku":b.item.sku,"unit":self._base_unit(b.item),
                         "available":str(b.available_quantity),"usage":str(quantity),"daily":str(daily.quantize(Decimal("0.0001"))),
                         "cover":str((max(b.available_quantity,Decimal("0"))/daily).quantize(Decimal("0.01"))) if daily else None,
                         "forecast":str((b.available_quantity-quantity).quantize(Decimal("0.0001"))) if daily else None})
        return analysis_response("Stock Cover Report" if report_kind=="stockCover" else "Stock on Hand Forecast",
            "Indicative 30-day historical run rate; no future purchase orders, seasonality or demand reservations are added. No usage evidence means no forecast.",
            self._columns([("store","Store","text"),("article","Article","text"),("sku","SKU","text"),("unit","UOM","text"),
                ("available","Available","number"),("usage","Past 30-day usage","number"),("daily","Daily rate","number"),
                ("cover","Days of cover","number"),("forecast","Projected 30-day available","number")]),rows)

    def ledger_register(self, request, report_kind):
        queryset = apply_store_scope(StockLedger.objects.select_related("store","item__base_unit"),request)
        queryset = apply_category_scope(queryset,request)
        queryset = apply_date_scope(queryset,request)
        if request.query_params.get("item"):
            queryset = queryset.filter(item_id=request.query_params["item"])
        if report_kind=="usageStatistics":
            queryset = queryset.filter(quantity_out__gt=0,reference_type__in=self._usage_sources())
        rows = [{"date":m.accounting_date,"posted_at":m.created_at,"source":m.reference_type,"reference":str(m.reference_id),
                 "store":str(m.store or ""),"article":m.item.name,"sku":m.item.sku,"unit":self._base_unit(m.item),
                 "quantity_in":str(m.quantity_in),"quantity_out":str(m.quantity_out),
                 "value":str(m.total_cost_snapshot) if m.total_cost_snapshot is not None else None,"remarks":m.note}
                for m in queryset.order_by("accounting_date","created_at","pk")]
        titles = {"articleDocumentHistory":"Article History by Document Date","bookingJournal":"Booking Journal","usageStatistics":"Usage Statistics"}
        return analysis_response(titles[report_kind],
            "Posted stock ledger, sorted by accounting date. The accounting date is not a verified source-document issue date. Missing historical cost remains blank; no external GL journal is posted.",
            self._columns([("date","Accounting date","text"),("posted_at","Posted at","text"),("source","Source","text"),
                ("reference","Reference","text"),("store","Store","text"),("article","Article","text"),("sku","SKU","text"),("unit","UOM","text"),
                ("quantity_in","In","number"),("quantity_out","Out","number"),("value","Movement value","money"),("remarks","Remarks","text")]),rows)

    def _booked_inventory(self, request):
        from apps.inventory.models import MonthEndInventory
        rows = apply_branch_scope(MonthEndInventory.objects.filter(cycle__status="booked").select_related("cycle","store","department"),
                                  request,branch_field="cycle__branch")
        rows = apply_date_scope(rows,request,field="cycle__cutoff")
        if request.query_params.get("store"):
            rows=rows.filter(store_id=request.query_params["store"])
        if request.query_params.get("department"):
            rows=rows.filter(department_id=request.query_params["department"])
        return rows

    def month_end_stock(self, request, report_kind):
        from apps.inventory.models import MonthEndInventory
        rows=[]
        for inv in self._booked_inventory(request).filter(store__isnull=False):
            previous=MonthEndInventory.objects.filter(cycle__branch=inv.cycle.branch,
                cycle__cutoff=inv.cycle.cutoff.replace(day=1)-timedelta(days=1),cycle__status="booked",store=inv.store).first()
            opening={line["sku"]:line for line in previous.count_snapshot} if previous else {}
            for line in inv.count_snapshot:
                actual=Decimal(line["physical_quantity"]); system=Decimal(line["system_quantity"]); cost=Decimal(line["unit_cost"])
                prior=opening.get(line["sku"])
                rows.append({"date":inv.cycle.cutoff,"store":inv.location_name,"article":line["article"],"sku":line["sku"],"unit":line["unit"],
                    "opening_value":str(Decimal(prior["physical_quantity"])*Decimal(prior["unit_cost"])) if prior else None,
                    "system_quantity":str(system),"physical_quantity":str(actual),"variance":str(actual-system),
                    "variance_value":str((actual-system)*cost),"closing_value":str(actual*cost),"remarks":line["note"]})
        return analysis_response("Stock Take Linewise" if report_kind=="stockTakeLinewise" else "Monthly Store Balance Sheet",
            "Booked cutoff snapshots only. Prior opening values are available only where matching booked evidence exists. Movement reconciliation is available in the month-end workspace.",
            self._columns([("date","Cutoff","text"),("store","Store","text"),("article","Article","text"),("sku","SKU","text"),("unit","UOM","text"),
                ("opening_value","Opening value","money"),("system_quantity","System qty","number"),("physical_quantity","Physical qty","number"),
                ("variance","Variance","number"),("variance_value","Variance value","money"),("closing_value","Closing value","money"),("remarks","Remarks","text")]),rows)

    def consumption_inventory(self, request, report_kind):
        rows=[]
        for inv in self._booked_inventory(request).filter(department__isnull=False):
            snapshot=inv.department_cost_snapshot
            for line in snapshot.get("lines",[]):
                rows.append({"date":line["date"],"month":inv.cycle.cutoff.strftime("%Y-%m"),"department":inv.location_name,
                             "classification":snapshot.get("classification",""),"source":line["source"],"reference":line["reference"],
                             "article":line["article"],"sku":line["sku"],"unit":line["unit"],"quantity":line["quantity"],"value":line["value"]})
        return analysis_response("Consumption on Inventory","Booked zero-closing department consumption, including recorded issues, direct receipts and return reversals. Physical store variances are reported separately in Stock Take Linewise. Not an additional expense posting.",
            self._columns([("date","Date","text"),("month","Month","text"),("department","Department","text"),("classification","Classification","text"),
                ("source","Source","text"),("reference","Reference","text"),("article","Article","text"),("sku","SKU","text"),
                ("unit","UOM","text"),("quantity","Quantity","number"),("value","Net recorded cost","money")]),rows)

    def purchase_prices(self, request, report_kind):
        queryset = SupplierItemPrice.objects.select_related("supplier", "item__category", "unit").filter(is_active=True,effective_from__lte=timezone.localdate()).filter(Q(quotation_valid_until__isnull=True)|Q(quotation_valid_until__gte=timezone.localdate()))
        if request.query_params.get("supplier"):
            queryset = queryset.filter(supplier_id=request.query_params["supplier"])
        if request.query_params.get("category"):
            queryset = queryset.filter(item__category_id=request.query_params["category"])
        if request.query_params.get("item"):
            queryset = queryset.filter(item_id=request.query_params["item"])
        rows = [
            {
                "article": str(price.item), "sku": price.item.sku, "major_group": str(price.item.category.parent or price.item.category),
                "supplier": str(price.supplier), "unit": str(price.unit or price.item.base_unit or price.item.unit),
                "unit_price": decimal_string(price.unit_price), "base_price": decimal_string(price.base_unit_price),
                "effective_from": price.effective_from, "quoted_at": price.last_quoted_at or "",
            }
            for price in queryset.order_by("item__name", "supplier__name")
        ]
        return analysis_response(
            "Article Purchase Prices", "Current active supplier quotations, expressed in both purchase and base units.",
            [
                {"key": "article", "label": "Article"}, {"key": "sku", "label": "SKU"}, {"key": "major_group", "label": "Major group"},
                {"key": "supplier", "label": "Supplier"}, {"key": "unit", "label": "Purchase unit"},
                {"key": "unit_price", "label": "Unit price", "kind": "money"}, {"key": "base_price", "label": "Base-unit price", "kind": "money"},
                {"key": "effective_from", "label": "Effective from"},
            ], rows,
        )

    def reorder_proposal(self, request, report_kind):
        queryset = apply_store_scope(InventoryBalance.objects.select_related("item", "store", "item__category"), request)
        queryset = apply_category_scope(queryset, request)
        if request.query_params.get("item"):
            queryset = queryset.filter(item_id=request.query_params["item"])
        rows = []
        for balance in queryset:
            rule = ReorderRule.objects.filter(item=balance.item, store=balance.store, is_active=True).first() or ReorderRule.objects.filter(item=balance.item, store__isnull=True, is_active=True).first()
            minimum = rule.minimum_level if rule else (balance.reorder_level or balance.item.reorder_level)
            if balance.quantity_in_stock <= minimum:
                rows.append({
                    "article": str(balance.item), "sku": balance.item.sku, "store": str(balance.store),
                    "on_hand": decimal_string(balance.quantity_in_stock), "minimum": decimal_string(minimum),
                    "proposal": decimal_string(rule.reorder_quantity if rule else Decimal("0.00")),
                    "supplier": str(rule.preferred_supplier) if rule and rule.preferred_supplier else "",
                })
        return analysis_response(
            "Re-Order Proposal", "Live proposal for balances at or below their configured reorder minimum.",
            [{"key": "article", "label": "Article"}, {"key": "sku", "label": "SKU"}, {"key": "store", "label": "Store"}, {"key": "on_hand", "label": "SOH", "kind": "number"}, {"key": "minimum", "label": "Minimum", "kind": "number"}, {"key": "proposal", "label": "Proposed order", "kind": "number"}, {"key": "supplier", "label": "Preferred supplier"}], rows,
        )


    def _purchase_detail(self, request):
        rows = []
        for line in analysis_purchase_lines(request).order_by("purchase_order__supplier__name","item__name"):
            po = line.purchase_order
            rows.append({"reference":po.lpo_number or po.po_number,"date":po.created_at,"supplier":str(po.supplier),
                         "article":line.item.name,"sku":line.item.sku,"unit":self._base_unit(line.item),
                         "store":str(line.destination_store or (po.store if not line.destination_department_id else "") or ""),
                         "department":str(line.destination_department or ""),"ordered":str(line.approved_base_quantity),
                         "value":str(line.line_total),"status":po.status})
        return rows

    def _purchase_columns(self):
        return self._columns([("reference","LPO","text"),("date","Order date","text"),("supplier","Supplier","text"),
            ("article","Article","text"),("sku","SKU","text"),("unit","Base UOM","text"),
            ("store","Store","text"),("department","Department","text"),("ordered","Approved base qty","number"),
            ("value","Approved net value","money"),("status","Status","text")])

    def purchase_statistics_item(self, request, report_kind):
        return analysis_response("Purchase Statistics per Article","Approved LPO line evidence in base units. Group by article for summary.",self._purchase_columns(),self._purchase_detail(request))

    def purchase_statistics_supplier(self, request, report_kind):
        return analysis_response("Purchase Statistics per Supplier","Approved LPO line evidence. Group by supplier for summary; unlike units are not totaled.",self._purchase_columns(),self._purchase_detail(request))

    def purchase_receiving_deviation(self, request, report_kind):
        rows=[]
        for line in analysis_purchase_lines(request).prefetch_related("receipt_items__inspection_items","receipt_items__goods_receipt"):
            ordered=line.approved_base_quantity
            delivered=accepted=rejected=Decimal("0")
            incomplete=False
            for receipt in line.receipt_items.all():
                if receipt.goods_receipt.status != GoodsReceiptStatus.POSTED:
                    continue
                delivered+=receipt.base_quantity
                decision=next(iter(receipt.inspection_items.all()),None)
                if (not decision or decision.quantity_received != receipt.base_quantity or
                        decision.quantity_accepted+decision.quantity_rejected != receipt.base_quantity):
                    incomplete=True
                    continue
                accepted+=decision.quantity_accepted;rejected+=decision.quantity_rejected
            po=line.purchase_order
            rows.append({"reference":po.lpo_number or po.po_number,"supplier":str(po.supplier),"article":line.item.name,
                         "sku":line.item.sku,"unit":self._base_unit(line.item),"ordered":str(ordered),
                         "delivered":str(delivered),"accepted":None if incomplete else str(accepted),
                         "rejected":None if incomplete else str(rejected),"deviation":None if incomplete else str(accepted-ordered),
                         "value":str(line.line_total),"status":"Missing inspection evidence" if incomplete else po.status})
        return analysis_response("Purchase/Receiving Deviation per Supplier","Approved quantities compared with posted receipt inspections; unknown acceptance is not assumed.",
            self._columns([("reference","LPO","text"),("supplier","Supplier","text"),("article","Article","text"),("sku","SKU","text"),
                ("unit","Base UOM","text"),("ordered","Approved base qty","number"),("delivered","Posted delivered","number"),
                ("accepted","Accepted","number"),("rejected","Rejected","number"),("deviation","Accepted less ordered","number"),
                ("value","Approved net value","money"),("status","Status","text")]),rows)

    def abc_analysis(self, request, report_kind):
        balances = apply_store_scope(InventoryBalance.objects.select_related("item", "store", "item__category"), request)
        balances = apply_category_scope(balances, request)
        prepared = []
        for balance in balances:
            value = balance.quantity_in_stock * weighted_average_cost(balance.item, balance.store)
            prepared.append((balance, value))
        total = sum((value for _, value in prepared), Decimal("0.00"))
        running = Decimal("0.00")
        rows = []
        for balance, value in sorted(prepared, key=lambda pair: pair[1], reverse=True):
            previous_share = (running / total * Decimal("100.00")) if total else Decimal("0.00")
            running += value
            share = (running / total * Decimal("100.00")) if total else Decimal("0.00")
            # Use the value accumulated *before* the current article: the
            # largest article in a small catalogue is still an A item even if
            # its own inclusion takes cumulative value beyond 80%.
            classification = "A" if previous_share < Decimal("80.00") else "B" if previous_share < Decimal("95.00") else "C"
            rows.append({"article": str(balance.item), "sku": balance.item.sku, "store": str(balance.store), "on_hand": decimal_string(balance.quantity_in_stock), "value": decimal_string(value), "class": classification, "cumulative": decimal_string(share)})
        return analysis_response(
            "ABC Analysis", "Inventory value classification using cumulative weighted stock value (A 80%, B next 15%, C remainder).",
            [{"key": "article", "label": "Article"}, {"key": "sku", "label": "SKU"}, {"key": "store", "label": "Store"}, {"key": "on_hand", "label": "SOH", "kind": "number"}, {"key": "value", "label": "Stock value", "kind": "money"}, {"key": "class", "label": "ABC class"}, {"key": "cumulative", "label": "Cumulative %", "kind": "number"}], rows,
        )

    def price_variance(self, request, report_kind):
        prices = SupplierItemPrice.objects.select_related("item__category", "supplier").filter(is_active=True,effective_from__lte=timezone.localdate()).filter(Q(quotation_valid_until__isnull=True)|Q(quotation_valid_until__gte=timezone.localdate()))
        if request.query_params.get("supplier"):
            prices=prices.filter(supplier_id=request.query_params["supplier"])
        if request.query_params.get("category"):
            prices = prices.filter(item__category_id=request.query_params["category"])
        if request.query_params.get("item"):
            prices = prices.filter(item_id=request.query_params["item"])
        grouped = {}
        for price in prices:
            row = grouped.setdefault(str(price.item_id), {"article": str(price.item), "sku": price.item.sku, "quotes": 0, "lowest": price.base_unit_price, "highest": price.base_unit_price})
            row["quotes"] += 1; row["lowest"] = min(row["lowest"], price.base_unit_price); row["highest"] = max(row["highest"], price.base_unit_price)
        rows = [{**row, "lowest": decimal_string(row["lowest"]), "highest": decimal_string(row["highest"]), "variance": decimal_string(row["highest"] - row["lowest"])} for row in grouped.values()]
        return analysis_response(
            "Price Variance Statistics", "Current active supplier quotation spread per article in base units.",
            [{"key": "article", "label": "Article"}, {"key": "sku", "label": "SKU"}, {"key": "quotes", "label": "Quotes", "kind": "number"}, {"key": "lowest", "label": "Lowest", "kind": "money"}, {"key": "highest", "label": "Highest", "kind": "money"}, {"key": "variance", "label": "Variance", "kind": "money"}], rows,
        )

    def receipts_journal(self, request, report_kind):
        queryset = GoodsReceiptNote.objects.select_related("purchase_order__supplier", "purchase_order__store", "purchase_order__requisition__branch", "received_by").prefetch_related("items")
        queryset = apply_branch_scope(queryset, request, branch_field="purchase_order__requisition__branch")
        queryset = apply_date_scope(queryset, request, field="received_date")
        if request.query_params.get("store"):
            queryset = queryset.filter(purchase_order__store_id=request.query_params["store"])
        if request.query_params.get("supplier"):
            queryset = queryset.filter(purchase_order__supplier_id=request.query_params["supplier"])
        rows = []
        for receipt in queryset.order_by("-received_date", "-created_at"):
            value = sum((line.quantity_received * line.unit_cost for line in receipt.items.all()), Decimal("0.00"))
            rows.append({"grn": receipt.grn_number, "date": receipt.received_date, "lpo": receipt.purchase_order.lpo_number or receipt.purchase_order.po_number, "supplier": str(receipt.purchase_order.supplier), "store": str(receipt.purchase_order.store or ""), "lines": receipt.items.count(), "value": decimal_string(value), "status": receipt.status, "drilldown_type": "grns", "drilldown_id": str(receipt.id)})
        return analysis_response(
            "Summarized Receipts Journal", "Goods receipt journal with supplier, store, receiving value and posting state.",
            [{"key": "grn", "label": "GRN"}, {"key": "date", "label": "Received"}, {"key": "lpo", "label": "LPO"}, {"key": "supplier", "label": "Supplier"}, {"key": "store", "label": "Store"}, {"key": "lines", "label": "Lines", "kind": "number"}, {"key": "value", "label": "Received value", "kind": "money"}, {"key": "status", "label": "Status"}], rows,
        )

    def supplier_invoices(self, request, report_kind):
        queryset = SupplierInvoice.objects.select_related("supplier", "purchase_order__requisition__branch")
        queryset = apply_branch_scope(queryset, request, branch_field="purchase_order__requisition__branch")
        queryset = apply_date_scope(queryset, request, field="invoice_date")
        if request.query_params.get("supplier"):
            queryset = queryset.filter(supplier_id=request.query_params["supplier"])
        rows = [{"invoice": invoice.invoice_number, "date": invoice.invoice_date, "supplier": str(invoice.supplier), "lpo": invoice.purchase_order.lpo_number or invoice.purchase_order.po_number, "subtotal": decimal_string(invoice.subtotal), "tax": decimal_string(invoice.tax_amount), "total": decimal_string(invoice.total_amount), "status": invoice.status} for invoice in queryset.order_by("-invoice_date", "-created_at")]
        return analysis_response(
            "A/P Reports", "Supplier invoices, tax amounts and payment-matching state.",
            [{"key": "invoice", "label": "Supplier invoice"}, {"key": "date", "label": "Invoice date"}, {"key": "supplier", "label": "Supplier"}, {"key": "lpo", "label": "LPO"}, {"key": "subtotal", "label": "Subtotal", "kind": "money"}, {"key": "tax", "label": "Tax", "kind": "money"}, {"key": "total", "label": "Invoice total", "kind": "money"}, {"key": "status", "label": "Status"}], rows,
        )

    def sales_overview(self, request, report_kind):
        rows = [{"receipt": sale.receipt_no, "date": sale.sale_date, "store": str(sale.store or ""), "customer": str(sale.customer or "Walk-in"), "payment": str(sale.payment_method or ""), "total": decimal_string(sale.total_amount), "paid": decimal_string(sale.amount_paid), "status": sale.status} for sale in analysis_sales(request).order_by("-sale_date", "-created_at")]
        return analysis_response(
            "Sales Overview", "Recorded sales receipts in the current operational scope.",
            [{"key": "receipt", "label": "Receipt"}, {"key": "date", "label": "Date"}, {"key": "store", "label": "Store"}, {"key": "customer", "label": "Customer"}, {"key": "payment", "label": "Payment method"}, {"key": "total", "label": "Total", "kind": "money"}, {"key": "paid", "label": "Paid", "kind": "money"}, {"key": "status", "label": "Status"}], rows,
        )

    def menu_profitability(self, request):
        """Oracle-style menu matrix using posted POS sales and frozen recipe COGS.

        Popularity = sold portions; profitability = contribution per portion.
        Thresholds are the arithmetic mean across *priced* recipes in the
        permitted outlet/date scope. Unpriced recipes never get a misleading
        Star/Plowhorse/Puzzle/Dog label.
        """
        from apps.materials_control.models import POSSaleLine

        lines = apply_store_scope(
            POSSaleLine.objects.select_related("batch__outlet", "mapping__recipe")
            .filter(inventory_changes_applied=True, mapping__isnull=False),
            request, store_field="batch__outlet",
        )
        from_date = parse_date(request.query_params.get("date_from", ""))
        to_date = parse_date(request.query_params.get("date_to", ""))
        if from_date:
            lines = lines.filter(batch__business_date__gte=from_date)
        if to_date:
            lines = lines.filter(batch__business_date__lte=to_date)
        grouped = {}
        for line in lines:
            recipe = line.mapping.recipe
            row = grouped.setdefault(str(recipe.pk), {
                "sku": recipe.code, "article": recipe.name,
                "quantity": Decimal("0.0000"), "sales": Decimal("0.00"),
                "cogs": Decimal("0.00"), "unpriced": 0, "transactions": 0,
            })
            row["quantity"] += line.quantity
            row["sales"] += line.net_sales
            row["transactions"] += 1
            if line.cost_of_goods_sold is None:
                row["unpriced"] += 1
            else:
                row["cogs"] += line.cost_of_goods_sold

        rows, statistics = classify_menu_recipes(grouped.values())
        return analysis_response(
            "Menu Engineering",
            (
                "Four-quadrant POS menu matrix. Popularity threshold: "
                f"{statistics['popularity_threshold']} portions; unit contribution "
                f"threshold: {statistics['unit_contribution_threshold']} "
                f"(each calculated from {statistics['eligible_recipes']} fully costed recipes)."
            ),
            [
                {"key": "article", "label": "Recipe"},
                {"key": "sku", "label": "Recipe code"},
                {"key": "classification", "label": "Menu classification"},
                {"key": "quantity", "label": "Sold portions", "kind": "number"},
                {"key": "unit_contribution", "label": "Contribution / portion", "kind": "money"},
                {"key": "sales", "label": "Net POS sales", "kind": "money"},
                {"key": "cogs", "label": "Frozen recipe COGS", "kind": "money"},
                {"key": "profit", "label": "Gross contribution", "kind": "money"},
                {"key": "margin_percent", "label": "Margin %", "kind": "number"},
                {"key": "recommended_action", "label": "Suggested action"},
            ],
            rows,
            notice=(
                f"{statistics['unclassified_recipes']} unclassified recipe(s) have missing "
                "historical COGS or non-positive sales/quantity; they are excluded "
                "from both thresholds. This is an operational decision aid, not a GL posting."
            ) if statistics["unclassified_recipes"] else "",
        )

    def sales_statistics(self, request, report_kind):
        if report_kind == "menuEngineering":
            return self.menu_profitability(request)
        sale_ids = analysis_sales(request).filter(inventory_changes_applied=True, is_cancelled=False).values_list("id", flat=True)
        lines = SaleItem.objects.select_related("item__category", "sale__store").filter(sale_id__in=sale_ids)
        if request.query_params.get("category"):
            lines = lines.filter(item__category_id=request.query_params["category"])
        if request.query_params.get("item"):
            lines = lines.filter(item_id=request.query_params["item"])
        grouped = {}
        for line in lines:
            row = grouped.setdefault(str(line.item_id), {"article": str(line.item), "sku": line.item.sku, "major_group": str(line.item.category.parent or line.item.category), "quantity": Decimal("0.00"), "sales": Decimal("0.00"), "receipts": set()})
            row["quantity"] += line.quantity; row["sales"] += line.line_total; row["receipts"].add(str(line.sale_id))
        rows = [{"article": row["article"], "sku": row["sku"], "major_group": row["major_group"], "receipts": len(row["receipts"]), "quantity": decimal_string(row["quantity"]), "sales": decimal_string(row["sales"])} for row in grouped.values()]
        title = "Menu Engineering" if report_kind == "menuEngineering" else "Sales per Article"
        subtitle = "Completed sale quantity and revenue by article; this is a sales-mix view." if report_kind == "menuEngineering" else "Completed sales quantity and revenue grouped by article."
        return analysis_response(title, subtitle, [{"key": "article", "label": "Article"}, {"key": "sku", "label": "SKU"}, {"key": "major_group", "label": "Major group"}, {"key": "receipts", "label": "Receipts", "kind": "number"}, {"key": "quantity", "label": "Sold qty", "kind": "number"}, {"key": "sales", "label": "Sales value", "kind": "money"}], rows)

    def sales_tax_analysis(self, request, report_kind):
        # Sales records do not contain a tax field. Surface that data gap rather
        # than manufacturing a tax amount from supplier invoices or the UI.
        return analysis_response(
            "Sales Tax Analysis", "Sales receipts in this deployment do not yet record a tax amount per sale.",
            [{"key": "status", "label": "Status"}], [],
            notice="No sales-tax figures are shown until tax is captured on sales receipts. This report intentionally does not infer tax from supplier invoices.",
        )

    def sales_activity(self, request, report_kind):
        sale_ids = analysis_sales(request).filter(inventory_changes_applied=True, is_cancelled=False).values_list("id", flat=True)
        grouped = {}
        for line in SaleItem.objects.select_related("item").filter(sale_id__in=sale_ids):
            key = line.item.business_type
            row = grouped.setdefault(key, {"activity": line.item.get_business_type_display(), "quantity": Decimal("0.00"), "sales": Decimal("0.00")})
            row["quantity"] += line.quantity; row["sales"] += line.line_total
        rows = [{"activity": row["activity"], "quantity": decimal_string(row["quantity"]), "sales": decimal_string(row["sales"])} for row in grouped.values()]
        return analysis_response("Sales per Activity Type", "Activity is represented by the configured Article business type until a separate sales-activity field is introduced.", [{"key": "activity", "label": "Article business type"}, {"key": "quantity", "label": "Sold qty", "kind": "number"}, {"key": "sales", "label": "Sales value", "kind": "money"}], rows)

    def article_potential_usage(self, request, report_kind):
        balances = apply_store_scope(InventoryBalance.objects.select_related("item", "store"), request)
        if request.query_params.get("item"):
            balances = balances.filter(item_id=request.query_params["item"])
        rows = [{"article": str(balance.item), "sku": balance.item.sku, "store": str(balance.store), "available": decimal_string(balance.available_quantity), "reorder": decimal_string(balance.reorder_level), "status": "Reorder review" if balance.is_below_reorder else "Available"} for balance in balances]
        return analysis_response("Article Potential Usage", "Available stock position for articles that may be used or sold from each store.", [{"key": "article", "label": "Article"}, {"key": "sku", "label": "SKU"}, {"key": "store", "label": "Store"}, {"key": "available", "label": "Available", "kind": "number"}, {"key": "reorder", "label": "Reorder level", "kind": "number"}, {"key": "status", "label": "Position"}], rows)

    def requirements_usage(self, request, report_kind):
        response = self.reorder_proposal(request, report_kind)
        response.data["title"] = "Requirements based on Usage"
        response.data["subtitle"] = "Current stock requirements derived from configured reorder thresholds and live stock on hand."
        return response

    def pos_cost_of_sales(self, request, report_kind):
        """Posted POS recipe cost evidence; never infer a cost from turnover."""
        from apps.materials_control.models import POSSaleLine
        lines = apply_store_scope(
            POSSaleLine.objects.select_related("batch__outlet", "mapping__recipe")
            .filter(inventory_changes_applied=True),
            request, store_field="batch__outlet",
        )
        lines = apply_date_scope(lines, request, field="batch__business_date")
        details, grouped = [], {}
        for line in lines.order_by("batch__business_date", "batch__outlet__name", "external_reference"):
            store = str(line.batch.outlet)
            cost = line.cost_of_goods_sold
            group = grouped.setdefault(str(line.batch.outlet_id), {
                "store": store, "lines": 0, "sales": Decimal("0.00"), "cost": Decimal("0.00"), "unpriced": 0,
            })
            group["lines"] += 1
            group["sales"] += line.net_sales
            if cost is None:
                group["unpriced"] += 1
            else:
                group["cost"] += cost
            details.append({
                "store": store, "date": line.batch.business_date, "reference": line.external_reference,
                "article": line.mapping.recipe.name if line.mapping_id else line.external_name or line.external_plu,
                "sku": line.external_plu, "unit": "portion", "quantity": str(line.quantity),
                "sales": decimal_string(line.net_sales), "cogs": decimal_string(cost) if cost is not None else None,
                "profit": decimal_string(line.net_sales - cost) if cost is not None else None,
                "status": "Valued" if cost is not None else "Missing historical cost",
            })
        rows = [{
            "store": row["store"], "lines": row["lines"], "sales": decimal_string(row["sales"]),
            "cogs": decimal_string(row["cost"]) if not row["unpriced"] else None,
            "profit": decimal_string(row["sales"] - row["cost"]) if not row["unpriced"] else None,
            "unpriced": row["unpriced"],
        } for row in grouped.values()]
        def column(key, label, kind="text"):
            return {"key": key, "label": label, "kind": kind}
        response = analysis_response(
            "Cost of Sales by Location (POS recipes)",
            "Processed POS sales and captured recipe COGS. Unvalued lines suppress location-level COGS and contribution; not a complete departmental P&L.",
            [column("store", "Store"), column("lines", "Lines", "number"), column("sales", "Net sales", "money"),
             column("cogs", "Recorded COGS", "money"), column("profit", "Gross contribution", "money"),
             column("unpriced", "Missing cost", "number")], rows,
            notice="Department consumption and non-recipe sales are separate cost sources. Do not treat this report as complete hotel cost of sales.",
        )
        response.data["detail_columns"] = [
            column("store", "Store"), column("date", "Date"), column("reference", "Reference"),
            column("article", "Recipe"), column("sku", "PLU"), column("unit", "UOM"),
            column("quantity", "Portions", "number"), column("sales", "Net sales", "money"),
            column("cogs", "Recorded COGS", "money"), column("profit", "Gross contribution", "money"),
            column("status", "Status"),
        ]
        response.data["detail_results"] = details
        return response

    def sales_by_store(self, request, report_kind):
        grouped = {}
        for sale in analysis_sales(request).filter(is_cancelled=False):
            key = str(sale.store_id or "")
            row = grouped.setdefault(key, {"store": str(sale.store or "Unassigned"), "receipts": 0, "sales": Decimal("0.00"), "paid": Decimal("0.00"), "outstanding": Decimal("0.00")})
            row["receipts"] += 1; row["sales"] += sale.total_amount; row["paid"] += sale.amount_paid; row["outstanding"] += sale.balance
        rows = [{**row, "sales": decimal_string(row["sales"]), "paid": decimal_string(row["paid"]), "outstanding": decimal_string(row["outstanding"])} for row in grouped.values()]
        title = "Cost Center Comparison" if report_kind == "costCenterComparison" else "Cost of Sales Location Summary"
        subtitle = "Recorded sales, collections and outstanding balance by store/cost center."
        return analysis_response(title, subtitle, [{"key": "store", "label": "Store / cost center"}, {"key": "receipts", "label": "Receipts", "kind": "number"}, {"key": "sales", "label": "Sales", "kind": "money"}, {"key": "paid", "label": "Collected", "kind": "money"}, {"key": "outstanding", "label": "Outstanding", "kind": "money"}], rows)

    def warehouse_statistics(self, request, report_kind):
        balances = apply_store_scope(InventoryBalance.objects.select_related("item__base_unit", "item__category", "store"), request)
        return self._stock_group_report(balances, by_group=False)

    def _stock_group_report(self, balances, *, by_group):
        grouped, details = {}, []
        for balance in balances:
            group = balance.item.category.parent or balance.item.category
            group_key = str(group.pk if by_group else balance.store_id)
            key, label = ("group", str(group)) if by_group else ("store", str(balance.store))
            bucket = grouped.setdefault(group_key, {key: label, "articles": 0, "value": Decimal("0.00"), "missing": 0, "below_reorder": 0})
            cost = weighted_average_cost(balance.item, balance.store)
            known = balance.quantity_in_stock == 0 or cost > 0
            value = balance.quantity_in_stock * cost
            bucket["articles"] += 1
            bucket["value"] += value
            bucket["missing"] += int(not known)
            bucket["below_reorder"] += int(balance.is_below_reorder)
            details.append({
                "store": str(balance.store), "group": str(group), "article": balance.item.name, "sku": balance.item.sku,
                "unit": balance.item.base_unit.abbreviation if balance.item.base_unit_id else balance.item.unit,
                "available": str(balance.available_quantity), "reserved": str(balance.quantity_reserved),
                "value": decimal_string(value) if known else None,
                "status": "Below reorder" if balance.is_below_reorder else "Available",
            })
        key, heading = ("group", "Major group") if by_group else ("store", "Store")
        rows = [{**row, "value": decimal_string(row["value"]) if not row["missing"] else None} for row in grouped.values()]
        response = analysis_response(
            "Major Group Lists" if by_group else "Warehouse Statistics",
            "Inventory article positions and recorded valuation. Unlike units are never added together; missing costs suppress group valuation.",
            [{"key": key, "label": heading}, {"key": "articles", "label": "Article positions", "kind": "number"},
             {"key": "value", "label": "Stock value", "kind": "money"}, {"key": "missing", "label": "Missing valuation", "kind": "number"},
             {"key": "below_reorder", "label": "Below reorder", "kind": "number"}], rows,
        )
        response.data["detail_columns"] = [
            {"key": k, "label": label, "kind": kind} for k, label, kind in (
                ("store", "Store", "text"), ("group", "Major group", "text"), ("article", "Article", "text"),
                ("sku", "SKU", "text"), ("unit", "UOM", "text"), ("available", "Available", "number"),
                ("reserved", "Reserved", "number"), ("value", "Stock value", "money"), ("status", "Status", "text"),
            )
        ]
        response.data["detail_results"] = details
        return response

    def sales_by_category(self, request, report_kind):
        sale_ids = analysis_sales(request).filter(inventory_changes_applied=True, is_cancelled=False).values_list("id", flat=True)
        lines = SaleItem.objects.select_related("item__category").filter(sale_id__in=sale_ids)
        grouped = {}
        for line in lines:
            category = line.item.category.parent or line.item.category
            row = grouped.setdefault(str(category.id), {"group": str(category), "articles": set(), "quantity": Decimal("0.00"), "sales": Decimal("0.00")})
            row["articles"].add(str(line.item_id)); row["quantity"] += line.quantity; row["sales"] += line.line_total
        rows = [{"group": row["group"], "articles": len(row["articles"]), "quantity": decimal_string(row["quantity"]), "sales": decimal_string(row["sales"])} for row in grouped.values()]
        title = "Group Analysis" if report_kind == "groupAnalysis" else "Daily Food"
        subtitle = "Completed sales grouped by the configured Major Group. Apply the date filter for a daily review." if report_kind == "dailyFood" else "Completed sales value and quantity grouped by Major Group."
        return analysis_response(title, subtitle, [{"key": "group", "label": "Major group"}, {"key": "articles", "label": "Articles", "kind": "number"}, {"key": "quantity", "label": "Sold qty", "kind": "number"}, {"key": "sales", "label": "Sales value", "kind": "money"}], rows)

    def major_group_lists(self, request, report_kind):
        balances = apply_store_scope(InventoryBalance.objects.select_related("item__category", "item__base_unit", "store"), request)
        return self._stock_group_report(balances, by_group=True)

    def fb_result(self, request, report_kind):
        sales = analysis_sales(request).filter(is_cancelled=False)
        sales_total = sum((sale.total_amount for sale in sales), Decimal("0.00"))
        expenses = Expense.objects.select_related("store__branch")
        if is_report_administrator(request.user):
            if request.query_params.get("branch"):
                expenses = expenses.filter(store__branch_id=request.query_params["branch"])
        else:
            branch_id = employee_branch_id(request.user)
            expenses = expenses.filter(store__branch_id=branch_id) if branch_id else expenses.none()
        expenses = apply_date_scope(expenses, request, field="date")
        expense_total = sum((expense.amount for expense in expenses), Decimal("0.00"))
        rows = [{"measure": "Sales revenue", "amount": decimal_string(sales_total)}, {"measure": "Recorded operating expenses", "amount": decimal_string(expense_total)}, {"measure": "Recorded operating result", "amount": decimal_string(sales_total - expense_total)}]
        return analysis_response("F&B Result", "Recorded sales revenue less recorded operating expenses; inventory cost is not estimated from this report.", [{"key": "measure", "label": "Measure"}, {"key": "amount", "label": "Amount", "kind": "money"}], rows)

    def monthly_report(self, request, report_kind):
        grouped = {}
        for sale in analysis_sales(request).filter(is_cancelled=False):
            month = sale.sale_date.strftime("%Y-%m")
            row = grouped.setdefault(month, {"month": month, "receipts": 0, "sales": Decimal("0.00"), "collected": Decimal("0.00"), "outstanding": Decimal("0.00")})
            row["receipts"] += 1; row["sales"] += sale.total_amount; row["collected"] += sale.amount_paid; row["outstanding"] += sale.balance
        rows = [{**row, "sales": decimal_string(row["sales"]), "collected": decimal_string(row["collected"]), "outstanding": decimal_string(row["outstanding"])} for _, row in sorted(grouped.items())]
        return analysis_response("Monthly Report", "Sales, collections and outstanding balances by sale month.", [{"key": "month", "label": "Month"}, {"key": "receipts", "label": "Receipts", "kind": "number"}, {"key": "sales", "label": "Sales", "kind": "money"}, {"key": "collected", "label": "Collected", "kind": "money"}, {"key": "outstanding", "label": "Outstanding", "kind": "money"}], rows)

    def last_estimate(self, request, report_kind):
        queryset = PurchaseRequisition.objects.select_related("department", "branch", "requester")
        queryset = apply_branch_scope(queryset, request, branch_field="branch")
        queryset = apply_date_scope(queryset, request)
        rows = [{"requisition": row.requisition_number, "date": row.created_at, "department": str(row.department or ""), "requester": str(row.requester or ""), "estimate": decimal_string(row.estimated_total), "status": row.status} for row in queryset.order_by("-created_at")]
        return analysis_response("Last Estimate", "Latest procurement requisition estimates in the current branch scope.", [{"key": "requisition", "label": "Requisition"}, {"key": "date", "label": "Created"}, {"key": "department", "label": "Department"}, {"key": "requester", "label": "Requester"}, {"key": "estimate", "label": "Estimated value", "kind": "money"}, {"key": "status", "label": "Status"}], rows)

    def fb_budget(self, request, report_kind):
        from apps.materials_control.models import CostCenterBudget
        budgets = apply_branch_scope(CostCenterBudget.objects.filter(is_active=True).select_related("department","branch"), request)
        budgets = apply_date_scope(budgets, request, field="period_month")
        if request.query_params.get("department"):
            budgets = budgets.filter(department_id=request.query_params["department"])
        rows = [{"month":budget.period_month,"department":str(budget.department),"budget":str(budget.spending_cap),
                 "committed":str(budget.committed_spend),"remaining":str(budget.remaining_amount)} for budget in budgets]
        return analysis_response("F&B Budget","Configured cost-center purchasing caps and commitments. Select the F&B department; this is not a verified food-cost budget or an actual-versus-budget P&L.",
            self._columns([("month","Month","text"),("department","Department","text"),("budget","Budget cap","money"),
                           ("committed","Purchase commitments","money"),("remaining","Remaining cap","money")]),rows)


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


def scope_control_rows_for_user(rows, request, report_kind):
    if is_report_administrator(request.user):
        return rows
    if report_kind == "supplier_price_changes":
        # Supplier catalogue pricing is hotel-wide master data for the approved roles.
        return rows
    roles = user_role_names(request.user)
    requested_branch = str(request.query_params.get("branch", "") or "")
    branch_id = employee_branch_id(request.user)
    if requested_branch and requested_branch != branch_id:
        return []
    if "Store Keeper" in roles:
        allowed = {str(value) for value in assigned_store_ids_for_reports(request.user)}
        return [row for row in rows if str(row.get("_store_id", "")) in allowed]
    if not branch_id:
        return []
    return [row for row in rows if str(row.get("_branch_id", "")) == branch_id]


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
        rows = scope_control_rows_for_user(rows, request, self.report_kind)
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
        for line in GoodsInspectionItem.objects.select_related(
            "inspection__goods_receipt__purchase_order__requisition__branch",
            "goods_receipt_item__item",
        ).filter(quantity_rejected__gt=0):
            item = line.goods_receipt_item.item
            receipt = line.inspection.goods_receipt
            branch = receipt.purchase_order.requisition.branch
            rows.append(control_row(date=line.created_at, document_type="inspection", reference=str(receipt), action="Rejected delivery", status="exception", branch=str(branch or ""), item=str(item), quantity=decimal_string(line.quantity_rejected), detail=line.rejection_reason, drilldown_type="inspections", drilldown_id=str(line.inspection_id), _date=line.created_at.date(), _branch_id=str(receipt.purchase_order.requisition.branch_id or ""), _item_id=str(item.id), _category_id=str(item.category_id)))
        for invoice in SupplierInvoice.objects.select_related("supplier", "purchase_order__requisition__branch").filter(status="exception"):
            rows.append(control_row(date=invoice.updated_at, document_type="supplier_invoice", reference=invoice.invoice_number, action="Invoice mismatch", status=invoice.status, supplier=str(invoice.supplier), value=decimal_string(invoice.total_amount), detail=invoice.match_notes, drilldown_type="supplier-invoices", drilldown_id=str(invoice.id), _date=invoice.updated_at.date(), _value=invoice.total_amount, _supplier_id=str(invoice.supplier_id), _branch_id=str(invoice.purchase_order.requisition.branch_id or "")))
        for line in StockCountItem.objects.select_related("stock_count__store__branch", "item").all():
            if line.variance:
                rows.append(control_row(date=line.updated_at, document_type="stock_count", reference=line.stock_count.count_no, action="Count variance", status=line.stock_count.status, branch=str(line.stock_count.store.branch or ""), store_workspace=str(line.stock_count.store), item=str(line.item), quantity=decimal_string(line.variance), detail=f"System {line.system_quantity}; physical {line.physical_quantity}", drilldown_type="stock-counts", drilldown_id=str(line.stock_count_id), _date=line.updated_at.date(), _branch_id=str(line.stock_count.store.branch_id or ""), _store_id=str(line.stock_count.store_id), _item_id=str(line.item_id), _category_id=str(line.item.category_id)))
        for req in StoreRequisition.objects.select_related("store__branch", "requested_by__branch", "department").filter(status="awaiting_procurement"):
            branch = req.store.branch if req.store_id else req.requested_by.branch
            branch_id = req.store.branch_id if req.store_id else req.requested_by.branch_id
            rows.append(control_row(date=req.updated_at, document_type="store_requisition", reference=req.requisition_no, action="Stock shortage", status=req.status, branch=str(branch or ""), department=str(req.department), detail=req.purpose, drilldown_type="store-requisitions", drilldown_id=str(req.id), _date=req.updated_at.date(), _branch_id=str(branch_id or ""), _department_id=str(req.department_id)))
        return rows

    def stock_movement_rows(self, request):
        rows = []
        for move in StockLedger.objects.select_related("item__category", "store__branch", "created_by").all():
            quantity = move.quantity_in if move.quantity_in else -move.quantity_out
            rows.append(control_row(date=move.created_at, document_type=move.reference_type, reference=str(move.reference_id), action="Stock in" if quantity > 0 else "Stock out", status="posted", actor=(move.created_by.get_full_name() or move.created_by.username) if move.created_by else "System", branch=str(move.store.branch or "") if move.store_id else "", store_workspace=str(move.store or ""), item=str(move.item), quantity=decimal_string(quantity), detail=move.note, drilldown_type=move.reference_type, drilldown_id=str(move.reference_id), _date=move.business_date or timezone.localtime(move.created_at).date(), _branch_id=str(move.store.branch_id or "") if move.store_id else "", _store_id=str(move.store_id or ""), _employee_id=employee_id_for_user(move.created_by), _item_id=str(move.item_id), _category_id=str(move.item.category_id)))
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
        requested_branch = str(request.query_params.get("branch", "") or "")
        branch_id = requested_branch if is_report_administrator(request.user) else employee_branch_id(request.user)
        if not is_report_administrator(request.user) and requested_branch and requested_branch != branch_id:
            return []

        open_pos = PurchaseOrder.objects.filter(status__in=("issued", "partially_received"))
        exception_invoices = SupplierInvoice.objects.filter(status="exception")
        direct_lines = GoodsReceiptItem.objects.select_related("purchase_order_item").filter(
            direct_issue_department__isnull=False,
            inventory_changes_applied=True,
        )
        low_stock = InventoryBalance.objects.all()
        if branch_id:
            open_pos = open_pos.filter(requisition__branch_id=branch_id)
            exception_invoices = exception_invoices.filter(purchase_order__requisition__branch_id=branch_id)
            direct_lines = direct_lines.filter(goods_receipt__purchase_order__requisition__branch_id=branch_id)
            low_stock = low_stock.filter(store__branch_id=branch_id)

        direct_value = sum((line.base_quantity * line.base_unit_cost for line in direct_lines), Decimal("0"))
        metrics = [
            ("Open purchase commitments", open_pos.count(), open_pos.aggregate(total=Sum("total_amount"))["total"] or 0),
            ("Overdue purchase orders", open_pos.filter(expected_date__lt=today).count(), 0),
            ("Invoice exceptions", exception_invoices.count(), sum((invoice.total_amount for invoice in exception_invoices), Decimal("0"))),
            ("Direct workspace consumption", direct_lines.count(), direct_value),
            ("Low-stock balances", sum(1 for balance in low_stock if balance.is_below_reorder), 0),
        ]
        return [control_row(
            date=today,
            document_type="management_metric",
            reference=name,
            action="Management summary",
            status="current",
            quantity=str(count),
            value=decimal_string(Decimal(value)),
            detail=name,
            _date=today,
            _value=Decimal(value),
            _branch_id=branch_id,
        ) for name, count, value in metrics]
