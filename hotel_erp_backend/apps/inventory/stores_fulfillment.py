"""Sprint 1 Storekeeper posting and physically balanced transit fulfillment.

A fiscal period must be configured and OPEN before a GRN or internal issue moves
stock. Each transition locks the business document and source balances. The
immutable StockLedger records both sides of dispatch and the final pickup.
"""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import logging

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.inventory.models import (
    DepartmentConsumption, InventoryBalance, StockIssue, StockIssueItem,
    StockLedger, StoreKeeperAssignment, StoreLocation, StoreRequisition,
)
from apps.materials_control.models import FiscalPeriod
from apps.procurement.models import GoodsReceiptNote
from core.constants.choices import (
    GoodsReceiptStatus, LedgerReferenceType, StoreRequisitionStatus,
)

CENT = Decimal("0.01")
FOUR = Decimal("0.0001")
TRANSIT_NAME = "Virtual Transit Store — Internal Dispatch"


def _positive_decimal(value, *, allow_zero=False):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValidationError("Enter a valid base-unit quantity.") from error
    if not number.is_finite() or number < 0 or (number == 0 and not allow_zero):
        raise ValidationError("Quantities must be finite and non-negative.")
    if number.as_tuple().exponent < -4:
        raise ValidationError("Quantities support at most four decimal places.")
    return number


def require_open_period(branch_id, business_date):
    """Lock the target period so a concurrent period-close cannot overtake posting."""
    if not branch_id:
        raise ValidationError("A property is required to post inventory.")
    period = FiscalPeriod.objects.select_for_update().filter(
        branch_id=branch_id,
        start_date__lte=business_date,
        end_date__gte=business_date,
    ).first()
    if not period:
        raise ValidationError(
            f"Configure an OPEN fiscal period for {business_date} before posting inventory."
        )
    if period.status != FiscalPeriod.STATUS_OPEN:
        raise ValidationError(f"Fiscal period {period.name} is closed.")
    return period


@transaction.atomic
def post_grn_to_inventory(receipt_id, keeper):
    """Verify and post accepted GRN base quantities, updating per-store WAC."""
    # Avoid locking nullable FK outer joins: PostgreSQL rejects FOR UPDATE
    # on the nullable side of an outer join.
    receipt = GoodsReceiptNote.objects.select_for_update().get(pk=receipt_id)
    if receipt.status not in (GoodsReceiptStatus.RECEIVED, GoodsReceiptStatus.INSPECTED):
        raise ValidationError("Only a received, unposted GRN can be posted.")
    require_open_period(receipt.purchase_order.requisition.branch_id, receipt.received_date)
    if not receipt.posting_readiness()["can_proceed"]:
        raise ValidationError(receipt.posting_readiness()["blockers"])
    # All lines must be within assigned stores, not merely any one of them.
    assigned = set(StoreKeeperAssignment.objects.filter(
        employee=keeper, is_active=True,
    ).values_list("store_id", flat=True))
    if receipt.items.exclude(store__isnull=True).exclude(store_id__in=assigned).exists():
        raise ValidationError("Every destination must be one of the Storekeeper's assigned stores.")
    receipt.post_to_inventory(posted_by=keeper)
    receipt.refresh_from_db()
    return receipt


def _require_store_assignment(store, keeper):
    if not keeper or not keeper.is_active:
        raise ValidationError("An active Storekeeper is required.")
    if not StoreKeeperAssignment.objects.filter(
        store=store, employee=keeper, is_active=True,
    ).exists():
        raise ValidationError("The Storekeeper must be assigned to the issuing store.")


