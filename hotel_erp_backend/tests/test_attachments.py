import uuid

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.procurement.models import ProcurementAttachment


def attachment_user(*permissions):
    user = get_user_model().objects.create_user(
        username=f"attachment-user-{uuid.uuid4()}",
        employee_code=f"EMP-{uuid.uuid4().hex[:8].upper()}",
        password="test-pass-123",
    )
    user.user_permissions.add(
        *Permission.objects.filter(
            content_type__app_label="procurement",
            codename__in=permissions,
        )
    )
    return user


@pytest.mark.django_db
def test_attachment_is_stored_in_database_and_downloaded_with_authentication():
    user = attachment_user(
        "add_procurementattachment",
        "view_procurementattachment",
    )
    client = APIClient()
    client.force_authenticate(user=user)
    content = b"%PDF-1.4 hotel delivery note"

    upload = client.post(
        "/api/v1/procurement-attachments/",
        {
            "document_type": "grn",
            "document_id": str(uuid.uuid4()),
            "category": "delivery_note",
            "file": SimpleUploadedFile(
                "Kampala delivery note.pdf",
                content,
                content_type="application/pdf",
            ),
        },
        format="multipart",
    )

    assert upload.status_code == 201
    assert upload.data["original_name"] == "Kampala delivery note.pdf"
    assert upload.data["file_size"] == len(content)
    assert upload.data["download_url"].endswith(
        f"/api/v1/procurement-attachments/{upload.data['id']}/download/"
    )
    attachment = ProcurementAttachment.objects.get(pk=upload.data["id"])
    assert bytes(attachment.file_content) == content
    assert attachment.file.name == ""

    download = client.get(
        f"/api/v1/procurement-attachments/{attachment.id}/download/"
    )

    assert download.status_code == 200
    assert download.content == content
    assert download["Content-Type"] == "application/pdf"
    assert "Kampala delivery note.pdf" in download["Content-Disposition"]
    assert download["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_attachment_upload_requires_add_permission():
    user = attachment_user("view_procurementattachment")
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post(
        "/api/v1/procurement-attachments/",
        {
            "document_type": "grn",
            "document_id": str(uuid.uuid4()),
            "category": "supporting",
            "file": SimpleUploadedFile(
                "support.pdf",
                b"%PDF-1.4 supporting document",
                content_type="application/pdf",
            ),
        },
        format="multipart",
    )

    assert response.status_code == 403
    assert ProcurementAttachment.objects.count() == 0


@pytest.mark.django_db
def test_attachment_upload_rejects_unsupported_files():
    user = attachment_user(
        "add_procurementattachment",
        "view_procurementattachment",
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post(
        "/api/v1/procurement-attachments/",
        {
            "document_type": "grn",
            "document_id": str(uuid.uuid4()),
            "category": "supporting",
            "file": SimpleUploadedFile(
                "unsafe.exe",
                b"not a supporting document",
                content_type="application/octet-stream",
            ),
        },
        format="multipart",
    )

    assert response.status_code == 400
    assert "Use a PDF, Word document" in str(response.data["file"])
