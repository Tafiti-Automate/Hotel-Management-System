"""Regression tests for the approved Supervisor -> HOD -> Cost Control -> Stores workflow.

Old tests permitting HOD to originate and Storekeeper to edit requests directly
were superseded by the explicit segregation-of-duties design.
"""
from calendar import monthrange
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import (
    Category, DepartmentConsumption, InventoryBalance, Item, StockIssue,
    StoreKeeperAssignment, StoreLocation, StoreRequisition, StoreRequisitionItem,
    UnitOfMeasure,
)
from apps.materials_control.models import FiscalPeriod
from core.constants.choices import StoreRequisitionStatus


@pytest.fixture
def workflow(db):
    department = Department.objects.create(name="Housekeeping Control")
    branch = Branch.objects.create(name="Warehouse Control Property")
    store = StoreLocation.objects.create(branch=branch, name="Main Dry Store", is_active=True)
    unit = UnitOfMeasure.objects.create(name="Bottles Test", abbreviation="tbt")
    category = Category.objects.create(name="Cleaning Control Items")
    item = Item.objects.create(
        category=category, name="Surface Cleaner", sku="E2E-CLEANER",
        unit="btl", base_unit=unit, reorder_level=Decimal("2.00"),
    )

    def person(role,code):
        user = get_user_model().objects.create_user(
            username="wf-" + role.lower().replace(" ", "-"),
            employee_code="WF-" + code,
            password="test-pass-123",
        )
        user.groups.add(Group.objects.get_or_create(name=role)[0])
        employee = Employee.objects.create(
            user=user, department=department, branch=branch,
            designation=role, is_active=True,
        )
        client = APIClient()
        client.force_authenticate(user)
        return user, employee, client

    supervisor = person("Department Supervisor", "SUP")
    head = person("Department Head", "HOD")
    cost = person("Cost Controller", "COST")
    keeper = person("Store Keeper", "KEEP")
    StoreKeeperAssignment.objects.create(store=store, employee=keeper[1], is_active=True)
    InventoryBalance.objects.create(
        item=item, store=store, quantity_in_stock=Decimal("20.00"),
        weighted_average_cost=Decimal("2500.0000"),
    )
    today = timezone.localdate()
    FiscalPeriod.objects.create(
        branch=branch, name="Operational workflow period",
        start_date=today.replace(day=1),
        end_date=today.replace(day=monthrange(today.year,today.month)[1]),
    )
    return {"department": department, "branch": branch, "store": store, "item": item,
            "unit": unit, "supervisor": supervisor, "head": head,
            "cost": cost, "keeper": keeper}


def _create_supervisor_draft(ctx, quantity="10.00"):
    supervisor = ctx["supervisor"][2]
    result = supervisor.post(
        "/api/v1/store-requisitions/",
        {"purpose": "Shift supplies", "store": str(ctx["store"].pk)},
        format="json",
    )
    assert result.status_code == 201, result.data
    request_id = result.data["id"]
    line = supervisor.post(
        "/api/v1/store-requisition-items/",
        {"requisition": request_id, "item": str(ctx["item"].pk),
         "unit": str(ctx["unit"].pk), "quantity_requested": quantity},
        format="json",
    )
    assert line.status_code == 201, line.data
    return request_id, line.data["id"]


