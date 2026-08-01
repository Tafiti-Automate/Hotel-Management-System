from collections.abc import Iterable

from apps.employees.models import Employee
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


def notify_roles(
    role_names: Iterable[str],
    *,
    title,
    message,
    branch=None,
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
