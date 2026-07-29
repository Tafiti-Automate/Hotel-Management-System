import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings.prod")

from core.wsgi import application

app = application