@pytest.mark.django_db
def test_supervisor_origination_hod_and_cost_review_and_signed_pickup(workflow):
    """The genuine four-step flow posts a balanced transit and a consumption."""
    ctx=workflow
    denied=ctx["head"][2].post(
        "/api/v1/store-requisitions/",
        {"purpose":"Bypass Supervisor","store":str(ctx["store"].pk)},
        format="json",
    )
    assert denied.status_code == 403

    request_id,line_id=_create_supervisor_draft(ctx)
    supervisor=ctx["supervisor"][2]
    # Editing the unsubmitted draft is allowed, but quantities cannot increase.
    edit=supervisor.patch(
        f"/api/v1/store-requisition-items/{line_id}/",
        {"quantity_requested":"8.00"},format="json"
    )
    assert edit.status_code == 200, edit.data
    submit=supervisor.post(f"/api/v1/store-requisitions/{request_id}/submit/",{},format="json")
    assert submit.status_code == 200, submit.data
    assert submit.data["status"] == StoreRequisitionStatus.PENDING_DEPARTMENT_APPROVAL

    keeper=ctx["keeper"][2]
    assert keeper.get("/api/v1/store-requisitions/fulfillment-queue/").data == []

    reviewed=ctx["head"][2].post(
        f"/api/v1/store-requisitions/{request_id}/department-approve/",
        {"items":[{"id":line_id,"approved_quantity":"7.00","reason":"Reduced shift requirement"}]},
        format="json",
    )
    assert reviewed.status_code == 200, reviewed.data
    assert reviewed.data["status"] == StoreRequisitionStatus.SUBMITTED
    assert keeper.get("/api/v1/store-requisitions/fulfillment-queue/").data == []

    cost=ctx["cost"][2]
    approved=cost.post(
        f"/api/v1/store-requisitions/{request_id}/cost-control-approve/",
        {"items":[{"id":line_id,"approved_quantity":"6.00","reason":"Approved six bottles"}]},
        format="json",
    )
    assert approved.status_code == 200, approved.data
    assert approved.data["status"] == StoreRequisitionStatus.APPROVED
    queue=keeper.get("/api/v1/store-requisitions/fulfillment-queue/")
    assert queue.status_code == 200, queue.data
    assert queue.data[0]["id"] == request_id

    too_much=keeper.post(
        f"/api/v1/store-requisitions/{request_id}/dispatch-transfer/",
        {"quantities":{line_id:"7.00"}},format="json",
    )
    assert too_much.status_code == 400

    dispatched=keeper.post(
        f"/api/v1/store-requisitions/{request_id}/dispatch-transfer/",
        {"quantities":{line_id:"6.00"}},format="json",
    )
    assert dispatched.status_code == 201, dispatched.data
    issue=StockIssue.objects.get(pk=dispatched.data["id"])
    assert issue.fulfillment_status == StockIssue.STATUS_TRANSIT
    balance=InventoryBalance.objects.get(item=ctx["item"],store=ctx["store"])
    assert balance.quantity_in_stock == Decimal("14.00")

    signed=supervisor.post(f"/api/v1/stock-issues/{issue.pk}/acknowledge/",{},format="json")
    assert signed.status_code == 200, signed.data
    assert StockIssue.objects.get(pk=issue.pk).fulfillment_status != StockIssue.STATUS_TRANSIT
    assert DepartmentConsumption.objects.filter(stock_issue_item__issue=issue).count() == 1
    duplicate=supervisor.post(f"/api/v1/stock-issues/{issue.pk}/acknowledge/",{},format="json")
    assert duplicate.status_code == 400


@pytest.mark.django_db
def test_store_keeper_cannot_edit_supervisor_requested_or_cost_approved_quantities(workflow):
    ctx=workflow
    request_id,line_id=_create_supervisor_draft(ctx)
    supervisor=ctx["supervisor"][2]
    assert supervisor.post(f"/api/v1/store-requisitions/{request_id}/submit/",{},format="json").status_code == 200
    approved=ctx["head"][2].post(
        f"/api/v1/store-requisitions/{request_id}/department-approve/",
        {"items":[{"id":line_id,"approved_quantity":"10.00"}]},format="json",
    )
    assert approved.status_code == 200, approved.data
    approved=ctx["cost"][2].post(
        f"/api/v1/store-requisitions/{request_id}/cost-control-approve/",
        {"items":[{"id":line_id,"approved_quantity":"6.00","reason":"Restrict to six"}]},
        format="json",
    )
    assert approved.status_code == 200, approved.data

    keeper=ctx["keeper"][2]
    for patch in (
        {"quantity_requested":"12.00"},
        {"quantity_approved":"8.00"},
        {"quantity_approved":"4.00"},
    ):
        denied=keeper.patch(f"/api/v1/store-requisition-items/{line_id}/",patch,format="json")
        assert denied.status_code == 403, denied.data

    line=StoreRequisitionItem.objects.get(pk=line_id)
    assert line.base_quantity_requested == Decimal("10.00")
    assert line.hod_approved_quantity == Decimal("10.00")
    assert line.quantity_approved == Decimal("6.00")
    assert line.quantity_issued == Decimal("0.00")


