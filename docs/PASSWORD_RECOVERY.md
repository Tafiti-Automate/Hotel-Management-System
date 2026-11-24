# Hotel ERP authentication recovery
The green login card preserves username and employee-code login and adds unique active-account email login. Reset requests use Django's time-limited password reset token, an HTTPS frontend URL supplied by the administrator, generic responses, and scoped throttling. Successful reset revokes the API token. Duplicate email accounts require administrator resolution.

Production configuration (backend environment):
- PASSWORD_RESET_FRONTEND_URL=https://YOUR-FRONTEND-HOST/login (no query or fragment)
- PASSWORD_RESET_TIMEOUT=1800 (seconds)
- EMAIL_HOST, EMAIL_PORT, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, EMAIL_USE_TLS or EMAIL_USE_SSL, DEFAULT_FROM_EMAIL
Use a verified sender. Do not commit credentials. Configure a shared cache for throttling across workers. Test delivery and reset in staging before enabling production recovery. No database migration is required.
