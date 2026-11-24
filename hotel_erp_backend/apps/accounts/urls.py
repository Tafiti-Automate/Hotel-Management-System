from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import CurrentUserView, LoginView, LogoutView, PasswordResetRequestView, PasswordResetConfirmView, PermissionViewSet, RoleViewSet, UserViewSet


router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("roles", RoleViewSet, basename="role")
router.register("permissions", PermissionViewSet, basename="permission")

urlpatterns = [
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/password-reset/request/", PasswordResetRequestView.as_view(), name="password-reset-request"),
    path("auth/password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
    path("auth/me/", CurrentUserView.as_view(), name="auth-me"),
    *router.urls,
]
