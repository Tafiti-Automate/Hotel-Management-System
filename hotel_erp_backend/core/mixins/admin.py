class CreatedByAdminMixin:
    list_per_page = 50
    readonly_base_fields = ("id", "created_at", "updated_at", "created_by")

    def get_readonly_fields(self, request, obj=None):
        readonly_fields = super().get_readonly_fields(request, obj)
        return tuple(dict.fromkeys((*readonly_fields, *self.readonly_base_fields)))

    def save_model(self, request, obj, form, change):
        if not change and hasattr(obj, "created_by_id") and not obj.created_by_id:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)
