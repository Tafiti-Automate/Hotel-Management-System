import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse


def test_site_root_redirects_to_admin(client):
    response = client.get("/")

    assert response.status_code == 302
    assert response["Location"] == reverse("admin:index")


@pytest.mark.django_db
def test_purchase_order_add_admin_renders_blank_inline(client):
    user = get_user_model().objects.create_superuser(
        username="admin-po",
        employee_code="EMP-ADMIN-PO",
        password="test-pass-123",
        email="admin-po@example.com",
    )
    client.force_login(user)

    response = client.get(reverse("admin:procurement_purchaseorder_add"))

    assert response.status_code == 200
