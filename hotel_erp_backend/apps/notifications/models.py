from django.db import models

from core.mixins.models import BaseModel


class Notification(BaseModel):
    employee = models.ForeignKey(
        "employees.Employee",
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    title = models.CharField(max_length=255)
    message = models.TextField()
    is_read = models.BooleanField(default=False)

    class Meta(BaseModel.Meta):
        ordering = ("is_read", "-created_at")

    def __str__(self):
        return self.title
