"""Persistent media storage for Vercel deployments."""

from __future__ import annotations

import mimetypes
import os
from pathlib import PurePosixPath
from typing import Any

from django.core.files.base import File
from django.core.files.storage import Storage
from django.utils.deconstruct import deconstructible


@deconstructible
class VercelBlobStorage(Storage):
    """Django storage backend backed by a public Vercel Blob store.

    ``BLOB_READ_WRITE_TOKEN`` is injected automatically when a Blob store is
    connected to the Vercel backend project. Stored field values are the final
    Blob URLs, so Django can serve them directly without a writable media
    directory on the serverless runtime.
    """

    def __init__(self, token: str | None = None, prefix: str = "hotel-management-system/media"):
        self.token = token or os.environ.get("BLOB_READ_WRITE_TOKEN", "")
        self.prefix = prefix.strip("/")

    def _require_token(self) -> str:
        if not self.token:
            raise RuntimeError(
                "Vercel Blob is not configured. Connect a Blob store to the backend "
                "project or set BLOB_READ_WRITE_TOKEN."
            )
        return self.token

    @staticmethod
    def _value(result: Any, key: str) -> Any:
        if isinstance(result, dict):
            return result.get(key)
        return getattr(result, key, None)

    def _save(self, name: str, content: File) -> str:
        self._require_token()
        try:
            import vercel_blob
        except ImportError as exc:  # pragma: no cover - deployment dependency guard
            raise RuntimeError("Install vercel_blob to use Vercel Blob media storage.") from exc

        original = PurePosixPath(name).name
        pathname = f"{self.prefix}/{original}"
        content_type = getattr(content, "content_type", None) or mimetypes.guess_type(original)[0]
        data = content.read()
        options: dict[str, str] = {"addRandomSuffix": "true"}
        if content_type:
            options["contentType"] = content_type

        # vercel_blob reads BLOB_READ_WRITE_TOKEN from the environment.
        result = vercel_blob.put(pathname, data, options)
        url = self._value(result, "url")
        if not url:
            raise RuntimeError("Vercel Blob upload completed without returning a file URL.")
        return str(url)

    def delete(self, name: str) -> None:
        if not name or not name.startswith("http"):
            return
        try:
            import vercel_blob

            self._require_token()
            vercel_blob.delete(name)
        except Exception:
            # File deletion should not make model deletion fail. The orphan can
            # still be removed from the Blob dashboard if the provider is down.
            return

    def exists(self, name: str) -> bool:
        # Every upload receives a random suffix, so no preflight request is needed.
        return False

    def url(self, name: str) -> str:
        return name

    def size(self, name: str) -> int:
        try:
            import vercel_blob

            self._require_token()
            result = vercel_blob.head(name)
            return int(self._value(result, "size") or 0)
        except Exception:
            return 0
