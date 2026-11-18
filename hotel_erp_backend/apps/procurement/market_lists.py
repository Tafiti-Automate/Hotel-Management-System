"""Daily perishable Market Lists built on the EXISTING controlled PR approval route.

Only Department Heads originate and submit quantity-only Market Lists.
The server chooses valid, Cost-Control-published supplier prices for budget
estimation at submission time, never exposing prices to the requester's UI.
Purchasing independently selects suppliers and issues LPOs after approval.
"""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from django.db import models, transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework import status

from apps.inventory.models import Item, SupplierItemPrice, UnitOfMeasure
from apps.procurement.models import PurchaseRequisition, RequisitionItem
from core.constants.choices import ProcurementSource, PRStatus, RequisitionType

FOUR = Decimal("0.0001")
CENT = Decimal("0.01")
READ_ROLES = ("Department Head", "Procurement Manager", "Financial Manager", "Cost Controller")


def _authorized_employee(request, *, write=False):
    user = request.user
    if not user or not user.is_authenticated or not user.is_active:
        raise PermissionDenied("An active authenticated employee account is required.")
    # IT/admin cannot bypass the purchasing maker/checker workflow.
    if user.is_superuser or user.groups.filter(name="System Administrator").exists():
        raise PermissionDenied("System Administrators cannot operate Market Lists.")
    accepted = ("Department Head",) if write else READ_ROLES
    if not user.groups.filter(name__in=accepted).exists():
        raise PermissionDenied("Your operational role cannot access Daily Market Lists.")
    employee = getattr(user, "employee_profile", None)
    if (
        not employee or not employee.is_active
        or not employee.branch_id or not employee.department_id
    ):
        raise PermissionDenied("An active branch and department assignment is required.")
    return employee


def _scoped_requests(request, employee):
    queryset = PurchaseRequisition.objects.filter(
        procurement_source=ProcurementSource.MARKET_LIST,
    ).select_related("department", "requester", "branch").prefetch_related(
        "items__item", "items__unit",
    )
    if request.user.groups.filter(name="Department Head").exists():
        return queryset.filter(requester=employee)
    if request.user.groups.filter(name="Procurement Manager").exists():
        return queryset.filter(branch_id=employee.branch_id)
    hotel_id = getattr(employee.branch, "hotel_id", None)
    return queryset.filter(
        hotel_id=hotel_id
    ) if hotel_id else queryset.filter(branch_id=employee.branch_id)


def _render(requisition):
    """Never include estimates, suppliers, rate fields or prices in this payload."""
    return {
        "id": str(requisition.pk),
        "reference": requisition.requisition_number,
        "business_date": requisition.expected_date.isoformat() if requisition.expected_date else "",
        "department": str(requisition.department),
        "branch": str(requisition.branch),
        "status": requisition.status,
        "purpose": requisition.reason,
        "created_at": requisition.created_at.isoformat(),
        "lines": [{
            "item": str(line.item_id),
            "sku": line.item.sku,
            "article": line.item.name,
            "quantity": str(line.quantity),
            "unit": str(line.unit_id or ""),
            "unit_name": str(line.unit) if line.unit_id else "",
        } for line in requisition.items.all()],
    }


def _parse_quantity(value, position):
    try:
        quantity = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValidationError({"lines": f"Line {position} needs a valid quantity."}) from error
    if not quantity.is_finite() or quantity <= 0 or quantity > Decimal("9999999999"):
        raise ValidationError({"lines": f"Line {position} quantity must be positive and finite."})
    if quantity != quantity.quantize(FOUR):
        raise ValidationError({"lines": f"Line {position} quantity permits at most four decimal places."})
    return quantity


