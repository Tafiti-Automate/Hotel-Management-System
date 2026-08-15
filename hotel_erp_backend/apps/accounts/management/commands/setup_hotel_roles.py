from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand
from django.db import transaction


ROLE_SPECS = {
    "System Administrator": {"all": True},
    "Cost Controller": {
        "crud": {
            "vendors": ["supplier"],
            "inventory": [
                "category",
                "item",
                "itemunitprice",
                "supplieritemprice",
                "unitofmeasure",
            ],
            "procurement": ["procurementattachment"],
        },
        "view": {
            "departments": ["branch", "department"],
            "inventory": ["storelocation"],
        },
    },
    "General Manager": {
        "view_all": True,
        "change": {
            "approvals": ["approvalworkflow"],
            "finance": ["supplierinvoice", "supplierpayment"],
            "procurement": ["purchaserequisition", "purchaseorder"],
            "inventory": ["stockadjustment", "stockcount", "stocktransfer"],
        },
        "view": {
            "procurement": [
                "purchaseorderitem",
                "purchaseorderactivity",
                "purchaseorderprintrecord",
                "requisitionitem",
                "vendorquotation",
            ],
            "vendors": ["supplier"],
        },
    },
    "Procurement Manager": {
        "crud": {
            "procurement": [
                "purchaseorder",
                "purchaseorderitem",
                "procurementattachment",
                "procurementcommunication",
                "purchaserequisition",
                "requisitionitem",
                "supplierreturn",
                "supplierreturnitem",
                "vendorquotation",
                "vendorquotationitem",
            ],
            "inventory": ["reorderrule"],
        },
        "change": {
            "approvals": ["approvalworkflow"],
            "inventory": ["supplieritemprice"],
        },
        "view": {
            "departments": ["department", "branch"],
            "employees": ["employee"],
            "inventory": [
                "inventorybalance",
                "inventorybatch",
                "item",
                "itemunitprice",
                "stockledger",
                "storelocation",
                "unitofmeasure",
                "supplieritemprice",
            ],
            "procurement": [
                "goodsinspection",
                "goodsinspectionitem",
                "goodsreceiptitem",
                "goodsreceiptnote",
                "requisitionhistory",
            ],
            "vendors": ["supplier"],
        },
    },
    "Financial Manager": {
        "crud": {
            "finance": [
                "bankaccount",
                "banktransaction",
                "cashflow",
                "dailycashsummary",
                "expense",
                "expensecategory",
                "paymentmethod",
                "supplierinvoice",
                "supplierinvoiceitem",
                "supplierpayment",
            ],
        },
        "change": {
            "approvals": ["approvalworkflow"],
            "procurement": ["purchaseorder"],
        },
        "view": {
            "customers": ["customer", "customerledger", "payment", "paymentallocation"],
            "departments": ["branch", "department"],
            "inventory": ["inventorybalance", "item", "stockledger", "storelocation", "unitofmeasure"],
            "procurement": [
                "purchaseorderitem",
                "purchaseorderactivity",
                "purchaseorderprintrecord",
                "purchaserequisition",
                "requisitionitem",
                "requisitionhistory",
                "vendorquotation",
                "vendorquotationitem",
                "goodsreceiptitem",
                "goodsreceiptnote",
                "supplierreturn",
            ],
            "sales": ["sale", "saleitem"],
            "vendors": ["supplier"],
        },
    },
    "Store Keeper": {
        "crud": {
            "inventory": [
                "inventorybatch",
                "reorderrule",
                "stockadjustment",
                "stockadjustmentitem",
                "stockcount",
                "stockcountitem",
                "stockissue",
                "stockissueitem",
                "stocktransfer",
                "stocktransferitem",
                "storerequisition",
                "storerequisitionitem",
                "storereturn",
                "storereturnitem",
            ],
        },
        "change": {
            "inventory": ["inventorybalance"],
        },
        "view": {
            "departments": ["branch", "department"],
            "employees": ["employee"],
            "inventory": [
                "inventorybalance",
                "inventorybatch",
                "category",
                "departmentconsumption",
                "item",
                "itemunitprice",
                "stockledger",
                "storelocation",
                "unitofmeasure",
            ],
            "procurement": ["purchaseorder", "purchaseorderitem"],
        },
    },
    "Receiving Clerk": {
        "crud": {
            "procurement": [
                "goodsinspection",
                "goodsinspectionitem",
                "goodsreceiptitem",
                "goodsreceiptnote",
                "procurementattachment",
                "supplierreturn",
                "supplierreturnitem",
            ],
        },
        "view": {
            "departments": ["branch", "department"],
            "employees": ["employee"],
            "inventory": ["item", "storelocation", "unitofmeasure"],
            "procurement": ["purchaseorder", "purchaseorderitem"],
            "vendors": ["supplier"],
        },
    },
}


