import csv
import io
from decimal import Decimal, InvalidOperation
from django.db import transaction
from django.utils import timezone
from django.core.exceptions import ValidationError as DjangoValidationError
from apps.departments.models import Branch
from django.db.models import Q
from uuid import UUID
from django.http import HttpResponse
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from apps.departments.models import Branch

from apps.materials_control.models import (
    BudgetOverride,
    CostCenterBudget,
    FiscalPeriod,
    GLExport,
    GLAccountMapping,
    IntegrationConfig,
    OutletAssignment,
    POSImportBatch,
    POSPLUMapping,
    POSSaleLine,
    Recipe,
    RecipeIngredient,
    WasteRecord,
)
from apps.materials_control.serializers import (
    BudgetOverrideSerializer,
    CostCenterBudgetSerializer,
    FiscalPeriodSerializer,
    GLExportSerializer,
    GLAccountMappingSerializer,
    IntegrationConfigSerializer,
    OutletAssignmentSerializer,
    POSImportBatchSerializer,
    POSPLUMappingSerializer,
    POSSaleLineSerializer,
    RecipeIngredientSerializer,
    RecipeSerializer,
    WasteRecordSerializer,
)
from core.mixins.viewsets import CreatedByModelMixin


ROLE_ALIASES = {
    "outlet": {"Department Supervisor", "Outlet Supervisor"},
    "department": {"Department Head"},
    "cost": {"Cost Controller", "F&B Cost Controller"},
    "purchasing": {"Procurement Manager", "Procurement Officer", "Purchasing Officer"},
    "ap": {"Accounts Payable Clerk"},
    "finance": {"Financial Manager", "Financial Controller"},
    "management": {"General Manager"},
    "admin": {"System Administrator"},
}


def has_role(user, *families):
    names = set()
    for family in families:
        names.update(ROLE_ALIASES.get(family, {family}))
    return bool(user and user.is_authenticated and user.groups.filter(name__in=names).exists())


def employee_for(user):
    return getattr(user, "employee_profile", None)


def raise_model_error(error):
    detail = getattr(error, "message_dict", None) or getattr(error, "messages", None) or str(error)
    raise ValidationError(detail)


def hotel_scope(queryset, user, branch_path):
    if user.is_superuser or has_role(user, "admin"):
        return queryset
    employee = employee_for(user)
    if not employee or not employee.branch_id:
        return queryset.none()
    if employee.branch.hotel_id:
        return queryset.filter(**{f"{branch_path}__hotel_id": employee.branch.hotel_id})
    return queryset.filter(**{f"{branch_path}_id": employee.branch_id})


def ensure_branch_scope(user, branch_id):
    if user.is_superuser or has_role(user, "admin"):
        return
    employee = employee_for(user)
    if not employee or not employee.branch_id or not branch_id:
        raise PermissionDenied("An assigned property is required.")
    target = Branch.objects.only("hotel_id").filter(pk=branch_id).first()
    if target is None:
        raise PermissionDenied("Unknown property.")
    if employee.branch.hotel_id and target.hotel_id:
        if employee.branch.hotel_id != target.hotel_id:
            raise PermissionDenied("This record belongs to another hotel.")
    elif employee.branch_id != target.pk:
        raise PermissionDenied("This record belongs to another branch.")


def department_outlet_ids(employee):
    if not employee or not employee.department_id or not employee.branch_id:
        return OutletAssignment.objects.none().values_list("outlet_id", flat=True)
    return OutletAssignment.objects.filter(
        employee__department_id=employee.department_id,
        employee__branch_id=employee.branch_id,
        is_active=True,
    ).values_list("outlet_id", flat=True)


def scoped_recipe_records(queryset, user, outlet_field):
    queryset = hotel_scope(queryset, user, f"{outlet_field}__branch")
    if user.is_superuser or has_role(user, "admin", "cost", "finance", "management"):
        return queryset
    employee = employee_for(user)
    if has_role(user, "department"):
        return queryset.filter(**{f"{outlet_field}_id__in": department_outlet_ids(employee)})
    if has_role(user, "outlet") and employee:
        ids = OutletAssignment.objects.filter(
            employee=employee, is_active=True
        ).values_list("outlet_id", flat=True)
        return queryset.filter(**{f"{outlet_field}_id__in": ids})
    return queryset.none()


