from django.contrib.auth import get_user_model
from rest_framework.permissions import IsAdminUser
from rest_framework.viewsets import ModelViewSet

from apps.accounts.serializers import UserSerializer


User = get_user_model()


class UserViewSet(ModelViewSet):
    queryset = User.objects.all().order_by("username")
    serializer_class = UserSerializer
    permission_classes = [IsAdminUser]
    search_fields = ("username", "email", "employee_code", "first_name", "last_name")
    ordering_fields = ("username", "employee_code", "date_joined")
