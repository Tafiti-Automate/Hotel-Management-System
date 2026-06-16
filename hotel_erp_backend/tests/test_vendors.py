import pytest

from apps.vendors.models import Supplier


@pytest.mark.django_db
def test_supplier_can_be_registered():
    supplier = Supplier.objects.create(
        name="Kampala Fresh Foods",
        email="sales@kampalafresh.example",
        phone="+256700000001",
        address="Kampala",
        tin_number="TIN-001",
        registration_number="REG-001",
    )

    assert supplier.supplier_code == "SUP-001"
    assert str(supplier) == "Kampala Fresh Foods (SUP-001)"
    assert supplier.is_active is True
