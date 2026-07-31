from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import CurrentUserView, LoginView, LogoutView, RoleViewSet, UserViewSet


router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("roles", RoleViewSet, basename="role")

urlpatterns = [
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/me/", CurrentUserView.as_view(), name="auth-me"),
    *router.urls,
]
