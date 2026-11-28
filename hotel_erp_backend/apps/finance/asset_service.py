from collections import defaultdict
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from apps.departments.models import Branch
from .asset_models import FixedAsset, AssetDepreciation
from .asset_calculation import ZERO, month_end, next_month_end, monthly_charge
from .ledger_models import LedgerAccount, LedgerJournal, LedgerLine
from .ledger_service import _scope, _period, prepare_journal


@transaction.atomic
def register_asset(*, actor, branch_id, cost_account, accumulated_account, expense_account, **values):
    _scope(actor, branch_id, ('Financial Manager',))
    Branch.objects.select_for_update().get(pk=branch_id)
    opening = LedgerJournal.objects.filter(branch_id=branch_id, status='posted', is_opening=True).first()
    if not opening or values['opening_date'] != opening.business_date or month_end(opening.business_date) != opening.business_date:
        raise ValidationError('Register assets against the posted GL opening date at a month end.')
    accounts = []
    for code, kind in ((cost_account, 'asset'), (accumulated_account, 'asset'), (expense_account, 'expense')):
        account = LedgerAccount.objects.filter(branch_id=branch_id, code=code, kind=kind, is_active=True, is_cash=False).first()
        if not account:
            raise ValidationError('Select valid noncash property ledger accounts.')
        accounts.append(account)
    if len({a.pk for a in accounts}) != 3:
        raise ValidationError('Select three distinct ledger accounts.')
    existing = FixedAsset.objects.filter(branch_id=branch_id)
    if existing.filter(accumulated_account=accounts[0]).exists() or existing.filter(cost_account=accounts[1]).exists():
        raise ValidationError('Cost and accumulated depreciation accounts cannot be interchanged.')
    try:
        monthly_charge(values['cost'], values['opening_depreciation'], values['residual_value'], values['annual_rate'])
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    asset = FixedAsset(branch_id=branch_id, created_by=actor, cost_account=accounts[0],
                       accumulated_account=accounts[1], expense_account=accounts[2], **values)
    asset.full_clean()
    asset.save(force_insert=True)
    return asset


@transaction.atomic
def prepare_depreciation(*, actor, branch_id, asset_id, period_end):
    _scope(actor, branch_id)
    Branch.objects.select_for_update().get(pk=branch_id)
    asset = FixedAsset.objects.select_for_update().filter(branch_id=branch_id, pk=asset_id).first()
    if not asset:
        raise ValidationError('Asset not found in assigned property.')
    if month_end(period_end) != period_end or period_end > timezone.localdate():
        raise ValidationError('Use a completed calendar month end.')
    period = _period(branch_id, period_end)
    if period.end_date != period_end or period.start_date != period_end.replace(day=1):
        raise ValidationError('Depreciation requires an open full-month fiscal period.')
    prior = list(asset.depreciations.select_related('journal').order_by('period_end'))
    if any(d.journal.status != 'posted' for d in prior):
        raise ValidationError('Post the pending depreciation journal first.')
    last = prior[-1].period_end if prior else asset.opening_date
    if period_end != next_month_end(last):
        raise ValidationError('Prepare depreciation sequentially, one month at a time.')
    accumulated = asset.opening_depreciation + sum((d.amount for d in prior), ZERO)
    amount = monthly_charge(asset.cost, accumulated, asset.residual_value, asset.annual_rate)
    if amount <= 0:
        raise ValidationError('No depreciation due under the registered policy.')
    journal = prepare_journal(actor=actor, branch_id=branch_id,
        source_key=f'asset-dep:{asset.pk}:{period_end.isoformat()}', business_date=period_end,
        evidence=f'Monthly straight-line depreciation: {asset.tag} — {asset.evidence}',
        lines=[(asset.expense_account.code, amount, ZERO), (asset.accumulated_account.code, ZERO, amount)])
    return AssetDepreciation.objects.create(asset=asset, period_end=period_end, amount=amount, journal=journal)


@transaction.atomic
def asset_report(*, actor, branch_id, start, end):
    _scope(actor, branch_id)
    Branch.objects.select_for_update().get(pk=branch_id)
    if start > end:
        raise ValidationError('Start date must not exceed end date.')
    assets = FixedAsset.objects.filter(branch_id=branch_id, opening_date__lte=end).prefetch_related('depreciations__journal').order_by('category', 'tag')
    detail, totals, expected = [], {}, defaultdict(lambda: ZERO)
    keys = ('gross_cost','depreciation_brought_forward','current_depreciation','accumulated_depreciation','net_book_value')
    for a in assets:
        if a.opening_date >= start:
            raise ValidationError('Report start must follow the registered opening date.')
        posted = [d for d in a.depreciations.all() if d.journal.status == 'posted' and d.period_end <= end]
        before = a.opening_depreciation + sum((d.amount for d in posted if d.period_end < start), ZERO)
        current = sum((d.amount for d in posted if d.period_end >= start), ZERO)
        accumulated = before + current
        pending = [d for d in a.depreciations.all() if d.journal.status != 'posted']
        last = max((d.period_end for d in a.depreciations.all() if d.journal.status == 'posted'), default=a.opening_date)
        vals = (a.cost, before, current, accumulated, a.cost - accumulated)
        detail.append({'id': str(a.pk), 'tag': a.tag, 'name': a.name, 'category': a.get_category_display(),
            'annual_rate': str(a.annual_rate), **dict(zip(keys,map(str,vals))),
            'next_month_end': next_month_end(last).isoformat(), 'pending_journal': str(pending[0].journal_id) if pending else ''})
        group = totals.setdefault(a.get_category_display(), [ZERO] * 5)
        for i, value in enumerate(vals):
            group[i] += value
        expected[a.cost_account_id] += a.cost
        expected[a.accumulated_account_id] -= accumulated
    ledger = defaultdict(lambda: ZERO)
    for line in LedgerLine.objects.filter(journal__branch_id=branch_id, journal__status='posted',
            journal__business_date__lte=end, account_id__in=expected).values('account_id','debit','credit'):
        ledger[line['account_id']] += line['debit'] - line['credit']
    reconciliation = [{'account': a.code, 'register': str(expected[a.pk]), 'ledger': str(ledger[a.pk]),
                       'difference': str(expected[a.pk] - ledger[a.pk])}
                      for a in LedgerAccount.objects.filter(branch_id=branch_id, pk__in=expected).order_by('code')]
    schedule = [{'category': k, **dict(zip(keys,map(str,v)))} for k,v in totals.items()]
    if totals:
        schedule.append({'category': 'TOTAL', **dict(zip(keys,map(str,[sum((v[i] for v in totals.values()), ZERO) for i in range(5)])))})
    return {'fixed_assets': schedule, 'asset_register': detail, 'asset_reconciliation': reconciliation,
            'notices': [{'label': 'Opening register and posted depreciation only. Additions, revaluations and disposals are not supported yet. Reconciliation covers mapped accounts only.'}]}
