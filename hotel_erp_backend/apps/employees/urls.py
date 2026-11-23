from rest_framework.routers import DefaultRouter

from apps.employees.views import DesignationViewSet, EmployeeViewSet
from apps.employees.payroll_views import (
    EmployeeDocumentViewSet,
    LeaveRequestViewSet,
    PayrollAffectorViewSet,
    PayrollEntryViewSet,
    PayrollPeriodViewSet,
    PayrollProfileViewSet,
    SalaryAdvanceRepaymentViewSet,
    SalaryAdvanceViewSet,
)


router = DefaultRouter()
router.register("employees", EmployeeViewSet, basename="employee")
router.register("designations", DesignationViewSet, basename="designation")
router.register("payroll-profiles", PayrollProfileViewSet, basename="payroll-profile")
router.register("payroll-affectors", PayrollAffectorViewSet, basename="payroll-affector")
router.register("salary-advances", SalaryAdvanceViewSet, basename="salary-advance")
router.register("payroll-periods", PayrollPeriodViewSet, basename="payroll-period")
router.register("payroll-entries", PayrollEntryViewSet, basename="payroll-entry")
router.register("salary-advance-repayments", SalaryAdvanceRepaymentViewSet, basename="salary-advance-repayment")
router.register("leave-requests", LeaveRequestViewSet, basename="leave-request")
router.register("employee-documents", EmployeeDocumentViewSet, basename="employee-document")

urlpatterns = router.urls
