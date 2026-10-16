"""Hardened Cost Controller approval endpoint for Department Requests.

The legacy viewset action performs the correct business checks, but production
approval must not fail because of secondary side effects. This endpoint keeps
the same workflow and quantity ceilings while making reservation and
notification handling deterministic.
"""
from decimal import Decimal, InvalidOperation
import logging

from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.inventory.department_request_v2 import (
    StoreRequisitionViewSet,
    emp,
    is_cost,
    operational_stores_for_user,
)
from apps.inventory.models import InventoryBalance, StoreRequisition, StoreRequisitionItem
from apps.notifications.services import notify_roles
from core.constants.choices import StoreRequisitionStatus

logger = logging.getLogger(__name__)


def _parse_decisions(payload):
    if not isinstance(payload, list) or not payload:
        raise ValidationError({"items": "Confirm every Article quantity."})
    decisions = {}
    for row in payload:
        try:
            line_id = str(row["id"])
            quantity = Decimal(str(row.get("approved_quantity", "")))
        except (KeyError, InvalidOperation, TypeError, ValueError):
            raise ValidationError({"items": "Invalid Article quantity decision."})
        decisions[line_id] = (
            quantity,
            str(row.get("reason") or "").strip(),
        )
    return decisions


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cost_control_approve(request, pk):
    requisition = (
        StoreRequisition.objects.select_related(
            "store__branch__hotel",
            "requested_by__branch__hotel",
            "department",
        )
        .filter(pk=pk)
        .first()
    )
    if requisition is None:
        raise NotFound("Department request was not found.")

    approver = emp(request.user)
    if not (is_cost(request.user) and approver):
        raise PermissionDenied("Only the Cost Controller can decide this stage.")
    if not requisition.store_id:
        raise ValidationError({"store": "This request has no issuing store."})

    allowed_store_ids = set(
        operational_stores_for_user(request.user).values_list("id", flat=True)
    )
    if requisition.store_id not in allowed_store_ids:
        raise PermissionDenied("Request is outside your hotel/property scope.")

    decisions = _parse_decisions(request.data.get("items"))
    now = timezone.now()

    with transaction.atomic():
        locked = (
            StoreRequisition.objects.select_for_update()
            .select_related("store__branch__hotel", "department")
            .get(pk=requisition.pk)
        )
        if locked.status != StoreRequisitionStatus.SUBMITTED:
            raise ValidationError(
                "Request is no longer awaiting Cost Control. Refresh the page."
            )

        lines = list(
            locked.items.select_for_update()
            .select_related("item", "item__base_unit")
            .order_by("pk")
        )
        if not lines:
            raise ValidationError("The Department request has no Articles.")

        reservation_totals = {}
        positive = False

        for line in lines:
            if str(line.pk) not in decisions:
                raise ValidationError(
                    {"items": f"Confirm the Cost Control quantity for {line.item}."}
                )

            quantity, reason = decisions[str(line.pk)]
            ceiling = line.department_approved_limit

            if quantity < Decimal("0") or quantity > ceiling:
                raise ValidationError(
                    {
                        "items": (
                            f"Cost Control cannot exceed the HOD-approved "
                            f"quantity {ceiling} for {line.item}."
                        )
                    }
                )
            if quantity < ceiling and not reason:
                raise ValidationError(
                    {"items": f"Enter a reason for reducing {line.item}."}
                )

            if quantity > Decimal("0"):
                balance = (
                    InventoryBalance.objects.select_for_update()
                    .filter(item=line.item, store=locked.store)
                    .first()
                )
                on_hand = balance.quantity_in_stock if balance else Decimal("0")
                reserved = balance.quantity_reserved if balance else Decimal("0")
                available = max(on_hand - reserved, Decimal("0"))
                if balance is None or available < quantity:
                    raise ValidationError(
                        {
                            "items": (
                                f"{line.item} has only {available} available in "
                                f"{locked.store}; {quantity} was entered."
                            )
                        }
                    )

                existing = reservation_totals.get(balance.pk)
                total = quantity + (existing[1] if existing else Decimal("0"))
                if total > available:
                    raise ValidationError(
                        {
                            "items": (
                                f"Combined approved quantity for {line.item} "
                                f"exceeds the {available} available in {locked.store}."
                            )
                        }
                    )
                reservation_totals[balance.pk] = (balance, total)
                positive = True

            StoreRequisitionItem.objects.filter(pk=line.pk).update(
                quantity_approved=quantity,
                rejection_stage="Cost Controller" if quantity == 0 else "",
                rejection_reason=reason if quantity < ceiling else "",
                rejected_at=now if quantity == 0 else None,
                rejected_by_id=request.user.pk if quantity == 0 else None,
                updated_at=now,
            )

        if not positive:
            raise ValidationError(
                "Approve at least one Article or reject the whole request."
            )

        for balance, quantity in reservation_totals.values():
            new_reserved = balance.quantity_reserved + quantity
            if new_reserved > balance.quantity_in_stock:
                raise ValidationError(
                    {
                        "items": (
                            f"Stock changed while you were reviewing {balance.item}. "
                            "Refresh and approve using the latest SOH."
                        )
                    }
                )
            InventoryBalance.objects.filter(pk=balance.pk).update(
                quantity_reserved=new_reserved,
                last_updated=now,
                updated_at=now,
            )

        updated = StoreRequisition.objects.filter(
            pk=locked.pk,
            status=StoreRequisitionStatus.SUBMITTED,
        ).update(
            status=StoreRequisitionStatus.APPROVED,
            approved_by=approver,
            approved_at=now,
            approval_comments=str(request.data.get("comments") or ""),
            rejection_reason="",
            updated_at=now,
        )
        if updated != 1:
            raise ValidationError(
                "This request changed while you were reviewing it. Refresh and try again."
            )

    requisition.refresh_from_db()

    try:
        branch = requisition.store.branch
        notify_roles(
            ("Store Keeper",),
            title=f"{requisition.requisition_no} approved for Stores",
            message="Prepare the transfer document and reserved Articles for pickup.",
            hotel=branch.hotel if getattr(branch, "hotel_id", None) else None,
            branch=None if getattr(branch, "hotel_id", None) else branch,
            created_by=request.user,
        )
    except Exception:
        logger.exception(
            "Store Keeper notification failed after Cost Control approval for %s",
            requisition.pk,
        )

    return Response(StoreRequisitionViewSet._request(requisition))
