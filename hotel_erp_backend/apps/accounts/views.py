from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.models import Group
from django.db.models import Count
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from apps.accounts.serializers import RoleSerializer, UserSerializer


User = get_user_model()


def _user_role(user) -> str:
    if user.is_superuser:
        return "Administrator"
    group = user.groups.first()
    return group.name if group else "Staff"


def _user_payload(user) -> dict:
    employee = getattr(user, "employee_profile", None)
    return {
        "id": user.employee_code or str(user.pk),
        "name": user.get_full_name() or user.username,
        "role": _user_role(user),
        "username": user.username,
        "branch_id": str(employee.branch_id) if employee and employee.branch_id else "",
        "branch_name": employee.branch.name if employee and employee.branch_id else "",
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
        "permissions": sorted(user.get_all_permissions()),
    }


class LoginView(APIView):
    """Exchange username/employee code + password for an auth token."""

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def post(self, request):
        identifier = str(request.data.get("username", "")).strip()
        password = str(request.data.get("password", ""))
        if not identifier or not password:
            return Response(
                {"detail": "Username and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = authenticate(request, username=identifier, password=password)
        if user is None:
            # Allow logging in with the employee code instead of the username.
            try:
                candidate = User.objects.get(employee_code=identifier)
            except User.DoesNotExist:
                candidate = None
            if candidate is not None:
                user = authenticate(request, username=candidate.username, password=password)

        if user is None or not user.is_active:
            return Response(
                {"detail": "Invalid credentials."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": _user_payload(user)})


class CurrentUserView(APIView):
    """Return the authenticated user's profile (used to restore a session)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(_user_payload(request.user))


class LogoutView(APIView):
    """Invalidate the caller's auth token."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserViewSet(ModelViewSet):
    queryset = User.objects.all().order_by("username")
    serializer_class = UserSerializer
    permission_classes = [IsAdminUser]
    search_fields = ("username", "email", "employee_code", "first_name", "last_name")
    ordering_fields = ("username", "employee_code", "date_joined")


class RoleViewSet(ModelViewSet):
    queryset = Group.objects.annotate(user_count=Count("user")).order_by("name")
    serializer_class = RoleSerializer
    permission_classes = [IsAdminUser]
    search_fields = ("name",)
    ordering_fields = ("name",)
