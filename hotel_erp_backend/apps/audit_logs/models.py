from django.conf import settings
from django.db import models

from core.mixins.models import BaseModel


class AuditLog(BaseModel):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    action = models.CharField(max_length=100)
    entity_type = models.CharField(max_length=100)
    entity_id = models.UUIDField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.action} {self.entity_type} {self.entity_id or ''}".strip()
