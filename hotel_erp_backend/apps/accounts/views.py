from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.models import Group, Permission
from django.db.models import Count
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import mixins
from rest_framework.viewsets import GenericViewSet, ModelViewSet, ReadOnlyModelViewSet

from apps.accounts.serializers import PermissionSerializer, RoleSerializer, UserSerializer, TECHNICAL_ROLE_NAMES


User = get_user_model()


def _user_role(user) -> str:
    if user.is_superuser:
        return "Administrator"
    group = user.groups.first()
    return group.name if group else "Staff"


def _user_payload(user) -> dict:
    employee = getattr(user, "employee_profile", None)
    return {
        "id": str(user.pk),
        "user_id": str(user.pk),
        "employee_id": str(employee.pk) if employee else "",
        "employee_code": user.employee_code or "",
        "name": user.get_full_name() or user.username,
        "role": _user_role(user),
        "username": user.username,
        "branch_id": str(employee.branch_id) if employee and employee.branch_id else "",
        "branch_name": employee.branch.name if employee and employee.branch_id else "",
        "department_id": str(employee.department_id) if employee and employee.department_id else "",
        "department_name": employee.department.name if employee and employee.department_id else "",
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

        employee = getattr(user, "employee_profile", None)
        role_name = _user_role(user).strip().lower()
        is_technical_account = user.is_superuser or (
            user.account_type == User.ACCOUNT_SYSTEM and role_name in TECHNICAL_ROLE_NAMES
        )
        if employee is None and not is_technical_account:
            return Response(
                {"detail": "This account is not linked to an employee profile."},
                status=status.HTTP_403_FORBIDDEN,
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


class RoleViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, GenericViewSet):
    """Predefined role names are fixed; administrators may tune their permissions."""
    queryset = Group.objects.annotate(user_count=Count("user")).order_by("name")
    serializer_class = RoleSerializer
    permission_classes = [IsAdminUser]
    search_fields = ("name",)
    ordering_fields = ("name",)



class PermissionViewSet(ReadOnlyModelViewSet):
    queryset = Permission.objects.select_related("content_type").order_by(
        "content_type__app_label", "content_type__model", "codename"
    )
    serializer_class = PermissionSerializer
    permission_classes = [IsAdminUser]
    pagination_class = None
