from django.db import models

from core.mixins.models import BaseModel


class Hotel(BaseModel):
    """Parent hotel/company profile.

    Supports both a single property hotel and a hotel group with many branches.
    Branch/property records live in departments.Branch and point back to this model.
    """

    BUSINESS_TYPE_SINGLE = "single"
    BUSINESS_TYPE_GROUP = "group"
    BUSINESS_TYPE_CHOICES = [
        (BUSINESS_TYPE_SINGLE, "Single Hotel"),
        (BUSINESS_TYPE_GROUP, "Hotel Group / Multiple Branches"),
    ]

    name = models.CharField(max_length=150, unique=True)
    legal_name = models.CharField(max_length=200, blank=True)
    business_type = models.CharField(
        max_length=20,
        choices=BUSINESS_TYPE_CHOICES,
        default=BUSINESS_TYPE_SINGLE,
        help_text="Use Single Hotel for one property, or Hotel Group for many branches.",
    )
    registration_number = models.CharField(max_length=100, blank=True)
    tax_identification_number = models.CharField(
        "TIN", max_length=100, blank=True
    )
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    alternate_phone = models.CharField(max_length=30, blank=True)
    website = models.URLField(blank=True)
    logo = models.ImageField(upload_to="hotel_logos/", blank=True, null=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, default="Uganda")
    currency = models.CharField(max_length=10, default="UGX")
    timezone = models.CharField(max_length=50, default="Africa/Kampala")
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        ordering = ("name",)

    def __str__(self):
        return self.name
