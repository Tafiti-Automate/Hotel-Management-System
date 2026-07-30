import pytest
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_authenticated_user_can_log_out_and_revoke_token():
    user = get_user_model().objects.create_user(
        username="logout-user",
        employee_code="EMP-LOGOUT",
        password="test-pass-123",
    )
    token = Token.objects.create(user=user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    response = client.post("/api/v1/auth/logout/")

    assert response.status_code == 204
    assert Token.objects.filter(user=user).exists() is False


@pytest.mark.django_db
def test_logout_requires_authentication():
    response = APIClient().post("/api/v1/auth/logout/")

    assert response.status_code == 401