@pytest.mark.django_db
def test_requisition_only_orders_the_unavailable_stock_and_keeps_approved_quantity(workflow):
    ctx = workflow
    supervisor = ctx["supervisor"][2]
    head = ctx["head"][2]
    keeper = ctx["keeper"][2]
    request_id, line_id = _create_supervisor_draft(ctx, quantity="30.0000")
    assert supervisor.post(
        f"/api/v1/store-requisitions/{request_id}/submit/", {}, format="json"
    ).status_code == 200
    decision = head.post(
        f"/api/v1/store-requisitions/{request_id}/department-approve/",
        {"items": [{"id": line_id, "approved_quantity": "28.0000", "reason": "Approved operational requirement"}]}, format="json",
    )
    assert decision.status_code == 200, decision.data
    purchase = keeper.post(
        f"/api/v1/store-requisitions/{request_id}/send-to-procurement/",
        {
            "reason": "Approved store shortage",
            "items": [{"id": line_id, "approved_quantity": "28.0000",
                       "reason": "Purchase only the shortfall"}],
        }, format="json",
    )
    assert purchase.status_code == 200, purchase.data
    req = StoreRequisition.objects.get(pk=request_id)
    original = StoreRequisitionItem.objects.get(pk=line_id)
    assert req.status == StoreRequisitionStatus.AWAITING_PROCUREMENT
    assert original.base_quantity_requested == Decimal("30.0000")
    assert original.hod_approved_quantity == Decimal("28.0000")
    assert original.quantity_approved == Decimal("28.0000")
    assert original.quantity_issued == Decimal("0.0000")
    from apps.procurement.models import RequisitionItem
    sourced = RequisitionItem.objects.get(requisition=req.procurement_requisition)
    assert sourced.quantity == Decimal("8.0000")
    assert keeper.post(
        f"/api/v1/store-requisitions/{request_id}/send-to-procurement/",
        {}, format="json",
    ).status_code == 400


@pytest.mark.django_db
def test_full_internal_requisition_closes_only_after_signed_pickup(workflow):
    ctx = workflow
    supervisor = ctx["supervisor"][2]
    request_id, line_id = _create_supervisor_draft(ctx, quantity="5.0000")
    assert supervisor.post(
        f"/api/v1/store-requisitions/{request_id}/submit/", {}, format="json"
    ).status_code == 200
    hod = ctx["head"][2].post(
        f"/api/v1/store-requisitions/{request_id}/department-approve/",
        {"items": [{"id": line_id, "approved_quantity": "5.0000"}]}, format="json",
    )
    assert hod.status_code == 200, hod.data
    cost = ctx["cost"][2].post(
        f"/api/v1/store-requisitions/{request_id}/cost-control-approve/",
        {"items": [{"id": line_id, "approved_quantity": "5.0000"}]}, format="json",
    )
    assert cost.status_code == 200, cost.data
    dispatch = ctx["keeper"][2].post(
        f"/api/v1/store-requisitions/{request_id}/dispatch-transfer/",
        {"quantities": {line_id: "5.0000"}}, format="json",
    )
    assert dispatch.status_code == 201, dispatch.data
    req = StoreRequisition.objects.get(pk=request_id)
    assert req.status == StoreRequisitionStatus.ISSUED
    signed = supervisor.post(
        f"/api/v1/stock-issues/{dispatch.data['id']}/acknowledge/", {}, format="json",
    )
    assert signed.status_code == 200, signed.data
    req.refresh_from_db()
    assert req.status == StoreRequisitionStatus.COMPLETED


@pytest.mark.django_db
def test_unrelated_roles_cannot_create_department_requisitions(workflow):
    ctx = workflow
    for role in ("head", "cost", "keeper"):
        denied = ctx[role][2].post(
            "/api/v1/store-requisitions/",
            {"purpose": "Unauthorized origin", "store": str(ctx["store"].pk)},
            format="json",
        )
        assert denied.status_code == 403, (role, denied.data)


