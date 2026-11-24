"""Property-specific month-end inventories, independent of ordinary cycle counts."""
import calendar
from datetime import timedelta
from decimal import Decimal
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone

from django.db import transaction
from django.db.models import Q
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.departments.models import Branch, Department
from apps.inventory.models import (
    MonthEndCycle, MonthEndInventory, StoreLocation, InventoryBalance,
    InventoryBatch, StockCount, StockCountItem, StockLedger, DepartmentConsumption, StoreReturn,
)
from apps.materials_control.models import FiscalPeriod
from apps.notifications.services import notify_roles
from core.constants.choices import LedgerReferenceType


class MonthEndPlanInput(serializers.Serializer):
    cutoff = serializers.DateField()
    memo_reference = serializers.CharField(max_length=100)
    memo = serializers.CharField()
    consumption_department_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=True,
    )
    roster_confirmed = serializers.BooleanField()

    def validate(self, attrs):
        cutoff = attrs["cutoff"]
        if cutoff.day != calendar.monthrange(cutoff.year, cutoff.month)[1]:
            raise serializers.ValidationError({"cutoff": "Use the last calendar day of the inventory month."})
        if not attrs["roster_confirmed"]:
            raise serializers.ValidationError({"roster_confirmed": "Confirm the complete property consumption-department roster."})
        ids = attrs["consumption_department_ids"]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError({"consumption_department_ids": "Duplicate departments are not allowed."})
        return attrs


def _employee(user, *, write):
    allowed = ("Cost Controller",) if write else ("Cost Controller", "Financial Manager")
    if (user.is_superuser or not user.is_active
            or user.groups.filter(name="System Administrator").exists()
            or not user.groups.filter(name__in=allowed).exists()):
        raise PermissionDenied("Only assigned Cost Control staff may prepare month-end inventories; Finance may review.")
    employee = getattr(user, "employee_profile", None)
    if not employee or not employee.is_active or not employee.branch_id or not employee.branch.is_active:
        raise PermissionDenied("An active employee and property assignment are required.")
    return employee


def _department_cost(row):
    """Net zero-closing department consumption, sourced only from recorded transactions."""
    cycle = row.cycle
    start = cycle.cutoff.replace(day=1)
    entries = []
    issues = DepartmentConsumption.objects.filter(
        department_id=row.department_id, consumed_on__range=(start, cycle.cutoff),
    ).filter(
        Q(stock_issue_item__issue__store__branch_id=cycle.branch_id)
        | Q(goods_receipt_item__goods_receipt__purchase_order__requisition__branch_id=cycle.branch_id)
    ).select_related("item__base_unit", "stock_issue_item__issue", "goods_receipt_item__goods_receipt").order_by("pk")
    for entry in issues:
        direct = entry.goods_receipt_item_id is not None
        source = entry.goods_receipt_item.goods_receipt if direct else entry.stock_issue_item.issue
        reference = source.grn_number if direct else source.issue_no
        # The consumption record is the already-recognized cost evidence, not a new expense.
        entries.append({
            "id": str(entry.pk), "article": entry.item.name, "sku": entry.item.sku,
            "source": "direct_receipt" if direct else "department_issue", "reference": reference,
            "date": entry.consumed_on.isoformat(), "quantity": str(entry.quantity),
            "unit": entry.item.base_unit.abbreviation if entry.item.base_unit_id else entry.item.unit,
            "value": str(entry.total_cost.quantize(Decimal("0.0001"))) if entry.unit_cost > 0 else None,
        })
    returns = {ret.pk: ret.return_no for ret in StoreReturn.objects.filter(
        department_id=row.department_id, store__branch_id=cycle.branch_id, inventory_changes_applied=True,
    )}
    for movement in StockLedger.objects.with_accounting_date().filter(
        reference_type=LedgerReferenceType.STORE_RETURN, reference_id__in=returns,
        store__branch_id=cycle.branch_id, accounting_date__range=(start, cycle.cutoff),
    ).select_related("item__base_unit").order_by("pk"):
        entries.append({
            "id": str(movement.pk), "article": movement.item.name, "sku": movement.item.sku,
            "source": "department_return", "reference": returns[movement.reference_id],
            "date": movement.accounting_date.isoformat(), "quantity": str(-movement.quantity_in),
            "unit": movement.item.base_unit.abbreviation if movement.item.base_unit_id else movement.item.unit,
            "value": str(-movement.total_cost_snapshot) if movement.total_cost_snapshot is not None and movement.unit_cost_snapshot is not None else None,
        })
    missing = sum(entry["value"] is None for entry in entries)
    net = sum((Decimal(entry["value"]) for entry in entries if entry["value"] is not None), Decimal("0.0000"))
    return {"lines": entries, "missing_valuations": missing,
            "net_cost": str(net.quantize(Decimal("0.0001"))) if not missing else None,
            "closing_value": "0.0000"}


