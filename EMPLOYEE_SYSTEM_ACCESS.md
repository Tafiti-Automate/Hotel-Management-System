# Employee and System Access Control

- Normal operational accounts are created together with an Employee profile.
- Standalone accounts are restricted to approved technical roles.
- Existing accounts linked to Employee records are classified as employee accounts.
- Existing unlinked accounts are classified as system accounts by migration.
- Unlinked accounts cannot sign in unless they are superusers or hold an approved technical role.
- Access Management now creates only system accounts; staff access begins from Employees.

Run migrations after deployment:

```bash
python manage.py migrate
```
