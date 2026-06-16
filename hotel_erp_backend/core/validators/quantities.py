from decimal import Decimal

from django.core.exceptions import ValidationError


def validate_positive_decimal(value):
    if value <= Decimal("0"):
        raise ValidationError("Value must be greater than zero.")


def validate_non_negative_decimal(value):
    if value < Decimal("0"):
        raise ValidationError("Value cannot be negative.")