@pytest.mark.django_db
def test_connected_eight_role_shortage_partial_receipts_and_signed_completion(workflow):
    """Eight-role API journey: 3 RFQs -> supplier award -> three LPO approvals
    -> supplier dispatch -> split GRNs -> signed department fulfillment.
    """
    from datetime import timedelta
    from django.test import override_settings
    from apps.procurement.models import (
        PurchaseOrder, RequisitionItem, VendorQuotation, VendorQuotationItem,
    )
    from apps.vendors.models import Supplier
    from core.constants.choices import POStatus, LedgerReferenceType
    from apps.inventory.models import StockLedger

    ctx = workflow
    supervisor = ctx["supervisor"][2]
    head = ctx["head"][2]
    keeper = ctx["keeper"][2]
    cost = ctx["cost"][2]

    def extra(role, suffix):
        user = get_user_model().objects.create_user(
            username=f"wf-e2e-{suffix}", employee_code=f"WFE2E-{suffix}",
            password="test-pass-123",
        )
        user.groups.add(Group.objects.get_or_create(name=role)[0])
        employee = Employee.objects.create(
            user=user, department=ctx["department"], branch=ctx["branch"],
            designation=role, is_active=True,
        )
        client = APIClient()
        client.force_authenticate(user)
        return client, employee

    buyer, buyer_employee = extra("Procurement Manager", "BUY")
    finance, _ = extra("Financial Manager", "FIN")
    gm, _ = extra("General Manager", "GM")
    receiver, _ = extra("Receiving Clerk", "RCV")
    ap, _ = extra("Accounts Payable Clerk", "AP")
    ap_checker, _ = extra("Accounts Payable Clerk", "AP2")

    request_id, line_id = _create_supervisor_draft(ctx, "28.0000")
    for forbidden in (head, keeper, cost, buyer, finance, gm, receiver, ap):
        response = forbidden.post(
            "/api/v1/store-requisitions/",
            {"purpose": "Forbidden", "store": str(ctx["store"].pk)}, format="json",
        )
        assert response.status_code == 403, response.data
    assert supervisor.post(
        f"/api/v1/store-requisitions/{request_id}/submit/", {}, format="json",
    ).status_code == 200
    approved = head.post(
        f"/api/v1/store-requisitions/{request_id}/department-approve/",
        {"items": [{"id": line_id, "approved_quantity": "28.0000"}]},
        format="json",
    )
    assert approved.status_code == 200, approved.data
    handoff = {
        "reason": "Eight bottles cannot be fulfilled from Stores",
        "items": [{"id": line_id, "approved_quantity": "28.0000"}],
    }
    for forbidden in (supervisor, head, cost, buyer, finance, gm, receiver, ap):
        response = forbidden.post(
            f"/api/v1/store-requisitions/{request_id}/send-to-procurement/",
            handoff, format="json",
        )
        assert response.status_code in (403, 404), (response.status_code, response.data)
    purchase = keeper.post(
        f"/api/v1/store-requisitions/{request_id}/send-to-procurement/",
        handoff, format="json",
    )
    assert purchase.status_code == 200, purchase.data
    req = StoreRequisition.objects.get(pk=request_id)
    purchase_line = RequisitionItem.objects.get(requisition=req.procurement_requisition)
    assert purchase_line.quantity == Decimal("8.0000")
    assert req.status == StoreRequisitionStatus.AWAITING_PROCUREMENT

    # Dispatch in-stock goods without waiting for purchasing, then sign pickup.
    local_issue = keeper.post(
        f"/api/v1/store-requisitions/{request_id}/dispatch-transfer/",
        {"quantities": {line_id: "20.0000"}}, format="json",
    )
    assert local_issue.status_code == 201, local_issue.data
    assert StoreRequisition.objects.get(pk=request_id).status != StoreRequisitionStatus.COMPLETED
    first_signed = supervisor.post(
        f"/api/v1/stock-issues/{local_issue.data['id']}/acknowledge/",
        {}, format="json",
    )
    assert first_signed.status_code == 200, first_signed.data
    assert StoreRequisition.objects.get(pk=request_id).status != StoreRequisitionStatus.COMPLETED

    supplier = Supplier.objects.create(
        name="E2E Partial Delivery Supplier", email="e2e-partial@example.com",
        phone="+256700000099", address="Kampala", tin_number="E2E-TIN-9",
        registration_number="E2E-REG-9",
    )
    quotations = []
    for index, price in enumerate(("2500.00", "3000.00", "4000.00"), start=1):
        vendor = supplier if index == 1 else Supplier.objects.create(
            name=f"E2E comparison vendor {index}",
            email=f"e2e-comparison-{index}@example.com",
            phone=f"+2567000000{index:02d}", address="Kampala",
            tin_number=f"E2E-RFQ-TIN-{index}",
            registration_number=f"E2E-RFQ-REG-{index}",
        )
        quotation = VendorQuotation.objects.create(
            requisition=req.procurement_requisition, supplier=vendor,
            valid_until=timezone.localdate() + timedelta(days=14),
            payment_terms="Net 30",
        )
        VendorQuotationItem.objects.create(
            quotation=quotation, requisition_item=purchase_line,
            quantity=Decimal("8.0000"), unit=ctx["unit"],
            unit_price=Decimal(price),
        )
        quotations.append(quotation)

    with override_settings(
        PROCUREMENT_QUOTATION_THRESHOLD=Decimal("100.00"),
        PROCUREMENT_MIN_QUOTATIONS=3,
    ):
        report = buyer.get(
            f"/api/v1/quotations/comparison/?requisition={req.procurement_requisition_id}"
        )
        assert report.status_code == 200, report.data
        assert report.data["qualified_quotation_count"] == 3
        assert report.data["competitive_sourcing_ready"] is True
        assert finance.post(
            f"/api/v1/quotations/{quotations[0].pk}/award/",
            {"selection_reason": "Unauthorized finance award"}, format="json",
        ).status_code == 403
        award = buyer.post(
            f"/api/v1/quotations/{quotations[0].pk}/award/",
            {"selection_reason": "Lowest compliant comparable offer"},
            format="json",
        )
        assert award.status_code == 200, award.data

    order = req.procurement_requisition.create_purchase_order(
        ordered_by=buyer_employee, store=ctx["store"], created_by=buyer_employee.user,
    )
    assert order.supplier_id == supplier.pk
    po_line = order.items.get()
    assert po_line.quantity == Decimal("8.0000")
    assert po_line.unit_cost == Decimal("2500.00")
    assert order.status == POStatus.DRAFT

    # The three-role sequence is a real API decision, not a forced model status.
    blocked = buyer.post(
        f"/api/v1/purchase-orders/{order.pk}/issue/", {}, format="json",
    )
    assert blocked.status_code == 400, blocked.data
    submit = buyer.post(
        f"/api/v1/purchase-orders/{order.pk}/submit-for-approval/",
        {}, format="json",
    )
    assert submit.status_code == 200, submit.data
    assert finance.post(
        f"/api/v1/purchase-orders/{order.pk}/approve/",
        {"comments": "Attempt to bypass Procurement"}, format="json",
    ).status_code == 403
    for client, comment in (
        (buyer, "Procurement approved the RFQ award"),
        (finance, "Finance confirmed cost and budget"),
        (gm, "General Manager authorized LPO"),
    ):
        decision = client.post(
            f"/api/v1/purchase-orders/{order.pk}/approve/",
            {"comments": comment}, format="json",
        )
        assert decision.status_code == 200, (comment, decision.data)
    order.refresh_from_db()
    assert order.status == POStatus.APPROVED
    order.issue(sent_by=buyer_employee)
    assert order.status == POStatus.ISSUED

    for number, amount in enumerate(("3.0000", "5.0000"), start=1):
        arrived = receiver.post(
            f"/api/v1/purchase-orders/{order.pk}/receive-delivery/",
            {"supplier_invoice_no": f"E2E-INV-{number}",
             "lines": [{"purchase_order_item": str(po_line.pk),
                        "quantity_received": amount}]},
            format="json",
        )
        assert arrived.status_code == 201, arrived.data
        grn_id = arrived.data["id"]
        assert receiver.post(
            f"/api/v1/grns/{grn_id}/post-to-inventory/", {}, format="json",
        ).status_code == 403
        posted = keeper.post(
            f"/api/v1/grns/{grn_id}/post-to-inventory/", {}, format="json",
        )
        assert posted.status_code == 200, posted.data
        assert StockLedger.objects.filter(
            reference_id=grn_id,
            reference_type=LedgerReferenceType.GRN_RECEIPT,
        ).exists()
        assert StoreRequisition.objects.get(pk=request_id).status != StoreRequisitionStatus.COMPLETED
        dispatched = keeper.post(
            f"/api/v1/store-requisitions/{request_id}/dispatch-transfer/",
            {"quantities": {line_id: amount}}, format="json",
        )
        assert dispatched.status_code == 201, dispatched.data
        assert StoreRequisition.objects.get(pk=request_id).status != StoreRequisitionStatus.COMPLETED
        signed = supervisor.post(
            f"/api/v1/stock-issues/{dispatched.data['id']}/acknowledge/",
            {}, format="json",
        )
        assert signed.status_code == 200, signed.data

    req.refresh_from_db()
    original = StoreRequisitionItem.objects.get(pk=line_id)
    assert original.base_quantity_requested == Decimal("28.0000")
    assert original.hod_approved_quantity == Decimal("28.0000")
    assert original.quantity_approved == Decimal("28.0000")
    assert original.quantity_issued == Decimal("28.0000")
    assert req.status == StoreRequisitionStatus.COMPLETED
    assert DepartmentConsumption.objects.filter(
        stock_issue_item__issue__requisition=req,
    ).count() == 3

    # Finance handoff: actual AP API creates, matches and independently approves
    # the supplier invoice after both accepted GRNs have reached the store.
    from apps.finance.models import PaymentMethod, SupplierInvoice, SupplierPayment
    invoice_amount = Decimal("20000.00")
    assert finance.post(
        "/api/v1/supplier-invoices/",
        {
            "supplier": str(supplier.pk), "purchase_order": str(order.pk),
            "invoice_number": "E2E-FIN-INV-001", "subtotal": str(invoice_amount),
            "due_date": str(timezone.localdate()),
        }, format="json",
    ).status_code == 403
    created_invoice = ap.post(
        "/api/v1/supplier-invoices/",
        {
            "supplier": str(supplier.pk), "purchase_order": str(order.pk),
            "invoice_number": "E2E-FIN-INV-001", "subtotal": str(invoice_amount),
            "due_date": str(timezone.localdate()),
        }, format="json",
    )
    assert created_invoice.status_code == 201, created_invoice.data
    invoice_id = created_invoice.data["id"]
    match = ap.post(
        f"/api/v1/supplier-invoices/{invoice_id}/match/", {}, format="json",
    )
    assert match.status_code == 200, match.data
    invoice = SupplierInvoice.objects.get(pk=invoice_id)
    assert invoice.status == SupplierInvoice.STATUS_MATCHED
    assert invoice.amount_variance == Decimal("0.00")
    assert ap.post(
        f"/api/v1/supplier-invoices/{invoice_id}/approve-for-payment/",
        {}, format="json",
    ).status_code == 400
    independent_approval = ap_checker.post(
        f"/api/v1/supplier-invoices/{invoice_id}/approve-for-payment/",
        {}, format="json",
    )
    assert independent_approval.status_code == 200, independent_approval.data
    assert invoice_amount == Decimal("8.0000") * po_line.unit_cost

    payment_method = PaymentMethod.objects.create(name="E2E controlled bank transfer")
    for index, amount in enumerate(("7500.00", "12500.00"), start=1):
        created_payment = ap.post(
            "/api/v1/supplier-payments/",
            {
                "invoice": invoice_id, "amount": amount,
                "payment_method": str(payment_method.pk),
                "reference": f"E2E-PAY-{index:02d}",
            }, format="json",
        )
        assert created_payment.status_code == 201, created_payment.data
        payment_id = created_payment.data["id"]
        assert ap.post(
            f"/api/v1/supplier-payments/{payment_id}/post/",
            {}, format="json",
        ).status_code == 400
        posted_payment = ap_checker.post(
            f"/api/v1/supplier-payments/{payment_id}/post/",
            {}, format="json",
        )
        assert posted_payment.status_code == 200, posted_payment.data
    invoice.refresh_from_db()
    assert invoice.status == SupplierInvoice.STATUS_PAID
    assert invoice.balance_due == Decimal("0.00")
    assert SupplierPayment.objects.filter(
        invoice=invoice, status=SupplierPayment.STATUS_POSTED,
    ).count() == 2


