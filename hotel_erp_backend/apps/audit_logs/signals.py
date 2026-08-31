from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from django.db.models.signals import post_save, pre_delete, pre_save

from apps.approvals.models import ApprovalWorkflow
from apps.audit_logs.models import AuditLog
from apps.audit_logs.services import record_audit
from apps.finance.models import SupplierInvoice, SupplierPayment
from apps.inventory.models import (
    StockAdjustment,
    StockCount,
    StockLedger,
    StockTransfer,
    StoreRequisition,
)
from apps.procurement.models import (
    GoodsReceiptNote,
    PurchaseOrder,
    PurchaseRequisition,
    SupplierReturn,
)
from core.constants.choices import ApprovalStatus, GoodsReceiptStatus, POStatus, PRStatus


def _json_value(value):
    if isinstance(value, (datetime, date, Decimal, UUID)):
        return str(value)
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _snapshot(instance):
    data = {}
    for field in instance._meta.concrete_fields:
        name = field.attname
        if name in {"updated_at"}:
            continue
        try:
            data[name] = _json_value(getattr(instance, name))
        except Exception:
            continue
    return data


@pre_save
def capture_previous_audited_state(sender, instance, **kwargs):
    if sender not in AUDITED_MODELS or not instance.pk:
        return
    try:
        previous = sender.objects.get(pk=instance.pk)
    except sender.DoesNotExist:
        return
    instance._audit_previous_state = _snapshot(previous)


@post_save
def audit_stock_movement(sender, instance, created, **kwargs):
    if sender is not StockLedger or not created:
        return
    record_audit(
        actor=instance.created_by,
        action="stock_movement_posted",
        entity_type="inventory.StockLedger",
        entity_id=instance.id,
        metadata={
            "item_id": str(instance.item_id),
            "store_id": str(instance.store_id) if instance.store_id else None,
            "quantity_in": str(instance.quantity_in),
            "quantity_out": str(instance.quantity_out),
            "reference_type": instance.reference_type,
            "reference_id": str(instance.reference_id),
            "reason": instance.note,
        },
        created_by=instance.created_by,
    )


@post_save
def audit_approval_decision(sender, instance, created, **kwargs):
    if sender is not ApprovalWorkflow or created or instance.status not in (
        ApprovalStatus.APPROVED,
        ApprovalStatus.REJECTED,
        ApprovalStatus.RETURNED,
        ApprovalStatus.SKIPPED,
    ):
        return
    actor = instance.decided_by or getattr(instance.approver, "user", None)
    record_audit(
        actor=actor,
        action=f"approval_{instance.status}",
        entity_type="approvals.ApprovalWorkflow",
        entity_id=instance.id,
        metadata={
            "requisition_id": str(instance.requisition_id),
            "stage": instance.stage,
            "stage_name": instance.stage_name,
            "approver_id": str(instance.approver_id),
            "comments": instance.comments,
        },
        created_by=actor,
    )


AUDITED_MODELS = (
    PurchaseRequisition,
    PurchaseOrder,
    GoodsReceiptNote,
    SupplierReturn,
    StoreRequisition,
    StockTransfer,
    StockAdjustment,
    StockCount,
    SupplierInvoice,
    SupplierPayment,
)


@post_save
def audit_document_change(sender, instance, created, **kwargs):
    if sender not in AUDITED_MODELS:
        return
    after = _snapshot(instance)
    before = {} if created else getattr(instance, "_audit_previous_state", {})
    changed = {
        key: {"before": before.get(key), "after": value}
        for key, value in after.items()
        if before.get(key) != value
    }
    actor = getattr(instance, "created_by", None)
    record_audit(
        actor=actor,
        action="document_created" if created else "document_updated",
        entity_type=f"{sender._meta.app_label}.{sender.__name__}",
        entity_id=instance.id,
        metadata={
            "changes": changed,
            "status": getattr(instance, "status", None),
        },
        created_by=actor,
    )


@pre_delete
def protect_immutable_records(sender, instance, **kwargs):
    """Block destructive removal of evidence-bearing transactional records."""
    if sender is AuditLog:
        raise ValueError("Audit records are immutable and cannot be deleted.")
    if sender is StockLedger:
        raise ValueError("Stock ledger entries are immutable. Create a reversing movement instead.")
    if sender is PurchaseRequisition and instance.status != PRStatus.DRAFT:
        raise ValueError("Submitted procurement requisitions cannot be deleted; cancel or close them instead.")
    if sender is PurchaseOrder and instance.status != POStatus.DRAFT:
        raise ValueError("LPOs that entered approval or supplier processing cannot be deleted; cancel them instead.")
    if sender is GoodsReceiptNote and instance.status != GoodsReceiptStatus.DRAFT:
        raise ValueError("Received or posted GRNs cannot be deleted; use cancellation or a controlled reversal.")
    if sender is SupplierInvoice and instance.status != SupplierInvoice.STATUS_DRAFT:
        raise ValueError("Matched or approved supplier invoices cannot be deleted; cancel or reverse them instead.")
    if sender is SupplierPayment and instance.status != SupplierPayment.STATUS_DRAFT:
        raise ValueError("Posted supplier payments cannot be deleted; record a controlled reversal instead.")
