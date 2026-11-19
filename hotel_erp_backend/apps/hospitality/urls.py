from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.hospitality.views import (
    CashierSessionViewSet, GuestFolioViewSet, GuestRegistrationView, POSCheckViewSet, PropertyGuestViewSet, ReservationViewSet, RoomTypeViewSet, RoomViewSet,
)

router = DefaultRouter()
router.register('hospitality-guests', PropertyGuestViewSet, basename='hospitality-guest')
router.register('hospitality-folios', GuestFolioViewSet, basename='hospitality-folio')
router.register('hospitality-cashier-sessions', CashierSessionViewSet, basename='hospitality-cashier-session')
router.register("hospitality-room-types", RoomTypeViewSet, basename="hospitality-room-type")
router.register("hospitality-rooms", RoomViewSet, basename="hospitality-room")
router.register("hospitality-reservations", ReservationViewSet, basename="hospitality-reservation")
router.register("hospitality-pos-checks", POSCheckViewSet, basename="hospitality-pos-check")

urlpatterns = [path('hospitality-guests/register/', GuestRegistrationView.as_view(), name='hospitality-guest-register')] + router.urls
