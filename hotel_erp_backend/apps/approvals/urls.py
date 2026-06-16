from rest_framework.routers import DefaultRouter

from apps.approvals.views import ApprovalWorkflowViewSet


router = DefaultRouter()
router.register("approvals", ApprovalWorkflowViewSet, basename="approval")

urlpatterns = router.urls