@pytest.mark.django_db
def test_department_return_requires_signed_issue_assigned_keeper_and_no_overcredit(workflow):
    """Stock can only return from a real completed departmental handover."""
    ctx = workflow
    supervisor = ctx["supervisor"][2]
    keeper = ctx["keeper"][2]
    request_id, line_id = _create_supervisor_draft(ctx, "5.0000")
    assert supervisor.post(
        f"/api/v1/store-requisitions/{request_id}/submit/", {}, format="json"
    ).status_code == 200
    head = ctx["head"][2].post(
        f"/api/v1/store-requisitions/{request_id}/department-approve/",
        {"items": [{"id": line_id, "approved_quantity": "5.0000"}]},
        format="json",
    )
    assert head.status_code == 200, head.data
    cost = ctx["cost"][2].post(
        f"/api/v1/store-requisitions/{request_id}/cost-control-approve/",
        {"items": [{"id": line_id, "approved_quantity": "5.0000"}]},
        format="json",
    )
    assert cost.status_code == 200, cost.data

    before = InventoryBalance.objects.get(
        item=ctx["item"], store=ctx["store"]
    ).quantity_in_stock
    # No physical handover has been signed: no return can be raised.
    rejected = keeper.post(
        "/api/v1/store-returns/",
        {"department": str(ctx["department"].pk),
         "store": str(ctx["store"].pk), "reason": "Unused sealed bottles"},
        format="json",
    )
    assert rejected.status_code == 400, rejected.data

    dispatched = keeper.post(
        f"/api/v1/store-requisitions/{request_id}/dispatch-transfer/",
        {"quantities": {line_id: "5.0000"}}, format="json",
    )
    assert dispatched.status_code == 201, dispatched.data
    assert supervisor.post(
        f"/api/v1/stock-issues/{dispatched.data['id']}/acknowledge/",
        {}, format="json",
    ).status_code == 200
    # Simulate a later catalogue/stock WAC change. The returned 2 bottles
    # must reverse the ORIGINAL issue cost, not the new 3,200 WAC.
    InventoryBalance.objects.filter(
        item=ctx["item"], store=ctx["store"],
    ).update(weighted_average_cost=Decimal("3200.0000"))

    remote_branch = Branch.objects.create(name="Separate Hotel Return Property")
    remote_user = get_user_model().objects.create_user(
        username="return-remote-keeper", employee_code="RET-REMOTE",
    )
    remote_user.groups.add(Group.objects.get_or_create(name="Store Keeper")[0])
    remote_employee = Employee.objects.create(
        user=remote_user, department=ctx["department"],
        branch=remote_branch, designation="Store Keeper", is_active=True,
    )
    # Even a mistakenly assigned remote keeper cannot cross property borders.
    StoreKeeperAssignment.objects.create(
        store=ctx["store"], employee=remote_employee, is_active=True,
    )
    remote_client = APIClient()
    remote_client.force_authenticate(remote_user)
    admin_user = get_user_model().objects.create_user(
        username="return-it-admin", employee_code="RET-ADMIN", is_superuser=True,
    )
    admin_client = APIClient()
    admin_client.force_authenticate(admin_user)
    for client in (supervisor, ctx["head"][2], ctx["cost"][2], remote_client, admin_client):
        denied = client.post(
            "/api/v1/store-returns/",
            {"department": str(ctx["department"].pk),
             "store": str(ctx["store"].pk), "reason": "Unauthorized"},
            format="json",
        )
        assert denied.status_code == 403, denied.data

    created = keeper.post(
        "/api/v1/store-returns/",
        {"department": str(ctx["department"].pk),
         "store": str(ctx["store"].pk), "reason": "Unused sealed bottles"},
        format="json",
    )
    assert created.status_code == 201, created.data
    return_id = created.data["id"]
    assert str(created.data["received_by"]) == str(ctx["keeper"][1].pk)
    first_line = keeper.post(
        "/api/v1/store-return-items/",
        {"store_return": return_id, "item": str(ctx["item"].pk),
         "unit": str(ctx["unit"].pk), "quantity": "2.0000"},
        format="json",
    )
    assert first_line.status_code == 201, first_line.data
    assert supervisor.post(
        f"/api/v1/store-returns/{return_id}/apply/", {}, format="json"
    ).status_code in (403, 404)
    period = FiscalPeriod.objects.get(branch=ctx["branch"])
    FiscalPeriod.objects.filter(pk=period.pk).update(status=FiscalPeriod.STATUS_CLOSED)
    locked = keeper.post(
        f"/api/v1/store-returns/{return_id}/apply/", {}, format="json",
    )
    assert locked.status_code == 400, locked.data
    FiscalPeriod.objects.filter(pk=period.pk).update(status=FiscalPeriod.STATUS_OPEN)
    applied = keeper.post(
        f"/api/v1/store-returns/{return_id}/apply/", {}, format="json",
    )
    assert applied.status_code == 200, applied.data
    from apps.inventory.models import StockLedger
    from core.constants.choices import LedgerReferenceType
    credited = StockLedger.objects.get(
        reference_id=return_id,
        reference_type=LedgerReferenceType.STORE_RETURN,
    )
    assert credited.unit_cost_snapshot == Decimal("2500.0000")
    assert credited.total_cost_snapshot == Decimal("5000.0000")
    assert credited.wac_before == Decimal("3200.0000")
    assert InventoryBalance.objects.get(
        item=ctx["item"], store=ctx["store"]
    ).weighted_average_cost == Decimal("3117.6471")
    assert InventoryBalance.objects.get(
        item=ctx["item"], store=ctx["store"]
    ).quantity_in_stock == before - Decimal("3.0000")
    assert keeper.post(
        f"/api/v1/store-returns/{return_id}/apply/", {}, format="json"
    ).status_code == 400
    assert keeper.patch(
        f"/api/v1/store-return-items/{first_line.data['id']}/",
        {"quantity": "3.0000"}, format="json",
    ).status_code == 400
    assert keeper.delete(
        f"/api/v1/store-returns/{return_id}/"
    ).status_code == 400

    excessive = keeper.post(
        "/api/v1/store-returns/",
        {"department": str(ctx["department"].pk),
         "store": str(ctx["store"].pk), "reason": "Over-return attempt"},
        format="json",
    )
    assert excessive.status_code == 201, excessive.data
    extra_line = keeper.post(
        "/api/v1/store-return-items/",
        {"store_return": excessive.data["id"], "item": str(ctx["item"].pk),
         "unit": str(ctx["unit"].pk), "quantity": "3.0001"},
        format="json",
    )
    assert extra_line.status_code == 201, extra_line.data
    assert keeper.post(
        f"/api/v1/store-returns/{excessive.data['id']}/apply/",
        {}, format="json",
    ).status_code == 400
    assert InventoryBalance.objects.get(
        item=ctx["item"], store=ctx["store"]
    ).quantity_in_stock == before - Decimal("3.0000")


