"""Client-approved operational role templates.

Role names and permission sets are fixed business identities approved by the client.
Administrators assign people to roles; they do not redesign operational permissions.
"""
from django.contrib.auth.models import Group, Permission
from django.db import transaction


ROLE_SPECS = {
    "System Administrator": {"all": True},
    "Department Head": {
        # The Department Head is now the originator of Department requisitions.
        # They may maintain only their own draft/rejected request through API
        # object-level controls; submitted records remain read-only to the HOD.
        "crud": {"inventory": ["storerequisition", "storerequisitionitem"]},
        "view": {
            "departments": ["department", "branch"],
            "employees": ["employee"],
            "inventory": ["category", "item", "storelocation", "unitofmeasure"],
        },
    },
    "Cost Controller": {
        "crud": {
            "vendors": ["supplier"],
            "inventory": ["category", "item", "itemunitprice", "supplieritemprice", "unitofmeasure"],
            "procurement": ["procurementattachment"],
        },
    },
    "Store Keeper": {
        # The Department request is predecessor data. Store Keeper may process it,
        # select the destination store and record carried-forward quantities, but
        # supplier/price permissions are deliberately absent.
        "change": {"inventory": ["storerequisition", "storerequisitionitem"]},
        "view": {
            "departments": ["department", "branch"],
            "employees": ["employee"],
            "inventory": ["item", "storelocation", "storekeeperassignment", "unitofmeasure"],
        },
    },
    "Procurement Manager": {
        "crud": {
            "procurement": [
                "purchaseorder", "purchaseorderitem", "procurementattachment",
                "procurementcommunication", "purchaserequisition", "requisitionitem",
            ],
        },
        "view": {
            "departments": ["department", "branch"],
            "inventory": ["item", "storelocation", "unitofmeasure", "supplieritemprice", "itemunitprice"],
            "procurement": ["purchaseorderactivity", "purchaseorderprintrecord", "requisitionhistory"],
            "vendors": ["supplier"],
        },
    },
    "Financial Manager": {
        "change": {
            "approvals": ["purchaseorderapprovalworkflow"],
            "procurement": ["purchaseorder"],
        },
        "view": {
            "departments": ["branch", "department"],
            "inventory": ["item", "unitofmeasure"],
            "procurement": ["purchaseorderitem", "purchaseorderactivity", "purchaserequisition", "requisitionitem"],
            "vendors": ["supplier"],
        },
    },
    "General Manager": {
        "change": {
            "approvals": ["purchaseorderapprovalworkflow"],
            "procurement": ["purchaseorder"],
        },
        "view": {
            "departments": ["branch", "department"],
            "inventory": ["item", "unitofmeasure"],
            "procurement": ["purchaseorderitem", "purchaseorderactivity"],
            "vendors": ["supplier"],
        },
    },
    "Receiving Clerk": {
        "crud": {"procurement": [
            "goodsreceiptitem", "goodsreceiptnote", "goodsinspection",
            "goodsinspectionitem", "procurementattachment",
        ]},
        "view": {
            "departments": ["branch", "department"],
            "inventory": ["item", "storelocation", "unitofmeasure"],
            "procurement": ["purchaseorder", "purchaseorderitem"],
            "vendors": ["supplier"],
        },
    },
}

# Requester/Department Requester is retired. Existing accounts are deliberately
# not promoted to Department Head automatically because that would grant approval
# authority to users who may never have been department heads.
RETIRED_ROLE_NAMES = (
    "Requester",
    "Department Requester",
    "REQUESTER",
    "DEPARTMENT REQUESTER",
)

# Existing installations used several spellings/cases. All non-retired aliases
# are migrated into the canonical roles before the legacy groups are removed.
ROLE_ALIASES = {
    "DEPARTMENT HEAD": "Department Head",
    "COST CONTROLLER": "Cost Controller",
    "STORE KEEPER": "Store Keeper",
    "Stores Manager": "Store Keeper",
    "Store Manager": "Store Keeper",
    "STORES MANAGER": "Store Keeper",
    "PROCUREMENT OFFICER": "Procurement Manager",
    "Procurement Officer": "Procurement Manager",
    "PROCUREMENT MANAGER": "Procurement Manager",
    "FINANCIAL MANAGER": "Financial Manager",
    "Finance Manager": "Financial Manager",
    "Finance Controller": "Financial Manager",
    "MANAGER": "General Manager",
    "GENERAL MANAGER": "General Manager",
    "Director": "General Manager",
    "DIRECTOR": "General Manager",
    "RECIVING CLARK": "Receiving Clerk",
    "RECEIVING CLARK": "Receiving Clerk",
    "Receiving Officer": "Receiving Clerk",
}

SYSTEM_ROLE_NAMES = tuple(ROLE_SPECS.keys())


def model_permissions(app_label, model_name, actions):
    codenames = [f"{action}_{model_name}" for action in actions]
    return Permission.objects.filter(
        content_type__app_label=app_label,
        content_type__model=model_name,
        codename__in=codenames,
    )


def permissions_for_spec(spec):
    if spec.get("all"):
        return Permission.objects.all()
    permissions = Permission.objects.none()
    for bucket, actions in (
        ("view", ["view"]),
        ("change", ["view", "change"]),
        ("crud", ["view", "add", "change", "delete"]),
    ):
        for app_label, models in spec.get(bucket, {}).items():
            for model_name in models:
                permissions |= model_permissions(app_label, model_name, actions)
    return permissions.distinct()


@transaction.atomic
def sync_client_roles(*, reset_permissions=True):
    """Create canonical roles, migrate aliases, and enforce client-approved access.

    ``reset_permissions`` is retained for compatibility with existing callers; the
    approved operational permission sets are always restored.
    """
    groups = {}
    for name in ROLE_SPECS:
        group, _ = Group.objects.get_or_create(name=name)
        groups[name] = group

    # Retire Department Requester without silently promoting old accounts to HOD.
    # Administrators can explicitly assign the correct operational role afterward.
    for retired_name in RETIRED_ROLE_NAMES:
        retired = Group.objects.filter(name=retired_name).first()
        if not retired:
            continue
        retired.user_set.clear()
        try:
            from apps.approvals.models import ApprovalMatrixRule
            ApprovalMatrixRule.objects.filter(approver_role=retired).update(approver_role=None)
        except Exception:
            pass
        retired.delete()

    # Move users from old role names to the canonical roles.
    for old_name, new_name in ROLE_ALIASES.items():
        if old_name == new_name:
            continue
        old_group = Group.objects.filter(name=old_name).first()
        if not old_group:
            continue
        new_group = groups[new_name]
        for user in old_group.user_set.all():
            user.groups.add(new_group)
        # Approval rules are migrated when that app/table is available.
        try:
            from apps.approvals.models import ApprovalMatrixRule
            ApprovalMatrixRule.objects.filter(approver_role=old_group).update(approver_role=new_group)
        except Exception:
            pass
        old_group.delete()

    for name, spec in ROLE_SPECS.items():
        # Operational permissions are client-approved policy, not administrator
        # configuration. Every synchronization restores the canonical permission set.
        groups[name].permissions.set(permissions_for_spec(spec))

    return groups