ROLE_REPLACEMENTS = {
    "Finance Manager": "Financial Manager",
    "Finance Controller": "Financial Manager",
    "Director": "General Manager",
    "Stores Manager": "Store Keeper",
    "Store Manager": "Store Keeper",
    "Receiving Officer": "Receiving Clerk",
}

OBSOLETE_ROLES = {
    *ROLE_REPLACEMENTS,
    "Department Requester",
    "Department Head",
    "Auditor",
}


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
    if spec.get("view_all"):
        permissions |= Permission.objects.filter(codename__startswith="view_")

    for bucket, actions in (
        ("view", ["view"]),
        ("change", ["view", "change"]),
        ("crud", ["view", "add", "change", "delete"]),
    ):
        for app_label, models in spec.get(bucket, {}).items():
            for model_name in models:
                permissions |= model_permissions(app_label, model_name, actions)
    return permissions.distinct()


class Command(BaseCommand):
    help = "Create hotel management role groups and assign model permissions."

    @transaction.atomic
    def handle(self, *args, **options):
        for group_name, spec in ROLE_SPECS.items():
            group, _ = Group.objects.get_or_create(name=group_name)
            permissions = permissions_for_spec(spec)
            group.permissions.set(permissions)
            self.stdout.write(
                self.style.SUCCESS(f"{group.name}: {permissions.count()} permissions")
            )

        # Consolidate existing accounts and role-based approval matrices before
        # deleting the legacy groups. Historical approval decisions remain
        # attached to their employees and are not altered.
        from apps.approvals.models import ApprovalMatrixRule

        for old_name, new_name in ROLE_REPLACEMENTS.items():
            old_group = Group.objects.filter(name=old_name).first()
            if not old_group:
                continue
            new_group = Group.objects.get(name=new_name)
            for user in old_group.user_set.all():
                user.groups.add(new_group)
            ApprovalMatrixRule.objects.filter(approver_role=old_group).update(
                approver_role=new_group
            )

        removable = Group.objects.filter(name__in=OBSOLETE_ROLES)
        unassigned_rules = ApprovalMatrixRule.objects.filter(
            approver_role__in=removable
        ) | ApprovalMatrixRule.objects.filter(
            assignment_type=ApprovalMatrixRule.ASSIGNMENT_DEPARTMENT_HEAD
        )
        removed_rules = unassigned_rules.count()
        unassigned_rules.delete()
        removed_roles = removable.count()
        removable.delete()
        from apps.accounts.role_policy import grant_employee_self_service
        from apps.employees.models import Employee
        from apps.inventory.models import StoreRequisition
        from core.constants.choices import StoreRequisitionStatus

        StoreRequisition.objects.filter(
            status=StoreRequisitionStatus.PENDING_DEPARTMENT_APPROVAL
        ).update(status=StoreRequisitionStatus.SUBMITTED)

        for employee in Employee.objects.select_related("user"):
            grant_employee_self_service(employee.user)
        self.stdout.write(
            self.style.SUCCESS(
                f"Removed {removed_roles} obsolete roles and {removed_rules} obsolete approval rules."
            )
        )
