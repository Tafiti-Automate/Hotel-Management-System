from rest_framework.permissions import SAFE_METHODS, DjangoModelPermissions


class HotelDjangoModelPermissions(DjangoModelPermissions):
    perms_map = {
        "GET": ["%(app_label)s.view_%(model_name)s"],
        "OPTIONS": [],
        "HEAD": [],
        "POST": ["%(app_label)s.add_%(model_name)s"],
        "PUT": ["%(app_label)s.change_%(model_name)s"],
        "PATCH": ["%(app_label)s.change_%(model_name)s"],
        "DELETE": ["%(app_label)s.delete_%(model_name)s"],
    }

    def get_required_permissions(self, method, model_cls):
        permissions = super().get_required_permissions(method, model_cls)
        if method in SAFE_METHODS:
            return permissions
        return permissions

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        queryset = self._queryset(view)
        model_cls = queryset.model
        method = request.method
        action = getattr(view, "action", None)
        if method == "POST" and action and action not in {"create", None}:
            method = "PATCH"
        perms = self.get_required_permissions(method, model_cls)
        return request.user.has_perms(perms)
