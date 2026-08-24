from django.contrib.auth.models import Permission

from apps.accounts.role_templates import SYSTEM_ROLE_NAMES


OPERATIONAL_ROLE_NAMES = tuple(name for name in SYSTEM_ROLE_NAMES if name != "System Administrator")


def employee_self_service_permissions():
    """Legacy compatibility: operational request permissions belong to the Requester role."""
    return Permission.objects.none()


def grant_employee_self_service(user):
    """No-op retained for older migrations/commands. Assign the Requester role instead."""
    return None
