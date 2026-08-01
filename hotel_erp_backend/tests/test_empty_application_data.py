from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.management.commands.setup_hotel_roles import ROLE_SPECS
from apps.organization.models import Hotel


@pytest.mark.django_db(transaction=True)
def test_empty_application_data_is_dry_run_by_default():
    User = get_user_model()
    User.objects.create_superuser(
        username="admin",
        employee_code="EMP-ADMIN",
        password="admin-password",
    )
    Hotel.objects.create(name="Demo Hotel")
    output = StringIO()

    call_command("empty_application_data", stdout=output)

    assert Hotel.objects.filter(name="Demo Hotel").exists()
    assert User.objects.filter(username="admin").exists()
    assert "Dry run only; nothing was deleted" in output.getvalue()


@pytest.mark.django_db(transaction=True)
def test_empty_application_data_requires_exact_confirmation():
    get_user_model().objects.create_superuser(
        username="admin",
        employee_code="EMP-ADMIN",
        password="admin-password",
    )

    with pytest.raises(CommandError, match="requires --confirm EMPTY-APPLICATION-DATA"):
        call_command(
            "empty_application_data",
            execute=True,
            confirm="wrong",
            verbosity=0,
        )


@pytest.mark.django_db(transaction=True)
def test_empty_application_data_preserves_superuser_and_rebuilds_roles():
    User = get_user_model()
    admin = User.objects.create_superuser(
        username="admin",
        employee_code="EMP-ADMIN",
        password="admin-password",
        email="admin@example.com",
    )
    User.objects.create_user(
        username="demo-user",
        employee_code="EMP-DEMO",
        password="demo-password",
    )
    Group.objects.create(name="Temporary Demo Group")
    Hotel.objects.create(name="Demo Hotel", created_by=admin)

    call_command(
        "empty_application_data",
        execute=True,
        confirm="EMPTY-APPLICATION-DATA",
        verbosity=0,
    )

    assert not Hotel.objects.exists()
    assert not User.objects.filter(username="demo-user").exists()
    restored_admin = User.objects.get(username="admin")
    assert restored_admin.is_superuser
    assert restored_admin.check_password("admin-password")
    assert not Group.objects.filter(name="Temporary Demo Group").exists()
    assert set(Group.objects.values_list("name", flat=True)) == set(ROLE_SPECS)
