from decimal import Decimal

from django.core.exceptions import ValidationError

from apps.materials_control.models import BudgetOverride, CostCenterBudget, FiscalPeriod


def enforce_requisition_budget(requisition):
    if not requisition.branch_id or not requisition.department_id:
        return None
    budget = CostCenterBudget.objects.filter(
        branch_id=requisition.branch_id,
        department_id=requisition.department_id,
        period_month__year=requisition.expected_date.year,
        period_month__month=requisition.expected_date.month,
        is_active=True,
    ).first()
    if not budget:
        return None
    projected = budget.committed_spend + requisition.estimated_total
    if projected <= budget.spending_cap:
        return None
    overage = (projected - budget.spending_cap).quantize(Decimal("0.01"))
    override, created = BudgetOverride.objects.get_or_create(
        requisition=requisition,
        defaults={
            "budget": budget,
            "requested_amount": requisition.estimated_total,
            "overage_amount": overage,
            "reason": requisition.reason,
            "created_by": requisition.created_by,
        },
    )
    if not created and (
        override.budget_id != budget.pk
        or override.requested_amount != requisition.estimated_total
        or override.overage_amount != overage
    ):
        # An old decision cannot approve a higher amount or another budget.
        override.budget = budget
        override.requested_amount = requisition.estimated_total
        override.overage_amount = overage
        override.reason = requisition.reason
        override.status = BudgetOverride.STATUS_PENDING
        override.decided_by = None
        override.decided_at = None
        override.decision_note = ""
        override.save(update_fields=(
            "budget", "requested_amount", "overage_amount", "reason", "status",
            "decided_by", "decided_at", "decision_note", "updated_at",
        ))
    if override.status == BudgetOverride.STATUS_APPROVED:
        return override
    if override.status == BudgetOverride.STATUS_REJECTED:
        raise ValidationError("The Financial Controller rejected this over-budget request.")
    if budget.enforce_hard_block:
        raise ValidationError(
            f"Budget hard block: this request exceeds the remaining budget by {overage}."
        )
    raise ValidationError(
        f"This request is over budget by {overage} and requires Financial Controller override."
    )


def assert_period_open(branch_id, transaction_date):
    if not branch_id or not transaction_date:
        return
    closed = FiscalPeriod.objects.filter(
        branch_id=branch_id,
        start_date__lte=transaction_date,
        end_date__gte=transaction_date,
        status=FiscalPeriod.STATUS_CLOSED,
    ).first()
    if closed:
        raise ValidationError(
            f"Fiscal period {closed.name} is closed; transactions dated {transaction_date} are locked."
        )

