from django.apps import AppConfig


class AuditLogsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.audit_logs"
    label = "audit_logs"

    def ready(self):
        from apps.audit_logs import signals  # noqa: F401