@pytest.mark.django_db
def test_role_by_role_acceptance_blocks_draft_mutations_and_approval_skips(workflow):
    """Negative staging contract: IT, HOD, Cost Control and Stores cannot
    change the wrong document state or forge the Supervisor's signature.
    """
    ctx = workflow
    supervisor = ctx["supervisor"][2]
    hod = ctx["head"][2]
    cost = ctx["cost"][2]
    keeper = ctx["keeper"][2]
    request_id, line_id = _create_supervisor_draft(ctx, "4.0000")
    admin_user = get_user_model().objects.create_superuser(
        username="staging-it", employee_code="STAGING-IT",
        password="staging-only-password",
    )
    admin = APIClient()
    admin.force_authenticate(admin_user)
    path = f"/api/v1/store-requisitions/{request_id}/"
    line_path = f"/api/v1/store-requisition-items/{line_id}/"
    for client in (admin, hod, cost, keeper):
        assert client.patch(path, {"purpose": "Unauthorized change"}, format="json").status_code == 403
        assert client.patch(
            line_path, {"quantity_requested": "1.0000"}, format="json"
        ).status_code in (403, 404)
        assert client.delete(path).status_code == 403
        assert client.post(path + "submit/", {}, format="json").status_code in (403, 404)
    assert hod.post(
        path + "department-approve/",
        {"items": [{"id": line_id, "approved_quantity": "4.0000"}]},
        format="json",
    ).status_code == 400
    assert keeper.post(
        path + "dispatch-transfer/",
        {"quantities": {line_id: "1.0000"}}, format="json",
    ).status_code in (400, 403)
    assert supervisor.post(path + "submit/", {}, format="json").status_code == 200
    assert supervisor.patch(
        path, {"purpose": "Alter submitted requisition"}, format="json"
    ).status_code == 403
    assert supervisor.patch(
        line_path, {"quantity_requested": "1.0000"}, format="json"
    ).status_code == 403
    for client in (admin, supervisor, cost, keeper):
        assert client.post(
            path + "department-approve/",
            {"items": [{"id": line_id, "approved_quantity": "4.0000"}]},
            format="json",
        ).status_code in (403, 404)
    assert hod.post(
        path + "department-approve/",
        {"items": [{"id": line_id, "approved_quantity": "4.0000"}]},
        format="json",
    ).status_code == 200
    for client in (admin, supervisor, hod, keeper):
        assert client.post(
            path + "cost-control-approve/",
            {"items": [{"id": line_id, "approved_quantity": "4.0000"}]},
            format="json",
        ).status_code in (403, 404)
    assert cost.post(
        path + "cost-control-approve/",
        {"items": [{"id": line_id, "approved_quantity": "4.0000"}]},
        format="json",
    ).status_code == 200
    for client in (admin, supervisor, hod, cost):
        assert client.post(
            path + "dispatch-transfer/",
            {"quantities": {line_id: "4.0000"}}, format="json",
        ).status_code in (403, 404)
    issued = keeper.post(
        path + "dispatch-transfer/",
        {"quantities": {line_id: "4.0000"}}, format="json",
    )
    assert issued.status_code == 201, issued.data
    for client in (admin, hod, cost, keeper):
        assert client.post(
            f"/api/v1/stock-issues/{issued.data['id']}/acknowledge/",
            {}, format="json",
        ).status_code in (403, 404)
    assert supervisor.post(
        f"/api/v1/stock-issues/{issued.data['id']}/acknowledge/",
        {}, format="json",
    ).status_code == 200
    original = StoreRequisitionItem.objects.get(pk=line_id)
    assert original.quantity_issued == Decimal("4.0000")
    assert StoreRequisition.objects.get(pk=request_id).status == StoreRequisitionStatus.COMPLETED
