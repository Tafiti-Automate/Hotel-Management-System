from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.approvals.models import ApprovalWorkflow
from apps.audit_logs.models import AuditLog
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
from core.constants.choices import ApprovalStatus


@receiver(post_save, sender=StockLedger)
def audit_stock_movement(sender, instance, created, **kwargs):
    if not created:
        return
    AuditLog.objects.create(
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


@receiver(post_save, sender=ApprovalWorkflow)
def audit_approval_decision(sender, instance, created, **kwargs):
    if created or instance.status not in (
        ApprovalStatus.APPROVED,
        ApprovalStatus.REJECTED,
        ApprovalStatus.RETURNED,
        ApprovalStatus.SKIPPED,
    ):
        return
    AuditLog.objects.create(
        actor=instance.decided_by or instance.approver.user,
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
        created_by=instance.decided_by or instance.approver.user,
    )


AUDITED_DELETION_MODELS = (
    PurchaseRequisition,
    PurchaseOrder,
    GoodsReceiptNote,
    SupplierReturn,
    StoreRequisition,
    StockTransfer,
    StockAdjustment,
    StockCount,
)


def audit_document_change(sender, instance, created, **kwargs):
    metadata = {"snapshot": str(instance)}
    if hasattr(instance, "status"):
        metadata["status"] = instance.status
    AuditLog.objects.create(
        actor=instance.created_by,
        action="document_created" if created else "document_updated",
        entity_type=f"{sender._meta.app_label}.{sender.__name__}",
        entity_id=instance.id,
        metadata=metadata,
        created_by=instance.created_by,
    )


def audit_document_deletion(sender, instance, **kwargs):
    AuditLog.objects.create(
        actor=instance.created_by,
        action="document_deleted",
        entity_type=f"{sender._meta.app_label}.{sender.__name__}",
        entity_id=instance.id,
        metadata={"snapshot": str(instance)},
        created_by=instance.created_by,
    )


for audited_model in AUDITED_DELETION_MODELS:
    post_save.connect(
        audit_document_change,
        sender=audited_model,
        dispatch_uid=f"audit_change_{audited_model._meta.label_lower}",
    )
    post_delete.connect(
        audit_document_deletion,
        sender=audited_model,
        dispatch_uid=f"audit_delete_{audited_model._meta.label_lower}",
    )
