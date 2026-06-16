from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    employee_code = models.CharField(max_length=50, unique=True)
    phone = models.CharField(max_length=20, blank=True)

    REQUIRED_FIELDS = ["employee_code"]

    def __str__(self):
        display_name = self.get_full_name() or self.username
        return f"{display_name} ({self.employee_code})"
