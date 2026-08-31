from core.audit_context import request_metadata

from apps.audit_logs.models import AuditLog


def record_audit(*, action, entity_type, entity_id=None, metadata=None, actor=None, created_by=None):
    context = request_metadata()
    effective_actor = actor or context.get("actor")
    return AuditLog.objects.create(
        actor=effective_actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        metadata=metadata or {},
        ip_address=context.get("ip_address"),
        request_id=context.get("request_id", ""),
        user_agent=context.get("user_agent", ""),
        created_by=created_by or effective_actor,
    )
