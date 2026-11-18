"""GRN posting is authorized at the document workflow level, never per line."""
from uuid import uuid4

import pytest
from django.urls import Resolver404, resolve


def test_line_level_inventory_posting_endpoint_is_not_exposed():
    with pytest.raises(Resolver404):
        resolve(f"/api/v1/grn-items/{uuid4()}/post-to-inventory/")


def test_document_level_grn_posting_endpoint_remains_registered():
    match = resolve(f"/api/v1/grns/{uuid4()}/post-to-inventory/")
    assert match.url_name == "grn-post-to-inventory"


@pytest.mark.django_db
def test_assigned_store_keeper_posts_receipt_with_line_destination_not_po_header():
    """Actual API: Receiving records goods, Stores alone posts the accepted GRN."""
    from decimal import Decimal
    from django.contrib.auth import get_user_model
    from django.contrib.auth.models import Group
    from django.core.management import call_command
    from django.utils import timezone
    from rest_framework.test import APIClient

    from apps.departments.models import Branch
    from apps.employees.models import Employee
    from apps.inventory.models import (
        InventoryBalance, StockLedger, StoreKeeperAssignment, StoreLocation,
    )
    from apps.materials_control.models import FiscalPeriod
    from apps.procurement.models import (
        GoodsInspection, GoodsInspectionItem, GoodsReceiptItem, GoodsReceiptNote,
        PurchaseOrder, PurchaseOrderItem, PurchaseRequisition, RequisitionItem,
    )
    from core.constants.choices import POStatus, PRStatus
    from tests.test_procurement import create_procurement_context

    call_command("setup_hotel_roles", verbosity=0)
    requester, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Line destination receipt acceptance property")
    destination = StoreLocation.objects.create(branch=branch, name="Actual receiving store")
    requester.branch = branch
    requester.save(update_fields=("branch", "updated_at"))
    keeper_user = get_user_model().objects.create_user(
        username="line-destination-keeper", employee_code="LINE-DEST-KEEP",
        password="test-password",
    )
    keeper_user.groups.add(Group.objects.get(name="Store Keeper"))
    keeper = Employee.objects.create(
        user=keeper_user, branch=branch, department=department,
        designation="Store Keeper",
    )
    StoreKeeperAssignment.objects.create(store=destination, employee=keeper)
    period_date = timezone.localdate()
    FiscalPeriod.objects.create(
        branch=branch, name="Receiving handoff month",
        start_date=period_date.replace(day=1), end_date=period_date,
    )
    pr = PurchaseRequisition.objects.create(
        requester=requester, department=department, branch=branch,
        reason="Restaurant goods purchase", status=PRStatus.APPROVED,
    )
    source_line = RequisitionItem.objects.create(
        requisition=pr, item=item, quantity=Decimal("4.00"),
        approved_quantity=Decimal("4.00"), destination_store=destination,
    )
    # No PO header store: per-line assignment must drive Store Keeper visibility.
    po = PurchaseOrder.objects.create(
        requisition=pr, supplier=supplier, ordered_by=requester,
        store=None,
    )
    po_line = PurchaseOrderItem.objects.create(
        purchase_order=po, requisition_item=source_line,
        item=item, quantity=Decimal("4.00"), unit_cost=Decimal("100.00"),
        destination_store=destination,
    )
    # A real LPO is composed while draft, then authorized and issued.
    po.status = POStatus.ISSUED
    po.save(update_fields=("status", "updated_at"))
    grn = GoodsReceiptNote.objects.create(
        purchase_order=po, received_by=requester,
    )
    receipt_line = GoodsReceiptItem.objects.create(
        goods_receipt=grn, purchase_order_item=po_line,
        quantity_received=Decimal("4.00"), unit_cost=Decimal("100.00"),
    )
    assert receipt_line.store_id == destination.pk
    inspection = GoodsInspection.objects.create(
        goods_receipt=grn, inspected_by=requester,
    )
    GoodsInspectionItem.objects.create(
        inspection=inspection, goods_receipt_item=receipt_line,
        quantity_received=Decimal("4.00"),
        quantity_accepted=Decimal("4.00"), quantity_rejected=Decimal("0.00"),
    )
    client = APIClient()
    client.force_authenticate(user=keeper_user)

    # A previously authenticated Store Keeper must lose all GRN actions as
    # soon as their account is disabled, even if their Employee and store
    # assignment remain active. A disabled session cannot change stock.
    keeper_user.is_active = False
    keeper_user.save(update_fields=("is_active",))
    assert client.get("/api/v1/grns/unposted-queue/").status_code == 403
    assert client.get(f"/api/v1/grns/{grn.pk}/verification/").status_code in (403, 404)
    assert client.post(f"/api/v1/grns/{grn.pk}/post-to-inventory/").status_code in (403, 404)
    assert StockLedger.objects.filter(reference_id=grn.pk).count() == 0
    keeper_user.is_active = True
    keeper_user.save(update_fields=("is_active",))

    queue = client.get("/api/v1/grns/unposted-queue/")
    assert queue.status_code == 200, getattr(queue, "data", None)
    assert str(grn.pk) in {str(row["id"]) for row in queue.data}
    assert client.get(f"/api/v1/grns/{grn.pk}/verification/").status_code == 200
    posted = client.post(f"/api/v1/grns/{grn.pk}/post-to-inventory/")
    assert posted.status_code == 200, getattr(posted, "data", None)
    grn.refresh_from_db()
    assert grn.status == "posted"
    balance = InventoryBalance.objects.get(item=item, store=destination)
    assert balance.quantity_in_stock == Decimal("4.00")
    assert StockLedger.objects.filter(reference_id=grn.pk).count() == 1
    repeated = client.post(f"/api/v1/grns/{grn.pk}/post-to-inventory/")
    assert repeated.status_code == 400, getattr(repeated, "data", None)
    assert StockLedger.objects.filter(reference_id=grn.pk).count() == 1
    balance.refresh_from_db()
    assert balance.quantity_in_stock == Decimal("4.00")
