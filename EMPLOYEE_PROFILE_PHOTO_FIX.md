# Employee & User Profile Photo Fix

This patch completes the existing employee-photo pipeline without changing roles, permissions, procurement flow, or other business logic.

## What changed

- Employee registration/editing accepts PNG, JPG/JPEG, or WEBP profile photos up to 5 MB.
- Employee records expose the photo to the React frontend.
- Employee directory rows, employee detail drawers, and HR dashboard rows display the photo with initials as fallback.
- The linked employee photo is used automatically for the signed-in user's header, sidebar, and launchpad avatar.
- User Access displays the linked employee's photo for employee accounts; standalone system accounts keep initials.
- The authenticated-user API now returns `photo_url`.
- The employee photo field supports longer Vercel Blob URLs (`max_length=500`).

## Deployment

Run the migration on the backend:

```bash
python manage.py migrate --settings=core.settings.prod
```

For Vercel production uploads, the backend must have a connected Vercel Blob store / `BLOB_READ_WRITE_TOKEN`. The project already contains the Blob storage backend; this patch reuses it.

No employee needs a separate user-account photo. `Employee.photo` remains the single source of truth.