@transaction.atomic
def fulfill_requisition(request_id, keeper, actor, quantities=None):
    """Dispatch an approved requisition into the property's virtual transit store.

    `quantities` is a dict of requisition-line UUID to desired BASE quantity.
    A zero quantity is allowed for a short line; at least one line must dispatch.
    """
    req = StoreRequisition.objects.select_for_update().get(pk=request_id)
    if req.status not in (
        StoreRequisitionStatus.APPROVED,
        StoreRequisitionStatus.PARTIALLY_ISSUED,
        StoreRequisitionStatus.AWAITING_PROCUREMENT,
    ):
        raise ValidationError("Only Cost-Control-approved requests can be dispatched.")
    if not req.store_id or not req.store.is_active:
        raise ValidationError("The issuing store must be active.")
    _require_store_assignment(req.store, keeper)
    require_open_period(req.store.branch_id, timezone.localdate())
    if StockIssue.objects.filter(
        requisition=req, fulfillment_status=StockIssue.STATUS_TRANSIT,
    ).exists():
        raise ValidationError("An issue is already in transit; wait for pickup before dispatching more.")

    lines = list(req.items.select_for_update().select_related("item").order_by("item__name"))
    if not lines:
        raise ValidationError("An internal request must contain at least one Article.")
    valid = {
        str(row.pk) for row in lines
        if row.quantity_approved > row.quantity_issued
    }
    supplied = quantities is not None
    if supplied and (not isinstance(quantities, dict) or set(quantities) != valid):
        raise ValidationError("Confirm a base-unit quantity for every outstanding Article.")
    prepared = []
    for line in lines:
        outstanding = max(line.quantity_approved - line.quantity_issued, Decimal("0"))
        quantity = _positive_decimal(
            quantities[str(line.pk)] if supplied and outstanding > 0 else outstanding,
            allow_zero=True,
        )
        if quantity > outstanding:
            raise ValidationError(f"Issue quantity for {line.item} exceeds the approved outstanding quantity.")
        if quantity > 0:
            prepared.append((line, quantity))
    if not prepared:
        raise ValidationError("Dispatch at least one approved Article quantity.")

    transit_store, _ = StoreLocation.objects.get_or_create(
        branch=req.store.branch, name=TRANSIT_NAME,
        defaults={"is_active": False, "is_default": False, "is_virtual_transit": True},
    )
    if not transit_store.is_virtual_transit:
        if not transit_store.is_active and not transit_store.is_default:
            transit_store.is_virtual_transit = True
            transit_store.save(update_fields=["is_virtual_transit", "updated_at"])
        else:
            raise ValidationError("A regular location cannot be reused for virtual transit.")
    if transit_store.is_active or transit_store.is_default:
        raise ValidationError("The reserved virtual transit location cannot be a regular issuing store.")

    existing = StockIssue.objects.select_for_update().filter(
        requisition=req, inventory_changes_applied=False,
    ).order_by("-created_at").first()
    if existing:
        existing.items.all().delete()  # Draft picking lines only, never posted lines.
        issue = existing
        issue.transit_store = transit_store
        issue.fulfillment_status = StockIssue.STATUS_PACKED
        issue.issued_by = keeper
        issue.save(update_fields=[
            "transit_store", "fulfillment_status", "issued_by", "updated_at"
        ])
    else:
        issue = StockIssue.objects.create(
            requisition=req, store=req.store, issued_by=keeper,
            transit_store=transit_store, fulfillment_status=StockIssue.STATUS_PACKED,
            note=f"Packing list for {req.requisition_no}; awaiting dispatch",
            created_by=actor,
        )
    for line, quantity in prepared:
        balance = InventoryBalance.objects.select_for_update().filter(
            store=req.store, item=line.item
        ).first()
        if not balance or balance.quantity_in_stock < quantity:
            raise ValidationError(
                f"{line.item} has insufficient physical stock; adjust its issued quantity."
            )
        transit_balance, _ = InventoryBalance.objects.select_for_update().get_or_create(
            store=transit_store, item=line.item,
            defaults={"quantity_in_stock": Decimal("0")},
        )
        stock_value = StockIssue._consume_batches(
            item=line.item, store=req.store, quantity=quantity,
        )
        unit_cost = balance.weighted_average_cost
        if unit_cost == 0 and stock_value > 0:
            unit_cost = (stock_value / quantity).quantize(FOUR, rounding=ROUND_HALF_UP)
        previous_transit = transit_balance.quantity_in_stock
        new_transit = previous_transit + quantity
        transit_balance.weighted_average_cost = (
            ((previous_transit * transit_balance.weighted_average_cost) + quantity * unit_cost)
            / new_transit
        ).quantize(FOUR, rounding=ROUND_HALF_UP)
        transit_balance.quantity_in_stock = new_transit
        transit_balance.save(update_fields=[
            "quantity_in_stock", "weighted_average_cost", "updated_at"
        ])
        balance.quantity_in_stock -= quantity
        balance.quantity_reserved = max(
            Decimal("0"), balance.quantity_reserved - quantity
        )
        balance.save(update_fields=[
            "quantity_in_stock", "quantity_reserved", "updated_at"
        ])
        line.quantity_issued += quantity
        line.save(update_fields=["quantity_issued", "updated_at"])
        StockIssueItem.objects.create(
            issue=issue, requisition_item=line,
            item=line.item, unit=line.item.base_unit,
            quantity=quantity, dispatched_unit_cost=unit_cost,
            created_by=actor,
        )
        for store, inbound in ((req.store, False), (transit_store, True)):
            StockLedger.objects.create(
                item=line.item, store=store,
                quantity_in=quantity if inbound else Decimal("0"),
                quantity_out=Decimal("0") if inbound else quantity,
                reference_type=LedgerReferenceType.TRANSIT_DISPATCH,
                reference_id=issue.pk,
                note=(
                    f"Dispatch {req.requisition_no} into virtual transit"
                    if inbound else f"Dispatch {req.requisition_no} out of {req.store}"
                ),
                created_by=actor,
            )

    issue.fulfillment_status = StockIssue.STATUS_TRANSIT
    issue.dispatched_at = timezone.now()
    issue.inventory_changes_applied = True
    issue.note = f"Dispatched for {req.department}; waiting for Supervisor pickup signature"
    issue.save(update_fields=[
        "fulfillment_status", "dispatched_at", "inventory_changes_applied",
        "note", "updated_at",
    ])
    req.mark_issued_if_complete()

    def notify_supervisor():
        try:
            from apps.notifications.services import notify_employee
            notify_employee(
                req.requested_by,
                title=f"{req.requisition_no} dispatched from Stores",
                message=(
                    f"Storekeeper dispatched issue {issue.issue_no}. "
                    "Check packed quantities and sign physical pickup in Incoming Stock."
                ),
                created_by=actor,
            )
        except Exception:
            logging.getLogger(__name__).exception(
                "Failed to notify department of dispatched issue %s", issue.pk
            )

    transaction.on_commit(notify_supervisor)
    return issue


