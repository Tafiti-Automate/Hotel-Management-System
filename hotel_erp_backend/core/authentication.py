import hashlib
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed


class ExpiringTokenAuthentication(TokenAuthentication):
    """DRF token authentication with absolute and idle-expiry controls.

    The existing API contract remains ``Authorization: Token <key>``. Tokens are
    rotated at login, expire after a fixed maximum lifetime, and also expire
    after a configurable period without authenticated API activity.
    """

    def _activity_key(self, token_key: str) -> str:
        digest = hashlib.sha256(token_key.encode("utf-8")).hexdigest()
        return f"auth:last_seen:{digest}"

    def authenticate_credentials(self, key):
        user, token = super().authenticate_credentials(key)
        now = timezone.now()
        max_age = int(getattr(settings, "AUTH_TOKEN_MAX_AGE_SECONDS", 14400))
        idle_timeout = int(getattr(settings, "AUTH_TOKEN_IDLE_TIMEOUT_SECONDS", 1800))

        if now - token.created >= timedelta(seconds=max_age):
            token.delete()
            cache.delete(self._activity_key(key))
            raise AuthenticationFailed("Your session has expired. Please sign in again.")

        activity_key = self._activity_key(key)
        last_seen = cache.get(activity_key)
        if last_seen is None:
            # A cache restart must never make an old token effectively immortal.
            last_seen = token.created.timestamp()
        try:
            idle_seconds = now.timestamp() - float(last_seen)
        except (TypeError, ValueError):
            idle_seconds = idle_timeout + 1

        if idle_seconds >= idle_timeout:
            token.delete()
            cache.delete(activity_key)
            raise AuthenticationFailed("Your session ended after a period of inactivity.")

        cache.set(activity_key, now.timestamp(), timeout=max_age)
        return user, token
