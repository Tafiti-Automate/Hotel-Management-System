from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.accounts.role_policy import grant_employee_self_service
from apps.employees.models import Employee


@receiver(post_save, sender=Employee)
def grant_department_request_access(sender, instance, **kwargs):
    """Department request access is employee self-service, not another role."""
    grant_employee_self_service(instance.user)