@transaction.atomic
def complete_transit_pickup(issue_id, receiver, actor):
    """Consume only the actual in-transit stock upon the Supervisor's signature."""
    issue = StockIssue.objects.select_for_update().get(pk=issue_id)
    if issue.fulfillment_status != StockIssue.STATUS_TRANSIT or not issue.transit_store_id:
        raise ValidationError("Only dispatched transit issues can be received.")
    if issue.received_by_id or issue.received_by_name:
        raise ValidationError("This issue has already been signed.")
    if not receiver or not receiver.is_active or issue.requisition.requested_by_id != receiver.pk:
        raise ValidationError("Only the original requesting Supervisor can sign the pickup.")
    require_open_period(issue.store.branch_id, timezone.localdate())
    lines = list(issue.items.select_related("item", "requisition_item"))
    if not lines:
        raise ValidationError("No dispatched Articles are recorded.")
    for line in lines:
        balance = InventoryBalance.objects.select_for_update().get(
            store=issue.transit_store, item=line.item
        )
        if balance.quantity_in_stock < line.base_quantity:
            raise ValidationError(f"In-transit balance is short for {line.item}.")
        balance.quantity_in_stock -= line.base_quantity
        balance.save(update_fields=["quantity_in_stock", "updated_at"])
        StockLedger.objects.create(
            item=line.item, store=issue.transit_store,
            quantity_out=line.base_quantity,
            reference_type=LedgerReferenceType.TRANSIT_PICKUP,
            reference_id=issue.pk,
            note=f"Signed physical pickup {issue.issue_no}",
            created_by=actor,
        )
        DepartmentConsumption.objects.create(
            department=issue.requisition.department,
            stock_issue_item=line,
            item=line.item, quantity=line.base_quantity,
            unit_cost=line.dispatched_unit_cost,
            consumed_on=timezone.localdate(),
            purpose=issue.requisition.purpose,
            created_by=actor,
        )
    issue.received_by = receiver
    issue.received_by_name = receiver.user.get_full_name() or receiver.user.username
    issue.fulfillment_status = StockIssue.STATUS_COMPLETED
    issue.signed_at = timezone.now()
    issue.save(update_fields=[
        "received_by", "received_by_name", "fulfillment_status",
        "signed_at", "updated_at",
    ])
    # A dispatched issue is not a completed departmental request until the
    # supervisor signs, all lines are supplied and no handover is in transit.
    req = StoreRequisition.objects.select_for_update().get(pk=issue.requisition_id)
    if (
        req.status == StoreRequisitionStatus.ISSUED
        and req.items.exists()
        and all(line.quantity_issued >= line.quantity_approved for line in req.items.all())
        and not StockIssue.objects.filter(
            requisition=req, fulfillment_status=StockIssue.STATUS_TRANSIT,
        ).exists()
    ):
        req.status = StoreRequisitionStatus.COMPLETED
        req.save(update_fields=["status", "updated_at"])
    return issue