@transaction.atomic
def market_lists(request):
    employee = _authorized_employee(request, write=request.method == "POST")
    if request.method == "GET":
        rows = _scoped_requests(request, employee).order_by("-created_at")[:100]
        return Response({
            "business_date": timezone.localdate().isoformat(),
            "results": [_render(row) for row in rows],
        })

    entries = request.data.get("lines")
    purpose = str(request.data.get("purpose") or "").strip()
    if not purpose:
        raise ValidationError({"purpose": "Explain the day's perishable food requirements."})
    if not isinstance(entries, list) or not (1 <= len(entries) <= 50):
        raise ValidationError({"lines": "Enter between 1 and 50 unique perishable Articles."})

    prepared, seen = [], set()
    for index, entry in enumerate(entries, 1):
        if not isinstance(entry, dict):
            raise ValidationError({"lines": f"Line {index} must be an Article and quantity."})
        item = Item.objects.select_related("base_unit").filter(
            pk=entry.get("item"), is_active=True,
        ).first()
        if not item or not item.base_unit_id:
            raise ValidationError({"lines": f"Line {index} requires an active Article with a base unit."})
        if not (item.batch_tracking or item.expiry_tracking or item.requires_delivery_temperature):
            raise ValidationError({
                "lines": f"{item.name} is not configured for traceable perishable receiving."
            })
        if item.pk in seen:
            raise ValidationError({"lines": "An Article may only appear once on a daily Market List."})
        seen.add(item.pk)
        quantity = _parse_quantity(entry.get("quantity"), index)
        unit_id = entry.get("unit")
        unit = (
            UnitOfMeasure.objects.filter(pk=unit_id, is_active=True).first()
            if unit_id else item.base_unit
        )
        if not unit:
            raise ValidationError({"lines": f"Select an active purchase unit for {item.name}."})
        try:
            item.quantity_in_base_units(quantity, unit)
        except Exception as error:
            raise ValidationError({
                "lines": f"The selected unit for {item.name} is not an active conversion."
            }) from error
        prepared.append((item, unit, quantity))

    # The operational source is server-owned and cannot be supplied by a client.
    requisition = PurchaseRequisition.objects.create(
        request_type=RequisitionType.DEPARTMENT,
        procurement_source=ProcurementSource.MARKET_LIST,
        requester=employee,
        department=employee.department,
        branch=employee.branch,
        reason=purpose,
        created_by=request.user,
    )
    for item, unit, quantity in prepared:
        RequisitionItem.objects.create(
            requisition=requisition,
            item=item, unit=unit, quantity=quantity,
            estimated_unit_cost=Decimal("0.00"),
            created_by=request.user,
        )
    requisition.record_history(
        action="market_list_created", previous_status="", actor=request.user,
        metadata={"article_count": len(prepared), "business_date": timezone.localdate().isoformat()},
    )
    return Response(_render(requisition), status=status.HTTP_201_CREATED)


def _published_unit_estimate(requisition, line, business_date):
    quotes = SupplierItemPrice.objects.filter(
        item=line.item, is_active=True, supplier__is_active=True,
        effective_from__lte=business_date, currency=requisition.currency,
    ).filter(
        models.Q(quotation_valid_until__gte=business_date)
        | models.Q(quotation_valid_until__isnull=True)
    ).select_related("unit", "item").order_by("-is_preferred", "unit_price", "pk")
    for quote in quotes:
        try:
            supplier_factor = line.item.conversion_factor_for_unit(quote.unit)
            request_factor = line.item.conversion_factor_for_unit(line.unit)
            if supplier_factor <= 0 or request_factor <= 0:
                continue
            discounted = quote.unit_price * (
                Decimal("1") - quote.discount_percent / Decimal("100")
            )
            estimated_unit = (
                discounted * request_factor / supplier_factor
            ).quantize(CENT, rounding=ROUND_HALF_UP)
            if estimated_unit > 0:
                return estimated_unit
        except (ArithmeticError, ValueError):
            continue
    return None


@transaction.atomic
def submit_market_list(request, requisition):
    employee = _authorized_employee(request, write=True)
    requisition = PurchaseRequisition.objects.select_for_update().get(pk=requisition.pk)
    if requisition.procurement_source != ProcurementSource.MARKET_LIST:
        raise ValidationError("Only a Daily Market List can use this submission action.")
    if requisition.requester_id != employee.pk or requisition.branch_id != employee.branch_id:
        raise PermissionDenied("Only the originating Department Head can submit this Market List.")
    if requisition.status != PRStatus.DRAFT:
        raise ValidationError("Only a draft Market List can be submitted.")
    today = timezone.localdate()
    if requisition.expected_date != today:
        raise ValidationError("This Market List is from an earlier business day. Create a new daily list.")

    lines = list(requisition.items.select_for_update().select_related("item", "unit"))
    if not lines:
        raise ValidationError("Add perishable Articles before submission.")
    updates = []
    for line in lines:
        estimate = _published_unit_estimate(requisition, line, today)
        if estimate is None:
            raise ValidationError({
                "detail": "Commercial approval needed before this Market List can enter approval.",
                "article": line.item.name,
                "required_action": "Cost Controller must publish a current, same-currency supplier price.",
            })
        updates.append((line, estimate))
    for line, estimate in updates:
        line.estimated_unit_cost = estimate
        line.save(update_fields=["estimated_unit_cost", "updated_at"])
    # Reuse the pre-existing monetary approval matrix and hard-budget rules.
    requisition.submit(actor=request.user, market_list_validated=True)
    return Response(_render(requisition))
