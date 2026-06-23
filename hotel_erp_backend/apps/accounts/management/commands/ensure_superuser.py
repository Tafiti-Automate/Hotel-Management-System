import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    help = "Create or update a superuser from environment variables."

    @transaction.atomic
    def handle(self, *args, **options):
        username = os.environ.get("DJANGO_SUPERUSER_USERNAME", "").strip()
        password = os.environ.get("DJANGO_SUPERUSER_PASSWORD", "")
        if not username or not password:
            self.stdout.write("DJANGO_SUPERUSER_USERNAME/PASSWORD not set; skipping superuser bootstrap.")
            return

        employee_code = os.environ.get("DJANGO_SUPERUSER_EMPLOYEE_CODE", username).strip() or username
        email = os.environ.get("DJANGO_SUPERUSER_EMAIL", "").strip()

        User = get_user_model()
        conflict = User.objects.filter(employee_code=employee_code).exclude(username=username).first()
        if conflict:
            self.stderr.write(
                self.style.ERROR(
                    f"Employee code {employee_code!r} already belongs to user {conflict.username!r}."
                )
            )
            return

        user, created = User.objects.get_or_create(
            username=username,
            defaults={"employee_code": employee_code, "email": email},
        )
        user.employee_code = employee_code
        if email:
            user.email = email
        user.is_staff = True
        user.is_superuser = True
        user.is_active = True
        user.set_password(password)
        user.save()

        action = "Created" if created else "Updated"
        self.stdout.write(self.style.SUCCESS(f"{action} superuser {username!r}."))
