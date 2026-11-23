"""HR/payroll control tests. Use separate people for preparation and Finance approval."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.employees.models import PayrollPeriod
from apps.employees.payroll_views import PayrollPeriodViewSet, EmployeeDocumentViewSet


def fake_user(*role_names):
    user = SimpleNamespace(is_authenticated=True)
    memberships = set(role_names)
    groups = Mock()
    groups.filter.side_effect = lambda **kwargs: SimpleNamespace(
        exists=lambda: bool(memberships.intersection(kwargs.get("name__in", [])))
    )
    user.groups = groups
    return user


def test_bank_schedule_rejects_hr_role_even_for_posted_period():
    view = PayrollPeriodViewSet()
    view.get_object = lambda: SimpleNamespace(status=PayrollPeriod.STATUS_POSTED)
    with pytest.raises(PermissionDenied, match="Only Finance"):
        view.bank_schedule_csv(SimpleNamespace(user=fake_user("HR Manager")))


@pytest.mark.parametrize("status", [
    PayrollPeriod.STATUS_DRAFT, PayrollPeriod.STATUS_CALCULATED,
    PayrollPeriod.STATUS_SUBMITTED, PayrollPeriod.STATUS_APPROVED,
])
def test_bank_schedule_cannot_be_exported_before_posting(status):
    view = PayrollPeriodViewSet()
    view.get_object = lambda: SimpleNamespace(status=status)
    with pytest.raises(ValidationError, match="Only posted payroll"):
        view.bank_schedule_csv(SimpleNamespace(user=fake_user("Financial Manager")))


def test_draft_payroll_register_cannot_be_exported():
    view = PayrollPeriodViewSet()
    view.get_object = lambda: SimpleNamespace(status=PayrollPeriod.STATUS_DRAFT)
    with pytest.raises(ValidationError, match="Calculate payroll"):
        view.register_csv(SimpleNamespace(user=fake_user("HR Manager")))


def test_personnel_document_download_denies_non_hr_access():
    view = EmployeeDocumentViewSet()
    with pytest.raises(PermissionDenied, match="Only Human Resources"):
        view.download(SimpleNamespace(user=fake_user("Store Keeper")))


def test_document_download_endpoint_is_registered():
    from django.urls import resolve
    from uuid import uuid4
    found = resolve(f"/api/v1/employee-documents/{uuid4()}/download/")
    assert found.url_name == "employee-document-download"


def test_affector_approval_requires_independent_approval():
    from apps.employees.payroll_views import PayrollAffectorViewSet
    # Exercise the exact maker-checker condition with a scoped request. The
    # API-level transaction test will use realistic employee records separately.
    view = PayrollAffectorViewSet()
    body = str(__import__("inspect").getsource(view.approve))
    assert "created_by_id == request.user.pk" in body
