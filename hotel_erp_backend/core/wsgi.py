"""WSGI config for the Hotel Management System backend."""
import os

from django.core.wsgi import get_wsgi_application


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings.prod")

application = get_wsgi_application()
