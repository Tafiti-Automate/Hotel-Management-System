from rest_framework.routers import DefaultRouter

from apps.vendors.views import SupplierViewSet


router = DefaultRouter()
router.register("vendors", SupplierViewSet, basename="vendor")

urlpatterns = router.urls
