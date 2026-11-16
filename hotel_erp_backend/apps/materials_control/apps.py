from django.apps import AppConfig


class MaterialsControlConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.materials_control"
    verbose_name = "Materials Control"

    def ready(self):
        from apps.materials_control import signals  # noqa: F401

