from django.apps import AppConfig
from django.db.models.signals import post_migrate


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"
    label = "accounts"

    def ready(self):
        # Applying migrations on an existing installation is enough to provision the
        # predefined workflow roles. This avoids empty sidebars caused by zero-permission
        # legacy groups. It intentionally runs only after migrate, not on every login.
        post_migrate.connect(_sync_roles_after_migrate, dispatch_uid="accounts.sync_client_roles")


def _sync_roles_after_migrate(**kwargs):
    try:
        from apps.accounts.role_templates import sync_client_roles
        sync_client_roles(reset_permissions=False)
    except Exception:
        # During unusual partial migration states some content types may not exist yet;
        # the explicit setup_hotel_roles command remains available as a safe retry.
        return
