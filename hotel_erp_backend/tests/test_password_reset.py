import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.test import override_settings
from rest_framework.authtoken.models import Token
from urllib.parse import parse_qs, urlsplit

@pytest.mark.django_db
@override_settings(PASSWORD_RESET_FRONTEND_URL="https://hotel.example.com/login", CACHES={"default":{"BACKEND":"django.core.cache.backends.dummy.DummyCache"}})
def test_password_reset_revokes_token_and_rejects_reuse(client):
    user = get_user_model().objects.create_user(username="recovery", employee_code="RESET-1", email="staff@example.com", password="Old-Password-123")
    Token.objects.create(user=user)
    path = "/api/v1/auth/password-reset/"
    response = client.post(path+"request/", {"email":user.email}, content_type="application/json")
    assert response.status_code == 200
    link = next(line for line in mail.outbox[0].body.splitlines() if line.startswith("https://"))
    params = {k:v[0] for k,v in parse_qs(urlsplit(link).fragment).items()}
    body = {**params,"password":"New-Strong-Password-472"}
    assert client.post(path+"confirm/",body,content_type="application/json").status_code == 200
    user.refresh_from_db()
    assert user.check_password(body["password"])
    assert not Token.objects.filter(user=user).exists()
    assert client.post(path+"confirm/",body,content_type="application/json").status_code == 400
    unknown = client.post(path+"request/",{"email":"unknown@example.com"},content_type="application/json")
    assert unknown.json() == response.json()
    assert len(mail.outbox) == 1

@pytest.mark.django_db
@override_settings(PASSWORD_RESET_FRONTEND_URL="", CACHES={"default":{"BACKEND":"django.core.cache.backends.dummy.DummyCache"}})
def test_unconfigured_recovery_does_not_expose_configuration(client):
    user = get_user_model().objects.create_user(username="private-reset", employee_code="RESET-2", email="known@example.com", password="Old-Password-123")
    path = "/api/v1/auth/password-reset/request/"
    for email in (user.email, "unknown@example.com"):
        response = client.post(path, {"email":email}, content_type="application/json")
        assert response.status_code == 503
        assert response.json()["detail"] == "Unable to process your request at the moment. Please try again later."
    assert not getattr(mail, "outbox", [])
