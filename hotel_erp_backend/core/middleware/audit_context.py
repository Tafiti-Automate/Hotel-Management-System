from core.audit_context import reset_current_request, set_current_request


class AuditRequestContextMiddleware:
    """Expose request metadata to audit signals without coupling business models to DRF."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = set_current_request(request)
        try:
            return self.get_response(request)
        finally:
            reset_current_request(token)
