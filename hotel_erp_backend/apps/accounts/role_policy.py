from django.contrib.auth.models import Permission
from django.db.models import Q


OPERATIONAL_ROLE_NAMES = (
    "Department Head",
    "Cost Controller",
    "Store Keeper",
    "Receiving Clerk",
    "Financial Manager",
    "Procurement Manager",
    "General Manager",
)

SYSTEM_ROLE_NAMES = ("System Administrator", *OPERATIONAL_ROLE_NAMES)


def employee_self_service_permissions():
    """Permissions every employee needs to submit their own store request."""
    return Permission.objects.filter(
        Q(
            content_type__app_label="inventory",
            content_type__model__in=("storerequisition", "storerequisitionitem"),
            codename__regex=r"^(view|add|change|delete)_",
        )
        | Q(
            content_type__app_label="inventory",
            content_type__model__in=("item", "unitofmeasure"),
            codename__startswith="view_",
        )
        | Q(
            content_type__app_label="departments",
            content_type__model="department",
            codename="view_department",
        )
    )


def grant_employee_self_service(user):
    if user and user.pk:
        user.user_permissions.add(*employee_self_service_permissions())
