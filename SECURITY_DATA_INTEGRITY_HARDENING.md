# Security & Data Integrity Hardening

This build adds production-oriented safeguards without changing the established procurement workflow or login screen design.

## Session and authentication controls
- API tokens are rotated at every successful login.
- One active API token is kept per user.
- API tokens expire after 4 hours maximum by default.
- Authenticated API sessions expire after 30 minutes of inactivity by default.
- Login attempts are throttled (default `10/min`).
- Basic Authentication has been removed from the REST API defaults.
- The frontend idle timeout is 30 minutes.
- Django session-authenticated views use `cached_db` in production.
- Redis is used when `REDIS_URL` is configured; the database remains the durable session source.
- Secure/HttpOnly/SameSite session cookies, HTTPS redirect, HSTS, no-sniff, referrer policy and frame denial remain enabled in production.

## Audit integrity
- Audit records are application-immutable.
- Audit records capture request ID, client IP and user agent when available.
- New audit records are serialized through a chain head and protected by an HMAC SHA-256 chain.
- Audit history includes before/after field changes for core procurement, inventory and supplier-finance records.
- Login success, login failure and logout are audited.
- Audit records cannot be added, edited or deleted through Django Admin and are read-only through the API.
- Verify the protected audit chain with:

  `python manage.py verify_audit_chain`

Set a dedicated high-entropy `AUDIT_LOG_HMAC_KEY` in production. Do not rotate this key without an audit-key rotation procedure, because old hashes are verified with the key that created them.

## Inventory integrity
- Stock ledger API access is read-only.
- Posted stock ledger entries cannot be edited or deleted through model operations; corrections must be recorded as reversing movements.
- Inventory balances are read-only through normal CRUD API operations. Quantity changes continue through controlled receiving, issuing, transfer, adjustment, count and reconciliation workflows.
- Existing row locking and atomic database transactions remain in place for critical stock and procurement operations.

## Transaction record deletion controls
- Submitted procurement requisitions cannot be hard deleted.
- LPOs that entered approval/supplier processing cannot be hard deleted.
- Received or posted GRNs cannot be hard deleted.
- Supplier invoices that entered matching/approval cannot be hard deleted.
- Posted supplier payments cannot be hard deleted.
- Use cancellation, return or controlled reversal workflows instead.

## Production environment variables
Recommended values:

```env
REDIS_URL=redis://<private-redis-host>:6379/0
AUTH_TOKEN_MAX_AGE_SECONDS=14400
AUTH_TOKEN_IDLE_TIMEOUT_SECONDS=1800
SESSION_COOKIE_AGE=14400
LOGIN_THROTTLE_RATE=10/min
AUDIT_LOG_HMAC_KEY=<long-random-production-secret>
DJANGO_SECURE_SSL_REDIRECT=True
DJANGO_SECURE_HSTS_SECONDS=31536000
```

Redis must be private to the application network and must not be exposed publicly.

## Deployment
Apply the included database migration:

`python manage.py migrate`

No automated test suite was run for this package at the user's request.