def _approve_department_costs(cycle, classifications):
    if not isinstance(classifications, dict):
        raise ValidationError("Supply department classifications as an object.")
    rows = list(cycle.inventories.filter(department__isnull=False))
    if set(classifications) - {str(row.pk) for row in rows}:
        raise ValidationError("Classification must refer to a department in this inventory.")
    for row in rows:
        evidence = _department_cost(row)
        classification = classifications.get(str(row.pk), "")
        if evidence["missing_valuations"]:
            raise ValidationError(f"{row.location_name}: resolve missing historical consumption costs.")
        if classification not in ("", "expense", "cost_of_sales"):
            raise ValidationError(f"{row.location_name}: select Expense or Cost of sales.")
        if evidence["lines"] and not classification:
            raise ValidationError(f"{row.location_name}: Finance must classify the recorded departmental cost.")
        row.department_cost_snapshot = {**evidence, "classification": classification}
        row.save(update_fields=["department_cost_snapshot"])


def _verify_department_costs(cycle):
    for row in cycle.inventories.filter(department__isnull=False):
        current = _department_cost(row)
        saved = row.department_cost_snapshot
        if not saved and not current["lines"]:
            continue  # compatibility for a previously approved empty department
        if {key: saved.get(key) for key in current} != current:
            raise ValidationError(f"{row.location_name}: departmental cost evidence changed. Reopen and obtain fresh Finance approval.")


