# Static Files / collectstatic Fix v25

The Vercel build failed while WhiteNoise's manifest storage attempted to post-process a Bootstrap/Jazzmin JavaScript bundle that referenced an optional source-map file not present in the package.

Production static storage now uses:

```python
whitenoise.storage.CompressedStaticFilesStorage
```

instead of:

```python
whitenoise.storage.CompressedManifestStaticFilesStorage
```

This keeps WhiteNoise compression and static serving while avoiding manifest URL rewriting of missing development-only `*.map` assets. Cloudinary remains the default storage for uploaded media when `CLOUDINARY_URL` is configured.