def require_recipe_outlet(user, outlet):
    ensure_branch_scope(user, outlet.branch_id)
    if has_role(user, "department") and not has_role(user, "cost"):
        if outlet.pk not in department_outlet_ids(employee_for(user)):
            raise PermissionDenied("This outlet is outside your department.")


class GlobalCommandSearchView(APIView):
    """Permission-filtered, property-scoped document search for the command bar."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.inventory.models import Item, StockTransfer
        from apps.procurement.models import PurchaseOrder, GoodsReceiptNote

        query = str(request.query_params.get("q") or "").strip()[:80]
        if len(query) < 2:
            return Response({"results": []})
        user = request.user
        employee = employee_for(user)
        unrestricted = user.is_superuser or has_role(user, "admin")
        if not unrestricted and (not employee or not employee.is_active or not employee.branch_id):
            return Response({"results": []})

        def scoped(queryset, branch_path):
            if unrestricted:
                return queryset
            if has_role(user, "finance", "management") and employee.branch.hotel_id:
                return queryset.filter(**{f"{branch_path}__hotel_id": employee.branch.hotel_id})
            return queryset.filter(**{f"{branch_path}_id": employee.branch_id})

        results = []
        if user.has_perm("procurement.view_purchaseorder"):
            orders = scoped(
                PurchaseOrder.objects.select_related("supplier", "requisition__branch"),
                "requisition__branch",
            ).filter(
                Q(lpo_number__icontains=query) | Q(po_number__icontains=query)
                | Q(supplier__name__icontains=query)
            ).order_by("-created_at")[:6]
            results.extend({
                "kind": "order", "id": str(order.pk),
                "reference": order.lpo_number or order.po_number,
                "title": "Purchase order", "subtitle": str(order.supplier),
                "status": order.status,
            } for order in orders)
        if user.has_perm("procurement.view_goodsreceiptnote"):
            receipts = scoped(
                GoodsReceiptNote.objects.select_related("purchase_order__supplier", "purchase_order__requisition__branch"),
                "purchase_order__requisition__branch",
            ).filter(
                Q(grn_number__icontains=query)
                | Q(purchase_order__lpo_number__icontains=query)
            ).order_by("-created_at")[:6]
            results.extend({
                "kind": "grn", "id": str(receipt.pk),
                "reference": receipt.grn_number,
                "title": "Goods receipt", "subtitle": str(receipt.purchase_order.supplier),
                "status": receipt.status,
            } for receipt in receipts)
        if user.has_perm("inventory.view_stocktransfer"):
            transfers = scoped(
                StockTransfer.objects.select_related("from_store", "to_store"),
                "from_store__branch",
            ).filter(
                Q(from_store__name__icontains=query)
                | Q(to_store__name__icontains=query)
                | Q(note__icontains=query)
            ).order_by("-created_at")
            if has_role(user, "Store Keeper") and not unrestricted:
                transfers = transfers.filter(
                    from_store__keeper_assignments__employee=employee,
                    from_store__keeper_assignments__is_active=True,
                )
            results.extend({
                "kind": "transfer", "id": str(transfer.pk),
                "reference": "Transfer " + str(transfer.pk)[:8],
                "title": "Stock transfer",
                "subtitle": f"{transfer.from_store} → {transfer.to_store}",
                "status": transfer.status,
            } for transfer in transfers[:6])
        if user.has_perm("inventory.view_item"):
            articles = Item.objects.filter(is_active=True).filter(
                Q(name__icontains=query) | Q(sku__icontains=query)
            ).order_by("name")[:6]
            results.extend({
                "kind": "article", "id": str(article.pk),
                "reference": article.sku,
                "title": article.name, "subtitle": "Article catalogue",
                "status": "",
            } for article in articles)
        return Response({"results": results})


class DocumentAuditTimelineView(APIView):
    """Read-only, property-scoped evidence for an individually authorized document.

    Never expose the administrator-only audit log collection or raw metadata
    to operational staff. A document's audit events are deliberately returned
    only after the underlying record passes the same scoped access checks.
    """

    permission_classes = [IsAuthenticated]
    KINDS = {
        "order": ("procurement.view_purchaseorder", "procurement.PurchaseOrder"),
        "grn": ("procurement.view_goodsreceiptnote", "procurement.GoodsReceiptNote"),
        "transfer": ("inventory.view_stocktransfer", "inventory.StockTransfer"),
        "requisition": ("inventory.view_storerequisition", "inventory.StoreRequisition"),
    }

    def get(self, request, kind, document_id):
        from apps.audit_logs.models import AuditLog
        from apps.procurement.models import PurchaseOrder, GoodsReceiptNote
        from apps.inventory.models import StockTransfer, StoreRequisition

        kind_info = self.KINDS.get(kind)
        if kind_info is None:
            raise ValidationError("Unsupported document type.")
        try:
            document_id = UUID(str(document_id))
        except (ValueError, TypeError):
            raise ValidationError("Invalid document identifier.")

        user = request.user
        unrestricted = user.is_superuser or has_role(user, "admin")
        if not unrestricted and not user.has_perm(kind_info[0]):
            raise PermissionDenied("This document is not available to your role.")

        if kind == "order":
            doc = PurchaseOrder.objects.select_related(
                "requisition__branch"
            ).filter(pk=document_id).first()
            branch = doc.requisition.branch if doc and doc.requisition else None
        elif kind == "grn":
            doc = GoodsReceiptNote.objects.select_related(
                "purchase_order__requisition__branch"
            ).filter(pk=document_id).first()
            branch = doc.purchase_order.requisition.branch if doc else None
        elif kind == "transfer":
            doc = StockTransfer.objects.select_related(
                "from_store__branch"
            ).filter(pk=document_id).first()
            branch = doc.from_store.branch if doc else None
            if doc and has_role(user, "Store Keeper") and not unrestricted:
                employee = employee_for(user)
                if (not employee or not doc.from_store.keeper_assignments.filter(
                    employee=employee, is_active=True
                ).exists()):
                    raise PermissionDenied("This transfer is outside your assigned store.")
        else:
            doc = StoreRequisition.objects.select_related(
                "store__branch"
            ).filter(pk=document_id).first()
            branch = doc.store.branch if doc else None
            if doc and has_role(user, "outlet") and not unrestricted:
                employee = employee_for(user)
                if not employee or doc.requested_by_id != employee.pk:
                    raise PermissionDenied("Only your own department request is visible.")

        if not doc or not branch:
            raise PermissionDenied("This document is not available in your property.")
        if not unrestricted:
            employee = employee_for(user)
            if not employee or not employee.is_active or not employee.branch_id:
                raise PermissionDenied("An active assigned property is required.")
            if has_role(user, "finance", "management") and branch.hotel_id and employee.branch.hotel_id:
                allowed = branch.hotel_id == employee.branch.hotel_id
            else:
                allowed = branch.pk == employee.branch_id
            if not allowed:
                raise PermissionDenied("This document is outside your assigned property.")

        events = AuditLog.objects.filter(
            entity_type=kind_info[1], entity_id=str(document_id)
        ).select_related("actor").order_by("chain_sequence")[:200]
        return Response({
            "document_id": str(document_id),
            "kind": kind,
            "events": [{
                "action": row.action,
                "actor": str(row.actor) if row.actor_id else "System",
                "created_at": row.created_at,
                "sequence": row.chain_sequence,
                "entry_hash": row.entry_hash,
            } for row in events],
        })


class PeriodContextView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = employee_for(request.user)
        branch_id = request.query_params.get("branch_id")
        if branch_id and (request.user.is_superuser or has_role(request.user, "admin", "finance", "management")):
            branch = Branch.objects.filter(pk=branch_id).first()
            if not branch:
                raise PermissionDenied("Unknown property.")
            if not request.user.is_superuser and not has_role(request.user, "admin"):
                ensure_branch_scope(request.user, branch.pk)
        elif employee and employee.is_active and employee.branch_id:
            branch = employee.branch
        else:
            return Response({"status": "unavailable", "name": "No assigned property"})
        period = FiscalPeriod.objects.filter(
            branch=branch, start_date__lte=timezone.localdate(),
            end_date__gte=timezone.localdate(),
        ).order_by("-start_date").first()
        if not period:
            return Response({
                "status": "unconfigured", "name": "Period not configured",
                "branch_id": str(branch.pk), "branch_name": branch.name,
            })
        return Response({
            "id": str(period.pk), "name": period.name, "status": period.status,
            "start_date": period.start_date, "end_date": period.end_date,
            "branch_id": str(branch.pk), "branch_name": branch.name,
        })


class OutletAssignmentViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = OutletAssignment.objects.select_related("employee__user", "outlet__branch")
    serializer_class = OutletAssignmentSerializer
    filterset_fields = ("employee", "outlet", "is_primary", "is_active")
    search_fields = ("employee__user__username", "outlet__name")

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.is_superuser or has_role(self.request.user, "admin"):
            return queryset
        employee = employee_for(self.request.user)
        if has_role(self.request.user, "outlet") and employee:
            return queryset.filter(employee=employee)
        if has_role(self.request.user, "department") and employee:
            return queryset.filter(employee__department=employee.department, employee__branch=employee.branch)
        return queryset.none()

    def _require_admin(self):
        if not (self.request.user.is_superuser or has_role(self.request.user, "admin")):
            raise PermissionDenied("Only the System Administrator can assign operational outlets.")

    def perform_create(self, serializer):
        self._require_admin()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_admin()
        serializer.save()

    def perform_destroy(self, instance):
        self._require_admin()
        instance.delete()


class WasteRecordViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = WasteRecord.objects.select_related(
        "outlet__branch__hotel", "department", "item", "unit", "reported_by__user", "reviewed_by__user"
    )
    serializer_class = WasteRecordSerializer
    filterset_fields = ("outlet", "department", "item", "reason_code", "status")
    search_fields = ("item__name", "item__sku", "note", "review_note", "outlet__name")
    ordering_fields = ("created_at", "submitted_at", "quantity", "status")

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        employee = employee_for(user)
        if user.is_superuser or has_role(user, "admin", "cost", "finance", "management"):
            return hotel_scope(queryset, user, "outlet__branch")
        if has_role(user, "department") and employee:
            return queryset.filter(department=employee.department, outlet__branch=employee.branch)
        if has_role(user, "outlet") and employee:
            outlet_ids = OutletAssignment.objects.filter(
                employee=employee, is_active=True
            ).values_list("outlet_id", flat=True)
            return queryset.filter(outlet_id__in=outlet_ids)
        return queryset.none()

    def perform_create(self, serializer):
        employee = employee_for(self.request.user)
        if not (employee and has_role(self.request.user, "outlet")):
            raise PermissionDenied("Only an assigned Outlet Supervisor can log waste.")
        outlet = serializer.validated_data["outlet"]
        if not OutletAssignment.objects.filter(employee=employee, outlet=outlet, is_active=True).exists():
            raise PermissionDenied("This outlet is not assigned to your account.")
        serializer.save(
            reported_by=employee,
            department=employee.department,
            created_by=self.request.user,
        )

    def perform_update(self, serializer):
        if serializer.instance.reported_by_id != getattr(employee_for(self.request.user), "id", None):
            raise PermissionDenied("You can only edit your own draft waste records.")
        serializer.save()

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        waste = self.get_object()
        if waste.reported_by_id != getattr(employee_for(request.user), "id", None):
            raise PermissionDenied("Only the reporting Outlet Supervisor can submit this record.")
        try:
            waste.submit(request.user)
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(self.get_serializer(waste).data)

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        if not has_role(request.user, "department", "cost"):
            raise PermissionDenied("Only the Department Head or Cost Controller can review waste.")
        reviewer = employee_for(request.user)
        if not reviewer:
            raise PermissionDenied("An employee profile is required to review waste.")
        waste = self.get_object()
        try:
            waste.review(
                reviewer,
                flagged=bool(request.data.get("flagged")),
                note=request.data.get("note", ""),
            )
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(self.get_serializer(waste).data)


class RecipeViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Recipe.objects.select_related("outlet__branch__hotel", "published_by").prefetch_related(
        "ingredients"
    )
    serializer_class = RecipeSerializer
    filterset_fields = ("outlet", "status", "is_sub_recipe")
    search_fields = ("code", "name", "note", "outlet__name")
    ordering_fields = ("name", "status", "published_at", "created_at")

    def get_queryset(self):
        return scoped_recipe_records(super().get_queryset(), self.request.user, "outlet")

    def _require_recipe_editor(self):
        if not has_role(self.request.user, "department", "cost"):
            raise PermissionDenied("Only Department leadership or F&B Cost Control can maintain recipes.")

    def perform_create(self, serializer):
        self._require_recipe_editor()
        require_recipe_outlet(self.request.user, serializer.validated_data["outlet"])
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_recipe_editor()
        if serializer.instance.status != Recipe.STATUS_DRAFT:
            raise ValidationError("Published or archived recipes cannot be edited; create a new revision.")
        require_recipe_outlet(self.request.user, serializer.validated_data.get(
            "outlet", serializer.instance.outlet
        ))
        serializer.save()

    def perform_destroy(self, instance):
        self._require_recipe_editor()
        if instance.status == Recipe.STATUS_PUBLISHED:
            raise ValidationError("Published recipes must be archived, not deleted.")
        instance.delete()

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        self._require_recipe_editor()
        recipe = self.get_object()
        try:
            recipe.publish(request.user)
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(self.get_serializer(recipe).data)

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        self._require_recipe_editor()
        recipe = self.get_object()
        recipe.status = Recipe.STATUS_ARCHIVED
        recipe.save(update_fields=("status", "updated_at"))
        return Response(self.get_serializer(recipe).data)


class RecipeIngredientViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = RecipeIngredient.objects.select_related(
        "recipe__outlet__branch__hotel", "item__base_unit", "unit"
    )
    serializer_class = RecipeIngredientSerializer
    filterset_fields = ("recipe", "item", "unit")
    search_fields = ("recipe__name", "item__name", "item__sku")

    def get_queryset(self):
        return scoped_recipe_records(super().get_queryset(), self.request.user, "recipe__outlet")

    def _require_editor(self):
        if not has_role(self.request.user, "department", "cost"):
            raise PermissionDenied("Only Department leadership or F&B Cost Control can edit ingredients.")

    def perform_create(self, serializer):
        self._require_editor()
        recipe = serializer.validated_data["recipe"]
        if not scoped_recipe_records(Recipe.objects.filter(pk=recipe.pk),
                                     self.request.user, "outlet").exists():
            raise PermissionDenied("Recipe is outside your department/property.")
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_editor()
        recipe = serializer.validated_data.get("recipe", serializer.instance.recipe)
        if not scoped_recipe_records(Recipe.objects.filter(pk=recipe.pk),
                                     self.request.user, "outlet").exists():
            raise PermissionDenied("Recipe is outside your department/property.")
        serializer.save()

    def perform_destroy(self, instance):
        self._require_editor()
        if instance.recipe.status != Recipe.STATUS_DRAFT:
            raise ValidationError("Ingredients of published or archived recipes cannot be removed.")
        instance.delete()


class POSPLUMappingViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = POSPLUMapping.objects.select_related("outlet__branch__hotel", "recipe")
    serializer_class = POSPLUMappingSerializer
    filterset_fields = ("outlet", "recipe", "is_active")
    search_fields = ("external_plu", "external_name", "recipe__name")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "outlet__branch")

    def _require_cost_control(self):
        if not has_role(self.request.user, "cost"):
            raise PermissionDenied("Only F&B Cost Control can maintain POS PLU mappings.")

    def perform_create(self, serializer):
        self._require_cost_control()
        ensure_branch_scope(self.request.user, serializer.validated_data["outlet"].branch_id)
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_cost_control()
        ensure_branch_scope(self.request.user, serializer.validated_data.get(
            "outlet", serializer.instance.outlet
        ).branch_id)
        serializer.save()

    def perform_destroy(self, instance):
        self._require_cost_control()
        instance.delete()


class POSImportBatchViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = POSImportBatch.objects.select_related("outlet__branch__hotel", "processed_by").prefetch_related(
        "lines"
    )
    serializer_class = POSImportBatchSerializer
    filterset_fields = ("outlet", "business_date", "source", "status")
    search_fields = ("source", "source_reference", "outlet__name", "error_message")
    ordering_fields = ("business_date", "status", "created_at")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "outlet__branch")

    def _require_cost_control(self):
        if not has_role(self.request.user, "cost"):
            raise PermissionDenied("Only F&B Cost Control can operate POS depletion imports.")

    def perform_create(self, serializer):
        self._require_cost_control()
        ensure_branch_scope(self.request.user, serializer.validated_data["outlet"].branch_id)
        super().perform_create(serializer)

    @action(detail=True, methods=["post"], url_path="run-depletion")
    def run_depletion(self, request, pk=None):
        self._require_cost_control()
        batch = self.get_object()
        try:
            batch.process(request.user)
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(self.get_serializer(batch).data)

    @action(detail=True, methods=["post"], url_path="import-csv")
    def import_csv(self, request, pk=None):
        self._require_cost_control()
        batch = self.get_object()
        csv_text = request.data.get("csv")
        if not isinstance(csv_text, str) or not csv_text.strip():
            raise ValidationError({"csv": "Provide a CSV document."})
        if len(csv_text.encode("utf-8")) > 1_000_000:
            raise ValidationError({"csv": "Maximum CSV size is 1 MB."})
        reader = csv.DictReader(io.StringIO(csv_text.lstrip("\ufeff")))
        required = {"external_plu", "external_reference", "quantity"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValidationError({"csv": "Required columns: external_plu,external_reference,quantity."})
        imported, skipped = 0, 0
        seen = set()
        with transaction.atomic():
            locked = POSImportBatch.objects.select_for_update().get(pk=batch.pk)
            if locked.status == POSImportBatch.STATUS_PROCESSED:
                raise ValidationError("A processed batch cannot receive sale lines.")
            existing = {line.external_reference: line for line in locked.lines.all()}
            for number, row in enumerate(reader, 2):
                plu = (row.get("external_plu") or "").strip()
                ref = (row.get("external_reference") or "").strip()
                name = (row.get("external_name") or "").strip()
                try:
                    quantity = Decimal((row.get("quantity") or "").strip())
                    sales = Decimal((row.get("net_sales") or "0").strip())
                except (InvalidOperation, ValueError):
                    raise ValidationError({"csv": f"Invalid numeric value at line {number}."})
                if not plu or not ref or ref in seen:
                    raise ValidationError({"csv": f"Blank or repeated PLU/reference at line {number}."})
                seen.add(ref)
                if not quantity.is_finite() or not sales.is_finite() or quantity <= 0 or sales < 0:
                    raise ValidationError({"csv": f"Invalid quantity or sales at line {number}."})
                previous = existing.get(ref)
                if previous:
                    if (previous.external_plu, previous.external_name,
                        previous.quantity, previous.net_sales) != (plu, name, quantity, sales):
                        raise ValidationError({"csv": f"Reference {ref} conflicts with an existing line."})
                    skipped += 1
                    continue
                sale = POSSaleLine(
                    batch=locked, external_plu=plu,
                    external_name=name, external_reference=ref,
                    quantity=quantity, net_sales=sales, created_by=request.user,
                )
                try:
                    sale.full_clean()
                except DjangoValidationError as error:
                    raise_model_error(error)
                sale.save()
                imported += 1
            if not seen:
                raise ValidationError({"csv": "CSV contains no sale lines."})
        return Response({"imported": imported, "skipped_existing": skipped})


class POSSaleLineViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = POSSaleLine.objects.select_related(
        "batch__outlet__branch__hotel", "mapping__recipe"
    )
    serializer_class = POSSaleLineSerializer
    filterset_fields = ("batch", "external_plu", "inventory_changes_applied")
    search_fields = ("external_plu", "external_name", "external_reference")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "batch__outlet__branch")

    def _require_cost_control(self):
        if not has_role(self.request.user, "cost"):
            raise PermissionDenied("Only F&B Cost Control can load POS sale lines.")

    def perform_create(self, serializer):
        self._require_cost_control()
        ensure_branch_scope(self.request.user, serializer.validated_data["batch"].outlet.branch_id)
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_cost_control()
        if serializer.instance.inventory_changes_applied:
            raise ValidationError("A depleted POS line is immutable.")
        ensure_branch_scope(self.request.user, serializer.validated_data.get(
            "batch", serializer.instance.batch
        ).outlet.branch_id)
        serializer.save()

    def perform_destroy(self, instance):
        self._require_cost_control()
        if instance.inventory_changes_applied:
            raise ValidationError("A depleted POS line cannot be deleted.")
        instance.delete()


class CostCenterBudgetViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = CostCenterBudget.objects.select_related("branch__hotel", "department")
    serializer_class = CostCenterBudgetSerializer
    filterset_fields = ("branch", "department", "period_month", "enforce_hard_block", "is_active")
    search_fields = ("branch__name", "department__name", "note")
    ordering_fields = ("period_month", "spending_cap", "department__name")

    def get_queryset(self):
        scoped = hotel_scope(super().get_queryset(), self.request.user, "branch")
        if has_role(self.request.user, "department") and not has_role(
            self.request.user, "finance", "management", "admin"
        ):
            employee = employee_for(self.request.user)
            return scoped.filter(department_id=employee.department_id) if employee else scoped.none()
        return scoped

    def _require_finance(self):
        if not has_role(self.request.user, "finance"):
            raise PermissionDenied("Only the Financial Controller can maintain cost-center budgets.")

    def perform_create(self, serializer):
        self._require_finance()
        ensure_branch_scope(self.request.user, serializer.validated_data["branch"].pk)
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_finance()
        ensure_branch_scope(self.request.user, serializer.validated_data.get(
            "branch", serializer.instance.branch
        ).pk)
        serializer.save()

    def perform_destroy(self, instance):
        self._require_finance()
        if instance.overrides.exists():
            raise ValidationError("A budget with override history cannot be deleted.")
        instance.delete()


class BudgetOverrideViewSet(ReadOnlyModelViewSet):
    queryset = BudgetOverride.objects.select_related(
        "budget__branch__hotel", "budget__department", "requisition", "decided_by"
    )
    serializer_class = BudgetOverrideSerializer
    filterset_fields = ("budget", "requisition", "status")
    search_fields = ("requisition__requisition_number", "reason", "decision_note")
    ordering_fields = ("status", "overage_amount", "created_at")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "budget__branch")

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        if not has_role(request.user, "finance"):
            raise PermissionDenied("Only the Financial Controller can decide a budget override.")
        override = self.get_object()
        decision = str(request.data.get("decision") or "").strip().lower()
        if decision not in {"approve", "reject"}:
            raise ValidationError({"decision": "Choose approve or reject."})
        try:
            override.decide(
                request.user,
                approve=decision == "approve",
                note=request.data.get("note", ""),
            )
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(self.get_serializer(override).data)


class FiscalPeriodViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = FiscalPeriod.objects.select_related("branch__hotel", "closed_by")
    serializer_class = FiscalPeriodSerializer
    filterset_fields = ("branch", "status", "start_date", "end_date")
    search_fields = ("name", "branch__name", "close_note")
    ordering_fields = ("start_date", "end_date", "status", "created_at")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "branch")

    def _require_finance(self):
        if not has_role(self.request.user, "finance"):
            raise PermissionDenied("Only the Financial Controller can operate fiscal periods.")

    def perform_create(self, serializer):
        self._require_finance()
        ensure_branch_scope(self.request.user, serializer.validated_data["branch"].pk)
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_finance()
        if serializer.instance.status == FiscalPeriod.STATUS_CLOSED:
            raise ValidationError("Closed fiscal periods are immutable.")
        ensure_branch_scope(self.request.user, serializer.validated_data.get(
            "branch", serializer.instance.branch
        ).pk)
        serializer.save()

    def perform_destroy(self, instance):
        self._require_finance()
        if instance.status == FiscalPeriod.STATUS_CLOSED:
            raise ValidationError("Closed fiscal periods cannot be deleted.")
        instance.delete()

    @action(detail=True, methods=["get"], url_path="pre-close-checklist")
    def pre_close_checklist(self, request, pk=None):
        return Response(self.get_object().pre_close_checklist())

    @action(detail=True, methods=["get"], url_path="inventory-gl-preview")
    def inventory_gl_preview(self, request, pk=None):
        self._require_finance()
        return Response(self.get_object().inventory_gl_journal_preview())

    @action(detail=True, methods=["get"], url_path="inventory-valuation-reconciliation")
    def inventory_valuation_reconciliation(self, request, pk=None):
        self._require_finance()
        return Response(self.get_object().inventory_valuation_reconciliation())

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        self._require_finance()
        period = self.get_object()
        try:
            period.close(request.user, request.data.get("note", ""))
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(self.get_serializer(period).data)

    @action(detail=True, methods=["post"], url_path="generate-gl-export")
    def generate_gl_export(self, request, pk=None):
        self._require_finance()
        try:
            export = GLExport.generate(self.get_object(), request.user)
        except DjangoValidationError as error:
            raise_model_error(error)
        return Response(GLExportSerializer(export, context=self.get_serializer_context()).data)


class GLAccountMappingViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = GLAccountMapping.objects.select_related("branch__hotel")
    serializer_class = GLAccountMappingSerializer
    filterset_fields = ("branch", "source_type", "is_active")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "branch")

    def _require_admin(self):
        if not (self.request.user.is_superuser or has_role(self.request.user, "admin")):
            raise PermissionDenied("Only IT can configure GL account mappings.")

    def perform_create(self, serializer):
        self._require_admin()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_admin()
        serializer.save()

    def perform_destroy(self, instance):
        self._require_admin()
        instance.delete()


class GLExportViewSet(ReadOnlyModelViewSet):
    queryset = GLExport.objects.select_related("period__branch__hotel", "generated_by")
    serializer_class = GLExportSerializer
    filterset_fields = ("period", "format", "generated_by")
    search_fields = ("period__name", "checksum")
    ordering_fields = ("generated_at", "row_count")

    def get_queryset(self):
        return hotel_scope(super().get_queryset(), self.request.user, "period__branch")

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        export = self.get_object()
        response = HttpResponse(export.payload, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = (
            f'attachment; filename="gl-export-{export.period.start_date}-{export.period.end_date}.csv"'
        )
        response["X-Content-SHA256"] = export.checksum
        return response


class IntegrationConfigViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = IntegrationConfig.objects.select_related("branch__hotel")
    serializer_class = IntegrationConfigSerializer
    filterset_fields = ("branch", "integration_type", "provider", "is_active", "health")
    search_fields = ("name", "provider", "endpoint_hint", "last_message")
    ordering_fields = ("integration_type", "name", "health", "last_sync_at")

    def _require_admin(self):
        if not (self.request.user.is_superuser or has_role(self.request.user, "admin")):
            raise PermissionDenied("Only the System Administrator can configure integrations.")

    def get_queryset(self):
        self._require_admin()
        return super().get_queryset()

    def perform_create(self, serializer):
        self._require_admin()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_admin()
        serializer.save()

    def perform_destroy(self, instance):
        self._require_admin()
        instance.delete()

