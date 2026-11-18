"""Department supply workflow: Supervisor -> HOD -> Cost Control -> Stores."""
from decimal import Decimal, InvalidOperation
from django.core.exceptions import ValidationError as DjangoValidationError

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.inventory.models import InventoryBalance, Item, StockIssue, StockIssueItem, StoreLocation, StoreKeeperAssignment, StoreRequisition, StoreRequisitionItem, UnitOfMeasure
from apps.inventory.stores_fulfillment import fulfill_requisition
from apps.inventory.serializers import StoreRequisitionItemSerializer as BaseItemSerializer, StoreRequisitionSerializer
from apps.inventory.views import has_role
from apps.notifications.services import notify_employee, notify_roles
from core.constants.choices import GoodsReceiptStatus, StoreRequisitionStatus
from core.mixins.viewsets import CreatedByModelMixin

SUPERVISOR_ROLES=("Department Supervisor","Outlet Supervisor","Supervisor")
def emp(user): return getattr(user,"employee_profile",None)
def operational_role(user,*roles):
    return bool(
        user and user.is_authenticated and not user.is_superuser
        and not user.groups.filter(name="System Administrator").exists()
        and user.groups.filter(name__in=roles).exists()
    )
def is_supervisor(user): return operational_role(user,*SUPERVISOR_ROLES)
def is_hod(user): return operational_role(user,"Department Head")
def is_cost(user): return operational_role(user,"Cost Controller")
def is_keeper(user): return operational_role(user,"Store Keeper")
def ename(e):
    if not e: return ""
    return e.user.get_full_name() or e.user.username

def hotel_scope(qs,e,path="branch"):
    if not e or not e.branch_id: return qs.none()
    if getattr(e.branch,"hotel_id",None): return qs.filter(**{f"{path}__hotel_id":e.branch.hotel_id})
    return qs.filter(**{f"{path}_id":e.branch_id})

def operational_stores_for_user(user):
    qs=StoreLocation.objects.select_related("branch","branch__hotel").filter(is_active=True)
    if user.is_superuser or has_role(user,"System Administrator"): return qs
    e=emp(user)
    if not e: return qs.none()
    if is_keeper(user):
        assigned=StoreKeeperAssignment.objects.filter(
            employee=e,is_active=True,store__is_active=True,
            store__branch_id=e.branch_id,
        ).values_list("store_id",flat=True)
        return qs.filter(pk__in=assigned)
    if is_cost(user): return hotel_scope(qs,e)
    return qs.filter(branch_id=e.branch_id)

def request_scope(qs,user):
    if user.is_superuser or has_role(user,"System Administrator"): return qs
    e=emp(user)
    if not e: return qs.none()
    if is_supervisor(user): return qs.filter(requested_by=e)
    if is_hod(user): return qs.filter(department=e.department,requested_by__branch=e.branch).exclude(status=StoreRequisitionStatus.DRAFT)
    if is_cost(user): return hotel_scope(qs,e,"requested_by__branch").filter(department_approved_at__isnull=False)
    if is_keeper(user):
        stores=StoreKeeperAssignment.objects.filter(
            employee=e, is_active=True, store__is_active=True,
            store__branch_id=e.branch_id,
        ).values_list("store_id",flat=True)
        return qs.filter(store_id__in=stores).filter(
            Q(approved_at__isnull=False)
            | Q(status__in=(
                StoreRequisitionStatus.SUBMITTED,
                StoreRequisitionStatus.APPROVED,
                StoreRequisitionStatus.AWAITING_PROCUREMENT,
                StoreRequisitionStatus.PARTIALLY_ISSUED,
                StoreRequisitionStatus.ISSUED,
            ), department_approved_at__isnull=False)
        )
    return qs.none()

class DepartmentRequestItemSerializer(BaseItemSerializer):
    def validate(self,attrs):
        attrs=super().validate(attrs); line=self.instance
        if not line: return attrs
        if line.requisition.status not in (StoreRequisitionStatus.DRAFT,StoreRequisitionStatus.REJECTED):
            raise ValidationError("Department request lines are locked after Supervisor submission.")
        if "quantity_requested" in attrs or "unit" in attrs:
            item=attrs.get("item",line.item); unit=attrs.get("unit",line.unit); quantity=attrs.get("quantity_requested",line.quantity_requested)
            if item.quantity_in_base_units(quantity,unit)>line.base_quantity_requested:
                raise ValidationError({"quantity_requested":"Quantity can only be retained or reduced after the Article is added."})
        return attrs

