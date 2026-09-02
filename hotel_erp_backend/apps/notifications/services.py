from collections.abc import Iterable
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.employees.models import Employee
from apps.inventory.models import InventoryBatch, StoreKeeperAssignment
from apps.notifications.models import Notification


def notify_employee(employee, *, title, message, created_by=None):
    """Create a personal alert only for an active employee account."""
    if (
        employee is None
        or not employee.is_active
        or not employee.user.is_active
    ):
        return None
    return Notification.objects.create(
        employee=employee,
        title=title,
        message=message,
        created_by=created_by,
    )


def _expiry_alert_state(days_remaining):
    if days_remaining < 0:
        return "expired"
    if days_remaining == 0:
        return "expires_today"
    for threshold in (7, 30, settings.INVENTORY_EXPIRY_WARNING_DAYS):
        if days_remaining <= threshold:
            return f"within_{threshold}_days"
    return None


def _quantity_label(batch):
    quantity = format(batch.remaining_quantity, "f").rstrip("0").rstrip(".")
    unit = batch.item.base_unit
    unit_label = (unit.abbreviation or unit.name) if unit else batch.item.unit
    return f"{quantity} {unit_label}".strip()


def _ensure_expiry_notification(employee, batch, *, created_by=None):
    today = timezone.localdate()
    days_remaining = (batch.expiry_date - today).days
    state = _expiry_alert_state(days_remaining)
    if state is None:
        return None

    if days_remaining < 0:
        title = f"Expired stock: {batch.item.name}"
        timing = f"expired {abs(days_remaining)} day{'s' if abs(days_remaining) != 1 else ''} ago"
        action = "Quarantine the remaining stock and record the required disposal or return action."
    elif days_remaining == 0:
        title = f"Expires today: {batch.item.name}"
        timing = "expires today"
        action = "Prioritize or quarantine the remaining stock according to store procedure."
    else:
        title = (
            f"Urgent expiry alert: {batch.item.name}"
            if days_remaining <= 7
            else f"Stock expiry warning: {batch.item.name}"
        )
        timing = f"expires in {days_remaining} day{'s' if days_remaining != 1 else ''}"
        action = "Review the batch and prioritize it using FEFO before it expires."

    notification, _ = Notification.objects.get_or_create(
        employee=employee,
        deduplication_key=f"inventory-expiry:{batch.pk}:{state}",
        defaults={
            "title": title,
            "message": (
                f"{batch.item.name} in {batch.store.name} {timing} on "
                f"{batch.expiry_date:%d %b %Y}. Remaining stock: {_quantity_label(batch)}. "
                f"{action}"
            ),
            "created_by": created_by,
        },
    )
    return notification


def notify_storekeepers_for_expiring_batch(batch, *, created_by=None):
    """Create the current expiry alert for every active keeper assigned to the batch store."""
    warning_end = timezone.localdate() + timedelta(
        days=settings.INVENTORY_EXPIRY_WARNING_DAYS
    )
    if (
        not batch.expiry_date
        or batch.expiry_date > warning_end
        or batch.remaining_quantity <= 0
    ):
        return []

    assignments = StoreKeeperAssignment.objects.select_related(
        "employee__user"
    ).filter(
        store=batch.store,
        is_active=True,
        employee__is_active=True,
        employee__user__is_active=True,
        employee__user__groups__name="Store Keeper",
    )
    notifications = []
    for assignment in assignments.distinct():
        notification = _ensure_expiry_notification(
            assignment.employee,
            batch,
            created_by=created_by,
        )
        if notification:
            notifications.append(notification)
    return notifications


def sync_expiry_notifications_for_employee(employee):
    """Materialize due expiry alerts when a Store Keeper polls their notification inbox."""
    if (
        employee is None
        or not employee.is_active
        or not employee.user.is_active
        or not employee.user.groups.filter(name="Store Keeper").exists()
    ):
        return []

    store_ids = StoreKeeperAssignment.objects.filter(
        employee=employee,
        is_active=True,
        store__is_active=True,
    ).values_list("store_id", flat=True)
    warning_end = timezone.localdate() + timedelta(
        days=settings.INVENTORY_EXPIRY_WARNING_DAYS
    )
    batches = InventoryBatch.objects.select_related(
        "item__base_unit", "store"
    ).filter(
        store_id__in=store_ids,
        remaining_quantity__gt=0,
        expiry_date__isnull=False,
        expiry_date__lte=warning_end,
    )
    notifications = []
    for batch in batches:
        notification = _ensure_expiry_notification(employee, batch)
        if notification:
            notifications.append(notification)
    return notifications


def sync_all_expiry_notifications():
    """Generate alerts for all active Store Keepers; suitable for a scheduled job."""
    employees = Employee.objects.select_related("user").filter(
        is_active=True,
        user__is_active=True,
        user__groups__name="Store Keeper",
        store_keeper_assignments__is_active=True,
    ).distinct()
    return sum(
        (len(sync_expiry_notifications_for_employee(employee)) for employee in employees),
        0,
    )


def notify_roles(
    role_names: Iterable[str],
    *,
    title,
    message,
    branch=None,
    hotel=None,
    department=None,
    created_by=None,
    exclude_employee=None,
):
    """Notify active employees holding one of the supplied roles in scope."""
    employees = Employee.objects.select_related("user").filter(
        is_active=True,
        user__is_active=True,
        user__groups__name__in=tuple(role_names),
    )
    if branch is not None:
        employees = employees.filter(branch=branch)
    elif hotel is not None:
        # Finance and General Management are hotel-wide control roles. They may
        # sit in a different branch from the store that originated the purchase.
        employees = employees.filter(models.Q(branch__hotel=hotel) | models.Q(branch__isnull=True))
    if department is not None:
        employees = employees.filter(department=department)
    if exclude_employee is not None:
        employees = employees.exclude(pk=exclude_employee.pk)

    notifications = []
    for employee in employees.distinct():
        notification = notify_employee(
            employee,
            title=title,
            message=message,
            created_by=created_by,
        )
        if notification:
            notifications.append(notification)
    return notifications
