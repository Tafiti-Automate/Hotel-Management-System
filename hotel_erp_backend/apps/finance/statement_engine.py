"""Pure calculation boundary for future property-scoped, posted GL integration.

Not a persistence or authorization layer. Callers must load only independently
verified, posted entries (including complete opening balances) from the GL.
Never use GLExport previews or operational cash flows as posted entries.
"""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Iterable

ZERO = Decimal('0.00')
CENT = Decimal('0.01')
KINDS = {'asset', 'liability', 'equity', 'revenue', 'expense'}
ACTIVITIES = {'operating', 'investing', 'financing', 'internal_transfer'}


@dataclass(frozen=True)
class Account:
    code: str
    name: str
    kind: str
    report_group: str
    is_cash: bool = False


@dataclass(frozen=True)
class Line:
    account: str
    debit: Decimal = ZERO
    credit: Decimal = ZERO


@dataclass(frozen=True)
class Journal:
    property_id: str
    source_key: str
    business_date: date
    lines: tuple[Line, ...]
    cash_activity: str | None = None
    is_opening: bool = False


def _money(value):
    if not isinstance(value, Decimal) or not value.is_finite() or value < ZERO:
        raise ValueError('Journal amounts must be finite nonnegative Decimals.')
    if value != value.quantize(CENT):
        raise ValueError('Journal amounts must have at most two decimal places.')
    return value


def calculate_statements(accounts: Iterable[Account], journals: Iterable[Journal], *,
                         property_id: str, opening_date: date, start: date, end: date):
    """Return reconciled arithmetic, not a certification of completeness.

    The opening date must precede the requested reporting interval. One verified
    opening journal plus all later posted transactions through end is required.
    A journal with multiple cash-flow activity types must be split by the caller.
    A cash transfer must net to zero across cash-equivalent accounts.
    Prior unclosed earnings are included in equity separately from current profit.
    """
    if not property_id or not opening_date < start <= end:
        raise ValueError('Invalid property or reporting dates.')
    chart = {}
    for account in accounts:
        if (not account.code or account.code in chart or account.kind not in KINDS
                or not account.report_group or (account.is_cash and account.kind != 'asset')):
            raise ValueError('Invalid or duplicate chart account.')
        chart[account.code] = account
    if not chart or not any(a.is_cash for a in chart.values()):
        raise ValueError('A chart with explicit cash-equivalent accounts is required.')
    opening = {code: ZERO for code in chart}
    ending = opening.copy()
    movement = opening.copy()
    activities = {kind: ZERO for kind in ACTIVITIES - {'internal_transfer'}}
    seen = set()
    opening_count = 0
    for journal in journals:
        if journal.property_id != property_id:
            raise ValueError('Cross-property journal rejected.')
        if not journal.source_key or journal.source_key in seen:
            raise ValueError('Missing or duplicate journal source key.')
        seen.add(journal.source_key)
        if not opening_date <= journal.business_date <= end:
            raise ValueError('Journal outside supplied ledger coverage.')
        if len(journal.lines) < 2:
            raise ValueError('A journal requires at least two lines.')
        if journal.is_opening:
            opening_count += 1
            if journal.business_date != opening_date or journal.cash_activity is not None:
                raise ValueError('Opening balances require the designated opening date.')
        elif journal.business_date == opening_date:
            raise ValueError('Opening date is reserved for the opening balance journal.')
        debit = credit = cash_delta = ZERO
        for line in journal.lines:
            if line.account not in chart:
                raise ValueError('Unknown account.')
            d, c = _money(line.debit), _money(line.credit)
            if (d > ZERO) == (c > ZERO):
                raise ValueError('Each line must contain exactly one positive side.')
            account = chart[line.account]
            if journal.is_opening and account.kind in {'revenue', 'expense'}:
                raise ValueError('Opening balances must use balance-sheet accounts.')
            debit += d
            credit += c
            delta = d - c
            ending[line.account] += delta
            if journal.business_date < start:
                opening[line.account] += delta
            else:
                movement[line.account] += delta
            if account.is_cash:
                cash_delta += delta
        if debit != credit:
            raise ValueError('Unbalanced journal.')
        if not journal.is_opening:
            if journal.cash_activity is not None and journal.cash_activity not in ACTIVITIES:
                raise ValueError('Unknown cash flow classification.')
            if cash_delta and journal.cash_activity not in activities:
                raise ValueError('Cash movement must have an operating, investing or financing classification.')
            if not cash_delta and journal.cash_activity in activities:
                raise ValueError('Zero net cash movement must not be classified as a cash flow.')
            if journal.business_date >= start and cash_delta:
                activities[journal.cash_activity] += cash_delta
    if opening_count != 1:
        raise ValueError('Exactly one verified opening-balance journal is required.')

    def grouped(balances, kinds):
        result = {}
        for code, value in balances.items():
            a = chart[code]
            if a.kind in kinds:
                group = (a.kind, a.report_group)
                signed = -value if a.kind in {'revenue', 'liability', 'equity'} else value
                result[group] = result.get(group, ZERO) + signed
        return result

    def profit(balances):
        return -sum((v for code, v in balances.items() if chart[code].kind in {'revenue', 'expense'}), ZERO)

    def cash(balances):
        return sum((v for code, v in balances.items() if chart[code].is_cash), ZERO)

    def total(kind):
        sign = -1 if kind in {'liability', 'equity'} else 1
        return sign * sum((v for code, v in ending.items() if chart[code].kind == kind), ZERO)

    prior_profit, period_profit = profit(opening), profit(movement)
    assets, liabilities, equity = total('asset'), total('liability'), total('equity')
    equity += prior_profit + period_profit
    opening_cash, closing_cash = cash(opening), cash(ending)
    cash_movement = sum(activities.values(), ZERO)
    return {
        'status': 'arithmetic_only_not_certified',
        'trial_balance': {code: {'debit': max(v, ZERO), 'credit': max(-v, ZERO)} for code, v in ending.items()},
        'profit_and_loss': {'groups': grouped(movement, {'revenue', 'expense'}), 'net_profit': period_profit},
        'balance_sheet': {'groups': grouped(ending, {'asset', 'liability', 'equity'}),
                          'assets': assets, 'liabilities': liabilities, 'equity': equity,
                          'prior_unclosed_earnings': prior_profit, 'period_profit': period_profit,
                          'difference': assets - liabilities - equity},
        'cash_flow_direct': {'opening_cash': opening_cash, **activities, 'net_movement': cash_movement,
                             'closing_cash': closing_cash,
                             'difference': closing_cash - opening_cash - cash_movement},
    }
