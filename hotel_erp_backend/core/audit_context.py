from contextvars import ContextVar

_current_request = ContextVar("audit_current_request", default=None)


def set_current_request(request):
    return _current_request.set(request)


def reset_current_request(token):
    _current_request.reset(token)


def get_current_request():
    return _current_request.get()


def request_metadata():
    request = get_current_request()
    if request is None:
        return {"request_id": "", "ip_address": None, "user_agent": "", "actor": None}

    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    remote = request.META.get("REMOTE_ADDR")
    # Use the closest proxy-provided client address only when present; deployment
    # proxies should overwrite X-Forwarded-For rather than append untrusted data.
    ip_address = forwarded.split(",")[0].strip() if forwarded else remote
    actor = getattr(request, "user", None)
    if not getattr(actor, "is_authenticated", False):
        actor = None
    return {
        "request_id": str(getattr(request, "request_id", "") or ""),
        "ip_address": ip_address or None,
        "user_agent": str(request.META.get("HTTP_USER_AGENT", ""))[:500],
        "actor": actor,
    }
