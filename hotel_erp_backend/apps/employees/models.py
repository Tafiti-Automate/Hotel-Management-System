from django.conf import settings
from django.db import models

from core.mixins.models import BaseModel


class Designation(BaseModel):
    department = models.ForeignKey(
        "departments.Department",
        on_delete=models.CASCADE,
        related_name="designations",
    )
    title = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("department", "title"),
                name="unique_department_designation",
            )
        ]
        ordering = ("department__name", "title")

    def __str__(self):
        return f"{self.title} ({self.department.name})"


class Employee(BaseModel):
    GENDER_CHOICES = (("Male", "Male"), ("Female", "Female"))
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="employee_profile",
    )
    department = models.ForeignKey(
        "departments.Department",
        on_delete=models.PROTECT,
        related_name="employees",
    )
    branch = models.ForeignKey(
        "departments.Branch",
        on_delete=models.PROTECT,
        related_name="employees",
        null=True,
        blank=True,
    )
    designation_record = models.ForeignKey(
        Designation,
        on_delete=models.SET_NULL,
        related_name="employees",
        null=True,
        blank=True,
    )
    designation = models.CharField(max_length=100)
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES, blank=True)
    contact = models.CharField(max_length=30, blank=True)
    address = models.TextField(blank=True)
    date_joined = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    photo = models.ImageField(upload_to="employee_photos/", blank=True, null=True, max_length=500)

    class Meta(BaseModel.Meta):
        ordering = ("user__first_name", "user__last_name", "user__username")

    def __str__(self):
        display_name = self.user.get_full_name() or self.user.username
        return f"{display_name} - {self.designation}"
