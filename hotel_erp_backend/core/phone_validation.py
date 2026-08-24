import re
from rest_framework import serializers

UGANDA_PHONE_MESSAGE = "Enter a valid Uganda phone number, for example 0701234567 or +256701234567."

def normalize_uganda_phone(value, *, allow_blank=True):
    raw = str(value or "").strip()
    if not raw:
        if allow_blank:
            return ""
        raise serializers.ValidationError(UGANDA_PHONE_MESSAGE)
    compact = re.sub(r"[\s\-().]", "", raw)
    if compact.startswith("00256"):
        compact = "+256" + compact[5:]
    if compact.startswith("+256"):
        national = compact[4:]
    elif compact.startswith("256"):
        national = compact[3:]
    elif compact.startswith("0"):
        national = compact[1:]
    else:
        national = compact
    if not re.fullmatch(r"[2347]\d{8}", national):
        raise serializers.ValidationError(UGANDA_PHONE_MESSAGE)
    return f"+256{national}"
