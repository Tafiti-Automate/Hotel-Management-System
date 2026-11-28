from hashlib import sha256
from decimal import Decimal
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from apps.departments.models import Branch
from .ledger_models import LedgerAccount, LedgerJournal, LedgerLine
from .ledger_service import _scope
from .reconciliation_models import AccountReconciliation

ZERO = Decimal('0.00')


def snapshot(account, as_of):
    # No reconciliation is meaningful until an opening balance has been posted.
    if not LedgerJournal.objects.filter(branch_id=account.branch_id, status='posted', is_opening=True,
                                        business_date__lte=as_of).exists():
        raise ValidationError('Verified opening balance required before reconciliation.')
    digest = sha256()
    total = ZERO
    rows = LedgerLine.objects.filter(account=account, journal__status='posted',
           journal__business_date__lte=as_of).order_by('pk').values_list(
               'pk','journal__branch_id','journal__business_date','debit','credit')
    for pk, branch_id, day, debit, credit in rows.iterator():
        if branch_id != account.branch_id:
            raise ValidationError('Cross-property journal data detected.')
        total += debit - credit
        digest.update(f'{pk}|{day}|{debit}|{credit}\n'.encode())
    # Display normal balance: asset debit positive, liability/equity credit positive.
    if account.kind in ('liability','equity'):
        total = -total
    return total, digest.hexdigest()


@transaction.atomic
def prepare_reconciliation(*, actor, branch_id, account_code, as_of, source_type, source_balance, evidence):
    _scope(actor, branch_id, ('Cost Controller','Financial Manager'))
    Branch.objects.select_for_update().get(pk=branch_id)
    account = LedgerAccount.objects.filter(branch_id=branch_id, code=account_code, is_active=True,
                                          kind__in=('asset','liability','equity')).first()
    if not account or as_of > timezone.localdate() or not evidence.strip():
        raise ValidationError('Select an active balance-sheet account, actual cutoff and evidence.')
    if source_type in ('bank','cash') and not account.is_cash:
        raise ValidationError('Bank or cash reconciliation requires a cash-equivalent account.')
    amount, digest = snapshot(account, as_of)
    entry = AccountReconciliation(account=account, as_of=as_of, source_type=source_type,
        source_balance=source_balance, ledger_balance=amount, ledger_digest=digest,
        evidence=evidence.strip(), prepared_by=actor)
    entry.full_clean()
    entry.save(force_insert=True)
    return entry


@transaction.atomic
def confirm_reconciliation(*, actor, branch_id, entry_id):
    _scope(actor, branch_id, ('Financial Manager','General Manager'))
    Branch.objects.select_for_update().get(pk=branch_id)
    entry = AccountReconciliation.objects.select_for_update().filter(account__branch_id=branch_id, pk=entry_id).first()
    if not entry or entry.confirmed_at or entry.prepared_by_id == actor.pk:
        raise ValidationError('A separate authorized reviewer must confirm an unconfirmed snapshot.')
    current, digest = snapshot(entry.account, entry.as_of)
    if digest != entry.ledger_digest or current != entry.ledger_balance:
        raise ValidationError('Ledger changed since preparation; prepare a new snapshot.')
    if entry.source_balance != current:
        raise ValidationError('Resolve the difference and prepare new supporting evidence first.')
    entry.confirmed_by, entry.confirmed_at = actor, timezone.now()
    entry.save(update_fields=('confirmed_by','confirmed_at'))
    return entry


@transaction.atomic
def reconciliation_register(*, actor, branch_id, start, end):
    _scope(actor, branch_id)
    Branch.objects.select_for_update().get(pk=branch_id)
    if start > end:
        raise ValidationError('Invalid date range.')
    entries = AccountReconciliation.objects.filter(account__branch_id=branch_id,
        as_of__range=(start,end)).select_related('account','prepared_by','confirmed_by').order_by('-as_of','-prepared_at')
    cache = {}
    result = []
    for e in entries:
        key = (e.account_id,e.as_of)
        if key not in cache:
            cache[key] = snapshot(e.account,e.as_of)
        current,digest = cache[key]
        stale = digest != e.ledger_digest or current != e.ledger_balance
        difference = e.source_balance - current
        status = 'stale' if stale else 'confirmed' if e.confirmed_at else 'variance' if difference else 'awaiting_review'
        result.append({'id':str(e.pk),'account':e.account.code,'as_of':e.as_of.isoformat(),
            'source_type':e.source_type,'source_balance':str(e.source_balance),'ledger_at_preparation':str(e.ledger_balance),
            'current_ledger_balance':str(current),'difference':str(difference),'status':status,
            'evidence':e.evidence,'prepared_by':e.prepared_by.get_username(),
            'confirmed_by':e.confirmed_by.get_username() if e.confirmed_by else '',
            'confirmed_at':e.confirmed_at.isoformat() if e.confirmed_at else ''})
    return result
