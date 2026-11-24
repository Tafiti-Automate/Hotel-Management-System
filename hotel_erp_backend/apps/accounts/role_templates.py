"""Client-approved operational role templates.

Role names and permission sets are fixed business identities approved by the client.
Administrators assign people to roles; they do not redesign operational permissions.
"""
from django.contrib.auth.models import Group, Permission
from django.db import transaction


ROLE_SPECS = {
    "System Administrator": {
        # IT can configure master data, accounts and integrations, and can read
        # operational evidence. Transactional approval/posting actions keep
        # their own role checks and never treat this role as a finance actor.
        "view_all": True,
        "crud": {
            "accounts": ["user"],
            "departments": ["department", "branch"],
            "employees": ["employee", "designation"],
            "inventory": ["category", "item", "itemunitprice", "storelocation", "unitofmeasure"],
            "organization": ["hotel"],
            "hospitality": ["room", "roomtype"],
            "materials_control": ["outletassignment", "integrationconfig", "glaccountmapping"],
        },
    },
    "HR Manager": {
        # HR owns employee master data, leave, documents and payroll preparation.
        # Finance independently approves salary advances and submitted payroll.
        "crud": {
            "employees": [
                "employee", "designation", "payrollprofile", "payrollaffector",
                "salaryadvance", "payrollperiod", "leaverequest", "employeedocument",
                "shifttemplate", "attendancerecord",
            ],
        },
        "view": {
            "departments": ["department", "branch"],
            "employees": ["payrollentry", "salaryadvancerepayment"],
        },
    },
    "Payroll Officer": {
        "crud": {
            "employees": [
                "payrollprofile", "payrollaffector", "salaryadvance",
                "payrollperiod", "leaverequest", "employeedocument",
                "shifttemplate", "attendancerecord",
            ],
        },
        "view": {
            "departments": ["department", "branch"],
            "employees": [
                "employee", "designation", "payrollentry", "salaryadvancerepayment",
            ],
        },
    },
    "Department Supervisor": {
        # Supervisors originate Department requests for their own department.
        # Object-level API controls keep them on their own draft/rejected records.
        "crud": {
            "inventory": ["storerequisition", "storerequisitionitem"],
            "materials_control": ["wasterecord"],
        },
        "view": {
            "departments": ["department", "branch"],
            "employees": ["employee"],
            "inventory": ["category", "item", "storelocation", "unitofmeasure"],
            "materials_control": ["outletassignment", "recipe", "recipeingredient"],
        },
    },
    "Department Head": {
        # HOD no longer originates the Department request. The HOD reviews the
        # Supervisor request and may retain/reduce quantities or reject it.
        "crud": {
            "materials_control": ["recipe", "recipeingredient"],
        },
        "change": {"materials_control": ["wasterecord"]},
        # Heads may originate quantity-only department PRs; no commercial price rights.
        "add": {"procurement": ["purchaserequisition", "requisitionitem"]},
        "view": {
            "procurement": ["purchaserequisition", "requisitionitem"],
            "departments": ["department", "branch"],
            "employees": ["employee"],
            "inventory": [
                "category", "item", "storelocation", "unitofmeasure",
                "storerequisition", "storerequisitionitem",
            ],
            "materials_control": ["outletassignment", "costcenterbudget"],
        },
    },
    "Cost Controller": {
        # Cost Control creates and edits organizational master records, but
        # cannot delete them or gain operational stock-posting rights.
        "add": {
            "inventory": ["storelocation"],
            "departments": ["department"],
        },
        "change": {
            "inventory": ["storelocation"],
            "departments": ["department"],
        },
        "crud": {
            "vendors": ["supplier"],
            "inventory": ["category", "item", "itemunitprice", "supplieritemprice", "unitofmeasure"],
            "procurement": ["procurementattachment", "supplierreturn", "supplierreturnitem", "supplierreturnrequest"],
            "materials_control": [
                "wasterecord", "recipe", "recipeingredient", "posplumapping",
                "posimportbatch", "possaleline",
            ],
        },
        "view": {
            "departments": ["department", "branch"],
            "employees": ["employee"],
            "inventory": [
                "storerequisition", "storerequisitionitem", "storelocation", "inventorybalance",
                # Stocktake variance review reads the frozen count and ledger snapshot.
                # Only Store Keepers can enter/change the physical counts.
                "stockcount", "stockcountitem", "stockledger",
                "stockadjustment", "stockadjustmentitem",
            ],
            "procurement": ["vendorquotation", "vendorquotationitem", "goodsreceiptnote", "goodsreceiptitem", "purchaseorder", "purchaseorderitem"],
        },
    },
    "Store Keeper": {
        # Store Keeper controls internal stock after HOD + Cost Control approval,
        # prepares the transfer/issue voucher, conducts assigned-store counts,
        # and verifies supplier GRNs before SOH posting.  Queryset guards in the
        # inventory API keep these records limited to the keeper's stores.
        "crud": {
            "inventory": [
                "stockissue", "stockissueitem",
                "stocktransfer", "stocktransferitem",
                "stockcount", "stockcountitem",
                "stockadjustment", "stockadjustmentitem",
                "storereturn", "storereturnitem",
            ],
        },
        "view": {
            "departments": ["department", "branch"],
            "employees": ["employee"],
            "inventory": [
                "category", "item", "itemunitprice", "storelocation", "storekeeperassignment", "unitofmeasure",
                "inventorybalance", "storerequisition", "storerequisitionitem",
                "inventorybatch", "stockledger",
            ],
            "procurement": [
                "goodsreceiptnote", "goodsreceiptitem", "purchaseorder", "purchaseorderitem",
                "supplierreturnrequest",
            ],
            "vendors": ["supplier"],
        },
        "add": {"procurement": ["supplierreturnrequest"]},
    },
    "Procurement Manager": {
        "crud": {
            "procurement": [
                "purchaseorder", "purchaseorderitem", "procurementattachment",
                "procurementcommunication", "purchaserequisition", "requisitionitem",
                "vendorquotation", "vendorquotationitem",
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
        "crud": {
            "materials_control": ["costcenterbudget", "fiscalperiod"],
        },
        "change": {
            "approvals": ["purchaseorderapprovalworkflow"],
            "procurement": ["purchaseorder"],
            "materials_control": ["budgetoverride"],
            "finance": ["suppliercreditnote", "supplierpaymentreconciliation"],
            "inventory": ["stockadjustment"],
            "employees": ["salaryadvance", "payrollperiod"],
        },
        "view": {
            "departments": ["branch", "department"],
            "inventory": ["item", "unitofmeasure", "stockcount", "stockcountitem", "stockledger", "stockadjustmentitem"],
            # Read-only GRN, receipt-line and return evidence for three-way matching.
            "procurement": [
                "purchaseorderitem", "purchaseorderactivity", "purchaserequisition", "requisitionitem",
                "goodsreceiptnote", "goodsreceiptitem", "supplierreturn",
                "vendorquotation", "vendorquotationitem",
            ],
            "vendors": ["supplier"],
            "finance": ["supplierinvoice", "supplierinvoiceitem", "supplierpayment", "suppliercreditnote", "expense"],
            "materials_control": ["glexport", "glaccountmapping", "wasterecord", "recipe", "posimportbatch"],
            "employees": [
                "employee", "payrollprofile", "payrollaffector", "salaryadvance",
                "payrollperiod", "payrollentry", "salaryadvancerepayment",
                "shifttemplate", "attendancerecord",
            ],
        },
    },
    "Accounts Payable Clerk": {
        "crud": {
            "finance": ["supplierinvoice", "supplierinvoiceitem", "supplierpayment", "suppliercreditnote", "supplierpaymentreconciliation"],
        },
        "view": {
            "finance": ["paymentmethod"],
            "departments": ["branch", "department"],
            "inventory": ["item", "unitofmeasure"],
            "procurement": [
                "purchaseorder", "purchaseorderitem", "goodsreceiptnote",
                "goodsreceiptitem", "supplierreturn", "supplierreturnitem",
            ],
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
            "procurement": ["purchaseorderitem", "purchaseorderactivity", "vendorquotation", "vendorquotationitem"],
            "vendors": ["supplier"],
            "finance": ["supplierinvoice", "supplierpayment", "expense"],
            "materials_control": [
                "costcenterbudget", "budgetoverride", "fiscalperiod", "glexport", "glaccountmapping",
                "wasterecord", "recipe", "posimportbatch",
            ],
            "employees": [
                "payrollperiod", "payrollentry", "payrollaffector", "salaryadvance",
            ],
        },
    },
    "Receiving Clerk": {
        "add": {"procurement": ["supplierreturnrequest"]},
        "crud": {"procurement": [
            "goodsreceiptitem", "goodsreceiptnote", "goodsinspection",
            "goodsinspectionitem", "procurementattachment",
        ]},
        "view": {
            "departments": ["branch", "department"],
            "inventory": ["item", "storelocation", "unitofmeasure"],
            "procurement": ["purchaseorder", "purchaseorderitem", "supplierreturnrequest"],
            "vendors": ["supplier"],
        },
    },
}

# The original ten Materials Control roles retain their existing acceptance
# baseline. Hospitality roles are provisioned separately and cannot change
# procurement and inventory role readiness expectations.
HOSPITALITY_ROLE_SPECS = {
    # PMS + Simphony-style operational roles. Permissions are confined to
    # hotel operations; existing Materials Control approval duties remain separate.
    "Receptionist": {
        "crud": {"hospitality": ["reservation", "propertyguest", "guestfolio"]},
        "view": {"hospitality": ["room", "roomtype", "poscheck"], "departments": ["branch"]},
    },
    "Reservations Agent": {
        "crud": {"hospitality": ["reservation", "propertyguest"]},
        "view": {"hospitality": ["room", "roomtype"], "departments": ["branch"]},
    },
    "Front Office Manager": {
        "crud": {"hospitality": ["reservation", "room", "roomtype", "propertyguest", "guestfolio"]},
        "view": {"hospitality": ["poscheck"], "departments": ["branch"]},
    },
    "Housekeeper": {
        "view": {"hospitality": ["room", "roomtype"], "departments": ["branch"]},
    },
    "Housekeeping Supervisor": {
        "change": {"hospitality": ["room"]},
        "view": {"hospitality": ["room", "roomtype"], "departments": ["branch"]},
    },
    "Bartender": {
        "crud": {"hospitality": ["poscheck", "posorderline"]},
        "view": {"inventory": ["item"], "departments": ["branch"]},
    },
    "Waiter": {
        "crud": {"hospitality": ["poscheck", "posorderline"]},
        "view": {"departments": ["branch"]},
    },
    "Cashier": {
        "crud": {"hospitality": ["cashiersession"]},
        "change": {"hospitality": ["poscheck"]},
        "view": {"hospitality": ["reservation", "posorderline"], "departments": ["branch"]},
    },
    "Bar Supervisor": {
        "crud": {"hospitality": ["poscheck", "posorderline"]},
        "view": {"hospitality": ["reservation", "cashiersession"], "departments": ["branch"]},
    },
    "F&B Manager": {
        "view": {"hospitality": ["poscheck", "cashiersession"], "materials_control": ["recipe", "posimportbatch"], "departments": ["branch"]},
    },
}

# Requester/Department Requester is retired. Existing accounts are deliberately
# not promoted to Department Supervisor automatically because role elevation must
# remain an explicit administrator decision.
RETIRED_ROLE_NAMES = (
    "Requester",
    "Department Requester",
    "REQUESTER",
    "DEPARTMENT REQUESTER",
)

# Existing installations used several spellings/cases. All non-retired aliases
# are migrated into the canonical roles before the legacy groups are removed.
ROLE_ALIASES = {
    "Supervisor": "Department Supervisor",
    "Outlet Supervisor": "Department Supervisor",
    "SUPERVISOR": "Department Supervisor",
    "DEPARTMENT SUPERVISOR": "Department Supervisor",
    "DEPARTMENT HEAD": "Department Head",
    "F&B Department Head": "Department Head",
    "COST CONTROLLER": "Cost Controller",
    "F&B Cost Controller": "Cost Controller",
    "STORE KEEPER": "Store Keeper",
    "Stores Manager": "Store Keeper",
    "Store Manager": "Store Keeper",
    "STORES MANAGER": "Store Keeper",
    "PROCUREMENT OFFICER": "Procurement Manager",
    "Procurement Officer": "Procurement Manager",
    "Purchasing Officer": "Procurement Manager",
    "PROCUREMENT MANAGER": "Procurement Manager",
    "FINANCIAL MANAGER": "Financial Manager",
    "Finance Manager": "Financial Manager",
    "Finance Controller": "Financial Manager",
    "Financial Controller": "Financial Manager",
    "Human Resources Manager": "HR Manager",
    "Human Resource Manager": "HR Manager",
    "HR Officer": "Payroll Officer",
    "Accounts Payable (A/P) Clerk": "Accounts Payable Clerk",
    "AP Clerk": "Accounts Payable Clerk",
    "MANAGER": "General Manager",
    "GENERAL MANAGER": "General Manager",
    "General Manager (GM)": "General Manager",
    "Director": "General Manager",
    "DIRECTOR": "General Manager",
    "RECIVING CLARK": "Receiving Clerk",
    "RECEIVING CLARK": "Receiving Clerk",
    "Receiving Officer": "Receiving Clerk",
}

SYSTEM_ROLE_NAMES = tuple(ROLE_SPECS.keys())
# Ten Materials Control operational actors; HR Manager and Payroll Officer are
# separately audited for the expanded ERP. Do not discard those actual roles.
MATERIALS_CONTROL_ROLE_NAMES = tuple(
    name for name in SYSTEM_ROLE_NAMES
    if name not in ("HR Manager", "Payroll Officer")
)


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
    permissions = (
        Permission.objects.filter(codename__startswith="view_")
        if spec.get("view_all")
        else Permission.objects.none()
    )
    for bucket, actions in (
        ("add", ["view", "add"]),
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
    for name in (*ROLE_SPECS, *HOSPITALITY_ROLE_SPECS):
        group, _ = Group.objects.get_or_create(name=name)
        groups[name] = group

    # Retire the generic Requester role without silently promoting old accounts.
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
        try:
            from apps.approvals.models import ApprovalMatrixRule
            ApprovalMatrixRule.objects.filter(approver_role=old_group).update(approver_role=new_group)
        except Exception:
            pass
        old_group.delete()

    for name, spec in {**ROLE_SPECS, **HOSPITALITY_ROLE_SPECS}.items():
        groups[name].permissions.set(permissions_for_spec(spec))

    return groups
