"""Genuine cross-department PR-to-PO consolidation and authority regressions."""
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import Category, Item, StoreLocation, SupplierItemPrice, UnitOfMeasure
from apps.procurement.models import PurchaseOrder, PurchaseRequisition, RequisitionItem
from apps.vendors.models import Supplier
from core.constants.choices import POStatus, PRStatus


@pytest.fixture
def sourcing(db):
    branch = Branch.objects.create(name="Cross Department Property")
    group = Group.objects.get_or_create(name="Procurement Manager")[0]
    buyer_user = get_user_model().objects.create_user(
        username="consolidation-buyer", employee_code="COL-BUYER"
    )
    buyer_user.groups.add(group)
    procurement_dept = Department.objects.create(name="Purchasing Group Test")
    buyer = Employee.objects.create(
        user=buyer_user, branch=branch,
        department=procurement_dept, designation="Procurement Manager",
    )
    officer = APIClient()
    officer.force_authenticate(buyer_user)

    supplier = Supplier.objects.create(
        name="Consolidation Supplier", email="consolidation@example.com",
        phone="+256700000666", address="Kampala",
        tin_number="TIN-CONSOLIDATED", registration_number="REG-CONSOLIDATED",
    )
    unit = UnitOfMeasure.objects.create(name="Consolidated Bottle", abbreviation="cbl")
    category = Category.objects.create(name="Cross PR Article Group")
    item = Item.objects.create(
        category=category, name="Consolidated Mineral Water",
        sku="CROSS-PR-WATER", unit="bottle", base_unit=unit,
        reorder_level=Decimal("2.00"),
    )
    store = StoreLocation.objects.create(
        branch=branch, name="Consolidated Receiving Bay", is_active=True
    )
    quote = SupplierItemPrice.objects.create(
        supplier=supplier, item=item, unit=unit,
        unit_price=Decimal("3000.00"), currency="UGX", is_preferred=True,
    )
    source = []
    for index, department_name in enumerate(("Kitchen Cross PR", "Housekeeping Cross PR"), start=1):
        department = Department.objects.create(name=department_name)
        user = get_user_model().objects.create_user(
            username=f"consolidated-dept-{index}", employee_code=f"COL-DEPT-{index}"
        )
        employee = Employee.objects.create(
            user=user, branch=branch, department=department,
            designation="Department Head",
        )
        req = PurchaseRequisition.objects.create(
            requester=employee, department=department,
            branch=branch, reason=f"Department {index} water",
            status=PRStatus.APPROVED,
        )
        line = RequisitionItem.objects.create(
            requisition=req, item=item, unit=unit,
            quantity=Decimal("5.00"), approved_quantity=Decimal("5.00"),
            estimated_unit_cost=Decimal("3000.00"),
            destination_type=RequisitionItem.DESTINATION_STORE,
            destination_store=store,
        )
        # Allocation needs a persisted source line; remaining_order_quantity
        # is computed from its reverse order-line relation.
        line.procurement_supplier = supplier
        line.procurement_supplier_price = quote
        line.procurement_unit = unit
        line.procurement_quantity = Decimal("5.00")
        line.procurement_unit_cost = Decimal("3000.00")
        line.save(update_fields=(
            "procurement_supplier", "procurement_supplier_price",
            "procurement_unit", "procurement_quantity",
            "procurement_unit_cost", "updated_at",
        ))
        source.append((req, line))
    return {
        "officer": officer, "buyer": buyer, "supplier": supplier,
        "branch": branch, "store": store, "item": item, "unit": unit,
        "source": source,
    }


@pytest.mark.django_db
def test_cross_pr_same_article_one_supplier_lpo_has_auditable_two_source_lines(sourcing):
    data=sourcing
    selected=[str(line.pk) for _,line in data["source"]]
    response=data["officer"].post(
        "/api/v1/purchase-orders/consolidate-approved/",
        {"requisition_item_ids": selected}, format="json",
    )
    assert response.status_code == 201, response.data
    assert len(response.data)==1
    order=PurchaseOrder.objects.get(pk=response.data[0]["id"])
    assert order.status==POStatus.DRAFT
    assert order.supplier==data["supplier"]
    assert set(order.source_requisitions.values_list("pk",flat=True))=={
        req.pk for req,_ in data["source"]
    }
    lines=list(order.items.order_by("requisition_item__requisition_id"))
    assert len(lines)==2
    assert all(line.item==data["item"] for line in lines)
    assert {line.requisition_item_id for line in lines}=={
        line.pk for _,line in data["source"]
    }
    assert order.total_amount == Decimal("30000.00")
    assert order.quantity_commitment_blockers() == []

    activity=order.activities.get(action="consolidated_from_requisitions")
    assert set(activity.metadata["source_requisitions"])=={
        str(req.pk) for req,_ in data["source"]
    }
    assert set(activity.metadata["source_lines"])==set(selected)

    second=data["officer"].post(
        "/api/v1/purchase-orders/consolidate-approved/",
        {"requisition_item_ids": selected}, format="json",
    )
    assert second.status_code == 400
    assert PurchaseOrder.objects.count() == 1


@pytest.mark.django_db
def test_consolidation_prevents_cross_property_and_it_operational_actions(sourcing):
    data=sourcing
    alien_branch=Branch.objects.create(name="Separate Property")
    alien_group=Group.objects.get_or_create(name="Procurement Manager")[0]
    alien_user=get_user_model().objects.create_user(
        username="alien-buyer",employee_code="ALIEN-BUYER",
    )
    alien_user.groups.add(alien_group)
    Employee.objects.create(
        user=alien_user, branch=alien_branch,
        department=Department.objects.create(name="Separate Purchasing"),
        designation="Procurement Manager",
    )
    selected=[str(line.pk) for _,line in data["source"]]
    alien=APIClient()
    alien.force_authenticate(alien_user)
    denied=alien.post(
        "/api/v1/purchase-orders/consolidate-approved/",
        {"requisition_item_ids": selected},format="json",
    )
    assert denied.status_code == 400
    assert PurchaseOrder.objects.count() == 0

    it_user=get_user_model().objects.create_user(
        username="consolidation-it",employee_code="COL-IT"
    )
    it_user.groups.add(Group.objects.get_or_create(name="System Administrator")[0])
    it=APIClient()
    it.force_authenticate(it_user)
    denied=it.post(
        "/api/v1/purchase-orders/consolidate-approved/",
        {"requisition_item_ids": selected},format="json",
    )
    assert denied.status_code == 403
    assert PurchaseOrder.objects.count() == 0
