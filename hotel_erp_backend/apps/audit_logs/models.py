import hashlib
import hmac
import json

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction

from core.mixins.models import BaseModel


class AuditChainState(models.Model):
    """Single-row chain head used to serialize audit hash generation."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    last_hash = models.CharField(max_length=64, blank=True, default="")
    sequence = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Audit chain state"
        verbose_name_plural = "Audit chain state"


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
    entity_id = models.CharField(max_length=100, null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    request_id = models.CharField(max_length=100, blank=True, default="")
    user_agent = models.CharField(max_length=500, blank=True, default="")
    chain_sequence = models.PositiveBigIntegerField(null=True, blank=True, editable=False, db_index=True)
    previous_hash = models.CharField(max_length=64, blank=True, default="", editable=False)
    entry_hash = models.CharField(max_length=64, blank=True, default="", editable=False, db_index=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def _hash_payload(self):
        return json.dumps(
            {
                "id": str(self.id),
                "actor_id": str(self.actor_id or ""),
                "action": self.action,
                "entity_type": self.entity_type,
                "entity_id": str(self.entity_id or ""),
                "metadata": self.metadata,
                "ip_address": str(self.ip_address or ""),
                "request_id": self.request_id,
                "user_agent": self.user_agent,
                "chain_sequence": self.chain_sequence,
                "previous_hash": self.previous_hash,
            },
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")

    def calculate_hash(self):
        key = str(getattr(settings, "AUDIT_LOG_HMAC_KEY", settings.SECRET_KEY)).encode("utf-8")
        return hmac.new(key, self._hash_payload(), hashlib.sha256).hexdigest()

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("Audit records are immutable and cannot be edited.")
        with transaction.atomic():
            state, _ = AuditChainState.objects.select_for_update().get_or_create(pk=1)
            state.sequence += 1
            self.chain_sequence = state.sequence
            self.previous_hash = state.last_hash or ""
            self.entry_hash = self.calculate_hash()
            super().save(*args, **kwargs)
            state.last_hash = self.entry_hash
            state.save(update_fields=("last_hash", "sequence", "updated_at"))

    def delete(self, *args, **kwargs):
        raise ValidationError("Audit records are immutable and cannot be deleted.")

    def __str__(self):
        return f"{self.action} {self.entity_type} {self.entity_id or ''}".strip()
