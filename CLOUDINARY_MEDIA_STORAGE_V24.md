# Cloudinary Media Storage — v24

Vercel's deployment directory (`/var/task`) is read-only and cannot store uploaded files permanently. This update routes Django `ImageField` uploads to Cloudinary in production.

## Backend Vercel environment variable

Create a Cloudinary account and copy the **API Environment variable** from the Cloudinary console. Add it to the **backend** Vercel project:

```text
CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
```

Apply it to Production (and Preview if required), then redeploy the backend.

The project also supports three separate variables:

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

Use either `CLOUDINARY_URL` or all three individual values—not both.

## What is stored externally

The default Django media storage is Cloudinary when credentials are present. This covers the hotel logo and other current/future `ImageField` uploads. Static application files remain served through WhiteNoise.

## Safe profile updates

The frontend sends a logo file only when the user selects a new file. Editing colors or contact details no longer attempts to rewrite the existing logo.

## Validation

- Maximum logo size: 5 MB
- Allowed formats: PNG, JPG/JPEG, WEBP, GIF
- When Vercel has no Cloudinary credentials, the API returns a clear 400 validation response rather than a 500 read-only-filesystem crash.
