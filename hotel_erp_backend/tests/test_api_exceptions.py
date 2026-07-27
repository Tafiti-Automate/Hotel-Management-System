import pytest
from django.db.models.deletion import ProtectedError

from apps.inventory.models import Category, Item
from core.exceptions import api_exception_handler


@pytest.mark.django_db
def test_protected_delete_returns_actionable_conflict():
    category = Category.objects.create(name="Food")
    item = Item.objects.create(
        category=category,
        name="Rice",
        sku="FOO-0001",
        unit="Kg",
        reorder_level=5,
    )
    exc = ProtectedError("Category is in use", {item})

    response = api_exception_handler(exc, {})

    assert response.status_code == 409
    assert response.data["code"] == "record_in_use"
    assert "remove/reassign" in response.data["detail"]
    assert response.data["dependencies"] == {"Items": 1}
