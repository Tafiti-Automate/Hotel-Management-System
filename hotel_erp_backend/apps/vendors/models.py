from django.db import models

from core.mixins.models import BaseModel


class Supplier(BaseModel):
    name = models.CharField(max_length=200)
    supplier_code = models.CharField(max_length=50, unique=True, blank=True, null=True)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=30)
    address = models.TextField()
    contact_person = models.CharField(max_length=100, blank=True)
    payment_terms = models.CharField(max_length=50, default="Net 30")
    tin_number = models.CharField(max_length=100, unique=True)
    registration_number = models.CharField(max_length=100, unique=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("name",)

    def __str__(self):
        if self.supplier_code:
            return f"{self.name} ({self.supplier_code})"
        return self.name

    def save(self, *args, **kwargs):
        if not self.supplier_code:
            last_supplier = (
                Supplier.objects.filter(supplier_code__startswith="SUP-")
                .order_by("supplier_code")
                .last()
            )
            next_number = 1
            if last_supplier and last_supplier.supplier_code:
                try:
                    next_number = int(last_supplier.supplier_code.split("-")[1]) + 1
                except (IndexError, ValueError):
                    next_number = 1
            self.supplier_code = f"SUP-{next_number:03d}"
        super().save(*args, **kwargs)
