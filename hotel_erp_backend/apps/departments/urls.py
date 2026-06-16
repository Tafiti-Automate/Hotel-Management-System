from rest_framework.routers import DefaultRouter

from apps.departments.views import BranchViewSet, DepartmentViewSet


router = DefaultRouter()
router.register("departments", DepartmentViewSet, basename="department")
router.register("branches", BranchViewSet, basename="branch")

urlpatterns = router.urls
