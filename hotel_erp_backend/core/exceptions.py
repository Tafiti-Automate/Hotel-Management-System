from collections import Counter

from django.db.models.deletion import ProtectedError, RestrictedError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


def api_exception_handler(exc, context):
    """Translate protected master-data deletes into an actionable API conflict."""
    if isinstance(exc, (ProtectedError, RestrictedError)):
        related_objects = getattr(exc, "protected_objects", None)
        if related_objects is None:
            related_objects = getattr(exc, "restricted_objects", ())

        dependencies = Counter(
            related._meta.verbose_name_plural.title()
            for related in related_objects
        )
        dependency_text = ", ".join(
            f"{name} ({count})" for name, count in sorted(dependencies.items())
        )
        detail = (
            "This record cannot be removed because it is used by other backend records. "
            "Deactivate it instead, or remove/reassign the dependent records first."
        )
        if dependency_text:
            detail = f"{detail} Dependencies: {dependency_text}."

        return Response(
            {
                "detail": detail,
                "code": "record_in_use",
                "dependencies": dict(dependencies),
            },
            status=409,
        )

    return drf_exception_handler(exc, context)
