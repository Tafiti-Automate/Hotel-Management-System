from rest_framework.routers import DefaultRouter

from apps.organization.views import HotelViewSet


router = DefaultRouter()
router.register("hotels", HotelViewSet, basename="hotel")

urlpatterns = router.urls
