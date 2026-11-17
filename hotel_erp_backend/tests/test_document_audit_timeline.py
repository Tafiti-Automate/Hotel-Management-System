"""Role and property isolation for read-only operational audit timelines."""
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from rest_framework.test import APIClient

from apps.audit_logs.models import AuditLog
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from tests.test_department_head_requisitions import workflow, _create_supervisor_draft


@pytest.mark.django_db
def test_document_audit_requires_the_owning_supervisors_property_and_identity(workflow):
    request_id, _ = _create_supervisor_draft(workflow)
    user = workflow["supervisor"][0]
    supervisor_api = workflow["supervisor"][2]
    group = Group.objects.get(name="Department Supervisor")
    group.permissions.add(Permission.objects.get(
        content_type__app_label="inventory", codename="view_storerequisition"
    ))
    AuditLog.objects.create(
        actor=user, action="store_request_approved_audit_test",
        entity_type="inventory.StoreRequisition", entity_id=str(request_id),
        metadata={"private_price": "do not disclose"},
    )
    result = supervisor_api.get(
        f"/api/v1/document-audit/requisition/{request_id}/"
    )
    assert result.status_code == 200, result.data
    matches = [e for e in result.data["events"] if e["action"] == "store_request_approved_audit_test"]
    assert len(matches) == 1
    assert matches[0]["entry_hash"]
    assert matches[0]["actor"]
    assert "metadata" not in matches[0]
    assert "private_price" not in str(result.data)

    stranger = get_user_model().objects.create_user(
        username="audit-other-property", employee_code="AUDIT-OTHER",
    )
    stranger_group, _ = Group.objects.get_or_create(name="Cost Controller")
    stranger_group.permissions.add(Permission.objects.get(
        content_type__app_label="inventory", codename="view_storerequisition"
    ))
    stranger.groups.add(stranger_group)
    new_branch = Branch.objects.create(name="Completely Other Property")
    Employee.objects.create(
        user=stranger, branch=new_branch, department=workflow["department"],
        designation="Cost Controller",
    )
    other_api = APIClient()
    other_api.force_authenticate(stranger)
    denied = other_api.get(f"/api/v1/document-audit/requisition/{request_id}/")
    assert denied.status_code == 403