class StoreRequisitionItemViewSet(CreatedByModelMixin,ModelViewSet):
    queryset=StoreRequisitionItem.objects.select_related("requisition","item","unit")
    serializer_class=DepartmentRequestItemSerializer
    permission_classes=(IsAuthenticated,)
    filterset_fields=("requisition","item","unit")
    def get_queryset(self): return super().get_queryset().filter(requisition__in=request_scope(StoreRequisition.objects.all(),self.request.user))
    def _editable(self,r):
        e=emp(self.request.user)
        if not(is_supervisor(self.request.user) and e and r.requested_by_id==e.id and r.status in (StoreRequisitionStatus.DRAFT,StoreRequisitionStatus.REJECTED)):
            raise PermissionDenied("Only the Supervisor who created this request can edit its draft Articles.")
    def perform_create(self,s): self._editable(s.validated_data["requisition"]); s.save(created_by=self.request.user)
    def update(self, request, *args, **kwargs):
        # Reject unauthorised edits before DRF field validation. Booked request
        # lines belong to the approval/dispatch API, never ordinary PATCH.
        line = self.get_object()
        self._editable(line.requisition)
        return super().update(request, *args, **kwargs)
    def perform_update(self,s): self._editable(s.instance.requisition); s.save()
    def perform_destroy(self,obj): self._editable(obj.requisition); obj.delete()
    @action(detail=True,methods=["post"])
    def remove(self,request,pk=None): self.perform_destroy(self.get_object()); return Response(status=204)

