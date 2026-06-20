from .base import *


DEBUG = False

# Behind a TLS-terminating proxy (e.g. Railway), trust the forwarded protocol
# header so SECURE_SSL_REDIRECT doesn't cause an infinite redirect loop.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True

# Allow the platform's CSRF-trusted origins to be supplied via env (comma list),
# e.g. "https://your-app.up.railway.app". Required for the Django admin/login
# to work over HTTPS behind the proxy.
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",")
    if origin.strip()
]

SECURE_SSL_REDIRECT = os.environ.get("DJANGO_SECURE_SSL_REDIRECT", "True").lower() in {
    "1",
    "true",
    "yes",
}
SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_SECURE_HSTS_SECONDS", "31536000"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = os.environ.get(
    "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS",
    "True",
).lower() in {"1", "true", "yes"}
SECURE_HSTS_PRELOAD = os.environ.get("DJANGO_SECURE_HSTS_PRELOAD", "True").lower() in {
    "1",
    "true",
    "yes",
}
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
X_FRAME_OPTIONS = "DENY"
