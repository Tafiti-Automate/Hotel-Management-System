from decimal import Decimal, InvalidOperation
from datetime import timedelta
import json
import smtplib

from django.http import Http404, HttpResponse
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import models, transaction
from django.conf import settings
from django.core.mail import EmailMessage
from django.utils import timezone
from django.utils.http import content_disposition_header
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response
from rest_framework import status
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from apps.employees.models import Employee
from apps.approvals.models import ApprovalWorkflow, PurchaseOrderApprovalWorkflow
from apps.approvals.serializers import ApprovalWorkflowSerializer
from apps.procurement.documents import build_purchase_order_pdf
from apps.procurement.models import (
    GoodsInspection,
    GoodsInspectionItem,
    GoodsReceiptItem,
    GoodsReceiptNote,
    PurchaseOrder,
    PurchaseOrderItem,
    ProcurementAttachment,
    ProcurementCommunication,
    PurchaseRequisition,
    RequisitionHistory,
    RequisitionItem,
    SupplierReturn,
    SupplierReturnItem,
    VendorQuotation,
    VendorQuotationItem,
)
from apps.vendors.models import Supplier
from core.constants.choices import (
    ApprovalStatus,
    GoodsInspectionStatus,
    GoodsReceiptStatus,
    POStatus,
    PRStatus,
    ProcurementSource,
    RequisitionType,
)
from apps.procurement.serializers import (
    GoodsInspectionItemSerializer,
    GoodsInspectionSerializer,
    GoodsReceiptItemSerializer,
    GoodsReceiptNoteSerializer,
    PurchaseOrderSerializer,
    PurchaseOrderItemSerializer,
    ProcurementAttachmentSerializer,
    ProcurementCommunicationSerializer,
    PurchaseRequisitionSerializer,
    RequisitionHistorySerializer,
    RequisitionItemSerializer,
    SupplierReturnItemSerializer,
    SupplierReturnSerializer,
    VendorQuotationItemSerializer,
    VendorQuotationSerializer,
)
from core.mixins.viewsets import CreatedByModelMixin


class PDFRenderer(BaseRenderer):
    """Allow controlled document actions to negotiate application/pdf."""

    media_type = "application/pdf"
    format = "pdf"
    charset = None
    render_style = "binary"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        if isinstance(data, bytes):
            return data
        return json.dumps(data, default=str).encode("utf-8")


def email_delivery_failure_message(error):
    """Return an actionable message without exposing mail credentials."""
    if isinstance(error, smtplib.SMTPAuthenticationError):
        return (
            "The mail server rejected the sender login. Check EMAIL_HOST_USER and "
            "EMAIL_HOST_PASSWORD in the backend deployment environment."
        )
    if isinstance(error, smtplib.SMTPRecipientsRefused):
        return "The mail provider rejected the supplier email address. Confirm the address and retry."
    if isinstance(error, (ConnectionRefusedError, TimeoutError, OSError)):
        return (
            "The production mail server could not be reached. Check EMAIL_HOST, EMAIL_PORT, "
            "EMAIL_USE_TLS and the mail provider's network settings."
        )
    if isinstance(error, smtplib.SMTPException):
        return "The mail provider could not deliver the LPO. Check the backend email settings and retry."
    return "The LPO email could not be delivered. Check the backend mail configuration and retry."


def raise_drf_validation_error(error):
    raise ValidationError(getattr(error, "messages", str(error)))


def enforce_readiness(readiness):
    if readiness["blockers"]:
        raise ValidationError(
            {
                "detail": "Complete the required steps before continuing.",
                "blockers": readiness["blockers"],
                "warnings": readiness["warnings"],
            }
        )


def user_has_role(user, *roles):
    return bool(
        user
        and user.is_authenticated
        and (user.is_superuser or user.groups.filter(name__in=roles).exists())
    )


COMMERCIAL_CONTROL_ROLES = (
    "System Administrator",
    "Procurement Manager",
    "Procurement Officer",
    "Financial Manager",
    "General Manager",
)
RECEIVING_ROLES = ("Receiving Clerk",)


def scope_purchase_orders_for_user(queryset, user):
    """Apply the same LPO visibility rules to lists and the combined workspace."""
    employee = getattr(user, "employee_profile", None)
    if user.is_superuser or user_has_role(user, "System Administrator"):
        return queryset
    if user_has_role(user, "Procurement Manager", "Procurement Officer", "Financial Manager", "General Manager"):
        if employee and employee.branch_id:
            return queryset.filter(requisition__branch=employee.branch)
        return queryset
    if user_has_role(user, *RECEIVING_ROLES):
        queryset = queryset.filter(
            status__in=(POStatus.ISSUED, POStatus.PARTIALLY_RECEIVED)
        )
        if employee and employee.branch_id:
            queryset = queryset.filter(requisition__branch=employee.branch)
        return queryset
    if user_has_role(user, "Store Keeper"):
        if not employee:
            return queryset.none()
        return queryset.filter(
            models.Q(
                store__keeper_assignments__employee=employee,
                store__keeper_assignments__is_active=True,
            )
            | models.Q(
                items__destination_store__keeper_assignments__employee=employee,
                items__destination_store__keeper_assignments__is_active=True,
            )
        ).distinct()
    if not employee:
        return queryset.none()
    return queryset.filter(requisition__requester=employee)


def current_lpo_approval_queue(queryset, user, role_name):
    """Return LPOs whose *first unfinished* approval stage belongs to this user/role.

    All approval rows exist from submission time. A simple
    ``approval_workflow__status=pending`` filter would expose future stages too
    early and can also miss legacy employee-assigned stages. The first pending
    stage is the authoritative queue owner.
    """
    pending_steps = PurchaseOrderApprovalWorkflow.objects.filter(
        purchase_order_id=models.OuterRef("pk"),
        status=ApprovalStatus.PENDING,
    ).order_by("stage")
    queue = queryset.filter(status=POStatus.PENDING_APPROVAL).annotate(
        current_approval_role_id=models.Subquery(
            pending_steps.values("approver_role_id")[:1]
        ),
        current_approval_employee_id=models.Subquery(
            pending_steps.values("approver_id")[:1]
        ),
    )
    if user.is_superuser:
        return queue
    employee = getattr(user, "employee_profile", None)
    role_ids = user.groups.filter(name=role_name).values_list("id", flat=True)
    ownership = models.Q(current_approval_role_id__in=role_ids)
    # Compatibility for an old pending workflow that has not yet been migrated.
    if employee:
        ownership |= models.Q(current_approval_employee_id=employee.pk)
    return queue.filter(ownership)


class PurchaseRequisitionViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = PurchaseRequisition.objects.select_related(
        "hotel",
        "branch",
        "requester",
        "department",
        "preferred_supplier",
        "source_store_requisition",
    ).prefetch_related(
        "approval_workflow__approver__user",
    )
    serializer_class = PurchaseRequisitionSerializer
    filterset_fields = ("request_type", "procurement_source", "status", "requester", "department", "preferred_supplier", "source_store_requisition")
    search_fields = (
        "reason",
        "control_notes",
        "requisition_number",
        "requester__user__employee_code",
        "department__name",
        "preferred_supplier__name",
    )
    ordering_fields = ("requisition_number", "status", "created_at", "expected_date")

    def get_permissions(self):
        if self.action in ("workspace", "store_purchase_requests", "cancel_store_purchase_request"):
            return [IsAuthenticated()]
        return super().get_permissions()

    def _store_purchase_employee(self, request):
        if not user_has_role(request.user, "System Administrator", "Store Keeper"):
            raise PermissionDenied("Only an assigned Store Keeper can create store purchase requests.")
        employee = getattr(request.user, "employee_profile", None)
        if not employee or not employee.is_active:
            raise PermissionDenied("An active Store Keeper employee profile is required.")
        return employee

    @action(detail=False, methods=["get", "post"], url_path="store-purchase-requests")
    def store_purchase_requests(self, request):
        """Create and list Store Keeper purchase requests for assigned stores.

        Store Keepers never enter supplier or price information here.  The
        request moves directly to Procurement with quantities and destination
        store only; supplier selection and all commercial values remain under
        Procurement/Cost Controller controls.
        """
        from apps.inventory.models import (
            InventoryBalance,
            Item,
            StoreKeeperAssignment,
            StoreLocation,
            SupplierItemPrice,
        )
        from apps.notifications.services import notify_roles
        from django.utils.dateparse import parse_date

        employee = self._store_purchase_employee(request)
        assignments = StoreKeeperAssignment.objects.select_related("store__branch").filter(
            employee=employee,
            is_active=True,
            store__is_active=True,
        ).order_by("store__name")
        store_ids = list(assignments.values_list("store_id", flat=True))

        if request.method == "GET":
            requests = (
                PurchaseRequisition.objects.filter(
                    requester=employee,
                    procurement_source=ProcurementSource.STORE_PURCHASE,
                )
                .select_related("branch", "requester", "department")
                .order_by("-created_at")
            )
            request_ids = list(requests.values_list("id", flat=True))
            lines = list(
                RequisitionItem.objects.filter(requisition_id__in=request_ids)
                .select_related("item", "unit", "destination_store")
                .order_by("requisition_id", "item__name")
            )
            lines_by_request = {}
            for line in lines:
                lines_by_request.setdefault(str(line.requisition_id), []).append(line)

            serialized_requests = []
            for requisition in requests:
                row = PurchaseRequisitionSerializer(
                    requisition, context={"request": request}
                ).data
                req_lines = lines_by_request.get(str(requisition.id), [])
                destination = next(
                    (line.destination_store for line in req_lines if line.destination_store_id),
                    None,
                )
                row["destination_store"] = str(getattr(destination, "pk", "") or "")
                row["destination_store_name"] = str(destination or "")
                row["item_count"] = len(req_lines)
                row["item_summary"] = ", ".join(
                    f"{line.item.name} × {line.quantity:g}" for line in req_lines[:3]
                ) + ("…" if len(req_lines) > 3 else "")
                row["can_cancel"] = (
                    requisition.status in (PRStatus.APPROVED, PRStatus.DRAFT)
                    and not requisition.purchase_orders.exists()
                )
                serialized_requests.append(row)

            balances = InventoryBalance.objects.filter(
                store_id__in=store_ids
            ).values("store_id", "item_id", "quantity_in_stock", "quantity_reserved")

            return Response({
                "requests": serialized_requests,
                "lines": RequisitionItemSerializer(
                    lines, many=True, context={"request": request}
                ).data,
                "stores": [
                    {
                        "id": str(assignment.store_id),
                        "name": assignment.store.name,
                        "branch": str(assignment.store.branch_id or ""),
                        "branch_name": str(assignment.store.branch or ""),
                    }
                    for assignment in assignments
                ],
                "balances": [
                    {
                        "store": str(balance["store_id"]),
                        "item": str(balance["item_id"]),
                        "on_hand": str(balance["quantity_in_stock"]),
                        "reserved": str(balance["quantity_reserved"]),
                    }
                    for balance in balances
                ],
            })

        store_id = str(request.data.get("store") or "").strip()
        reason = str(request.data.get("reason") or "").strip()
        expected_date_raw = str(request.data.get("expected_date") or "").strip()
        payload_lines = request.data.get("lines") or []

        if not reason:
            raise ValidationError({"reason": "Enter the reason for this store purchase request."})
        if not isinstance(payload_lines, list) or not payload_lines:
            raise ValidationError({"lines": "Add at least one Article to the purchase request."})
        if not store_id and len(store_ids) == 1:
            store_id = str(store_ids[0])
        assignment = assignments.filter(store_id=store_id).first()
        if not assignment:
            raise PermissionDenied("Choose a store assigned to your Store Keeper account.")
        store = assignment.store

        expected_date = None
        if expected_date_raw:
            expected_date = parse_date(expected_date_raw)
            if not expected_date:
                raise ValidationError({"expected_date": "Enter a valid required date."})
            if expected_date < timezone.localdate():
                raise ValidationError({"expected_date": "The required date cannot be in the past."})

        prepared_lines = []
        seen_items = set()
        today = timezone.localdate()
        for index, payload in enumerate(payload_lines, start=1):
            if not isinstance(payload, dict):
                raise ValidationError({"lines": f"Line {index} is not valid."})
            item_id = str(payload.get("item") or "").strip()
            if not item_id:
                raise ValidationError({"lines": f"Choose an Article on line {index}."})
            if item_id in seen_items:
                raise ValidationError({"lines": "The same Article cannot be added twice."})
            seen_items.add(item_id)
            try:
                quantity = Decimal(str(payload.get("quantity") or "0"))
            except (InvalidOperation, TypeError, ValueError):
                raise ValidationError({"lines": f"Enter a valid quantity on line {index}."})
            if quantity <= 0:
                raise ValidationError({"lines": f"Quantity on line {index} must be greater than zero."})

            item = Item.objects.select_related("base_unit").filter(
                pk=item_id, is_active=True
            ).first()
            if not item:
                raise ValidationError({"lines": f"Article on line {index} is unavailable."})

            quotations = SupplierItemPrice.objects.filter(
                item=item,
                is_active=True,
                effective_from__lte=today,
            ).filter(
                models.Q(quotation_valid_until__isnull=True)
                | models.Q(quotation_valid_until__gte=today)
            ).select_related("unit", "item__base_unit")
            reference_costs = [
                quotation.base_unit_price
                for quotation in quotations
                if quotation.unit_price > 0
            ]
            reference_cost = min(reference_costs) if reference_costs else Decimal("0.00")
            prepared_lines.append((item, quantity, reference_cost, str(payload.get("note") or "").strip()))

        with transaction.atomic():
            # Serialize purchase-request creation per destination store so two
            # browser sessions cannot create the same replenishment line at once.
            StoreLocation.objects.select_for_update().get(pk=store.pk)
            for item, quantity, reference_cost, note in prepared_lines:
                duplicate = RequisitionItem.objects.filter(
                    item=item,
                    destination_store=store,
                    requisition__procurement_source=ProcurementSource.STORE_PURCHASE,
                    requisition__status__in=(
                        PRStatus.APPROVED,
                        PRStatus.PARTIALLY_ORDERED,
                        PRStatus.ORDERED,
                        PRStatus.PARTIALLY_RECEIVED,
                    ),
                ).exists()
                if duplicate:
                    raise ValidationError({
                        "lines": (
                            f"{item.name} already has an open Store Purchase Request for {store}. "
                            "Complete or cancel that request before creating another."
                        )
                    })

            purchase = PurchaseRequisition.objects.create(
                request_type=RequisitionType.HOTEL_PURCHASE,
                procurement_source=ProcurementSource.STORE_PURCHASE,
                requester=employee,
                department=employee.department,
                branch=store.branch,
                expected_date=expected_date,
                reason=reason,
                control_notes=f"Store replenishment request for {store}.",
                created_by=request.user,
            )
            for item, quantity, reference_cost, note in prepared_lines:
                RequisitionItem.objects.create(
                    requisition=purchase,
                    item=item,
                    unit=item.base_unit,
                    quantity=quantity,
                    approved_quantity=quantity,
                    estimated_unit_cost=reference_cost,
                    description=note or f"Store replenishment for {store}.",
                    destination_type=RequisitionItem.DESTINATION_STORE,
                    destination_store=store,
                    created_by=request.user,
                )
            purchase.status = PRStatus.APPROVED
            purchase.approved_at = timezone.now()
            purchase.save(update_fields=["status", "approved_at", "updated_at"])
            purchase.record_history(
                action="store_purchase_request_created",
                previous_status=PRStatus.DRAFT,
                actor=request.user,
                comments=f"Store Keeper created a purchase request for {store}.",
                metadata={
                    "destination_store": str(store.pk),
                    "destination_store_name": store.name,
                    "item_count": len(prepared_lines),
                },
            )

        notify_roles(
            ("Procurement Manager", "Procurement Officer"),
            title=f"{purchase.requisition_number} is ready for Procurement",
            message=f"{employee} created a Store Purchase Request for {store}. Review and prepare the purchase.",
            branch=store.branch,
            created_by=request.user,
        )

        row = PurchaseRequisitionSerializer(purchase, context={"request": request}).data
        row["destination_store"] = str(store.pk)
        row["destination_store_name"] = store.name
        row["item_count"] = len(prepared_lines)
        return Response(row, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="cancel-store-purchase-request")
    def cancel_store_purchase_request(self, request, pk=None):
        employee = self._store_purchase_employee(request)
        requisition = self.get_object()
        if (
            requisition.procurement_source != ProcurementSource.STORE_PURCHASE
            or requisition.requester_id != employee.id
        ):
            raise PermissionDenied("You can only cancel a Store Purchase Request that you created.")
        if requisition.purchase_orders.exists() or requisition.status not in (
            PRStatus.APPROVED,
            PRStatus.DRAFT,
        ):
            raise ValidationError(
                "This purchase request has already entered Procurement processing and can no longer be cancelled here."
            )
        previous = requisition.status
        requisition.status = PRStatus.CANCELLED
        requisition.cancelled_at = timezone.now()
        requisition.save(update_fields=["status", "cancelled_at", "updated_at"])
        requisition.record_history(
            action="store_purchase_request_cancelled",
            previous_status=previous,
            actor=request.user,
            comments=str(request.data.get("comments") or "Cancelled by Store Keeper.").strip(),
        )
        return Response(PurchaseRequisitionSerializer(requisition, context={"request": request}).data)

    @action(detail=False, methods=["get"], url_path="workspace")
    def workspace(self, request):
        """Return the connected records needed by one procurement tab in one request."""
        stage = request.query_params.get("stage", "request")
        allowed = {"request", "quote", "lpo", "receipt", "inspect", "return"}
        if stage not in allowed:
            raise ValidationError({"stage": "Choose request, quote, lpo, receipt, inspect, or return."})
        stage_permission = {
            "request": "procurement.view_purchaserequisition",
            "quote": "inventory.view_supplieritemprice",
            "lpo": "procurement.view_purchaseorder",
            "receipt": "procurement.view_goodsreceiptnote",
            "inspect": "procurement.view_goodsinspection",
            "return": "procurement.view_supplierreturn",
        }[stage]
        stores_receiver = request.user.groups.filter(
            name="Store Keeper"
        ).exists()
        stores_readable_stages = {"lpo", "receipt", "inspect", "return"}
        if not request.user.is_superuser and not request.user.has_perm(stage_permission) and not (
            stores_receiver and stage in stores_readable_stages
        ):
            raise PermissionDenied("You do not have permission to view this procurement stage.")

        orders = None
        if stage in {"lpo", "receipt", "inspect", "return"}:
            orders = scope_purchase_orders_for_user(
                PurchaseOrder.objects.select_related(
                    "requisition", "supplier", "ordered_by", "store", "sent_by", "approved_by"
                ).prefetch_related("approval_workflow__approver__user", "approval_workflow__approver_role", "approval_workflow__decided_by"),
                request.user,
            )
            order_ids = orders.values_list("id", flat=True)
            if stage == "lpo" and user_has_role(
                request.user, "System Administrator", "Procurement Manager", "Procurement Officer"
            ):
                # Procurement must see approved requisitions before an LPO exists;
                # otherwise the LPO creation selector is an impossible empty state.
                requisitions = self.get_queryset()
            else:
                requisitions = self.queryset.filter(
                    id__in=orders.values_list("requisition_id", flat=True)
                )
        else:
            requisitions = self.get_queryset()
            order_ids = PurchaseOrder.objects.none().values_list("id", flat=True)
        requisition_ids = requisitions.values_list("id", flat=True)
        payload = {
            "requisitions": PurchaseRequisitionSerializer(requisitions, many=True, context={"request": request}).data,
        }

        if stage in {"request", "quote"}:
            lines = RequisitionItem.objects.filter(requisition_id__in=requisition_ids)
            payload["requisitionItems"] = RequisitionItemSerializer(lines, many=True, context={"request": request}).data
        if stage == "request" and (
            request.user.is_superuser or request.user.has_perm("approvals.view_approvalworkflow")
        ):
            approvals = ApprovalWorkflow.objects.filter(requisition_id__in=requisition_ids)
            payload["approvals"] = ApprovalWorkflowSerializer(approvals, many=True, context={"request": request}).data
        if stage in {"lpo", "receipt", "inspect", "return"}:
            payload["orders"] = PurchaseOrderSerializer(orders, many=True, context={"request": request}).data
            payload["orderItems"] = PurchaseOrderItemSerializer(
                PurchaseOrderItem.objects.filter(purchase_order_id__in=order_ids),
                many=True, context={"request": request},
            ).data
            # Approval queues are authoritative server-side role queues.  Do not
            # make Finance/GM reconstruct their inbox from serialized status text.
            approval_role = None
            if user_has_role(request.user, "Procurement Manager"):
                approval_role = "Procurement Manager"
            elif user_has_role(request.user, "Financial Manager"):
                approval_role = "Financial Manager"
            elif user_has_role(request.user, "General Manager"):
                approval_role = "General Manager"
            if stage == "lpo" and approval_role:
                approval_queue_orders = current_lpo_approval_queue(
                    orders, request.user, approval_role
                ).distinct()
                payload["approvalQueueOrders"] = PurchaseOrderSerializer(
                    approval_queue_orders,
                    many=True,
                    context={"request": request},
                ).data
        if stage in {"receipt", "inspect", "return"}:
            if user_has_role(request.user, *RECEIVING_ROLES) and not user_has_role(
                request.user, *COMMERCIAL_CONTROL_ROLES
            ):
                # Receiving history must remain visible after an LPO becomes
                # fully received and therefore drops out of the ready-LPO list.
                receipts = GoodsReceiptNote.objects.filter(
                    received_by=getattr(request.user, "employee_profile", None)
                ).select_related(
                    "received_by__user",
                    "purchase_order__supplier",
                    "purchase_order__store",
                    "purchase_order__requisition__branch",
                )
            else:
                receipts = GoodsReceiptNote.objects.filter(
                    purchase_order_id__in=order_ids
                ).select_related(
                    "received_by__user",
                    "purchase_order__supplier",
                    "purchase_order__store",
                    "purchase_order__requisition__branch",
                )
            receipt_ids = receipts.values_list("id", flat=True)
            payload["receipts"] = GoodsReceiptNoteSerializer(receipts, many=True, context={"request": request}).data
            payload["receiptItems"] = GoodsReceiptItemSerializer(
                GoodsReceiptItem.objects.filter(goods_receipt_id__in=receipt_ids)
                .select_related("item", "purchase_order_item__unit")
                .prefetch_related("inspection_items"),
                many=True, context={"request": request},
            ).data
        if stage == "inspect":
            inspections = GoodsInspection.objects.filter(goods_receipt_id__in=receipt_ids)
            payload["inspections"] = GoodsInspectionSerializer(inspections, many=True, context={"request": request}).data
            payload["inspectionItems"] = GoodsInspectionItemSerializer(
                GoodsInspectionItem.objects.filter(inspection__goods_receipt_id__in=receipt_ids),
                many=True, context={"request": request},
            ).data
        if stage == "return":
            returns = SupplierReturn.objects.filter(goods_receipt_id__in=receipt_ids)
            payload["returns"] = SupplierReturnSerializer(returns, many=True, context={"request": request}).data
            payload["returnItems"] = SupplierReturnItemSerializer(
                SupplierReturnItem.objects.filter(supplier_return__goods_receipt_id__in=receipt_ids),
                many=True, context={"request": request},
            ).data
        return Response(payload)

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.is_superuser or user.groups.filter(
            name__in=(
                "System Administrator",
                "General Manager",
                "Procurement Manager",
                "Procurement Officer",
                "Financial Manager",
            )
        ).exists():
            return queryset
        employee = getattr(user, "employee_profile", None)
        if not employee:
            return queryset.none()
        if user.groups.filter(name="Store Keeper").exists():
            return queryset.filter(branch=employee.branch)
        return queryset.filter(requester=employee)

    def perform_destroy(self, instance):
        if instance.status != PRStatus.DRAFT:
            raise ValidationError(
                "Submitted procurement records cannot be deleted. Cancel or close the requisition instead."
            )
        instance.delete()

    @action(detail=True, methods=["get"])
    def readiness(self, request, pk=None):
        return Response(self.get_object().submission_readiness())

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        requisition = self.get_object()
        enforce_readiness(requisition.submission_readiness())
        try:
            requisition.submit(actor=request.user)
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(requisition)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        requisition = self.get_object()
        try:
            requisition.cancel(
                actor=request.user,
                comments=str(request.data.get("comments", "")),
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(requisition)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        requisition = self.get_object()
        try:
            requisition.close(
                actor=request.user,
                comments=str(request.data.get("comments", "")),
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(requisition).data)

    def _allocate_procurement_line(self, request, requisition, payload):
        from apps.inventory.models import SupplierItemPrice

        line = requisition.items.select_for_update().select_related("item").filter(
            pk=payload.get("line_id") or payload.get("id")
        ).first()
        if not line:
            raise ValidationError({"line_id": "Select an Article from this Store Requisition."})
        price = SupplierItemPrice.objects.select_for_update().filter(
            pk=payload.get("supplier_price"), is_active=True
        ).order_by("pk").first()
        if not price or price.item_id != line.item_id:
            raise ValidationError({"supplier_price": f"Choose an active vetted supplier quotation for {line.item}."})
        # Client-facing procurement quantities remain in the Article base/request UOM.
        # A supplier quotation may be expressed in a larger purchase pack (for
        # example a carton of 5 reams), but that must never turn a request for
        # 1 ream into an LPO quantity of 0.20 carton.  Keep the requested
        # quantity intact and convert only the supplier's quoted price to the
        # base UOM used on the LPO.
        quantity = Decimal(str(payload.get("quantity") or "0"))
        if quantity <= 0 or quantity > line.remaining_order_quantity:
            raise ValidationError({
                "quantity": f"Procurement quantity for {line.item} must be positive and cannot exceed {line.remaining_order_quantity}."
            })
        quote_unit = price.unit or line.item.base_unit
        conversion_factor = line.item.conversion_factor_for_unit(quote_unit)
        if conversion_factor <= 0:
            raise ValidationError({
                "supplier_price": f"The supplier quotation UOM for {line.item} has no valid conversion."
            })
        supplied_unit_price = payload.get("unit_price")
        if supplied_unit_price not in (None, ""):
            try:
                requested_price = Decimal(str(supplied_unit_price))
            except (InvalidOperation, TypeError, ValueError):
                raise ValidationError({"unit_price": "Enter a valid supplier price."})
            if requested_price != price.unit_price:
                raise PermissionDenied(
                    "Supplier prices are set by the Cost Controller and are read-only in Procurement."
                )
        confirmed_price = price.unit_price
        if confirmed_price <= 0:
            raise ValidationError({"supplier_price": f"The approved supplier price for {line.item} is invalid."})
        base_unit_price = (confirmed_price / conversion_factor).quantize(Decimal("0.01"))
        line.procurement_supplier = price.supplier
        line.procurement_supplier_price = price
        line.procurement_unit = line.item.base_unit
        line.procurement_quantity = quantity
        line.procurement_unit_cost = base_unit_price
        line.procurement_note = str(payload.get("note") or "").strip()
        line.procurement_allocated_at = timezone.now()
        line.procurement_allocated_by = request.user
        line.full_clean()
        line.save(update_fields=[
            "procurement_supplier", "procurement_supplier_price", "procurement_unit",
            "procurement_quantity", "procurement_unit_cost", "procurement_note",
            "procurement_allocated_at", "procurement_allocated_by", "updated_at",
        ])
        return line

    @action(detail=True, methods=["post"], url_path="reject-all-items")
    def reject_all_items(self, request, pk=None):
        requisition = self.get_object()
        if not user_has_role(request.user, "System Administrator", "Procurement Manager", "Procurement Officer"):
            raise PermissionDenied("Only Procurement can reject the procurement requisition.")
        if requisition.status not in (PRStatus.APPROVED, PRStatus.PARTIALLY_ORDERED):
            raise ValidationError("Only an approved Store Requisition can be rejected by Procurement.")
        reason = str(request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": "Enter the reason for rejecting the requisition."})
        if requisition.purchase_orders.exclude(status__in=(POStatus.REJECTED, POStatus.CANCELLED)).exists():
            raise ValidationError("An active LPO already exists. Reject the LPO through its approval workflow instead.")
        with transaction.atomic():
            locked = PurchaseRequisition.objects.select_for_update().get(pk=requisition.pk)
            now = timezone.now()
            locked.items.select_for_update().update(
                approved_quantity=Decimal("0.00"),
                rejection_stage="Procurement Manager",
                rejection_reason=reason,
                rejected_at=now,
                rejected_by=request.user,
                procurement_supplier=None,
                procurement_supplier_price=None,
                procurement_unit=None,
                procurement_quantity=None,
                procurement_unit_cost=None,
                procurement_note=reason,
                procurement_allocated_at=None,
                procurement_allocated_by=None,
                updated_at=now,
            )
            previous = locked.status
            locked.status = PRStatus.REJECTED
            locked.rejected_at = now
            locked.save(update_fields=["status", "rejected_at", "updated_at"])
            locked.record_history(
                action="procurement_rejected_all_items",
                previous_status=previous,
                actor=request.user,
                comments=reason,
                metadata={"all_items_rejected": True},
            )
            source = locked.source_store_requisition
            if source:
                from core.constants.choices import StoreRequisitionStatus
                source.status = StoreRequisitionStatus.REJECTED
                source.rejection_reason = reason
                source.save(update_fields=["status", "rejection_reason", "updated_at"])
        return Response(self.get_serializer(locked).data)

    @action(detail=True, methods=["post"], url_path="allocate-line")
    def allocate_line(self, request, pk=None):
        requisition = self.get_object()
        if not user_has_role(request.user, "System Administrator", "Procurement Manager", "Procurement Officer"):
            raise PermissionDenied("Only Procurement can allocate suppliers.")
        if requisition.status not in (PRStatus.APPROVED, PRStatus.PARTIALLY_ORDERED):
            raise ValidationError("Only an approved Store Requisition can be allocated to suppliers.")
        try:
            with transaction.atomic():
                locked = PurchaseRequisition.objects.select_for_update().get(pk=requisition.pk)
                line = self._allocate_procurement_line(request, locked, request.data)
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(RequisitionItemSerializer(line, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="create-allocated-lpos")
    def create_allocated_lpos(self, request, pk=None):
        requisition = self.get_object()
        if not user_has_role(request.user, "System Administrator", "Procurement Manager", "Procurement Officer"):
            raise PermissionDenied("Only Procurement can prepare LPOs.")
        try:
            orders = requisition.create_allocated_purchase_orders(
                ordered_by=getattr(request.user, "employee_profile", None),
                expected_date=request.data.get("expected_date") or None,
                valid_until=request.data.get("valid_until") or None,
                note=str(request.data.get("note") or ""),
                created_by=request.user,
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(
            PurchaseOrderSerializer(orders, many=True, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="allocate-and-create-lpos")
    def allocate_and_create_lpos(self, request, pk=None):
        requisition = self.get_object()
        if not user_has_role(request.user, "System Administrator", "Procurement Manager", "Procurement Officer"):
            raise PermissionDenied("Only Procurement can allocate suppliers and prepare LPOs.")
        allocations = request.data.get("lines") or []
        if not isinstance(allocations, list) or not allocations:
            raise ValidationError({"lines": "Allocate at least one requisition line."})
        try:
            with transaction.atomic():
                locked = PurchaseRequisition.objects.select_for_update().get(pk=requisition.pk)
                for allocation in allocations:
                    self._allocate_procurement_line(request, locked, allocation)
                orders = locked.create_allocated_purchase_orders(
                    ordered_by=getattr(request.user, "employee_profile", None),
                    expected_date=request.data.get("expected_date") or None,
                    valid_until=request.data.get("valid_until") or None,
                    note=str(request.data.get("note") or ""),
                    created_by=request.user,
                )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(
            PurchaseOrderSerializer(orders, many=True, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="create-purchase-order")
    def create_purchase_order(self, request, pk=None):
        requisition = self.get_object()
        if not user_has_role(request.user, "System Administrator", "Procurement Manager", "Procurement Officer"):
            raise PermissionDenied("Only Procurement can prepare an LPO.")
        try:
            supplier = self._optional_object(Supplier, request.data.get("supplier"))
            ordered_by = self._optional_object(Employee, request.data.get("ordered_by"))
            store = None
            if request.data.get("store"):
                from apps.inventory.models import StoreLocation

                store = self._optional_object(StoreLocation, request.data.get("store"))
            if not ordered_by:
                ordered_by = getattr(request.user, "employee_profile", None)

            order = requisition.create_purchase_order(
                supplier=supplier,
                ordered_by=ordered_by,
                store=store,
                expected_date=request.data.get("expected_date") or None,
                valid_until=request.data.get("valid_until") or None,
                note=request.data.get("note", ""),
                created_by=request.user if request.user.is_authenticated else None,
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)

        serializer = PurchaseOrderSerializer(order, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def _optional_object(self, model, pk):
        if not pk:
            return None
        try:
            return model.objects.get(pk=pk)
        except model.DoesNotExist:
            raise ValidationError({model._meta.model_name: "Selected record was not found."})


class RequisitionItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = RequisitionItem.objects.select_related("requisition", "item")
    serializer_class = RequisitionItemSerializer
    filterset_fields = ("requisition", "item")
    search_fields = ("item__name", "item__sku")
    ordering_fields = ("quantity", "created_at")

    @action(detail=True, methods=["post"], url_path="review-quantity")
    def review_quantity(self, request, pk=None):
        if not user_has_role(request.user, "System Administrator", "Procurement Manager", "Procurement Officer"):
            raise PermissionDenied("Only Procurement can change the procurement requisition quantity.")
        line = self.get_object()
        if line.requisition.status not in (PRStatus.APPROVED, PRStatus.PARTIALLY_ORDERED):
            raise ValidationError("Only an approved procurement requisition can be reviewed by Procurement.")
        if line.purchase_order_items.exists():
            raise ValidationError("An LPO already exists for this item. Review its quantity on the LPO instead.")
        try:
            approved_quantity = Decimal(str(request.data.get("approved_quantity")))
        except Exception as error:
            raise ValidationError({"approved_quantity": "Enter a valid quantity."}) from error
        if approved_quantity < Decimal("0.00") or approved_quantity > line.quantity:
            raise ValidationError({
                "approved_quantity": f"Quantity must be between 0 and the Store Keeper quantity of {line.quantity}."
            })
        reason = str(request.data.get("reason") or "").strip()
        if approved_quantity < line.quantity and not reason:
            raise ValidationError({"reason": "Enter the reason for reducing or rejecting this item."})
        with transaction.atomic():
            request_lines = list(
                RequisitionItem.objects.select_for_update()
                .filter(requisition=line.requisition)
                .order_by("pk")
            )
            if approved_quantity == Decimal("0.00"):
                other_positive = any(
                    candidate.pk != line.pk
                    and (candidate.approved_quantity if candidate.approved_quantity is not None else candidate.quantity) > Decimal("0.00")
                    for candidate in request_lines
                )
                if not other_positive:
                    raise ValidationError(
                        "This is the last remaining item. Use Reject entire requisition instead."
                    )
            locked = next(candidate for candidate in request_lines if candidate.pk == line.pk)
            now = timezone.now()
            RequisitionItem.objects.filter(pk=locked.pk).update(
                approved_quantity=approved_quantity,
                rejection_stage="Procurement Manager" if approved_quantity == Decimal("0.00") else "",
                rejection_reason=reason if approved_quantity == Decimal("0.00") else "",
                rejected_at=now if approved_quantity == Decimal("0.00") else None,
                rejected_by=request.user if approved_quantity == Decimal("0.00") else None,
                procurement_supplier=None,
                procurement_supplier_price=None,
                procurement_unit=None,
                procurement_quantity=None,
                procurement_unit_cost=None,
                procurement_note=reason if approved_quantity < locked.quantity else "",
                procurement_allocated_at=None,
                procurement_allocated_by=None,
                updated_at=now,
            )
            locked.requisition.record_history(
                action="procurement_line_quantity_review",
                actor=request.user,
                comments=reason,
                metadata={
                    "line_id": str(locked.pk),
                    "item": str(locked.item),
                    "previous_quantity": str(locked.approved_quantity if locked.approved_quantity is not None else locked.quantity),
                    "approved_quantity": str(approved_quantity),
                    "rejected": approved_quantity == Decimal("0.00"),
                },
            )
            locked.refresh_from_db()
        return Response(self.get_serializer(locked).data)

    def perform_destroy(self, instance):
        if not instance.requisition.editable:
            raise ValidationError(
                "Requisition lines can only be removed while the requisition is draft, rejected, or returned."
            )
        instance.delete()


class RequisitionHistoryViewSet(ReadOnlyModelViewSet):
    queryset = RequisitionHistory.objects.select_related(
        "requisition",
        "performed_by",
    )
    serializer_class = RequisitionHistorySerializer
    filterset_fields = ("requisition", "action", "previous_status", "new_status")
    search_fields = (
        "requisition__requisition_number",
        "comments",
        "performed_by__username",
        "performed_by__first_name",
        "performed_by__last_name",
    )
    ordering_fields = ("created_at", "action")

    def get_queryset(self):
        queryset = super().get_queryset()
        visible_requisitions = PurchaseRequisitionViewSet.queryset
        user = self.request.user
        if user.is_superuser or user.groups.filter(
            name__in=(
                "System Administrator",
                "General Manager",
                "Procurement Manager",
                "Procurement Officer",
                "Financial Manager",
            )
        ).exists():
            return queryset
        employee = getattr(user, "employee_profile", None)
        if not employee:
            return queryset.none()
        visible_requisitions = visible_requisitions.filter(requester=employee)
        return queryset.filter(requisition__in=visible_requisitions)


class VendorQuotationViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = VendorQuotation.objects.select_related("requisition", "supplier")
    serializer_class = VendorQuotationSerializer
    filterset_fields = ("requisition", "supplier")
    search_fields = ("supplier__name",)
    ordering_fields = ("total_amount", "created_at")

    @action(detail=True, methods=["post"])
    def award(self, request, pk=None):
        quotation = self.get_object()
        selection_reason = str(request.data.get("selection_reason", "")).strip()
        if not selection_reason:
            raise ValidationError(
                {"selection_reason": "Record a written evaluation justification before selecting a winner."}
            )
        if quotation.valid_until and quotation.valid_until < timezone.localdate():
            raise ValidationError("This supplier quotation has expired and cannot be selected.")
        threshold = Decimal(str(settings.PROCUREMENT_QUOTATION_THRESHOLD))
        required_quotes = settings.PROCUREMENT_MIN_QUOTATIONS
        quotation_count = quotation.requisition.vendor_quotations.count()
        if (
            quotation.requisition.estimated_total >= threshold
            and quotation_count < required_quotes
        ):
            remaining_quotes = required_quotes - quotation_count
            raise ValidationError(
                {
                    "detail": "Competitive sourcing is not complete.",
                    "blockers": [
                        f"This requisition is valued at or above UGX {threshold:,.0f} and requires "
                        f"at least {required_quotes} supplier quotations. "
                        f"Add {remaining_quotes} more quotation{'s' if remaining_quotes != 1 else ''}."
                    ],
                    "quotation_count": quotation_count,
                    "required_quotation_count": required_quotes,
                }
            )
        requisition_line_ids = set(quotation.requisition.items.values_list("id", flat=True))
        quoted_line_ids = set(quotation.items.values_list("requisition_item_id", flat=True))
        missing_count = len(requisition_line_ids - quoted_line_ids)
        if missing_count:
            raise ValidationError(
                {
                    "detail": "A winning quotation must price every requisition line.",
                    "blockers": [f"Add prices for {missing_count} missing requisition line(s)."],
                }
            )
        with transaction.atomic():
            VendorQuotationItem.objects.filter(
                quotation__requisition=quotation.requisition
            ).update(selected=False, selection_reason="")
            quotation.items.update(
                selected=True,
                selection_reason=selection_reason,
            )
        return Response(self.get_serializer(quotation).data)


class PurchaseOrderViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = PurchaseOrder.objects.select_related(
        "requisition", "supplier", "ordered_by", "store", "sent_by", "approved_by"
    ).prefetch_related("approval_workflow__approver__user", "approval_workflow__approver_role")
    serializer_class = PurchaseOrderSerializer
    filterset_fields = ("status", "requisition", "supplier", "ordered_by", "store")
    search_fields = (
        "lpo_number", "po_number", "supplier__name", "ordered_by__user__employee_code", "store__name"
    )
    ordering_fields = ("po_number", "status", "created_at")

    def perform_destroy(self, instance):
        if instance.status != POStatus.DRAFT:
            raise ValidationError(
                "An LPO that entered approval or supplier processing cannot be deleted. Cancel it instead."
            )
        instance.delete()

    def get_permissions(self):
        if self.action in ("approve_order", "reject_order", "receive_delivery"):
            return [IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        return scope_purchase_orders_for_user(super().get_queryset(), self.request.user)

    @action(detail=False, methods=["get"], url_path="approval-inbox")
    def approval_inbox(self, request):
        """Return the authenticated manager's current LPO approval inbox."""
        if user_has_role(request.user, "Procurement Manager"):
            role_name = "Procurement Manager"
        elif user_has_role(request.user, "Financial Manager"):
            role_name = "Financial Manager"
        elif user_has_role(request.user, "General Manager"):
            role_name = "General Manager"
        elif request.user.is_superuser:
            role_name = str(request.query_params.get("role", "General Manager")).strip()
            if role_name not in {"Procurement Manager", "Financial Manager", "General Manager"}:
                raise ValidationError({"role": "Choose Procurement Manager, Financial Manager or General Manager."})
        else:
            raise PermissionDenied("Only Purchasing, Finance or General Management can view this approval inbox.")

        queue = current_lpo_approval_queue(self.get_queryset(), request.user, role_name)
        queue = queue.select_related(
            "requisition", "supplier", "ordered_by", "store", "sent_by", "approved_by"
        ).prefetch_related(
            "approval_workflow__approver__user",
            "approval_workflow__approver_role",
            "approval_workflow__decided_by",
        ).order_by("submitted_for_approval_at", "created_at")
        return Response(self.get_serializer(queue, many=True).data)

    @action(detail=False, methods=["get"], url_path="decision-history")
    def decision_history(self, request):
        """Return final General Manager LPO decisions for the user's branch."""
        if not (request.user.is_superuser or user_has_role(request.user, "General Manager")):
            raise PermissionDenied("Only the General Manager can view final LPO decision history.")
        history = self.get_queryset().filter(
            approval_workflow__stage_name__icontains="General Manager",
            approval_workflow__status__in=(ApprovalStatus.APPROVED, ApprovalStatus.REJECTED),
        ).select_related(
            "requisition", "supplier", "ordered_by", "store", "sent_by", "approved_by"
        ).prefetch_related(
            "approval_workflow__approver__user",
            "approval_workflow__approver_role",
            "approval_workflow__decided_by",
        ).distinct().order_by("-updated_at")
        return Response(self.get_serializer(history, many=True).data)

    def _require_procurement_manager(self, request):
        if not user_has_role(request.user, "System Administrator", "Procurement Manager", "Procurement Officer"):
            raise PermissionDenied("Only Procurement can perform this LPO action.")

    def _require_receiving_clerk(self, request):
        if user_has_role(request.user, "System Administrator"):
            return getattr(request.user, "employee_profile", None)
        if not user_has_role(request.user, *RECEIVING_ROLES):
            raise PermissionDenied("Only the Receiving Clerk can receive supplier deliveries.")
        employee = getattr(request.user, "employee_profile", None)
        if not employee or not employee.is_active:
            raise PermissionDenied("An active Receiving Clerk employee profile is required.")
        return employee

    @action(detail=True, methods=["post"], url_path="receive-delivery")
    def receive_delivery(self, request, pk=None):
        """Receive an issued LPO and generate a GRN.

        Receiving and inventory posting are deliberately separate controls. The
        clerk first records the physical delivery and the GRN becomes Received;
        the existing post-to-inventory action is then used for the Posting stage.
        """
        employee = self._require_receiving_clerk(request)
        supplier_invoice_no = str(request.data.get("supplier_invoice_no") or "").strip()
        delivery_note_no = str(request.data.get("delivery_note_no") or "").strip()
        received_date = request.data.get("received_date") or timezone.localdate()
        payload_lines = request.data.get("lines") or []

        if not supplier_invoice_no:
            raise ValidationError({"supplier_invoice_no": "Enter the supplier invoice number."})
        if not isinstance(payload_lines, list) or not payload_lines:
            raise ValidationError({"lines": "Enter the quantity received for at least one LPO item."})

        try:
            with transaction.atomic():
                order = PurchaseOrder.objects.select_for_update().get(pk=self.get_object().pk)
                if order.status not in (POStatus.ISSUED, POStatus.PARTIALLY_RECEIVED):
                    raise ValidationError("Only an issued or partially received LPO can be received.")

                order_branch_id = getattr(order.requisition, "branch_id", None)
                if employee and order_branch_id and employee.branch_id != order_branch_id:
                    raise PermissionDenied("This LPO belongs to a different branch.")

                order_lines = {
                    str(line.pk): line
                    for line in PurchaseOrderItem.objects.select_for_update().filter(
                        purchase_order=order
                    )
                }
                normalized = []
                seen = set()
                for entry in payload_lines:
                    line_id = str(entry.get("purchase_order_item") or entry.get("id") or "").strip()
                    if not line_id or line_id in seen:
                        continue
                    seen.add(line_id)
                    line = order_lines.get(line_id)
                    if not line:
                        raise ValidationError({"lines": "One of the selected items does not belong to this LPO."})
                    try:
                        quantity = Decimal(str(entry.get("quantity_received") or "0"))
                    except Exception as error:
                        raise ValidationError({"lines": "Received quantities must be valid numbers."}) from error
                    if quantity <= Decimal("0.00"):
                        continue
                    normalized.append((line, quantity, entry.get("expiry_date") or None))

                if not normalized:
                    raise ValidationError({"lines": "Enter a received quantity greater than zero."})

                receipt = GoodsReceiptNote(
                    purchase_order=order,
                    received_by=employee,
                    received_date=received_date,
                    delivery_note_no=delivery_note_no,
                    supplier_invoice_no=supplier_invoice_no,
                    note="",
                    created_by=request.user if request.user.is_authenticated else None,
                )
                receipt.full_clean()
                receipt.save()

                receipt_items = []
                for order_line, quantity, expiry_date in normalized:
                    receipt_item = GoodsReceiptItem(
                        goods_receipt=receipt,
                        purchase_order_item=order_line,
                        quantity_received=quantity,
                        expiry_date=expiry_date,
                        created_by=request.user if request.user.is_authenticated else None,
                    )
                    receipt_item.save()
                    receipt_items.append(receipt_item)

                inspection = GoodsInspection.objects.create(
                    goods_receipt=receipt,
                    inspected_by=employee,
                    inspection_date=received_date,
                    status=GoodsInspectionStatus.ACCEPTED,
                    delivery_note_no=delivery_note_no,
                    remarks="Receiving Clerk confirmed delivered quantities against the issued LPO.",
                    created_by=request.user if request.user.is_authenticated else None,
                )
                for receipt_item in receipt_items:
                    GoodsInspectionItem.objects.create(
                        inspection=inspection,
                        goods_receipt_item=receipt_item,
                        quantity_received=receipt_item.base_quantity,
                        quantity_accepted=receipt_item.base_quantity,
                        quantity_rejected=Decimal("0.00"),
                        rejection_reason="",
                        created_by=request.user if request.user.is_authenticated else None,
                    )

                receipt.status = GoodsReceiptStatus.RECEIVED
                receipt.save(update_fields=["status", "updated_at"])
                receipt.refresh_from_db()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)

        return Response(
            GoodsReceiptNoteSerializer(receipt, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"])
    def readiness(self, request, pk=None):
        return Response(self.get_object().issue_readiness())

    @action(detail=True, methods=["get"], url_path="approval-readiness")
    def approval_readiness(self, request, pk=None):
        return Response(self.get_object().approval_readiness())

    @action(detail=True, methods=["post"], url_path="update-draft-quantities")
    def update_draft_quantities(self, request, pk=None):
        """Allow Procurement to revise draft LPO quantities without changing prices."""
        self._require_procurement_manager(request)
        decisions = request.data.get("lines", [])
        if not isinstance(decisions, list) or not decisions:
            raise ValidationError({"lines": "Provide at least one LPO line quantity."})

        try:
            with transaction.atomic():
                order = PurchaseOrder.objects.select_for_update().get(pk=self.get_object().pk)
                if not order.editable:
                    raise ValidationError("LPO quantities can only be changed while the LPO is draft.")

                locked_lines = {
                    str(line.pk): line
                    for line in PurchaseOrderItem.objects.select_for_update().select_related(
                        "item", "unit", "requisition_item"
                    ).filter(purchase_order=order)
                }
                seen = set()
                for decision in decisions:
                    line_id = str(decision.get("id", "")).strip()
                    if not line_id or line_id in seen or line_id not in locked_lines:
                        raise ValidationError({"lines": "Every quantity decision must reference one unique LPO line."})
                    seen.add(line_id)
                    try:
                        quantity = Decimal(str(decision.get("quantity", "")))
                    except (InvalidOperation, TypeError, ValueError):
                        raise ValidationError({"quantity": "Enter a valid quantity."})
                    if quantity <= Decimal("0.00"):
                        raise ValidationError({"quantity": "LPO quantity must be greater than zero."})

                    line = locked_lines[line_id]
                    requisition_line = line.requisition_item or order.requisition.items.filter(item=line.item).first()
                    if not requisition_line:
                        raise ValidationError({"lines": f"{line.item} is not linked to the source requisition."})

                    ordered_elsewhere = sum(
                        (
                            other.approved_base_quantity
                            for other in PurchaseOrderItem.objects.filter(
                                purchase_order__requisition=order.requisition,
                                item=line.item,
                                purchase_order__status__in=(
                                    POStatus.APPROVED,
                                    POStatus.ISSUED,
                                    POStatus.PARTIALLY_RECEIVED,
                                    POStatus.RECEIVED,
                                ),
                            ).exclude(purchase_order=order)
                        ),
                        Decimal("0.00"),
                    )
                    available_base = max(
                        requisition_line.approved_base_quantity - ordered_elsewhere,
                        Decimal("0.00"),
                    )
                    requested_base = line.item.quantity_in_base_units(quantity, line.unit).quantize(Decimal("0.01"))
                    if requested_base > available_base:
                        raise ValidationError({
                            "quantity": (
                                f"{line.item}: quantity exceeds the approved requisition balance "
                                f"({available_base} base units available)."
                            )
                        })
                    line.quantity = quantity
                    line.save(update_fields=[
                        "quantity", "base_quantity", "procurement_quantity",
                        "procurement_base_quantity", "purchasing_approved_quantity",
                        "purchasing_approved_base_quantity", "purchasing_reduction_reason",
                        "finance_approved_quantity", "finance_approved_base_quantity",
                        "finance_reduction_reason", "management_approved_quantity",
                        "management_approved_base_quantity", "management_reduction_reason",
                        "updated_at",
                    ])

                if seen != set(locked_lines):
                    raise ValidationError({"lines": "Submit a quantity for every LPO line."})
                order.refresh_from_db()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)

        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"], url_path="submit-for-approval")
    def submit_for_approval(self, request, pk=None):
        order = self.get_object()
        self._require_procurement_manager(request)
        enforce_readiness(order.approval_readiness())
        try:
            order.submit_for_approval()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(order).data)

    def _current_approval_step(self, order, request):
        from core.constants.choices import ApprovalStatus

        step = order.approval_workflow.filter(
            status=ApprovalStatus.PENDING,
        ).order_by("stage").first()
        if not step:
            raise ValidationError("This LPO has no pending approval stage.")
        if request.user.is_superuser:
            return step
        employee = getattr(request.user, "employee_profile", None)
        if not employee or not employee.is_active or not request.user.is_active:
            raise PermissionDenied("An active employee profile is required to approve this LPO.")
        order_branch_id = getattr(order.requisition, "branch_id", None)
        if order_branch_id and employee.branch_id != order_branch_id:
            raise PermissionDenied("This LPO belongs to a different branch.")
        if step.approver_id:
            if step.approver_id != employee.id:
                raise PermissionDenied(f"This stage is assigned to {step.approver}.")
            return step
        if step.approver_role_id:
            if not request.user.groups.filter(pk=step.approver_role_id).exists():
                raise PermissionDenied(
                    f"This stage requires the {step.approver_role.name} role."
                )
            return step
        raise PermissionDenied("This approval stage has no assigned role or employee.")

    @action(detail=True, methods=["post"], url_path="approve")
    def approve_order(self, request, pk=None):
        try:
            with transaction.atomic():
                order = PurchaseOrder.objects.select_for_update().get(pk=self.get_object().pk)
                step = self._current_approval_step(order, request)
                step.approve(
                    comments=str(request.data.get("comments", "")).strip(),
                    decided_by=request.user,
                )
                order.refresh_from_db()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"], url_path="review-quantities")
    def review_quantities(self, request, pk=None):
        order = self.get_object()
        try:
            with transaction.atomic():
                locked_order = PurchaseOrder.objects.select_for_update().get(pk=order.pk)
                step = self._current_approval_step(locked_order, request)
                locked_order.apply_approval_quantity_decisions(
                    stage=step.stage,
                    decisions=request.data.get("lines", []),
                    actor=request.user,
                    comments=str(request.data.get("comments", "")).strip(),
                )
                locked_order.refresh_from_db()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(locked_order).data)

    @action(detail=True, methods=["post"], url_path="finance-reduce-quantities")
    def finance_reduce_quantities(self, request, pk=None):
        order = self.get_object()
        if not user_has_role(request.user, "System Administrator", "Financial Manager"):
            raise PermissionDenied("Only the Financial Manager can reduce LPO quantities.")
        try:
            with transaction.atomic():
                locked_order = PurchaseOrder.objects.select_for_update().get(pk=order.pk)
                self._current_approval_step(locked_order, request)
                locked_order.apply_finance_quantity_reductions(
                    reductions=request.data.get("lines", []),
                    actor=request.user,
                    comments=str(request.data.get("comments", "")).strip(),
                )
                locked_order.refresh_from_db()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(locked_order).data)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject_order(self, request, pk=None):
        try:
            with transaction.atomic():
                order = PurchaseOrder.objects.select_for_update().get(pk=self.get_object().pk)
                step = self._current_approval_step(order, request)
                step.reject(
                    comments=str(request.data.get("comments", "")).strip(),
                    decided_by=request.user,
                )
                order.refresh_from_db()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def issue(self, request, pk=None):
        order = self.get_object()
        self._require_procurement_manager(request)
        enforce_readiness(order.issue_readiness())
        sent_by = None
        if request.data.get("sent_by"):
            try:
                sent_by = Employee.objects.get(pk=request.data.get("sent_by"))
            except Employee.DoesNotExist:
                raise ValidationError({"sent_by": "Selected employee was not found."})
        else:
            sent_by = getattr(request.user, "employee_profile", None)
        recipient = str(order.supplier.email or "").strip()
        if not recipient:
            raise ValidationError(
                "The selected supplier has no registered email address. Update the supplier record before sending."
            )
        subject = f"Local Purchase Order {order.lpo_number}"
        communication = ProcurementCommunication.objects.create(
            purchase_order=order,
            supplier=order.supplier,
            recipient=recipient,
            subject=subject,
            status="pending",
            created_by=request.user if request.user.is_authenticated else None,
        )
        try:
            pdf = build_purchase_order_pdf(
                order,
                classification="ORIGINAL COPY",
                printed_by=request.user,
                delivery_date=(timezone.now() + timedelta(days=order.lead_time_days or 0)).date(),
            )
            email = EmailMessage(
                subject=subject,
                body=(
                    f"Please find attached Local Purchase Order {order.lpo_number}. "
                    f"Quote this number on your delivery note and invoice."
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[recipient],
            )
            email.attach(f"LPO-{order.lpo_number}.pdf", pdf, "application/pdf")
            email.send(fail_silently=False)
        except Exception as error:
            communication.status = "failed"
            communication.error_message = str(error)
            communication.save(update_fields=["status", "error_message", "updated_at"])
            order.email_status = "failed"
            order.last_email_error = str(error)
            order.save(update_fields=["email_status", "last_email_error", "updated_at"])
            raise ValidationError(
                f"Email delivery failed; the lead-time clock was not started. "
                f"{email_delivery_failure_message(error)}"
            )
        try:
            with transaction.atomic():
                order = PurchaseOrder.objects.select_for_update().get(pk=order.pk)
                order.issue(sent_by=sent_by, sent_to_email=recipient)
                order.email_status = "sent"
                order.last_email_error = ""
                order.save(update_fields=["email_status", "last_email_error", "updated_at"])
                communication.status = "sent"
                communication.sent_at = order.sent_at
                communication.error_message = ""
                communication.save(
                    update_fields=["status", "sent_at", "error_message", "updated_at"]
                )
        except DjangoValidationError as error:
            communication.status = "failed"
            communication.error_message = "Email sent, but the LPO issue state could not be committed."
            communication.save(update_fields=["status", "error_message", "updated_at"])
            raise_drf_validation_error(error)
        try:
            from apps.notifications.services import notify_roles
            notify_roles(
                ["Receiving Clerk"],
                branch=order.requisition.branch,
                title=f"LPO {order.lpo_number} is ready for receiving",
                message=f"The LPO for {order.supplier} has been sent and can now be received against the supplier delivery.",
                created_by=request.user,
            )
        except Exception:
            pass
        serializer = self.get_serializer(order)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def resend(self, request, pk=None):
        order = self.get_object()
        self._require_procurement_manager(request)
        if order.status == POStatus.DRAFT:
            raise ValidationError("Issue the LPO before resending it.")
        recipient = str(order.supplier.email or "").strip()
        if not recipient:
            raise ValidationError(
                "The selected supplier has no registered email address. Update the supplier record before resending."
            )
        communication = ProcurementCommunication.objects.create(
            purchase_order=order, supplier=order.supplier, recipient=recipient,
            subject=f"Local Purchase Order {order.lpo_number}", status="pending",
            created_by=request.user if request.user.is_authenticated else None,
        )
        try:
            pdf = build_purchase_order_pdf(
                order,
                classification="ORIGINAL COPY",
                printed_by=request.user,
            )
            email = EmailMessage(
                subject=communication.subject,
                body=(
                    f"Please find attached the resent Local Purchase Order {order.lpo_number}. "
                    "Quote this number on your delivery note and invoice."
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[recipient],
            )
            email.attach(f"LPO-{order.lpo_number}.pdf", pdf, "application/pdf")
            email.send(fail_silently=False)
            communication.status = "sent"
            communication.sent_at = timezone.now()
            order.email_status = "sent"
            order.last_email_error = ""
        except Exception as error:
            communication.status = "failed"
            communication.error_message = str(error)
            order.email_status = "failed"
            order.last_email_error = str(error)
            raise ValidationError(
                f"Email delivery failed. {email_delivery_failure_message(error)}"
            )
        finally:
            communication.save(update_fields=["status", "sent_at", "error_message", "updated_at"])
            order.save(update_fields=["email_status", "last_email_error", "updated_at"])
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        order = self.get_object()
        self._require_procurement_manager(request)
        try:
            order.acknowledge(str(request.data.get("acknowledged_by", "")).strip())
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        ProcurementCommunication.objects.create(
            purchase_order=order, supplier=order.supplier,
            direction=ProcurementCommunication.DIRECTION_INBOUND,
            recipient=order.supplier_acknowledged_by,
            subject=f"Supplier acknowledgement for {order.lpo_number}",
            status="received", sent_at=order.supplier_acknowledged_at,
            created_by=request.user if request.user.is_authenticated else None,
        )
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"], url_path="print-document")
    def print_document(self, request, pk=None):
        """Reserve ORIGINAL/COPY status before the browser print dialog opens."""
        order = self.get_object()
        self._require_procurement_manager(request)
        try:
            print_record = order.record_print(printed_by=request.user)
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(
            {
                "print_number": print_record.print_number,
                "print_classification": print_record.get_classification_display().upper(),
                "printed_at": print_record.created_at,
                "printed_by": request.user.get_full_name() or request.user.username,
            }
        )

    @action(
        detail=True,
        methods=["get"],
        url_path="preview-document",
        renderer_classes=[PDFRenderer, JSONRenderer],
    )
    def preview_document(self, request, pk=None):
        """Return an inline, non-controlled LPO preview without recording a print."""
        order = self.get_object()
        try:
            pdf = build_purchase_order_pdf(
                order,
                classification="PREVIEW - NOT A CONTROLLED COPY",
                printed_by=request.user,
                actor_label="Previewed By",
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = content_disposition_header(
            False,
            f"LPO-{order.lpo_number}-preview.pdf",
        )
        response["Cache-Control"] = "private, no-store"
        response["X-LPO-Document-Type"] = "PREVIEW"
        return response

    @action(
        detail=True,
        methods=["post"],
        url_path="controlled-document",
        renderer_classes=[PDFRenderer, JSONRenderer],
    )
    def controlled_document(self, request, pk=None):
        """Reserve the print number and return the matching ORIGINAL/COPY PDF."""
        order = self.get_object()
        self._require_procurement_manager(request)
        try:
            print_record = order.record_print(printed_by=request.user)
            classification = (
                "ORIGINAL COPY"
                if print_record.classification == "original"
                else "COPY OF ORIGINAL"
            )
            pdf = build_purchase_order_pdf(
                order,
                classification=classification,
                printed_by=request.user,
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = content_disposition_header(
            False,
            f"LPO-{order.lpo_number}-{print_record.classification}-{print_record.print_number}.pdf",
        )
        response["Cache-Control"] = "private, no-store"
        response["X-LPO-Print-Classification"] = print_record.classification.upper()
        response["X-LPO-Print-Number"] = str(print_record.print_number)
        return response


class PurchaseOrderItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = PurchaseOrderItem.objects.select_related("purchase_order", "item", "unit")
    serializer_class = PurchaseOrderItemSerializer
    filterset_fields = ("purchase_order", "item", "unit")
    search_fields = ("purchase_order__po_number", "item__name", "item__sku", "unit__name")
    ordering_fields = ("quantity", "base_quantity", "unit_cost", "created_at")

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        employee = getattr(user, "employee_profile", None)
        if user_has_role(user, *RECEIVING_ROLES) and not user_has_role(
            user, *COMMERCIAL_CONTROL_ROLES,
        ):
            return queryset.filter(
                purchase_order__status__in=(POStatus.ISSUED, POStatus.PARTIALLY_RECEIVED)
            )
        if user_has_role(user, "Store Keeper") and not user_has_role(
            user, *COMMERCIAL_CONTROL_ROLES,
        ):
            return queryset.filter(
                purchase_order__store__keeper_assignments__employee=employee,
                purchase_order__store__keeper_assignments__is_active=True,
            ).distinct()
        return queryset

    def perform_destroy(self, instance):
        if not instance.purchase_order.editable:
            raise ValidationError(
                "LPO lines can only be removed while the LPO is draft or rejected."
            )
        order = instance.purchase_order
        instance.delete()
        order.update_total_amount()


class GoodsReceiptNoteViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = GoodsReceiptNote.objects.select_related(
        "received_by__user",
        "purchase_order__supplier",
        "purchase_order__store",
        "purchase_order__requisition__branch",
    )
    serializer_class = GoodsReceiptNoteSerializer
    filterset_fields = ("purchase_order", "received_by", "received_date")
    search_fields = ("purchase_order__po_number", "received_by__user__employee_code")
    ordering_fields = ("received_date", "created_at")

    def perform_destroy(self, instance):
        if instance.status != GoodsReceiptStatus.DRAFT:
            raise ValidationError(
                "A received or posted GRN cannot be deleted. Use cancellation or a controlled reversal."
            )
        instance.delete()

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        employee = getattr(user, "employee_profile", None)
        if user_has_role(user, *RECEIVING_ROLES) and not user_has_role(
            user, *COMMERCIAL_CONTROL_ROLES
        ):
            return queryset.filter(received_by=employee)
        return queryset

    def _require_receiving_clerk(self, request, receipt=None):
        if user_has_role(request.user, "System Administrator"):
            return
        employee = getattr(request.user, "employee_profile", None)
        if not user_has_role(request.user, *RECEIVING_ROLES):
            raise PermissionDenied("Only the Receiving Clerk can create or post a GRN.")
        if receipt and receipt.received_by_id != getattr(employee, "id", None):
            raise PermissionDenied("Only the Receiving Clerk who opened this GRN can change it.")

    def perform_create(self, serializer):
        self._require_receiving_clerk(self.request)
        employee = getattr(self.request.user, "employee_profile", None)
        if not employee:
            raise ValidationError("Your account is not connected to an employee profile.")
        serializer.save(received_by=employee, created_by=self.request.user)

    @action(detail=True, methods=["get"])
    def readiness(self, request, pk=None):
        return Response(self.get_object().posting_readiness())

    @action(detail=True, methods=["post"], url_path="post-to-inventory")
    def post_to_inventory(self, request, pk=None):
        receipt = self.get_object()
        self._require_receiving_clerk(request, receipt)
        enforce_readiness(receipt.posting_readiness())
        try:
            receipt.post_to_inventory(
                posted_by=getattr(request.user, "employee_profile", None)
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(receipt)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        receipt = self.get_object()
        self._require_receiving_clerk(request, receipt)
        try:
            receipt.cancel()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(receipt).data)


class GoodsReceiptItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = GoodsReceiptItem.objects.select_related(
        "goods_receipt",
        "purchase_order_item__unit",
        "item",
        "store",
        "direct_issue_department",
    ).prefetch_related("inspection_items")
    serializer_class = GoodsReceiptItemSerializer
    filterset_fields = ("goods_receipt", "purchase_order_item", "item", "store", "expiry_date")
    search_fields = ("goods_receipt__purchase_order__po_number", "item__name", "item__sku", "store__name")
    ordering_fields = ("quantity_received", "base_quantity", "unit_cost", "created_at")

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        employee = getattr(user, "employee_profile", None)
        if user_has_role(user, *RECEIVING_ROLES) and not user_has_role(
            user, *COMMERCIAL_CONTROL_ROLES
        ):
            return queryset.filter(goods_receipt__received_by=employee)
        return queryset

    def _require_receiving_clerk(self, receipt):
        user = self.request.user
        if user_has_role(user, "System Administrator"):
            return
        employee = getattr(user, "employee_profile", None)
        if not user_has_role(user, *RECEIVING_ROLES) or receipt.received_by_id != getattr(employee, "id", None):
            raise PermissionDenied("Only the Receiving Clerk who opened this GRN can enter delivered quantities.")

    def perform_create(self, serializer):
        receipt = serializer.validated_data.get("goods_receipt")
        self._require_receiving_clerk(receipt)
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_receiving_clerk(serializer.instance.goods_receipt)
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        self._require_receiving_clerk(instance.goods_receipt)
        if instance.inventory_changes_applied:
            raise ValidationError("Posted GRN lines cannot be removed.")
        if GoodsInspectionItem.objects.filter(goods_receipt_item=instance).exists():
            raise ValidationError("Remove the inspection decision before removing this GRN line.")
        instance.delete()

    @action(detail=True, methods=["post"], url_path="post-to-inventory")
    def post_to_inventory(self, request, pk=None):
        receipt_item = self.get_object()
        try:
            receipt_item.post_to_inventory()
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(receipt_item)
        return Response(serializer.data)

class VendorQuotationItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = VendorQuotationItem.objects.select_related("quotation", "requisition_item", "item", "unit")
    serializer_class = VendorQuotationItemSerializer
    filterset_fields = ("quotation", "requisition_item", "item", "unit", "selected")
    search_fields = ("quotation__supplier__name", "item__name", "item__sku", "selection_reason")
    ordering_fields = ("quantity", "unit_price", "delivery_days", "created_at")

    def perform_destroy(self, instance):
        if instance.selected:
            raise ValidationError("A selected winning quotation line cannot be removed.")
        quotation = instance.quotation
        instance.delete()
        quotation.update_total_amount()


class GoodsInspectionViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = GoodsInspection.objects.select_related("goods_receipt", "inspected_by")
    serializer_class = GoodsInspectionSerializer
    filterset_fields = ("goods_receipt", "inspected_by", "status", "inspection_date")
    search_fields = ("delivery_note_no", "remarks", "goods_receipt__purchase_order__po_number")
    ordering_fields = ("inspection_date", "status", "created_at")

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user_has_role(user, *RECEIVING_ROLES) and not user_has_role(
            user, *COMMERCIAL_CONTROL_ROLES
        ):
            return queryset.filter(
                goods_receipt__received_by=getattr(user, "employee_profile", None)
            )
        return queryset

    def _require_receiving_clerk(self, receipt):
        user = self.request.user
        if user_has_role(user, "System Administrator"):
            return
        employee = getattr(user, "employee_profile", None)
        if not user_has_role(user, *RECEIVING_ROLES) or receipt.received_by_id != getattr(employee, "id", None):
            raise PermissionDenied(
                "Only the Receiving Clerk who opened the GRN can record its inspection."
            )

    def perform_create(self, serializer):
        receipt = serializer.validated_data.get("goods_receipt")
        self._require_receiving_clerk(receipt)
        serializer.save(
            inspected_by=getattr(self.request.user, "employee_profile", None),
            created_by=self.request.user,
        )

    def perform_update(self, serializer):
        self._require_receiving_clerk(serializer.instance.goods_receipt)
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        self._require_receiving_clerk(instance.goods_receipt)
        if instance.goods_receipt.status in ("posted", "cancelled"):
            raise ValidationError("Posted or cancelled GRN inspections cannot be removed.")
        instance.delete()


class GoodsInspectionItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = GoodsInspectionItem.objects.select_related("inspection", "goods_receipt_item", "item")
    serializer_class = GoodsInspectionItemSerializer
    filterset_fields = ("inspection", "goods_receipt_item", "item")
    search_fields = ("item__name", "item__sku", "rejection_reason")
    ordering_fields = ("quantity_received", "quantity_accepted", "quantity_rejected", "created_at")

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user_has_role(user, *RECEIVING_ROLES) and not user_has_role(
            user, *COMMERCIAL_CONTROL_ROLES
        ):
            return queryset.filter(
                inspection__goods_receipt__received_by=getattr(user, "employee_profile", None)
            )
        return queryset

    def _require_receiving_clerk(self, inspection):
        user = self.request.user
        if user_has_role(user, "System Administrator"):
            return
        employee = getattr(user, "employee_profile", None)
        if not user_has_role(user, *RECEIVING_ROLES) or inspection.goods_receipt.received_by_id != getattr(employee, "id", None):
            raise PermissionDenied(
                "Only the Receiving Clerk who opened the GRN can record its inspection lines."
            )

    def perform_create(self, serializer):
        self._require_receiving_clerk(serializer.validated_data.get("inspection"))
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_receiving_clerk(serializer.instance.inspection)
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        self._require_receiving_clerk(instance.inspection)
        if instance.inspection.goods_receipt.status in ("posted", "cancelled"):
            raise ValidationError("Posted or cancelled GRN inspection decisions cannot be removed.")
        instance.delete()


class SupplierReturnViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = SupplierReturn.objects.select_related("supplier", "goods_receipt", "store", "returned_by")
    serializer_class = SupplierReturnSerializer
    filterset_fields = ("supplier", "goods_receipt", "store", "returned_by", "status", "inventory_changes_applied")
    search_fields = ("return_no", "supplier__name", "goods_receipt__purchase_order__po_number", "reason")
    ordering_fields = ("return_no", "return_date", "status", "created_at")

    @action(detail=True, methods=["post"])
    def apply(self, request, pk=None):
        supplier_return = self.get_object()
        try:
            supplier_return.apply_inventory_changes(
                dispatched_by=getattr(request.user, "employee_profile", None)
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(supplier_return).data)

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        supplier_return = self.get_object()
        try:
            supplier_return.acknowledge(
                acknowledged_by=str(request.data.get("acknowledged_by", "")).strip(),
                credit_note_number=str(request.data.get("credit_note_number", "")).strip(),
                replacement_expected_date=request.data.get("replacement_expected_date") or None,
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(supplier_return).data)


class SupplierReturnItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = SupplierReturnItem.objects.select_related("supplier_return", "item", "unit")
    serializer_class = SupplierReturnItemSerializer
    filterset_fields = ("supplier_return", "item", "unit")
    search_fields = ("supplier_return__return_no", "item__name", "item__sku", "reason")
    ordering_fields = ("quantity", "base_quantity", "created_at")


class ProcurementAttachmentViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = ProcurementAttachment.objects.select_related("created_by")
    serializer_class = ProcurementAttachmentSerializer
    filterset_fields = ("document_type", "document_id", "category")
    search_fields = ("original_name", "note")
    ordering_fields = ("created_at", "original_name")

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user_has_role(user, "Cost Controller") and not user_has_role(
            user, "System Administrator", "Procurement Manager"
        ):
            return queryset.filter(
                document_type=ProcurementAttachment.DOCUMENT_SUPPLIER_CATALOGUE
            )
        if user_has_role(user, *RECEIVING_ROLES) and not user_has_role(
            user, *COMMERCIAL_CONTROL_ROLES
        ):
            employee = getattr(user, "employee_profile", None)
            receipt_ids = GoodsReceiptNote.objects.filter(
                received_by=employee
            ).values_list("id", flat=True)
            inspection_ids = GoodsInspection.objects.filter(
                goods_receipt__received_by=employee
            ).values_list("id", flat=True)
            return queryset.filter(
                models.Q(
                    document_type=ProcurementAttachment.DOCUMENT_GRN,
                    document_id__in=receipt_ids,
                )
                | models.Q(
                    document_type=ProcurementAttachment.DOCUMENT_INSPECTION,
                    document_id__in=inspection_ids,
                )
            )
        return queryset

    def perform_create(self, serializer):
        user = self.request.user
        document_type = serializer.validated_data.get("document_type")
        document_id = serializer.validated_data.get("document_id")
        if user_has_role(user, "Cost Controller") and not user_has_role(
            user, "System Administrator", "Procurement Manager"
        ):
            from apps.inventory.models import SupplierItemPrice

            if (
                document_type != ProcurementAttachment.DOCUMENT_SUPPLIER_CATALOGUE
                or not SupplierItemPrice.objects.filter(pk=document_id).exists()
            ):
                raise PermissionDenied(
                    "The Cost Controller may attach quotations only to supplier price records."
                )
        elif user_has_role(user, *RECEIVING_ROLES) and not user_has_role(
            user, *COMMERCIAL_CONTROL_ROLES
        ):
            employee = getattr(user, "employee_profile", None)
            owns_document = (
                document_type == ProcurementAttachment.DOCUMENT_GRN
                and GoodsReceiptNote.objects.filter(pk=document_id, received_by=employee).exists()
            ) or (
                document_type == ProcurementAttachment.DOCUMENT_INSPECTION
                and GoodsInspection.objects.filter(
                    pk=document_id,
                    goods_receipt__received_by=employee,
                ).exists()
            )
            if not owns_document:
                raise PermissionDenied(
                    "Receiving Clerks may attach evidence only to their own GRNs and inspections."
                )
        super().perform_create(serializer)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        attachment = self.get_object()
        if attachment.file_content is not None:
            content = bytes(attachment.file_content)
        elif attachment.file:
            try:
                attachment.file.open("rb")
                content = attachment.file.read()
            except (FileNotFoundError, OSError, ValueError):
                raise Http404("The attachment file is not available.")
            else:
                attachment.file.close()
        else:
            raise Http404("The attachment file is not available.")

        response = HttpResponse(
            content,
            content_type=attachment.content_type or "application/octet-stream",
        )
        response["Content-Disposition"] = content_disposition_header(
            False,
            attachment.original_name,
        )
        response["Content-Length"] = len(content)
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class ProcurementCommunicationViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = ProcurementCommunication.objects.select_related("purchase_order", "supplier", "created_by")
    serializer_class = ProcurementCommunicationSerializer
    filterset_fields = ("purchase_order", "supplier", "channel", "direction", "status")
    search_fields = ("recipient", "subject", "error_message")
    ordering_fields = ("created_at", "sent_at", "status")