class StoreRequisitionViewSet(CreatedByModelMixin,ModelViewSet):
    queryset=StoreRequisition.objects.select_related("department","store__branch__hotel","requested_by__user","requested_by__branch__hotel","department_approved_by__user","approved_by__user")
    serializer_class=StoreRequisitionSerializer
    permission_classes=(IsAuthenticated,)
    filterset_fields=("status","department","store","requested_by")
    def get_queryset(self): return request_scope(super().get_queryset(),self.request.user)
    def perform_create(self,s):
        if not is_supervisor(self.request.user): raise PermissionDenied("Only a Department Supervisor can create a Department request.")
        s.save(created_by=self.request.user)
    def _supervisor_draft(self,r):
        if self.request.user.is_superuser or has_role(self.request.user,"System Administrator"): return
        e=emp(self.request.user)
        if not(is_supervisor(self.request.user) and e and r.requested_by_id==e.id and r.status in (StoreRequisitionStatus.DRAFT,StoreRequisitionStatus.REJECTED)): raise PermissionDenied("Only the Supervisor who created this request can edit its draft.")
    def perform_update(self,s): self._supervisor_draft(s.instance); s.save()
    def perform_destroy(self,obj): self._supervisor_draft(obj); obj.delete()

    @action(detail=False,methods=["get"])
    def workflow(self,request):
        requests=list(self.get_queryset().order_by("-created_at")); ids=[x.pk for x in requests]
        lines=list(StoreRequisitionItem.objects.filter(requisition_id__in=ids).select_related("item__base_unit","unit"))
        stores=list(operational_stores_for_user(request.user)); store_ids=[x.pk for x in stores]
        balances=list(InventoryBalance.objects.filter(store_id__in=store_ids).select_related("item__base_unit","store"))
        items=list(Item.objects.filter(is_active=True).select_related("base_unit")); units=list(UnitOfMeasure.objects.filter(is_active=True))
        issues=list(StockIssue.objects.filter(requisition_id__in=ids).select_related("store","issued_by__user")); issue_ids=[x.pk for x in issues]
        issue_items=list(StockIssueItem.objects.filter(issue_id__in=issue_ids).select_related("item","unit"))
        grns=[]; grn_items=[]
        if is_keeper(request.user) or request.user.is_superuser or has_role(request.user,"System Administrator"):
            from apps.procurement.models import GoodsReceiptItem, GoodsReceiptNote
            rs=list(GoodsReceiptNote.objects.filter(items__store_id__in=store_ids).select_related("purchase_order__supplier","purchase_order__store","received_by__user").distinct().order_by("-created_at"))
            for g in rs:
                grns.append({"id":str(g.pk),"grn_number":g.grn_number,"lpo_number":g.purchase_order.lpo_number or g.purchase_order.po_number,"supplier_name":g.purchase_order.supplier.name,"supplier_invoice_no":g.supplier_invoice_no,"received_by_name":ename(g.received_by),"received_date":g.received_date,"status":g.status})
            for x in GoodsReceiptItem.objects.filter(goods_receipt_id__in=[g.pk for g in rs]).select_related("item","store","purchase_order_item__unit").prefetch_related("inspection_items"):
                ol=x.purchase_order_item; previous=sum((z.committed_purchase_quantity for z in ol.receipt_items.exclude(pk=x.pk).exclude(goods_receipt__status=GoodsReceiptStatus.CANCELLED)),Decimal("0")); ordered=ol.approved_quantity or Decimal("0"); due=max(ordered-previous,Decimal("0")); ins=x.inspection_items.first(); accepted_base=ins.quantity_accepted if ins else x.base_quantity; factor=ol.conversion_factor or Decimal("1"); accepted=accepted_base/factor
                grn_items.append({"id":str(x.pk),"goods_receipt":str(x.goods_receipt_id),"item":str(x.item_id),"item_name":x.item.name,"store":str(x.store_id or ""),"store_name":str(x.store or ""),"ordered_quantity":ordered,"received_quantity":x.quantity_received,"accepted_quantity":accepted,"matches_lpo_limit":x.quantity_received<=due})
        balance_info = [
            ({
                "id": str(x.pk), "store": str(x.store_id), "item": str(x.item_id),
                "in_stock": x.available_quantity > 0,
            } if is_supervisor(request.user) else {
                "id": str(x.pk), "store": str(x.store_id), "item": str(x.item_id),
                "item_name": x.item.name, "sku": x.item.sku,
                "on_hand": x.quantity_in_stock, "reserved": x.quantity_reserved,
                "available": x.available_quantity,
                "unit": x.item.base_unit.abbreviation if x.item.base_unit_id else x.item.unit,
            })
            for x in balances
        ]
        return Response({"requests":[self._request(x) for x in requests],"lines":[self._line(x) for x in lines],"stores":[{"id":str(x.pk),"name":x.name,"branch_name":str(x.branch or "")} for x in stores],"balances":balance_info,"items":[{"id":str(x.pk),"name":x.name,"sku":x.sku,"base_unit":str(x.base_unit_id or "")} for x in items],"units":[{"id":str(x.pk),"name":x.name,"abbreviation":x.abbreviation} for x in units],"issues":[{"id":str(x.pk),"issue_no":x.issue_no,"requisition":str(x.requisition_id),"store":str(x.store_id),"store_name":x.store.name,"issued_by_name":ename(x.issued_by),"issue_date":x.issue_date,"inventory_changes_applied":x.inventory_changes_applied,"received_by":str(x.received_by_id or ""),"received_by_name":x.received_by_name,"fulfillment_status":x.fulfillment_status,"dispatched_at":x.dispatched_at,"signed_at":x.signed_at} for x in issues],"issueItems":[{"id":str(x.pk),"issue":str(x.issue_id),"item_name":x.item.name,"base_quantity":x.base_quantity,"unit_name":x.unit.abbreviation if x.unit_id else ""} for x in issue_items],"grns":grns,"grnItems":grn_items})
    @staticmethod
    def _request(r): return {"id":str(r.pk),"requisition_no":r.requisition_no,"department":str(r.department_id),"department_name":r.department.name,"store":str(r.store_id or ""),"store_name":r.store.name if r.store_id else "","requested_by":str(r.requested_by_id),"requester_name":ename(r.requested_by),"status":r.status,"purpose":r.purpose,"required_date":r.required_date,"rejection_reason":r.rejection_reason,"department_approved_at":r.department_approved_at,"approved_at":r.approved_at,"created_at":r.created_at}
    @staticmethod
    def _line(x):
        base=x.item.base_unit; return {"id":str(x.pk),"requisition":str(x.requisition_id),"item":str(x.item_id),"item_name":x.item.name,"sku":x.item.sku,"unit":str(x.unit_id or x.item.base_unit_id or ""),"unit_name":(x.unit.abbreviation or x.unit.name) if x.unit_id else ((base.abbreviation or base.name) if base else x.item.unit),"base_unit_name":(base.abbreviation or base.name) if base else x.item.unit,"quantity_requested":x.quantity_requested,"base_quantity_requested":x.base_quantity_requested,"hod_approved_quantity":x.hod_approved_quantity,"quantity_approved":x.quantity_approved,"quantity_issued":x.quantity_issued}

    @action(detail=False, methods=["post"], url_path="create-with-lines")
    def create_with_lines(self, request):
        """Create a complete supervisor draft atomically; no partially saved lines."""
        from django.core.exceptions import ValidationError as DjangoValidationError

        if not is_supervisor(request.user):
            raise PermissionDenied("Only a Department Supervisor can create a request.")
        employee = emp(request.user)
        if not employee or not employee.is_active or not employee.department_id or not employee.branch_id:
            raise PermissionDenied("An active supervisor with a department and property is required.")
        store = StoreLocation.objects.filter(
            pk=request.data.get("store"), branch_id=employee.branch_id, is_active=True
        ).first()
        if not store:
            raise ValidationError({"store": "Choose an active issuing store in your property."})
        lines = request.data.get("lines")
        if not isinstance(lines, list) or not (1 <= len(lines) <= 100):
            raise ValidationError({"lines": "Enter between 1 and 100 Article lines."})
        prepared = []
        seen = set()
        for index, line in enumerate(lines, start=1):
            if not isinstance(line, dict):
                raise ValidationError({"lines": f"Invalid Article line {index}."})
            item = Item.objects.filter(pk=line.get("item"), is_active=True).first()
            if not item:
                raise ValidationError({"lines": f"Select a valid Article on line {index}."})
            unit = UnitOfMeasure.objects.filter(pk=line.get("unit"), is_active=True).first() if line.get("unit") else item.base_unit
            if line.get("unit") and not unit:
                raise ValidationError({"lines": f"Select a valid unit on line {index}."})
            try:
                quantity = Decimal(str(line.get("quantity", "")))
            except (InvalidOperation, TypeError, ValueError):
                raise ValidationError({"lines": f"Invalid quantity on line {index}."})
            if not quantity.is_finite() or quantity <= 0:
                raise ValidationError({"lines": f"Quantity must be positive on line {index}."})
            signature = (item.pk, unit.pk if unit else None)
            if signature in seen:
                raise ValidationError({"lines": f"Duplicate Article/UOM on line {index}."})
            seen.add(signature)
            prepared.append((item, unit, quantity, str(line.get("remarks") or "")[:255]))
        try:
            with transaction.atomic():
                draft = StoreRequisition.objects.create(
                    department=employee.department, requested_by=employee,
                    store=store, purpose=str(request.data.get("purpose") or "").strip(),
                    created_by=request.user,
                )
                for item, unit, quantity, remarks in prepared:
                    detail = StoreRequisitionItem(
                        requisition=draft, item=item, unit=unit,
                        quantity_requested=quantity, remarks=remarks,
                        created_by=request.user,
                    )
                    detail.full_clean()
                    detail.save()
                if request.data.get("submit") is True:
                    draft.submit(actor=request.user)
        except DjangoValidationError as error:
            raise ValidationError(getattr(error, "message_dict", None) or error.messages)
        draft.refresh_from_db()
        return Response(self._request(draft), status=201)

    @action(detail=True,methods=["post"])
    def submit(self,request,pk=None):
        r=self.get_object(); self._supervisor_draft(r)
        if not is_supervisor(request.user): raise PermissionDenied("Only the Department Supervisor can submit this request.")
        try: r.submit(actor=request.user)
        except Exception as e: raise ValidationError(getattr(e,"message_dict",None) or getattr(e,"messages",None) or str(e))
        r.refresh_from_db(); return Response(self._request(r))
    def _hod(self,r):
        e=emp(self.request.user)
        if not(is_hod(self.request.user) and e and e.department_id==r.department_id and e.branch_id==r.requested_by.branch_id): raise PermissionDenied("Only this Department's HOD can decide the request.")
        return e
    def _cost(self,r):
        e=emp(self.request.user)
        if not(is_cost(self.request.user) and e): raise PermissionDenied("Only the Cost Controller can decide this stage.")
        if r.store_id not in set(operational_stores_for_user(self.request.user).values_list("id",flat=True)): raise PermissionDenied("Request is outside your hotel/property scope.")
        return e
    def _keeper(self,r):
        e=emp(self.request.user)
        if not (is_keeper(self.request.user) and e and e.is_active):
            raise PermissionDenied("Only an active Storekeeper can prepare transfer documents.")
        if not StoreKeeperAssignment.objects.filter(
            store_id=r.store_id, employee=e, is_active=True,
        ).exists():
            raise PermissionDenied("You must be assigned to the issuing store.")
        return e
    @staticmethod
    def _decisions(payload):
        if not isinstance(payload,list) or not payload: raise ValidationError({"items":"Confirm every Article quantity."})
        out={}
        for d in payload:
            try: out[str(d["id"])]=(Decimal(str(d.get("approved_quantity",""))),str(d.get("reason") or "").strip())
            except (KeyError,InvalidOperation,TypeError,ValueError): raise ValidationError({"items":"Invalid Article quantity decision."})
        return out

    @action(detail=True,methods=["post"],url_path="department-approve")
    def department_approve(self,request,pk=None):
        r=self.get_object(); approver=self._hod(r); decisions=self._decisions(request.data.get("items")); now=timezone.now()
        with transaction.atomic():
            locked=StoreRequisition.objects.select_for_update().get(pk=r.pk)
            if locked.status!=StoreRequisitionStatus.PENDING_DEPARTMENT_APPROVAL: raise ValidationError("Request is no longer awaiting HOD approval.")
            lines=list(locked.items.select_for_update().select_related("item")); positive=False
            for x in lines:
                qty,why=decisions.get(str(x.pk),(None,"")); ceiling=x.base_quantity_requested
                if qty is None or qty<0 or qty>ceiling: raise ValidationError({"items":f"HOD cannot exceed {ceiling} for {x.item}."})
                if qty<ceiling and not why: raise ValidationError({"items":f"Enter a reason for reducing {x.item}."})
                StoreRequisitionItem.objects.filter(pk=x.pk).update(hod_approved_quantity=qty,quantity_approved=Decimal("0"),rejection_stage="Department Head" if qty==0 else "",rejection_reason=why if qty<ceiling else "",updated_at=now); positive|=qty>0
            if not positive: raise ValidationError("Approve at least one Article or reject the request.")
            StoreRequisition.objects.filter(pk=locked.pk).update(status=StoreRequisitionStatus.SUBMITTED,department_approved_by=approver,department_approved_at=now,department_approval_comments=str(request.data.get("comments") or ""),rejection_reason="",updated_at=now)
        r.refresh_from_db(); branch=r.requested_by.branch; notify_roles(("Cost Controller",),title=f"{r.requisition_no} needs Cost Control approval",message=f"HOD approved {r.department}'s request.",hotel=branch.hotel if getattr(branch,"hotel_id",None) else None,branch=None if getattr(branch,"hotel_id",None) else branch,created_by=request.user); notify_employee(r.requested_by,title=f"{r.requisition_no} approved by HOD",message="Request moved to Cost Control.",created_by=request.user); return Response(self._request(r))
    @action(detail=True,methods=["post"],url_path="department-reject")
    def department_reject(self,request,pk=None):
        r=self.get_object(); self._hod(r); why=str(request.data.get("reason") or "").strip()
        if not why: raise ValidationError({"reason":"Enter rejection reason."})
        StoreRequisition.objects.filter(pk=r.pk,status=StoreRequisitionStatus.PENDING_DEPARTMENT_APPROVAL).update(status=StoreRequisitionStatus.REJECTED,rejection_reason=why,updated_at=timezone.now()); r.refresh_from_db(); notify_employee(r.requested_by,title=f"{r.requisition_no} rejected by HOD",message=why,created_by=request.user); return Response(self._request(r))
    @action(detail=True,methods=["post"],url_path="cost-control-approve")
    def cost_control_approve(self,request,pk=None):
        r=self.get_object(); approver=self._cost(r); decisions=self._decisions(request.data.get("items")); now=timezone.now()
        with transaction.atomic():
            locked=StoreRequisition.objects.select_for_update().select_related("store").get(pk=r.pk)
            if locked.status!=StoreRequisitionStatus.SUBMITTED: raise ValidationError("Request is no longer awaiting Cost Control.")
            lines=list(locked.items.select_for_update().select_related("item")); reservations=[]; positive=False
            for x in lines:
                qty,why=decisions.get(str(x.pk),(None,"")); ceiling=x.department_approved_limit
                if qty is None or qty<0 or qty>ceiling: raise ValidationError({"items":f"Cost Control cannot exceed HOD-approved {ceiling} for {x.item}."})
                if qty<ceiling and not why: raise ValidationError({"items":f"Enter a reason for reducing {x.item}."})
                if qty>0:
                    b,_=InventoryBalance.objects.select_for_update().get_or_create(item=x.item,store=locked.store,defaults={"quantity_in_stock":Decimal("0")})
                    if b.available_quantity<qty: raise ValidationError({"items":f"{x.item} has only {b.available_quantity} available in {locked.store}."})
                    reservations.append((b,qty)); positive=True
                StoreRequisitionItem.objects.filter(pk=x.pk).update(quantity_approved=qty,rejection_stage="Cost Controller" if qty==0 else "",rejection_reason=why if qty<ceiling else "",updated_at=now)
            if not positive: raise ValidationError("Approve at least one Article or reject the request.")
            for b,qty in reservations: b.quantity_reserved+=qty; b.save(update_fields=["quantity_reserved","updated_at"])
            StoreRequisition.objects.filter(pk=locked.pk).update(status=StoreRequisitionStatus.APPROVED,approved_by=approver,approved_at=now,approval_comments=str(request.data.get("comments") or ""),rejection_reason="",updated_at=now)
        r.refresh_from_db(); branch=r.store.branch; notify_roles(("Store Keeper",),title=f"{r.requisition_no} approved for Stores",message="Prepare transfer document and reserved Articles for pickup.",hotel=branch.hotel if getattr(branch,"hotel_id",None) else None,branch=None if getattr(branch,"hotel_id",None) else branch,created_by=request.user); return Response(self._request(r))
    @action(detail=True,methods=["post"],url_path="cost-control-reject")
    def cost_control_reject(self,request,pk=None):
        r=self.get_object(); self._cost(r); why=str(request.data.get("reason") or "").strip()
        if not why: raise ValidationError({"reason":"Enter Cost Control rejection reason."})
        StoreRequisition.objects.filter(pk=r.pk,status=StoreRequisitionStatus.SUBMITTED).update(status=StoreRequisitionStatus.REJECTED,rejection_reason=why,updated_at=timezone.now()); r.refresh_from_db(); notify_employee(r.requested_by,title=f"{r.requisition_no} rejected by Cost Control",message=why,created_by=request.user); notify_roles(("Department Head",),title=f"{r.requisition_no} rejected by Cost Control",message=why,branch=r.requested_by.branch,department=r.department,created_by=request.user); return Response(self._request(r))
    @action(detail=True, methods=["post"], url_path="send-to-procurement")
    def send_to_procurement(self, request, pk=None):
        """Storekeeper forwards only HOD-approved, physically unavailable goods."""
        r=self.get_object()
        keeper=self._keeper(r)
        decisions=self._decisions(request.data.get("items"))
        with transaction.atomic():
            locked=StoreRequisition.objects.select_for_update().get(pk=r.pk)
            if locked.status != StoreRequisitionStatus.SUBMITTED or not locked.department_approved_at:
                raise ValidationError("Only HOD-approved requests can be forwarded to Procurement.")
            if locked.procurement_requisition_id:
                raise ValidationError("This request already has a linked purchase requisition.")
            lines=list(locked.items.select_for_update().select_related("item"))
            if set(decisions) != {str(x.pk) for x in lines}:
                raise ValidationError({"items":"Confirm the Storekeeper quantity for every Article."})
            now=timezone.now()
            confirmed=False
            for line in lines:
                qty,why=decisions[str(line.pk)]
                if not qty.is_finite() or qty<0 or qty>line.department_approved_limit:
                    raise ValidationError({"items":f"Storekeeper quantity for {line.item} exceeds the HOD limit."})
                if qty<line.department_approved_limit and not why:
                    raise ValidationError({"items":f"Explain any reduction for {line.item}."})
                StoreRequisitionItem.objects.filter(pk=line.pk).update(
                    quantity_approved=qty,storekeeper_comment=why,updated_at=now,
                )
                confirmed |= qty>0
            if not confirmed:
                raise ValidationError("At least one Article must have a confirmed quantity.")
            purchase=locked.create_procurement_requisition(
                created_by=request.user,
                reason=str(request.data.get("reason") or "").strip(),
            )
        from apps.procurement.serializers import PurchaseRequisitionSerializer
        return Response(PurchaseRequisitionSerializer(purchase,context=self.get_serializer_context()).data)

    @action(detail=False, methods=["get"], url_path="fulfillment-queue")
    def fulfillment_queue(self, request):
        if not is_keeper(request.user):
            raise PermissionDenied("Only a Storekeeper may see the dispatch console.")
        employee = emp(request.user)
        assigned = list(StoreKeeperAssignment.objects.filter(
            employee=employee, is_active=True, store__is_active=True,
        ).values_list("store_id", flat=True))
        qs = StoreRequisition.objects.select_related("department", "store").filter(
            store_id__in=assigned,
            status__in=(
                StoreRequisitionStatus.APPROVED,
                StoreRequisitionStatus.PARTIALLY_ISSUED,
                StoreRequisitionStatus.AWAITING_PROCUREMENT,
            ),
        ).order_by("created_at")
        records = []
        for req in qs:
            active = req.stock_issues.filter(
                fulfillment_status=StockIssue.STATUS_TRANSIT
            ).first()
            if active:
                continue
            lines = list(req.items.select_related("item__base_unit").order_by("item__name"))
            balances = {
                balance.item_id: balance
                for balance in InventoryBalance.objects.filter(
                    store=req.store, item_id__in=[line.item_id for line in lines]
                )
            }
            details = []
            for line in lines:
                due = max(line.quantity_approved - line.quantity_issued, Decimal("0"))
                if due <= 0:
                    continue
                balance = balances.get(line.item_id)
                available = balance.quantity_in_stock if balance else Decimal("0")
                details.append({
                    "id": str(line.pk), "item": str(line.item_id),
                    "article": line.item.name, "sku": line.item.sku,
                    "unit": line.item.base_unit.abbreviation if line.item.base_unit_id else line.item.unit,
                    "bin": balance.bin_location if balance else "",
                    "requested": str(line.base_quantity_requested),
                    "approved": str(line.quantity_approved),
                    "outstanding": str(due),
                    "physical_soh": str(available),
                    "suggested_issue": str(min(available, due)),
                })
            if details:
                details.sort(key=lambda x: (x["bin"] or "ZZZ", x["sku"]))
                records.append({
                    "id": str(req.pk), "reference": req.requisition_no,
                    "department": str(req.department), "store": req.store.name,
                    "status": req.status, "required_date": req.required_date,
                    "lines": details,
                })
        return Response(records)

    @action(detail=False, methods=["post"], url_path="dispatch-batch")
    def dispatch_batch(self, request):
        if not is_keeper(request.user):
            raise PermissionDenied("Only Storekeepers can dispatch requisitions.")
        batches = request.data.get("requests")
        if not isinstance(batches, list) or not (1 <= len(batches) <= 25):
            raise ValidationError({"requests": "Select between 1 and 25 approved requisitions."})
        ids = [str(value.get("id")) for value in batches if isinstance(value, dict)]
        if len(ids) != len(batches) or len(set(ids)) != len(ids):
            raise ValidationError({"requests": "Each selected requisition must appear exactly once."})
        results = []
        try:
            with transaction.atomic():
                for record in sorted(batches, key=lambda value: str(value["id"])):
                    issue = fulfill_requisition(
                        record["id"], emp(request.user), request.user,
                        quantities=record.get("quantities"),
                    )
                    results.append({
                        "id": str(issue.pk), "issue_no": issue.issue_no,
                        "requisition": str(issue.requisition_id),
                        "status": issue.fulfillment_status,
                    })
        except DjangoValidationError as error:
            raise ValidationError(getattr(error, "message_dict", None) or error.messages)
        return Response(results, status=201)

    @action(detail=True, methods=["post"], url_path="dispatch-transfer")
    def dispatch_transfer(self, request, pk=None):
        req = self.get_object()
        try:
            issue = fulfill_requisition(
                req.pk, emp(request.user), request.user,
                quantities=request.data.get("quantities"),
            )
        except DjangoValidationError as error:
            raise ValidationError(getattr(error, "message_dict", None) or error.messages)
        return Response({
            "id": str(issue.pk), "issue_no": issue.issue_no,
            "requisition": str(req.pk), "status": issue.fulfillment_status,
        }, status=201)

    @action(detail=True,methods=["post"],url_path="prepare-transfer")
    def prepare_transfer(self,request,pk=None):
        r=self.get_object(); keeper=self._keeper(r)
        if r.status not in (StoreRequisitionStatus.APPROVED,StoreRequisitionStatus.PARTIALLY_ISSUED): raise ValidationError("Only Cost-Control-approved requests can be prepared.")
        issue=r.stock_issues.filter(inventory_changes_applied=False).order_by("-created_at").first(); created=False
        if not issue:
            with transaction.atomic():
                # Lock only requisition-item rows. Item.base_unit is nullable,
                # and PostgreSQL rejects FOR UPDATE when that outer-joined
                # relation is included in the locking query.
                lines=list(r.items.select_for_update().filter(quantity_approved__gt=0).order_by("pk")); prepared=[]
                for x in lines:
                    due=x.outstanding_quantity
                    if due<=0: continue
                    b=InventoryBalance.objects.select_for_update().filter(item=x.item,store=r.store).first(); on_hand=b.quantity_in_stock if b else Decimal("0")
                    if on_hand<due: raise ValidationError({"stock":f"{x.item}: {on_hand} on hand, {due} required."})
                    prepared.append((x,due))
                if not prepared: raise ValidationError("No approved outstanding stock to prepare.")
                issue=StockIssue.objects.create(requisition=r,store=r.store,issued_by=keeper,fulfillment_status=StockIssue.STATUS_PACKED,note=f"Transfer packed for {r.department}; awaiting dispatch.",created_by=request.user)
                for x,due in prepared: StockIssueItem.objects.create(issue=issue,requisition_item=x,item=x.item,unit=x.item.base_unit,quantity=due,created_by=request.user)
                created=True
        if created:
            notify_roles(("Department Head",),title=f"{r.requisition_no} is ready for pickup",message=f"Stores prepared {issue.issue_no}. Approved Articles are ready at {r.store}.",branch=r.requested_by.branch,department=r.department,created_by=request.user); notify_employee(r.requested_by,title=f"{r.requisition_no} is ready for pickup",message=f"Stores prepared {issue.issue_no}; collect from {r.store}.",created_by=request.user)
        return Response({"id":str(issue.pk),"issue_no":issue.issue_no,"requisition":str(r.pk),"store":str(issue.store_id),"store_name":issue.store.name,"issued_by_name":ename(issue.issued_by),"issue_date":issue.issue_date,"inventory_changes_applied":issue.inventory_changes_applied,"created":created,"items":[{"id":str(x.pk),"issue":str(issue.pk),"item_name":x.item.name,"base_quantity":x.base_quantity,"unit_name":x.unit.abbreviation if x.unit_id else ""} for x in issue.items.select_related("item","unit")]})
