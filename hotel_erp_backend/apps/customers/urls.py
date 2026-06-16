from rest_framework.routers import DefaultRouter

from apps.customers.views import (
    CustomerLedgerViewSet,
    CustomerViewSet,
    PaymentAllocationViewSet,
    PaymentViewSet,
)


router = DefaultRouter()
router.register("customers", CustomerViewSet, basename="customer")
router.register("customer-ledger", CustomerLedgerViewSet, basename="customer-ledger")
router.register("customer-payments", PaymentViewSet, basename="customer-payment")
router.register("payment-allocations", PaymentAllocationViewSet, basename="payment-allocation")

urlpatterns = router.urls
