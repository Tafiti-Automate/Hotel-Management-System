# Vercel Blob media storage — v26

Uploaded media no longer writes to Vercel's read-only `/var/task/media` directory and no longer uses Cloudinary.

## Vercel setup

1. Open the **Django backend project** in Vercel.
2. Open **Storage**.
3. Select **Create Database** → **Blob**.
4. Create a **Public** Blob store for public hotel logos and profile images.
5. Connect it to the backend project's Production environment.
6. Vercel automatically creates `BLOB_READ_WRITE_TOKEN` for the project.
7. Redeploy the backend.

Do not add this token to the React frontend and do not commit it to Git.

## Deployment

The normal build command can remain unchanged. Run migrations during deployment because the hotel logo field now supports longer Blob URLs:

```bash
python manage.py migrate --noinput --settings=core.settings.prod
```

## Runtime behavior

- On Vercel with `BLOB_READ_WRITE_TOKEN`: Django uploads media to Vercel Blob.
- Locally without the token: Django keeps using the local `media/` directory.
- On Vercel without the token: the API returns a clear configuration error instead of an HTTP 500 filesystem error.
