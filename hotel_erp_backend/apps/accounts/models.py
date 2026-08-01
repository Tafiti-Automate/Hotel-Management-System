from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    ACCOUNT_EMPLOYEE = "employee"
    ACCOUNT_SYSTEM = "system"
    ACCOUNT_TYPE_CHOICES = (
        (ACCOUNT_EMPLOYEE, "Employee account"),
        (ACCOUNT_SYSTEM, "System account"),
    )

    employee_code = models.CharField(max_length=50, unique=True)
    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES, default=ACCOUNT_EMPLOYEE)
    phone = models.CharField(max_length=20, blank=True)

    REQUIRED_FIELDS = ["employee_code"]

    def __str__(self):
        display_name = self.get_full_name() or self.username
        return f"{display_name} ({self.employee_code})"
