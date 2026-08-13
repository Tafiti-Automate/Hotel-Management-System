from decimal import Decimal

from django.http import Http404, HttpResponse
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone
from django.utils.http import content_disposition_header
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from apps.employees.models import Employee
from apps.approvals.models import ApprovalWorkflow
from apps.approvals.serializers import ApprovalWorkflowSerializer
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
            name__in=("Stores Manager", "Store Manager", "Store Keeper")
        ).exists()
        stores_readable_stages = {"lpo", "receipt", "inspect", "return"}
        if not request.user.is_superuser and not request.user.has_perm(stage_permission) and not (
            stores_receiver and stage in stores_readable_stages
        ):
            raise PermissionDenied("You do not have permission to view this procurement stage.")

        requisitions = self.get_queryset()
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
            orders = PurchaseOrder.objects.filter(requisition_id__in=requisition_ids)
            payload["orders"] = PurchaseOrderSerializer(orders, many=True, context={"request": request}).data
            payload["orderItems"] = PurchaseOrderItemSerializer(
                PurchaseOrderItem.objects.filter(purchase_order__requisition_id__in=requisition_ids),
                many=True, context={"request": request},
            ).data
        if stage in {"receipt", "inspect", "return"}:
            receipts = GoodsReceiptNote.objects.filter(purchase_order__requisition_id__in=requisition_ids)
            payload["receipts"] = GoodsReceiptNoteSerializer(receipts, many=True, context={"request": request}).data
            payload["receiptItems"] = GoodsReceiptItemSerializer(
                GoodsReceiptItem.objects.filter(goods_receipt__purchase_order__requisition_id__in=requisition_ids),
                many=True, context={"request": request},
            ).data
        if stage == "inspect":
            inspections = GoodsInspection.objects.filter(goods_receipt__purchase_order__requisition_id__in=requisition_ids)
            payload["inspections"] = GoodsInspectionSerializer(inspections, many=True, context={"request": request}).data
            payload["inspectionItems"] = GoodsInspectionItemSerializer(
                GoodsInspectionItem.objects.filter(inspection__goods_receipt__purchase_order__requisition_id__in=requisition_ids),
                many=True, context={"request": request},
            ).data
        if stage == "return":
            returns = SupplierReturn.objects.filter(goods_receipt__purchase_order__requisition_id__in=requisition_ids)
            payload["returns"] = SupplierReturnSerializer(returns, many=True, context={"request": request}).data
            payload["returnItems"] = SupplierReturnItemSerializer(
                SupplierReturnItem.objects.filter(supplier_return__goods_receipt__purchase_order__requisition_id__in=requisition_ids),
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
                "Finance Controller",
                "Auditor",
            )
        ).exists():
            return queryset
        employee = getattr(user, "employee_profile", None)
        if not employee:
            return queryset.none()
        if user.groups.filter(name__in=("Stores Manager", "Store Manager", "Store Keeper")).exists():
            return queryset.filter(branch=employee.branch)
        if user.groups.filter(name="Department Head").exists():
            return queryset.filter(
                department=employee.department,
                branch=employee.branch,
            )
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
                po_number=request.data.get("po_number", ""),
                expected_date=request.data.get("expected_date") or None,
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
                "Finance Controller",
                "Auditor",
            )
        ).exists():
            return queryset
        employee = getattr(user, "employee_profile", None)
        if not employee:
            return queryset.none()
        if user.groups.filter(name="Department Head").exists():
            visible_requisitions = visible_requisitions.filter(
                department=employee.department,
                branch=employee.branch,
            )
        else:
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
    search_fields = ("po_number", "supplier__name", "ordered_by__user__employee_code", "store__name")
    ordering_fields = ("po_number", "status", "created_at")

    def get_permissions(self):
        if self.action in ("approve_order", "reject_order"):
            return [IsAuthenticated()]
        return super().get_permissions()

    @action(detail=True, methods=["get"])
    def readiness(self, request, pk=None):
        return Response(self.get_object().issue_readiness())

    @action(detail=True, methods=["get"], url_path="approval-readiness")
    def approval_readiness(self, request, pk=None):
        return Response(self.get_object().approval_readiness())

    @action(detail=True, methods=["post"], url_path="submit-for-approval")
    def submit_for_approval(self, request, pk=None):
        order = self.get_object()
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
        enforce_readiness(order.issue_readiness())
        sent_by = None
        if request.data.get("sent_by"):
            try:
                sent_by = Employee.objects.get(pk=request.data.get("sent_by"))
            except Employee.DoesNotExist:
                raise ValidationError({"sent_by": "Selected employee was not found."})
        else:
            sent_by = getattr(request.user, "employee_profile", None)
        try:
            with transaction.atomic():
                order.issue(
                    sent_by=sent_by,
                    sent_to_email=request.data.get("sent_to_email", ""),
                )
                send_mail(
                    subject=f"Local Purchase Order {order.po_number}",
                    message=(
                        f"Please find purchase order {order.po_number} for "
                        f"{order.total_amount}. Expected delivery: {order.expected_date or 'not specified'}."
                    ),
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[order.sent_to_email],
                    fail_silently=False,
                )
                order.email_status = "sent"
                order.last_email_error = ""
                order.save(update_fields=["email_status", "last_email_error", "updated_at"])
                ProcurementCommunication.objects.create(
                    purchase_order=order,
                    supplier=order.supplier,
                    recipient=order.sent_to_email,
                    subject=f"Local Purchase Order {order.po_number}",
                    status="sent",
                    sent_at=timezone.now(),
                    created_by=request.user if request.user.is_authenticated else None,
                )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(order)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def resend(self, request, pk=None):
        order = self.get_object()
        if order.status == POStatus.DRAFT:
            raise ValidationError("Issue the LPO before resending it.")
        recipient = str(request.data.get("sent_to_email") or order.sent_to_email or order.supplier.email).strip()
        if not recipient:
            raise ValidationError("The supplier has no email address.")
        communication = ProcurementCommunication.objects.create(
            purchase_order=order, supplier=order.supplier, recipient=recipient,
            subject=f"Local Purchase Order {order.po_number}", status="pending",
            created_by=request.user if request.user.is_authenticated else None,
        )
        try:
            send_mail(
                subject=communication.subject,
                message=f"Resent purchase order {order.po_number} for {order.total_amount}.",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[recipient],
                fail_silently=False,
            )
            communication.status = "sent"
            communication.sent_at = timezone.now()
            order.email_status = "sent"
            order.last_email_error = ""
        except Exception as error:
            communication.status = "failed"
            communication.error_message = str(error)
            order.email_status = "failed"
            order.last_email_error = str(error)
            raise ValidationError(f"Email delivery failed: {error}")
        finally:
            communication.save(update_fields=["status", "sent_at", "error_message", "updated_at"])
            order.save(update_fields=["email_status", "last_email_error", "updated_at"])
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        order = self.get_object()
        try:
            order.acknowledge(str(request.data.get("acknowledged_by", "")).strip())
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        ProcurementCommunication.objects.create(
            purchase_order=order, supplier=order.supplier,
            direction=ProcurementCommunication.DIRECTION_INBOUND,
            recipient=order.supplier_acknowledged_by,
            subject=f"Supplier acknowledgement for {order.po_number}",
            status="received", sent_at=order.supplier_acknowledged_at,
            created_by=request.user if request.user.is_authenticated else None,
        )
        return Response(self.get_serializer(order).data)


class PurchaseOrderItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = PurchaseOrderItem.objects.select_related("purchase_order", "item", "unit")
    serializer_class = PurchaseOrderItemSerializer
    filterset_fields = ("purchase_order", "item", "unit")
    search_fields = ("purchase_order__po_number", "item__name", "item__sku", "unit__name")
    ordering_fields = ("quantity", "base_quantity", "unit_cost", "created_at")

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

    @action(detail=True, methods=["get"])
    def readiness(self, request, pk=None):
        return Response(self.get_object().posting_readiness())

    @action(detail=True, methods=["post"], url_path="post-to-inventory")
    def post_to_inventory(self, request, pk=None):
        receipt = self.get_object()
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

    def perform_destroy(self, instance):
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

    def perform_destroy(self, instance):
        if instance.goods_receipt.status in ("posted", "cancelled"):
            raise ValidationError("Posted or cancelled GRN inspections cannot be removed.")
        instance.delete()


class GoodsInspectionItemViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = GoodsInspectionItem.objects.select_related("inspection", "goods_receipt_item", "item")
    serializer_class = GoodsInspectionItemSerializer
    filterset_fields = ("inspection", "goods_receipt_item", "item")
    search_fields = ("item__name", "item__sku", "rejection_reason")
    ordering_fields = ("quantity_received", "quantity_accepted", "quantity_rejected", "created_at")

    def perform_destroy(self, instance):
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
