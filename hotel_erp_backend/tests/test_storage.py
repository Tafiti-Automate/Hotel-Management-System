import pytest

from core.storage import VercelBlobStorage


class BlobResponse:
    def __init__(self, content):
        self.content = content
        self.closed = False

    def read(self, size=-1):
        return self.content if size < 0 else self.content[:size]

    def close(self):
        self.closed = True


def test_vercel_blob_storage_can_open_public_blob(monkeypatch):
    content = b"hotel-logo"
    response = BlobResponse(content)
    calls = []

    def fake_urlopen(request, timeout):
        calls.append((request.full_url, timeout))
        return response

    monkeypatch.setattr("core.storage.urlopen", fake_urlopen)
    storage = VercelBlobStorage(token="write-token")

    opened = storage.open(
        "https://example.public.blob.vercel-storage.com/hotel/logo-AbCd.png"
    )

    assert opened.read() == content
    assert opened.name == "logo-AbCd.png"
    assert calls == [
        (
            "https://example.public.blob.vercel-storage.com/hotel/logo-AbCd.png",
            10,
        )
    ]
    assert response.closed is True


@pytest.mark.parametrize(
    "url",
    [
        "http://example.public.blob.vercel-storage.com/logo.png",
        "https://example.com/logo.png",
        "file:///etc/passwd",
    ],
)
def test_vercel_blob_storage_rejects_non_blob_urls(monkeypatch, url):
    def unexpected_urlopen(*args, **kwargs):
        raise AssertionError("An untrusted URL must not be opened.")

    monkeypatch.setattr("core.storage.urlopen", unexpected_urlopen)

    with pytest.raises(ValueError, match="public HTTPS Blob URLs"):
        VercelBlobStorage(token="write-token").open(url)


def test_vercel_blob_storage_rejects_oversized_download(monkeypatch):
    storage = VercelBlobStorage(token="write-token")
    storage.max_open_bytes = 4
    response = BlobResponse(b"12345")
    monkeypatch.setattr("core.storage.urlopen", lambda request, timeout: response)

    with pytest.raises(ValueError, match="too large"):
        storage.open(
            "https://example.public.blob.vercel-storage.com/hotel/oversized.png"
        )

    assert response.closed is True
