from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand
from django.db import transaction


ROLE_SPECS = {
    "System Administrator": {"all": True},
    "General Manager": {
        "view_all": True,
        "change": {
            "approvals": ["approvalworkflow"],
            "procurement": ["purchaserequisition", "purchaseorder"],
            "inventory": ["stockadjustment", "stockcount", "stocktransfer"],
        },
    },
    "Procurement Manager": {
        "crud": {
            "vendors": ["supplier"],
            "procurement": [
                "goodsinspection",
                "goodsinspectionitem",
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
            "inventory": ["supplieritemprice", "reorderrule"],
        },
        "view": {
            "approvals": ["approvalworkflow"],
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
            ],
            "procurement": ["goodsreceiptitem", "goodsreceiptnote"],
        },
    },
    "Finance Controller": {
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
                "supplierpayment",
            ],
        },
        "change": {
            "approvals": ["approvalworkflow"],
            "procurement": ["purchaserequisition"],
        },
        "view": {
            "customers": ["customer", "customerledger", "payment", "paymentallocation"],
            "inventory": ["inventorybalance", "stockledger", "storelocation"],
            "procurement": [
                "purchaseorder",
                "purchaseorderitem",
                "purchaserequisition",
                "requisitionitem",
                "goodsreceiptitem",
                "goodsreceiptnote",
                "supplierreturn",
                "vendorquotation",
            ],
            "sales": ["sale", "saleitem"],
            "vendors": ["supplier"],
        },
    },
    "Stores Manager": {
        "crud": {
            "inventory": [
                "inventorybalance",
                "inventorybatch",
                "item",
                "itemunitprice",
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
                "supplieritemprice",
                "unitofmeasure",
            ],
        },
        "change": {
            "procurement": ["goodsreceiptitem", "goodsreceiptnote", "supplierreturn"],
        },
        "view": {
            "departments": ["department", "branch"],
            "employees": ["employee"],
            "inventory": [
                "category",
                "departmentconsumption",
                "stockledger",
                "storelocation",
            ],
            "procurement": [
                "goodsinspection",
                "goodsinspectionitem",
                "goodsreceiptitem",
                "goodsreceiptnote",
                "procurementattachment",
                "purchaseorder",
                "purchaseorderitem",
                "supplierreturn",
                "supplierreturnitem",
            ],
            "vendors": ["supplier"],
        },
    },
    "Store Keeper": {
        "crud": {
            "inventory": [
                "stockcount",
                "stockcountitem",
                "stockissue",
                "stockissueitem",
                "storerequisition",
                "storerequisitionitem",
                "storereturn",
                "storereturnitem",
            ],
        },
        "view": {
            "departments": ["department"],
            "employees": ["employee"],
            "inventory": [
                "inventorybalance",
                "inventorybatch",
                "item",
                "itemunitprice",
                "stockledger",
                "storelocation",
                "unitofmeasure",
            ],
        },
    },
    "Department Head": {
        "crud": {
            "inventory": ["storerequisition", "storerequisitionitem"],
            "procurement": ["purchaserequisition", "requisitionitem"],
        },
        "change": {
            "approvals": ["approvalworkflow"],
        },
        "view": {
            "departments": ["department"],
            "employees": ["employee"],
            "inventory": ["inventorybalance", "item", "stockledger", "storelocation", "unitofmeasure"],
            "procurement": ["purchaseorder", "purchaserequisition", "requisitionitem"],
        },
    },
    "Receiving Officer": {
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
            "inventory": ["inventorybalance", "inventorybatch", "item", "stockledger", "storelocation"],
            "procurement": ["purchaseorder", "purchaseorderitem"],
            "vendors": ["supplier"],
        },
    },
    "Auditor": {"view_all": True},
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
