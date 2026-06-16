from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView

from core.views import health_check


admin.site.site_header = "Hotel Management System"
admin.site.site_title = "Hotel Management System Admin"
admin.site.index_title = "Operations Dashboard"

api_patterns = [
    path("", include("apps.accounts.urls")),
    path("", include("apps.organization.urls")),
    path("", include("apps.departments.urls")),
    path("", include("apps.employees.urls")),
    path("", include("apps.vendors.urls")),
    path("", include("apps.inventory.urls")),
    path("", include("apps.procurement.urls")),
    path("", include("apps.approvals.urls")),
    path("", include("apps.finance.urls")),
    path("", include("apps.customers.urls")),
    path("", include("apps.sales.urls")),
    path("", include("apps.notifications.urls")),
    path("", include("apps.reports.urls")),
    path("", include("apps.audit_logs.urls")),
]

urlpatterns = [
    path("", RedirectView.as_view(pattern_name="admin:index", permanent=False), name="site-root"),
    path("admin/", admin.site.urls),
    path("api/v1/health/", health_check, name="health-check"),
    path("api/v1/", include(api_patterns)),
]
