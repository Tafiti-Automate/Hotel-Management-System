"""Property-scoped manual GL foundation. No operational source is auto-posted yet."""
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone
from apps.departments.models import Branch
from apps.materials_control.models import FiscalPeriod
from .ledger_models import LedgerAccount, LedgerJournal, LedgerLine
from .ledger_validation import validate_lines
from .statement_engine import Account, Line, Journal, calculate_statements

REPORT_ROLES = frozenset(('Cost Controller', 'Financial Manager', 'General Manager'))


def _scope(actor, branch_id, roles=REPORT_ROLES):
    employee = getattr(actor, 'employee_profile', None)
    if (not getattr(actor, 'is_authenticated', False) or not actor.is_active
            or not employee or not employee.is_active or str(employee.branch_id) != str(branch_id)
            or not actor.groups.filter(name__in=roles).exists()
            or not Branch.objects.filter(pk=branch_id, is_active=True).exists()):
        raise PermissionDenied('Financial role and active property assignment required.')


def _period(branch_id, business_date):
    periods = list(FiscalPeriod.objects.select_for_update().filter(branch_id=branch_id,
                   start_date__lte=business_date, end_date__gte=business_date))
    if len(periods) != 1 or periods[0].status != FiscalPeriod.STATUS_OPEN:
        raise ValidationError('Exactly one open fiscal period is required.')
    return periods[0]


def _validate(rows, opening, activity):
    try:
        validate_lines([(a.kind, a.is_cash, d, c) for a, d, c in rows],
                       is_opening=opening, cash_activity=activity)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


@transaction.atomic
def create_account(*, actor, branch_id, code, name, kind, report_group, is_cash=False):
    _scope(actor, branch_id, ('Financial Manager',))
    Branch.objects.select_for_update().get(pk=branch_id)
    account = LedgerAccount(branch_id=branch_id, code=code.strip(), name=name.strip(),
                            kind=kind, report_group=report_group.strip(), is_cash=is_cash)
    account.full_clean()
    account.save(force_insert=True)
    return account


@transaction.atomic
def prepare_journal(*, actor, branch_id, source_key, business_date, evidence, lines,
                    is_opening=False, cash_activity=''):
    _scope(actor, branch_id)
    Branch.objects.select_for_update().get(pk=branch_id)
    period = _period(branch_id, business_date)
    source_key, evidence = source_key.strip(), evidence.strip()
    if not source_key or len(source_key) > 150 or not evidence:
        raise ValidationError('Source key and supporting evidence are required.')
    if LedgerJournal.objects.filter(branch_id=branch_id, source_key=source_key).exists():
        raise ValidationError('Source key already exists; use the existing journal.')
    rows = []
    for code, debit, credit in lines:
        account = LedgerAccount.objects.filter(branch_id=branch_id, code=code, is_active=True).first()
        if not account:
            raise ValidationError('Unknown or inactive property account.')
        rows.append((account, debit, credit))
    _validate(rows, is_opening, cash_activity)
    journal = LedgerJournal.objects.create(branch_id=branch_id, period=period, source_key=source_key,
        business_date=business_date, evidence=evidence, cash_activity=cash_activity,
        is_opening=is_opening, prepared_by=actor)
    LedgerLine.objects.bulk_create([LedgerLine(journal=journal, account=a, debit=d, credit=c) for a,d,c in rows])
    return journal


def _locked_journal(actor, branch_id, journal_id, roles):
    _scope(actor, branch_id, roles)
    Branch.objects.select_for_update().get(pk=branch_id)
    journal = LedgerJournal.objects.select_for_update().filter(branch_id=branch_id, pk=journal_id).first()
    if not journal:
        raise ValidationError('Journal not found in assigned property.')
    period = _period(branch_id, journal.business_date)
    if journal.period_id != period.pk:
        raise ValidationError('Fiscal period mismatch.')
    rows = [(line.account, line.debit, line.credit) for line in journal.lines.select_related('account')]
    if any(a.branch_id != journal.branch_id or not a.is_active for a, _, _ in rows):
        raise ValidationError('Cross-property or inactive journal account.')
    _validate(rows, journal.is_opening, journal.cash_activity)
    return journal


@transaction.atomic
def approve_journal(*, actor, branch_id, journal_id):
    journal = _locked_journal(actor, branch_id, journal_id, ('General Manager',))
    if journal.status != 'draft' or journal.prepared_by_id == actor.pk:
        raise ValidationError('An independent approver must approve a draft.')
    journal.status, journal.approved_by, journal.approved_at = 'approved', actor, timezone.now()
    journal.save(update_fields=('status', 'approved_by', 'approved_at'))
    return journal


@transaction.atomic
def post_journal(*, actor, branch_id, journal_id):
    journal = _locked_journal(actor, branch_id, journal_id, ('Financial Manager',))
    if (journal.status != 'approved' or not journal.approved_by_id or not journal.approved_at
            or journal.prepared_by_id == journal.approved_by_id or journal.approved_by_id == actor.pk):
        raise ValidationError('Independent approval is required before posting.')
    posted = LedgerJournal.objects.filter(branch_id=branch_id, status='posted')
    opening = posted.filter(is_opening=True).first()
    if journal.is_opening:
        if posted.exists():
            raise ValidationError('Opening balance must precede all posted journals.')
    elif not opening or journal.business_date <= opening.business_date:
        raise ValidationError('Post a verified opening balance dated before this journal first.')
    journal.status, journal.posted_by, journal.posted_at = 'posted', actor, timezone.now()
    journal.save(update_fields=('status', 'posted_by', 'posted_at'))
    return journal


@transaction.atomic
def posted_statements(*, actor, branch_id, start, end):
    _scope(actor, branch_id)
    Branch.objects.select_for_update().get(pk=branch_id)
    chart = [Account(a.code, a.name, a.kind, a.report_group, a.is_cash)
             for a in LedgerAccount.objects.filter(branch_id=branch_id)]
    posted = list(LedgerJournal.objects.filter(branch_id=branch_id, status='posted', business_date__lte=end)
                  .prefetch_related('lines__account').order_by('business_date', 'id'))
    openings = [j for j in posted if j.is_opening]
    if len(openings) != 1:
        raise ValidationError('Verified opening balance required; report unavailable.')
    journals = []
    for j in posted:
        rows = list(j.lines.all())
        if any(row.account.branch_id != j.branch_id for row in rows):
            raise ValidationError('Cross-property journal data detected.')
        journals.append(Journal(str(branch_id), j.source_key, j.business_date,
            tuple(Line(row.account.code, row.debit, row.credit) for row in rows), j.cash_activity or None, j.is_opening))
    try:
        return calculate_statements(chart, journals, property_id=str(branch_id),
            opening_date=openings[0].business_date, start=start, end=end)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
