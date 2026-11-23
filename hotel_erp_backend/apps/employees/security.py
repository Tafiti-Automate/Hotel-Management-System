"""Employee master-data access: IT provisions accounts; HR manages assigned-hotel staff.

Every employee API read is scoped to the operator's assigned hotel or property.
The same rule applies to writes. Operational role assignment belongs to IT,
even when the HR Manager has Django add/change employee permissions.
"""
from rest_framework.exceptions import PermissionDenied

from apps.employees.models import Employee


def is_system_administrator(user):
    return bool(
        user and user.is_authenticated
        and (user.is_superuser or user.groups.filter(name="System Administrator").exists())
    )


def assigned_branch(user):
    if not user or not user.is_authenticated or not user.is_active:
        return None
    profile = Employee.objects.select_related("branch").filter(
        user=user, is_active=True, branch__is_active=True,
    ).first()
    return profile.branch if profile else None


def employee_queryset_for_user(queryset, user):
    """Never expose other hotels' personnel or unassigned records to operational roles."""
    if is_system_administrator(user):
        return queryset
    branch = assigned_branch(user)
    if branch is None:
        return queryset.none()
    if branch.hotel_id:
        return queryset.filter(branch__hotel_id=branch.hotel_id)
    return queryset.filter(branch_id=branch.pk)


def require_employee_write_scope(user, branch):
    """Only HR Manager and IT may create/edit staff; HR stays inside its hotel."""
    if is_system_administrator(user):
        return
    if not user or not user.is_authenticated or not user.groups.filter(name="HR Manager").exists():
        raise PermissionDenied("Only the HR Manager or System Administrator may maintain employee records.")
    home = assigned_branch(user)
    if home is None:
        raise PermissionDenied("The HR Manager requires an active employee and property assignment.")
    if branch is None or not branch.is_active:
        raise PermissionDenied("Select an active property before saving an employee.")
    if home.hotel_id:
        if branch.hotel_id != home.hotel_id:
            raise PermissionDenied("An HR Manager cannot manage employees of another hotel.")
    elif branch.pk != home.pk:
        raise PermissionDenied("An HR Manager cannot manage employees of another property.")
