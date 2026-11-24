import logging
from urllib.parse import urlencode, urlsplit
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import transaction
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.contrib.auth.models import Group, Permission
from django.db.models import Count
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import mixins
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.viewsets import GenericViewSet, ModelViewSet, ReadOnlyModelViewSet

from apps.accounts.serializers import PermissionSerializer, RoleSerializer, UserSerializer, TECHNICAL_ROLE_NAMES
from apps.audit_logs.services import record_audit


User = get_user_model()


def _user_role(user) -> str:
    if user.is_superuser:
        return "Administrator"
    group = user.groups.first()
    return group.name if group else "Staff"


def _employee_photo_url(employee, request=None) -> str:
    if not employee or not employee.photo:
        return ""
    try:
        url = employee.photo.url
    except (ValueError, AttributeError):
        return ""
    if request is not None and url and not str(url).startswith(("http://", "https://")):
        return request.build_absolute_uri(url)
    return str(url or "")


def _user_payload(user, request=None) -> dict:
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
        "designation": employee.designation if employee else "",
        "photo_url": _employee_photo_url(employee, request),
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
        "permissions": sorted(user.get_all_permissions()),
    }


class LoginView(APIView):
    """Exchange username/employee code + password for a short-lived auth token."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

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

        if user is None and "@" in identifier:
            candidates = list(User.objects.filter(email__iexact=identifier, is_active=True)[:2])
            if len(candidates) == 1:
                user = authenticate(request, username=candidates[0].username, password=password)

        if user is None or not user.is_active:
            record_audit(
                action="login_failed",
                entity_type="accounts.User",
                metadata={"identifier": identifier},
            )
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

        # One active API credential per user reduces stolen-token lifetime and
        # invalidates credentials left behind on another workstation.
        Token.objects.filter(user=user).delete()
        token = Token.objects.create(user=user)
        record_audit(
            actor=user,
            action="login_succeeded",
            entity_type="accounts.User",
            entity_id=str(user.pk),
            metadata={"role": _user_role(user)},
            created_by=user,
        )
        return Response({"token": token.key, "user": _user_payload(user, request)})


class PasswordResetRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset_request"

    def post(self, request):
        email = str(request.data.get("email", "")).strip()
        try:
            validate_email(email)
        except DjangoValidationError:
            return Response({"detail": "Enter a valid email address."}, status=400)
        url = settings.PASSWORD_RESET_FRONTEND_URL
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path.rstrip("/") != "/login" or not settings.EMAIL_HOST and settings.EMAIL_BACKEND.endswith("smtp.EmailBackend"):
            logging.getLogger(__name__).warning("Password recovery unavailable: frontend URL or email configuration invalid")
            return Response({"detail": "Unable to process your request at the moment. Please try again later."}, status=503)
        # Duplicate email addresses cannot safely identify one staff account.
        candidates = list(User.objects.filter(email__iexact=email, is_active=True)[:2])
        if len(candidates) == 1 and candidates[0].has_usable_password():
            user = candidates[0]
            link = url + "#" + urlencode({"uid": urlsafe_base64_encode(force_bytes(user.pk)), "token": default_token_generator.make_token(user)})
            try:
                send_mail("Hotel ERP password reset", "A password reset was requested for your Hotel ERP account.\n\nOpen this link to choose a new password:\n" + link + "\n\nIf you did not request this, ignore this email.", settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False)
            except Exception:
                logging.getLogger(__name__).warning("Password reset email delivery failed")
        return Response({"detail": "If an eligible account matches, reset instructions will be sent."})


class PasswordResetConfirmView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset_confirm"

    @transaction.atomic
    def post(self, request):
        try:
            uid = force_str(urlsafe_base64_decode(str(request.data.get("uid", ""))))
            user = User.objects.select_for_update().get(pk=uid, is_active=True)
        except (ValueError, TypeError, OverflowError, User.DoesNotExist, DjangoValidationError):
            user = None
        token = str(request.data.get("token", ""))
        if user is None or not user.has_usable_password() or not default_token_generator.check_token(user, token):
            return Response({"detail": "This reset link is invalid or expired. Request a new link."}, status=400)
        password = str(request.data.get("password", ""))
        if not password or len(password) > 256:
            return Response({"detail": "Enter a valid new password."}, status=400)
        try:
            validate_password(password, user)
        except DjangoValidationError as error:
            return Response({"detail": " ".join(error.messages)}, status=400)
        user.set_password(password)
        user.save(update_fields=["password"])
        Token.objects.filter(user=user).delete()
        return Response({"detail": "Password changed successfully."})


class CurrentUserView(APIView):
    """Return the authenticated user's profile (used to restore a session)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(_user_payload(request.user, request))


class LogoutView(APIView):
    """Invalidate the caller's auth token."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        record_audit(
            actor=request.user,
            action="logout",
            entity_type="accounts.User",
            entity_id=str(request.user.pk),
            created_by=request.user,
        )
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class IsHotelSystemAdministrator(BasePermission):
    """Role-based IT administration (without granting financial posting rights)."""

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user and user.is_authenticated and user.is_active
            and (user.is_superuser or user.groups.filter(name="System Administrator").exists())
        )


class UserViewSet(ModelViewSet):
    queryset = User.objects.all().order_by("username")
    serializer_class = UserSerializer
    permission_classes = [IsHotelSystemAdministrator]
    search_fields = ("username", "email", "employee_code", "first_name", "last_name")
    ordering_fields = ("username", "employee_code", "date_joined")


class RoleViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, GenericViewSet):
    """Operational roles and permissions are fixed; administrators only assign users."""
    queryset = Group.objects.annotate(user_count=Count("user")).order_by("name")
    serializer_class = RoleSerializer
    permission_classes = [IsHotelSystemAdministrator]
    search_fields = ("name",)
    ordering_fields = ("name",)



class PermissionViewSet(ReadOnlyModelViewSet):
    queryset = Permission.objects.select_related("content_type").order_by(
        "content_type__app_label", "content_type__model", "codename"
    )
    serializer_class = PermissionSerializer
    permission_classes = [IsHotelSystemAdministrator]
    pagination_class = None
