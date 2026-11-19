from rest_framework.routers import DefaultRouter

from apps.hospitality.views import (
    POSCheckViewSet, ReservationViewSet, RoomTypeViewSet, RoomViewSet,
)

router = DefaultRouter()
router.register("hospitality-room-types", RoomTypeViewSet, basename="hospitality-room-type")
router.register("hospitality-rooms", RoomViewSet, basename="hospitality-room")
router.register("hospitality-reservations", ReservationViewSet, basename="hospitality-reservation")
router.register("hospitality-pos-checks", POSCheckViewSet, basename="hospitality-pos-check")

urlpatterns = router.urls