def _cycle_data(cycle):
    inventories = []
    total_difference, total_closing = Decimal("0.0000"), Decimal("0.0000")
    all_counted = True
    for row in cycle.inventories.all():
        consumption = row.department_id is not None
        lines = []
        difference_total, closing_total = Decimal("0.0000"), Decimal("0.0000")
        if not consumption and not row.submitted_at:
            all_counted = False
        for record in row.count_snapshot:
            line = {key: record[key] for key in ("id", "article", "sku", "item_group", "unit", "physical_quantity", "note")}
            line["batch_required"] = record.get("batch_required", False)
            line["batches"] = [
                {key: batch[key] for key in ("id", "batch_number", "expiry_date", "physical_quantity")}
                for batch in record.get("batches", [])
            ]
            if row.submitted_at:
                for visible, batch in zip(line["batches"], record.get("batches", [])):
                    visible["system_quantity"] = batch["system_quantity"]
                actual = Decimal(record["physical_quantity"])
                theoretical = Decimal(record["system_quantity"])
                cost = Decimal(record["unit_cost"])
                variance_value = ((actual - theoretical) * cost).quantize(Decimal("0.0001"))
                closing_value = (actual * cost).quantize(Decimal("0.0001"))
                difference_total += variance_value
                closing_total += closing_value
                line.update(system_quantity=str(theoretical), unit_cost=str(cost),
                            variance=str(actual - theoretical),
                            variance_value=str(variance_value), closing_value=str(closing_value))
            lines.append(line)
        state = "booked" if cycle.status == "booked" else ("zero_planned" if consumption else
                "submitted" if row.submitted_at else "counting" if row.prepared_at else "count_pending")
        total_difference += difference_total
        total_closing += closing_total
        inventories.append({
            "difference_value": str(difference_total) if consumption or row.submitted_at else None,
            "closing_value": str(closing_total) if consumption or row.submitted_at else None,
            "id": row.pk, "location_name": row.location_name,
            "store": str(row.store_id) if row.store_id else None,
            "department": str(row.department_id) if row.department_id else None,
            "treatment": "consumption_zero" if consumption else "physical_count",
            "department_cost": (row.department_cost_snapshot or (_department_cost(row) if cycle.status == "planned" else None)) if consumption else None,
            "closing_quantity": "0.0000" if consumption else None,
            "status": state, "booked": cycle.status == "booked", "lines": lines,
            "stock_count": str(row.stock_count_id) if row.stock_count_id else None,
        })
    return {
        "id": cycle.pk, "branch": str(cycle.branch_id), "cutoff": cycle.cutoff.isoformat(),
        "memo_reference": cycle.memo_reference, "memo": cycle.memo,
        "status": cycle.status, "inventories": inventories, "approval_note": cycle.approval_note,
        "total_difference_value": str(total_difference) if all_counted else None,
        "total_closing_value": str(total_closing) if all_counted else None,
        "approved_at": cycle.approved_at, "booked_at": cycle.booked_at,
    }


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def month_end_cycles(request):
    employee = _employee(request.user, write=request.method == "POST")
    if request.method == "GET":
        cycles = MonthEndCycle.objects.filter(branch_id=employee.branch_id).prefetch_related("inventories")
        return Response([_cycle_data(cycle) for cycle in cycles])

    serializer = MonthEndPlanInput(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    with transaction.atomic():
        branch = Branch.objects.select_for_update().get(pk=employee.branch_id, is_active=True)
        period = FiscalPeriod.objects.select_for_update().filter(
            branch=branch, start_date__lte=data["cutoff"], end_date__gte=data["cutoff"],
        ).first()
        if period and period.status != FiscalPeriod.STATUS_OPEN:
            raise ValidationError("The inventory month is closed.")
        if MonthEndCycle.objects.filter(branch=branch, cutoff=data["cutoff"]).exists():
            raise ValidationError({"cutoff": "A month-end roster already exists for this property and month."})
        stores = list(StoreLocation.objects.filter(branch=branch, is_active=True, is_virtual_transit=False))
        # Department is a global master, without a branch FK. Only the explicitly
        # confirmed property roster is selected; names and employees do not
        # establish whether a department holds stock.
        departments = list(Department.objects.filter(pk__in=data["consumption_department_ids"], is_active=True))
        if len(departments) != len(data["consumption_department_ids"]):
            raise ValidationError({"consumption_department_ids": "Select valid active departments."})
        if not stores and not departments:
            raise ValidationError("Configure at least one inventory location first.")
        cycle = MonthEndCycle.objects.create(
            branch=branch, cutoff=data["cutoff"], memo_reference=data["memo_reference"],
            memo=data["memo"], created_by=request.user,
        )
        MonthEndInventory.objects.bulk_create(
            [MonthEndInventory(cycle=cycle, store=store, location_name=store.name) for store in stores]
            + [MonthEndInventory(cycle=cycle, department=dept, location_name=dept.name) for dept in departments]
        )
        notify_roles(
            ("Department Head", "Financial Manager"),
            title=f"Month-end stocktake: {cycle.cutoff:%d %b %Y}",
            message=f"Official memo {cycle.memo_reference}: {cycle.memo}",
            branch=branch, created_by=request.user,
            deduplication_key=f"month-end-memo:{cycle.pk}",
        )
    return Response(_cycle_data(cycle), status=status.HTTP_201_CREATED)


class BatchCountInput(serializers.Serializer):
    id = serializers.UUIDField()
    physical_quantity = serializers.DecimalField(max_digits=14, decimal_places=4, min_value=Decimal("0"))


class CountInput(serializers.Serializer):
    id = serializers.UUIDField()
    physical_quantity = serializers.DecimalField(max_digits=14, decimal_places=4, min_value=Decimal("0"))
    batches = BatchCountInput(many=True, required=False, default=list)


class NoteInput(serializers.Serializer):
    id = serializers.UUIDField()
    note = serializers.CharField(max_length=2000)


def _period(cycle, *, allow_later=False):
    period = FiscalPeriod.objects.select_for_update().filter(
        branch_id=cycle.branch_id, start_date__lte=cycle.cutoff, end_date=cycle.cutoff,
    ).first()
    if not period or period.status != FiscalPeriod.STATUS_OPEN:
        raise ValidationError("Configure an open fiscal period ending on the inventory cutoff.")
    today = timezone.localdate()
    if cycle.cutoff > today or (cycle.cutoff < today and not allow_later):
        raise ValidationError("Prepare and submit physical counts on the cutoff business date.")
    if cycle.cutoff < today:
        # A later review/booking may use ONLY a completed cutoff snapshot.
        # No reconstruction from live stock or intervening movements.
        rows = cycle.inventories.filter(store__isnull=False)
        if rows.filter(submitted_at__isnull=True).exists() or rows.exclude(submitted_at__date=cycle.cutoff).exists():
            raise ValidationError("A complete physical count submitted on the cutoff date is required for later booking.")
        if StockLedger.objects.filter(store__branch_id=cycle.branch_id,
                                     created_at__date__gt=cycle.cutoff).exists():
            raise ValidationError("Stock moved after the cutoff. Finance must resolve the intervening transactions before booking.")
        if FiscalPeriod.objects.filter(branch_id=cycle.branch_id, start_date__gt=cycle.cutoff,
                                       start_date__lte=today, status=FiscalPeriod.STATUS_CLOSED).exists():
            raise ValidationError("A subsequent period is closed; delayed booking is not permitted.")
    return period


def _balances(row):
    return list(InventoryBalance.objects.select_for_update(of=("self",)).filter(store_id=row.store_id)
                .select_related("item__category", "item__base_unit").order_by("pk"))


def _batches(row, item_id):
    return list(InventoryBatch.objects.select_for_update().filter(
        store_id=row.store_id, item_id=item_id,
    ).order_by("pk"))


def _snapshot(row):
    records = []
    for b in _balances(row):
        batches = _batches(row, b.item_id)
        required = bool(batches or b.item.batch_tracking or b.item.expiry_tracking)
        records.append({
            "batch_required": required,
            "batches": [{
                "id": str(batch.pk), "batch_number": batch.batch_number,
                "expiry_date": batch.expiry_date.isoformat() if batch.expiry_date else None,
                "system_quantity": str(batch.remaining_quantity),
                "received_quantity": str(batch.quantity),
                "updated_at": batch.updated_at.isoformat(), "physical_quantity": None,
            } for batch in batches],
            "id": str(b.pk), "article": b.item.name, "sku": b.item.sku,
            "item_group": b.item.category.name,
            "unit": (b.item.base_unit.abbreviation or b.item.base_unit.name) if b.item.base_unit else b.item.unit,
            "system_quantity": str(b.quantity_in_stock), "unit_cost": str(b.weighted_average_cost),
            "updated_at": b.updated_at.isoformat(), "physical_quantity": None, "note": "",
        })
    return sorted(records, key=lambda line: (line["item_group"].casefold(), line["article"].casefold(), line["id"]))


def _verify(row, *, review=False):
    balances = {str(b.pk): b for b in _balances(row)}
    if set(balances) != {line["id"] for line in row.count_snapshot}:
        raise ValidationError(f"{row.location_name}: article roster changed. Refresh and recount.")
    for line in row.count_snapshot:
        b = balances[line["id"]]
        if (b.quantity_in_stock != Decimal(line["system_quantity"])
                or b.weighted_average_cost != Decimal(line["unit_cost"])
                or b.updated_at.isoformat() != line["updated_at"]):
            raise ValidationError(f"{row.location_name}: {line['article']} changed. Refresh and recount.")
        if line["physical_quantity"] is None:
            raise ValidationError("Count every article, including explicit zeros.")
        actual = Decimal(line["physical_quantity"])
        live_batches = {str(batch.pk): batch for batch in _batches(row, b.item_id)}
        saved_batches = line.get("batches", [])
        required = bool(live_batches or b.item.batch_tracking or b.item.expiry_tracking)
        if required != line.get("batch_required", False) or set(live_batches) != {batch["id"] for batch in saved_batches}:
            raise ValidationError(f"{line['article']}: batch roster changed. Refresh and recount.")
        batch_difference = False
        if required:
            if sum((batch.remaining_quantity for batch in live_batches.values()), Decimal("0")) != b.quantity_in_stock:
                raise ValidationError(f"{line['article']}: existing batch and stock balances do not reconcile.")
            batch_total = Decimal("0")
            for saved in saved_batches:
                batch = live_batches[saved["id"]]
                if (batch.updated_at.isoformat() != saved["updated_at"]
                        or batch.remaining_quantity != Decimal(saved["system_quantity"])
                        or batch.quantity != Decimal(saved["received_quantity"])):
                    raise ValidationError(f"{line['article']}: batch changed. Refresh and recount.")
                if saved["physical_quantity"] is None:
                    raise ValidationError(f"{line['article']}: count each known batch explicitly.")
                quantity = Decimal(saved["physical_quantity"])
                if quantity > batch.quantity:
                    raise ValidationError(f"{line['article']}: batch count exceeds documented receipt quantity; reconcile provenance first.")
                batch_total += quantity
                batch_difference |= quantity != batch.remaining_quantity
            if batch_total != actual:
                raise ValidationError(f"{line['article']}: physical batch quantities must equal article physical quantity.")
        if not review:
            continue
        difference = actual - b.quantity_in_stock
        if (difference or batch_difference) and not line["note"].strip():
            raise ValidationError(f"{line['article']}: record a variance investigation note.")
        if actual < b.quantity_reserved + b.quantity_quarantined:
            raise ValidationError(f"{line['article']}: resolve reserved/quarantined stock first.")
        if (actual or b.quantity_in_stock) and b.weighted_average_cost <= 0:
            raise ValidationError(f"{line['article']}: establish a verified inventory valuation first.")
        if batch_difference and b.quantity_quarantined:
            raise ValidationError(f"{line['article']}: resolve quarantined batch stock before booking.")
    return balances


def _review(cycle, period):
    rows = list(cycle.inventories.all())
    current = set(StoreLocation.objects.filter(branch_id=cycle.branch_id, is_active=True,
                                               is_virtual_transit=False).values_list("pk", flat=True))
    if current != {row.store_id for row in rows if row.store_id}:
        raise ValidationError("The active store roster changed; reconcile the location register before booking.")
    for row in rows:
        if row.store_id:
            if not row.submitted_at:
                raise ValidationError(f"{row.location_name}: submit the physical inventory first.")
            _verify(row, review=True)
    check = period.pre_close_checklist()
    for field in ("open_grns", "open_transfers", "open_issue_transits", "open_stock_counts", "unresolved_pos_imports"):
        if check[field]:
            raise ValidationError(f"Resolve {field.replace('_', ' ')} ({check[field]}) before booking.")


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def month_end_action(request, pk, operation):
    finance = operation == "approve"
    employee = _employee(request.user, write=not finance)
    if finance and (not request.user.groups.filter(name="Financial Manager").exists()
                    or request.user.groups.filter(name="Cost Controller").exists()):
        raise PermissionDenied("Independent Financial Manager approval is required.")
    with transaction.atomic():
        cycle = MonthEndCycle.objects.filter(pk=pk, branch_id=employee.branch_id).first()
        if not cycle:
            raise PermissionDenied("Inventory is outside your assigned property.")
        period = _period(cycle, allow_later=operation in ("approve", "book", "investigate", "reopen"))
        cycle = MonthEndCycle.objects.select_for_update().get(pk=cycle.pk)
        if cycle.status == "booked":
            raise ValidationError("Booked inventories are immutable.")
        if operation == "reopen":
            if cycle.status != "approved":
                raise ValidationError("Only an approved unbooked inventory can be reopened.")
            cycle.inventories.filter(department__isnull=False).update(department_cost_snapshot={})
            cycle.status, cycle.approved_by, cycle.approved_at, cycle.approval_note = "planned", None, None, ""
            cycle.save(update_fields=["status", "approved_by", "approved_at", "approval_note"])
        elif operation == "approve":
            if cycle.status != "planned" or cycle.created_by_id == request.user.pk:
                raise PermissionDenied("You cannot approve your own or already approved inventory.")
            note = serializers.CharField(max_length=2000).run_validation(request.data.get("note"))
            _review(cycle, period)
            _approve_department_costs(cycle, request.data.get("department_classifications", {}))
            cycle.status, cycle.approved_by, cycle.approved_at, cycle.approval_note = "approved", request.user, timezone.now(), note
            cycle.save(update_fields=["status", "approved_by", "approved_at", "approval_note"])
        elif operation == "book":
            if cycle.status != "approved" or cycle.approved_by_id == request.user.pk:
                raise ValidationError("Independent Finance approval is required before booking.")
            _review(cycle, period)
            _verify_department_costs(cycle)
            approver = getattr(cycle.approved_by, "employee_profile", None)
            if (not approver or not approver.is_active or approver.branch_id != cycle.branch_id
                    or not cycle.approved_by.is_active or not cycle.approved_by.groups.filter(name="Financial Manager").exists()):
                raise ValidationError("Finance approver is no longer authorized for this property.")
            for row in cycle.inventories.filter(store__isnull=False):
                balances = _verify(row, review=True)
                if not row.count_snapshot:
                    continue
                count = StockCount.objects.create(
                    count_no=f"ME-{cycle.cutoff:%Y%m}-{row.pk}", store_id=row.store_id,
                    conducted_by=employee, created_by=request.user, note=f"Month-end inventory {cycle.memo_reference}",
                )
                # auto_now_add records the creation date; preserve the
                # evidenced inventory business date separately from created_at.
                StockCount.objects.filter(pk=count.pk).update(count_date=cycle.cutoff)
                count.count_date = cycle.cutoff
                StockCountItem.objects.bulk_create([
                    StockCountItem(stock_count=count, item_id=balances[line["id"]].item_id,
                                   system_quantity=Decimal(line["system_quantity"]),
                                   physical_quantity=Decimal(line["physical_quantity"]),
                                   note=line["note"], created_by=request.user) for line in row.count_snapshot
                ])
                try:
                    count.submit()
                    count.approve(approved_by=approver)
                    count.apply_variances(month_end_cutoff=cycle.cutoff)
                    # Batch adjustments are part of the same transaction as the
                    # aggregate variance ledger. Preserve receipt/expiry evidence.
                    for line in row.count_snapshot:
                        for saved in line.get("batches", []):
                            batch = InventoryBatch.objects.select_for_update().get(
                                pk=saved["id"], store_id=row.store_id,
                                item_id=balances[line["id"]].item_id,
                            )
                            actual = Decimal(saved["physical_quantity"])
                            if batch.remaining_quantity != actual:
                                batch.remaining_quantity = actual
                                batch.save(update_fields=["remaining_quantity", "updated_at"])
                except DjangoValidationError as exc:
                    raise ValidationError(exc.messages)
                row.stock_count = count
                row.save(update_fields=["stock_count"])
            cycle.status, cycle.booked_by, cycle.booked_at = "booked", request.user, timezone.now()
            cycle.save(update_fields=["status", "booked_by", "booked_at"])
        elif operation in ("prepare", "refresh", "save-count", "submit", "investigate"):
            if cycle.status != "planned":
                raise ValidationError("Reopen the approved inventory before editing.")
            row_id = serializers.IntegerField(min_value=1).run_validation(request.data.get("inventory"))
            row = cycle.inventories.filter(pk=row_id, store__isnull=False).first()
            if not row:
                raise ValidationError("Select a physical inventory in this cycle.")
            if operation in ("prepare", "refresh"):
                if operation == "prepare" and row.prepared_at:
                    raise ValidationError("Inventory already prepared.")
                if operation == "refresh" and request.data.get("discard_counts") is not True:
                    raise ValidationError("Confirm refresh discards the prior counts and requires recount.")
                row.count_snapshot, row.prepared_at, row.submitted_at = _snapshot(row), timezone.now(), None
            elif operation == "investigate":
                if not row.submitted_at:
                    raise ValidationError("Submit the blind count before investigating variances.")
                payload = NoteInput(data=request.data.get("lines"), many=True, allow_empty=False)
                payload.is_valid(raise_exception=True)
                updates = {str(line["id"]): line["note"] for line in payload.validated_data}
                if len(updates) != len(payload.validated_data) or not set(updates).issubset({line["id"] for line in row.count_snapshot}):
                    raise ValidationError("Select distinct articles in this inventory.")
                for line in row.count_snapshot:
                    if line["id"] in updates:
                        line["note"] = updates[line["id"]]
            elif not row.prepared_at or row.submitted_at:
                raise ValidationError("Prepare an editable inventory first.")
            elif operation == "save-count":
                payload = CountInput(data=request.data.get("lines"), many=True, allow_empty=False)
                payload.is_valid(raise_exception=True)
                updates = {str(line["id"]): line for line in payload.validated_data}
                if len(updates) != len(payload.validated_data) or not set(updates).issubset({line["id"] for line in row.count_snapshot}):
                    raise ValidationError("Select distinct articles in this inventory.")
                for line in row.count_snapshot:
                    if line["id"] in updates:
                        entry = updates[line["id"]]
                        batch_values = {str(batch["id"]): str(batch["physical_quantity"]) for batch in entry["batches"]}
                        existing = {batch["id"] for batch in line.get("batches", [])}
                        if len(batch_values) != len(entry["batches"]) or set(batch_values) != existing:
                            raise ValidationError(f"{line['article']}: provide every known batch exactly once.")
                        for batch in line.get("batches", []):
                            batch["physical_quantity"] = batch_values[batch["id"]]
                        line["physical_quantity"] = str(entry["physical_quantity"])
            elif operation == "submit":
                if not row.count_snapshot and request.data.get("confirm_empty") is not True:
                    raise ValidationError("Confirm the physical location is empty.")
                _verify(row)
                row.submitted_at = timezone.now()
            row.save(update_fields=["count_snapshot", "prepared_at", "submitted_at"])
            if operation == "submit" and not cycle.inventories.filter(store__isnull=False, submitted_at__isnull=True).exists():
                notify_roles(
                    ("Financial Manager",),
                    title=f"Month-end physical counts submitted: {cycle.cutoff:%d %b %Y}",
                    message="Cost Control has submitted all physical counts. Review inventory differences and investigation notes before approval.",
                    branch=cycle.branch, created_by=request.user,
                    deduplication_key=f"month-end-review:{cycle.pk}",
                )
        else:
            raise ValidationError("Unknown month-end action.")
    return Response(_cycle_data(cycle))


def _location_closing(row):
    return sum(
        ((Decimal(line["physical_quantity"]) * Decimal(line["unit_cost"])).quantize(Decimal("0.0001"))
         for line in row.count_snapshot), Decimal("0.0000"),
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def month_end_reconciliation(request, pk):
    """Read-only cost evidence. Missing opening balances never become zero."""
    employee = _employee(request.user, write=False)
    cycle = MonthEndCycle.objects.filter(pk=pk, branch_id=employee.branch_id, status="booked").first()
    if not cycle:
        raise ValidationError("Select a booked month-end inventory in your property.")
    start = cycle.cutoff.replace(day=1)
    previous = MonthEndCycle.objects.filter(
        branch_id=cycle.branch_id, cutoff=start - timedelta(days=1), status="booked",
    ).first()
    opening_rows = {row.store_id: row for row in previous.inventories.filter(store__isnull=False)} if previous else {}
    closing_rows = {row.store_id: row for row in cycle.inventories.filter(store__isnull=False)}
    blockers = []
    if not previous:
        blockers.append("Previous month has no booked opening inventory. Obtain independently verified opening evidence.")
    if previous and set(opening_rows) != set(closing_rows):
        blockers.append("Physical location roster changed between months. Reconcile location openings and closures.")
    movements = {}
    for move in StockLedger.objects.with_accounting_date().filter(
        store__branch_id=cycle.branch_id,
        accounting_date__range=(start, cycle.cutoff),
    ).values("store_id", "reference_type", "quantity_in", "quantity_out", "total_cost_snapshot", "unit_cost_snapshot"):
        location = move["store_id"]
        bucket = movements.setdefault(location, {})
        record = bucket.setdefault(move["reference_type"], {"in": Decimal("0.0000"), "out": Decimal("0.0000"), "missing": 0})
        if move["total_cost_snapshot"] is None or move["unit_cost_snapshot"] is None:
            record["missing"] += 1
        else:
            record["in" if move["quantity_in"] > 0 else "out"] += move["total_cost_snapshot"]
    rows = []
    for store_id in sorted(set(opening_rows) | set(closing_rows) | set(movements), key=str):
        opening = opening_rows.get(store_id)
        closing = closing_rows.get(store_id)
        by_source = movements.get(store_id, {})
        value_in = sum((source["in"] for source in by_source.values()), Decimal("0.0000"))
        value_out = sum((source["out"] for source in by_source.values()), Decimal("0.0000"))
        unknown = sum(source["missing"] for source in by_source.values())
        location = closing.location_name if closing else opening.location_name if opening else str(store_id)
        a = _location_closing(opening) if opening else None
        b = _location_closing(closing) if closing else None
        difference = (a + value_in - value_out - b) if a is not None and b is not None and not unknown else None
        if unknown:
            blockers.append(f"{location}: {unknown} movement(s) lack historical cost evidence.")
        if not closing or not opening:
            blockers.append(f"{location}: booked opening or closing inventory is missing.")
        if difference is not None and abs(difference) > Decimal("0.01"):
            blockers.append(f"{location}: unexplained value difference {difference}.")
        rows.append({
            "location": location,
            "opening_value": str(a) if a is not None else None,
            "valued_receipts": str(value_in), "valued_issues": str(value_out),
            "closing_value": str(b) if b is not None else None,
            "difference": str(difference) if difference is not None else None,
            "unvalued_movements": unknown,
            "movement_categories": {key: {"in": str(value["in"]), "out": str(value["out"]), "missing": value["missing"]}
                                    for key, value in sorted(by_source.items())},
        })
    # Direct receipts bypass physical stock. Present their recorded expense
    # separately; never add them to stock issues or ledger receipts again.
    direct = {}
    for expense in DepartmentConsumption.objects.filter(
        goods_receipt_item__goods_receipt__purchase_order__requisition__branch_id=cycle.branch_id,
        consumed_on__range=(start, cycle.cutoff),
    ).select_related("department"):
        key = expense.department.name
        direct[key] = direct.get(key, Decimal("0.0000")) + expense.total_cost
    return Response({
        "cutoff": cycle.cutoff.isoformat(),
        "previous_cutoff": previous.cutoff.isoformat() if previous else None,
        "locations": rows,
        "direct_department_expenses": [{"department": key, "amount": str(value)} for key, value in sorted(direct.items())],
        "department_costs": [{"department": row.location_name, **row.department_cost_snapshot} for row in cycle.inventories.filter(department__isnull=False) if row.department_cost_snapshot],
        "blockers": list(dict.fromkeys(blockers)),
        "reconciled": not blockers,
        "note": "Read-only inventory value reconciliation, not a certified food/beverage cost-of-sales or general ledger statement. Transfers, returns, expenses and POS depletion are distinct movement categories.",
    })
