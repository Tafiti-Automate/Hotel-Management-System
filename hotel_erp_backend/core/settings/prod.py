import os

from .base import *  # noqa: F403,F401


# ---------------------------------------------------------
# Database
# ---------------------------------------------------------

# Production must always use PostgreSQL/Neon.
if not os.environ.get("DATABASE_URL"):
    raise RuntimeError(
        "DATABASE_URL is required in production. "
        "Add the Neon PostgreSQL connection string to the deployment environment."
    )


DEBUG = False


# ---------------------------------------------------------
# Reverse proxy and HTTPS
# ---------------------------------------------------------

# Vercel and Railway terminate HTTPS before forwarding requests to Django.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True


# ---------------------------------------------------------
# Allowed hosts
# ---------------------------------------------------------

# Start with hosts supplied manually through:
# DJANGO_ALLOWED_HOSTS=backend.example.com,another.example.com
ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get(
        "DJANGO_ALLOWED_HOSTS",
        "localhost,127.0.0.1",
    ).split(",")
    if host.strip()
]


# Support Railway automatically.
RAILWAY_PUBLIC_DOMAIN = os.environ.get(
    "RAILWAY_PUBLIC_DOMAIN",
    "",
).strip()

if RAILWAY_PUBLIC_DOMAIN and RAILWAY_PUBLIC_DOMAIN not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(RAILWAY_PUBLIC_DOMAIN)


# Support Vercel automatically.
# VERCEL_URL normally contains only the hostname, without https://.
VERCEL_URL = os.environ.get("VERCEL_URL", "").strip()

if VERCEL_URL and VERCEL_URL not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(VERCEL_URL)


# Optional permanent production domain supplied manually.
VERCEL_PROJECT_PRODUCTION_URL = os.environ.get(
    "VERCEL_PROJECT_PRODUCTION_URL",
    "",
).strip()

if (
    VERCEL_PROJECT_PRODUCTION_URL
    and VERCEL_PROJECT_PRODUCTION_URL not in ALLOWED_HOSTS
):
    ALLOWED_HOSTS.append(VERCEL_PROJECT_PRODUCTION_URL)


# ---------------------------------------------------------
# CORS
# ---------------------------------------------------------

DEFAULT_FRONTEND_ORIGIN = "https://hotel-management-system-five-livid.vercel.app"

CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        DEFAULT_FRONTEND_ORIGIN,
    ).split(",")
    if origin.strip()
]

CORS_URLS_REGEX = r"^/api/.*$"


# ---------------------------------------------------------
# CSRF
# ---------------------------------------------------------

CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "DJANGO_CSRF_TRUSTED_ORIGINS",
        "",
    ).split(",")
    if origin.strip()
]


# Trust the Railway public origin automatically.
if RAILWAY_PUBLIC_DOMAIN:
    railway_origin = f"https://{RAILWAY_PUBLIC_DOMAIN}"

    if railway_origin not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append(railway_origin)


# Trust the current Vercel deployment URL automatically.
if VERCEL_URL:
    vercel_origin = f"https://{VERCEL_URL}"

    if vercel_origin not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append(vercel_origin)


# Trust the permanent Vercel production URL automatically.
if VERCEL_PROJECT_PRODUCTION_URL:
    vercel_production_origin = f"https://{VERCEL_PROJECT_PRODUCTION_URL}"

    if vercel_production_origin not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append(vercel_production_origin)


# ---------------------------------------------------------
# Production security
# ---------------------------------------------------------

SECURE_SSL_REDIRECT = os.environ.get(
    "DJANGO_SECURE_SSL_REDIRECT",
    "True",
).lower() in {
    "1",
    "true",
    "yes",
}

SECURE_HSTS_SECONDS = int(
    os.environ.get(
        "DJANGO_SECURE_HSTS_SECONDS",
        "31536000",
    )
)

SECURE_HSTS_INCLUDE_SUBDOMAINS = os.environ.get(
    "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS",
    "True",
).lower() in {
    "1",
    "true",
    "yes",
}

SECURE_HSTS_PRELOAD = os.environ.get(
    "DJANGO_SECURE_HSTS_PRELOAD",
    "True",
).lower() in {
    "1",
    "true",
    "yes",
}

SECURE_CONTENT_TYPE_NOSNIFF = True

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = False

X_FRAME_OPTIONS = "DENY"


# ---------------------------------------------------------
# Cross-origin cookie settings
# ---------------------------------------------------------

# Required only when the React frontend uses Django session authentication
# across separate frontend and backend domains.
SESSION_COOKIE_SAMESITE = os.environ.get(
    "SESSION_COOKIE_SAMESITE",
    "Lax",
)

CSRF_COOKIE_SAMESITE = os.environ.get(
    "CSRF_COOKIE_SAMESITE",
    "Lax",
)



# Jazzmin/Bootstrap bundles can reference optional source-map files that are
# not shipped in some package builds. CompressedStaticFilesStorage compresses
# and serves those assets without manifest URL rewriting, so collectstatic does
# not fail on missing *.map development files.

# ---------------------------------------------------------
# Persistent uploaded media (Vercel Blob)
# ---------------------------------------------------------
# Vercel serverless functions cannot persist files under /var/task. When a
# Blob store is connected to this backend project, Vercel injects
# BLOB_READ_WRITE_TOKEN and Django stores ImageField/FileField uploads there.
BLOB_READ_WRITE_TOKEN = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
VERCEL_BLOB_CONFIGURED = bool(BLOB_READ_WRITE_TOKEN)

if VERCEL_BLOB_CONFIGURED:
    STORAGES = {
        "default": {
            "BACKEND": "core.storage.VercelBlobStorage",
        },
        "staticfiles": {
            "BACKEND": "whitenoise.storage.CompressedStaticFilesStorage",
        },
    }
else:
    # Local development keeps the normal writable media directory. Production
    # uploads are rejected by serializer validation when Blob is not configured.
    STORAGES = {
        "default": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
        },
        "staticfiles": {
            "BACKEND": "whitenoise.storage.CompressedStaticFilesStorage",
        },
    }
