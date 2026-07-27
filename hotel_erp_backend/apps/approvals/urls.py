from rest_framework.routers import DefaultRouter

from apps.approvals.views import ApprovalMatrixRuleViewSet, ApprovalWorkflowViewSet


router = DefaultRouter()
router.register("approvals", ApprovalWorkflowViewSet, basename="approval")
router.register("approval-matrix", ApprovalMatrixRuleViewSet, basename="approval-matrix")

urlpatterns = router.urls
