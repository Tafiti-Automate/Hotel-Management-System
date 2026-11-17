"""Read-only role acceptance preflight must fail closed if accounts are missing."""
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.role_templates import SYSTEM_ROLE_NAMES


@pytest.mark.django_db
def test_ten_canonical_roles_are_defined():
    assert len(SYSTEM_ROLE_NAMES) == 10
    assert len(set(SYSTEM_ROLE_NAMES)) == 10


@pytest.mark.django_db
def test_missing_live_role_accounts_block_strict_acceptance():
    call_command("setup_hotel_roles", verbosity=0)
    output = StringIO()
    with pytest.raises(CommandError, match="Role acceptance is blocked"):
        call_command("audit_role_readiness", "--strict", stdout=output)
    assert "Role readiness: 0/10" in output.getvalue()


@pytest.mark.django_db
def test_role_audit_is_read_only_and_supports_non_strict_reports():
    call_command("setup_hotel_roles", verbosity=0)
    output = StringIO()
    call_command("audit_role_readiness", stdout=output)
    assert "Role readiness: 0/10" in output.getvalue()
