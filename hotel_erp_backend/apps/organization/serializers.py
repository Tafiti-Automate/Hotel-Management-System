import os

from django.conf import settings
from rest_framework import serializers

from apps.organization.models import Hotel


class HotelSerializer(serializers.ModelSerializer):
    branch_count = serializers.IntegerField(source="branches.count", read_only=True)

    class Meta:
        model = Hotel
        fields = (
            "id",
            "name",
            "legal_name",
            "business_type",
            "registration_number",
            "tax_identification_number",
            "email",
            "phone",
            "alternate_phone",
            "website",
            "logo",
            "address",
            "city",
            "country",
            "currency",
            "timezone",
            "brand_primary_color",
            "brand_secondary_color",
            "brand_accent_color",
            "use_logo_theme",
            "is_active",
            "branch_count",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "created_at", "updated_at", "created_by", "branch_count")

    def validate_logo(self, value):
        """Reject Vercel uploads cleanly when external media is not configured."""
        if value is None:
            return value

        max_size = 5 * 1024 * 1024
        if value.size > max_size:
            raise serializers.ValidationError("The hotel logo must be 5 MB or smaller.")

        allowed_types = {"image/png", "image/jpeg", "image/webp", "image/gif"}
        content_type = getattr(value, "content_type", "")
        if content_type and content_type not in allowed_types:
            raise serializers.ValidationError("Upload a PNG, JPG, WEBP, or GIF image.")

        running_on_vercel = bool(os.environ.get("VERCEL") or os.environ.get("VERCEL_URL"))
        blob_ready = bool(getattr(settings, "VERCEL_BLOB_CONFIGURED", False))
        if running_on_vercel and not blob_ready:
            raise serializers.ValidationError(
                "Media storage is not configured. Connect a Vercel Blob store to the backend project or add BLOB_READ_WRITE_TOKEN, redeploy, and try again."
            )
        return value
