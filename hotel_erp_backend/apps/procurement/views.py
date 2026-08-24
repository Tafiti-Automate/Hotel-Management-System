from decimal import Decimal
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
from apps.approvals.models import ApprovalWorkflow
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
from core.constants.choices import POStatus, PRStatus
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
    "Financial Manager",
    "General Manager",
)
RECEIVING_ROLES = ("Receiving Clerk",)


def scope_purchase_orders_for_user(queryset, user):
    """Apply the same LPO visibility rules to lists and the combined workspace."""
    employee = getattr(user, "employee_profile", None)
    if user_has_role(user, *COMMERCIAL_CONTROL_ROLES):
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
        if self.action == "workspace":
            return [IsAuthenticated()]
        return super().get_permissions()

    @action(detail=False, methods=["get"], url_path="workspace")
    def workspace(self, request):
        """Return the connected records needed by one procurement tab in one request."""
        stage = request.query_params.get("stage", "request")
        allowed = {"request", "quote", "lpo", "receipt", "inspect", "return"}
        if stage not in allowed:
            raise ValidationError({"stage": "Choose request, quote, lpo, receipt, inspect, or return."})
        stage_permission = {
            "request": "procurement.view_purchaserequisition",
            "quote": "procurement.view_vendorquotation",
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
                ).prefetch_related("approval_workflow__approver__user"),
                request.user,
            )
            order_ids = orders.values_list("id", flat=True)
            if stage == "lpo" and user_has_role(
                request.user, "System Administrator", "Procurement Manager"
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
        if stage == "quote":
            quotations = VendorQuotation.objects.filter(requisition_id__in=requisition_ids)
            payload["quotations"] = VendorQuotationSerializer(quotations, many=True, context={"request": request}).data
            payload["quotationItems"] = VendorQuotationItemSerializer(
                VendorQuotationItem.objects.filter(quotation__requisition_id__in=requisition_ids),
                many=True, context={"request": request},
            ).data
        if stage in {"lpo", "receipt", "inspect", "return"}:
            payload["orders"] = PurchaseOrderSerializer(orders, many=True, context={"request": request}).data
            payload["orderItems"] = PurchaseOrderItemSerializer(
                PurchaseOrderItem.objects.filter(purchase_order_id__in=order_ids),
                many=True, context={"request": request},
            ).data
        if stage in {"receipt", "inspect", "return"}:
            receipts = GoodsReceiptNote.objects.filter(purchase_order_id__in=order_ids)
            if user_has_role(request.user, *RECEIVING_ROLES) and not user_has_role(
                request.user, *COMMERCIAL_CONTROL_ROLES
            ):
                receipts = receipts.filter(received_by=getattr(request.user, "employee_profile", None))
            receipt_ids = receipts.values_list("id", flat=True)
            payload["receipts"] = GoodsReceiptNoteSerializer(receipts, many=True, context={"request": request}).data
            payload["receiptItems"] = GoodsReceiptItemSerializer(
                GoodsReceiptItem.objects.filter(goods_receipt_id__in=receipt_ids),
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

    @action(detail=True, methods=["post"], url_path="create-purchase-order")
    def create_purchase_order(self, request, pk=None):
        requisition = self.get_object()
        if not user_has_role(request.user, "System Administrator", "Procurement Manager"):
            raise PermissionDenied("Only the Procurement Manager can prepare an LPO.")
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
    ).prefetch_related("approval_workflow__approver__user")
    serializer_class = PurchaseOrderSerializer
    filterset_fields = ("status", "requisition", "supplier", "ordered_by", "store")
    search_fields = (
        "lpo_number", "po_number", "supplier__name", "ordered_by__user__employee_code", "store__name"
    )
    ordering_fields = ("po_number", "status", "created_at")

    def get_permissions(self):
        if self.action in ("approve_order", "reject_order"):
            return [IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        return scope_purchase_orders_for_user(super().get_queryset(), self.request.user)

    def _require_procurement_manager(self, request):
        if not user_has_role(request.user, "System Administrator", "Procurement Manager"):
            raise PermissionDenied("Only the Procurement Manager can perform this LPO action.")

    @action(detail=True, methods=["get"])
    def readiness(self, request, pk=None):
        return Response(self.get_object().issue_readiness())

    @action(detail=True, methods=["get"], url_path="approval-readiness")
    def approval_readiness(self, request, pk=None):
        return Response(self.get_object().approval_readiness())

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
        employee = getattr(request.user, "employee_profile", None)
        if not request.user.is_superuser and step.approver_id != getattr(employee, "id", None):
            raise PermissionDenied(
                f"This stage is assigned to {step.approver}."
            )
        return step

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
                classification="SUPPLIER COPY",
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
                classification="SUPPLIER COPY",
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
                "***** Original Order *****"
                if print_record.classification == "original"
                else "***** Copy of Original Order *****"
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
    queryset = GoodsReceiptNote.objects.select_related("purchase_order", "received_by")
    serializer_class = GoodsReceiptNoteSerializer
    filterset_fields = ("purchase_order", "received_by", "received_date")
    search_fields = ("purchase_order__po_number", "received_by__user__employee_code")
    ordering_fields = ("received_date", "created_at")

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
        "purchase_order_item",
        "item",
        "store",
        "direct_issue_department",
    )
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
