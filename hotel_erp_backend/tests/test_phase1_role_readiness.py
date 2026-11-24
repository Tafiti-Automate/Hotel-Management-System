"""Read-only role acceptance preflight must fail closed if accounts are missing."""
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.role_templates import SYSTEM_ROLE_NAMES, MATERIALS_CONTROL_ROLE_NAMES


@pytest.mark.django_db
def test_erp_twelve_roles_and_inventory_ten_are_both_well_defined():
    assert len(SYSTEM_ROLE_NAMES) == 12
    assert len(set(SYSTEM_ROLE_NAMES)) == 12
    assert len(MATERIALS_CONTROL_ROLE_NAMES) == 10
    assert set(MATERIALS_CONTROL_ROLE_NAMES).issubset(SYSTEM_ROLE_NAMES)


@pytest.mark.django_db
def test_missing_live_role_accounts_block_strict_acceptance():
    call_command("setup_hotel_roles", verbosity=0)
    output = StringIO()
    with pytest.raises(CommandError, match="Role acceptance is blocked"):
        call_command("audit_role_readiness", "--strict", stdout=output)
    assert "Role readiness: 0/12" in output.getvalue()


@pytest.mark.django_db
def test_role_audit_is_read_only_and_supports_non_strict_reports():
    call_command("setup_hotel_roles", verbosity=0)
    output = StringIO()
    call_command("audit_role_readiness", stdout=output)
    assert "Role readiness: 0/12" in output.getvalue()


@pytest.mark.django_db
def test_role_readiness_json_is_machine_readable_and_contains_no_personal_data():
    import json
    call_command("setup_hotel_roles", verbosity=0)
    output = StringIO()
    call_command("audit_role_readiness", "--json", stdout=output)
    report = json.loads(output.getvalue())
    assert report["schema_version"] == 1
    assert report["read_only"] is True
    assert report["all_roles_ready"] is False
    assert report["ready_role_count"] == 0
    assert report["required_role_count"] == len(SYSTEM_ROLE_NAMES)
    assert {row["role"] for row in report["roles"]} == set(SYSTEM_ROLE_NAMES)
    assert all(row["blocker"] == "no_active_assigned_user" for row in report["roles"])
    assert all(set(row) == {
        "role", "ready", "ready_users", "inactive_users",
        "missing_assignment_users", "blocker"
    } for row in report["roles"])


@pytest.mark.django_db
def test_role_readiness_json_strict_fails_closed_without_role_users():
    import json
    call_command("setup_hotel_roles", verbosity=0)
    output = StringIO()
    with pytest.raises(CommandError, match="Role acceptance is blocked"):
        call_command("audit_role_readiness", "--json", "--strict", stdout=output)
    assert json.loads(output.getvalue())["all_roles_ready"] is False


@pytest.mark.django_db
def test_role_readiness_json_recognizes_assigned_finance_user_without_exposing_identity():
    import json
    from django.contrib.auth import get_user_model
    from django.contrib.auth.models import Group
    from apps.departments.models import Branch, Department
    from apps.employees.models import Employee

    call_command("setup_hotel_roles", verbosity=0)
    user = get_user_model().objects.create_user(
        username="finance-acceptance-private", employee_code="ACC-FIN-001",
        password="not-a-live-credential",
    )
    branch = Branch.objects.create(name="Finance acceptance property")
    department = Department.objects.create(name="Finance acceptance team")
    Employee.objects.create(
        user=user, branch=branch, department=department,
        designation="Financial Manager",
    )
    user.groups.add(Group.objects.get(name="Financial Manager"))
    output = StringIO()
    call_command("audit_role_readiness", "--json", stdout=output)
    body = output.getvalue()
    report = json.loads(body)
    finance = next(row for row in report["roles"] if row["role"] == "Financial Manager")
    assert finance["ready"] is True
    assert finance["ready_users"] == 1
    assert report["ready_role_count"] == 1
    assert "finance-acceptance-private" not in body
    assert "ACC-FIN-001" not in body


@pytest.mark.django_db
def test_inventory_certification_preflight_checks_exactly_ten_operational_roles():
    import json
    call_command("setup_hotel_roles", verbosity=0)
    output = StringIO()
    call_command("audit_role_readiness", "--json", "--materials-control", stdout=output)
    result = json.loads(output.getvalue())
    assert result["required_role_count"] == 10
    assert {row["role"] for row in result["roles"]} == set(MATERIALS_CONTROL_ROLE_NAMES)
    assert result["all_roles_ready"] is False
    assert result["read_only"] is True
