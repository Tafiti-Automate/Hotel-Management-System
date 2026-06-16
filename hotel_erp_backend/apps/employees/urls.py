from rest_framework.routers import DefaultRouter

from apps.employees.views import DesignationViewSet, EmployeeViewSet


router = DefaultRouter()
router.register("employees", EmployeeViewSet, basename="employee")
router.register("designations", DesignationViewSet, basename="designation")

urlpatterns = router.urls
