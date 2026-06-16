from django.db import models

from core.mixins.models import BaseModel


class Department(BaseModel):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        ordering = ("name",)

    def __str__(self):
        return self.name


class Branch(BaseModel):
    BRANCH_TYPE_MAIN = "main"
    BRANCH_TYPE_BRANCH = "branch"
    BRANCH_TYPE_CHOICES = [
        (BRANCH_TYPE_MAIN, "Main Property"),
        (BRANCH_TYPE_BRANCH, "Branch Property"),
    ]

    hotel = models.ForeignKey(
        "organization.Hotel",
        related_name="branches",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        help_text="Parent hotel/company this property belongs to.",
    )
    name = models.CharField(max_length=100)
    branch_code = models.CharField(max_length=30, blank=True)
    branch_type = models.CharField(
        max_length=20,
        choices=BRANCH_TYPE_CHOICES,
        default=BRANCH_TYPE_MAIN,
    )
    location = models.TextField(blank=True)
    physical_address = models.TextField(blank=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, default="Uganda")
    contact_person = models.CharField(max_length=150, blank=True)
    contact = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    is_head_office = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        verbose_name_plural = "branches"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("hotel", "name"),
                name="unique_branch_name_per_hotel",
            ),
            models.UniqueConstraint(
                fields=("hotel", "branch_code"),
                condition=~models.Q(branch_code=""),
                name="unique_branch_code_per_hotel",
            ),
        ]

    def __str__(self):
        return f"{self.name} - {self.hotel.name}" if self.hotel_id else self.name
