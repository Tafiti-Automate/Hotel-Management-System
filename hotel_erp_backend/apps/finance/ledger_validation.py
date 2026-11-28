"""Pure journal validation shared by preparation and posting."""
from decimal import Decimal
from .statement_engine import ACTIVITIES, KINDS


def validate_lines(lines, *, is_opening=False, cash_activity=''):
    """Rows are (kind, is_cash, debit, credit); return balanced debit total."""
    lines = tuple(lines)
    if len(lines) < 2:
        raise ValueError('At least two lines are required.')
    if cash_activity and cash_activity not in ACTIVITIES:
        raise ValueError('Invalid cash activity.')
    debit = credit = cash = Decimal('0')
    for kind, is_cash, d, c in lines:
        if kind not in KINDS or (is_cash and kind != 'asset'):
            raise ValueError('Invalid account classification.')
        if is_opening and kind in ('revenue', 'expense'):
            raise ValueError('Opening journals use balance-sheet accounts only.')
        for value in (d, c):
            if (not isinstance(value, Decimal) or not value.is_finite() or value < 0
                    or value >= Decimal('10000000000000000') or value != value.quantize(Decimal('.01'))):
                raise ValueError('Invalid monetary amount.')
        if (d > 0) == (c > 0):
            raise ValueError('Exactly one positive side per line is required.')
        debit += d
        credit += c
        if is_cash:
            cash += d - c
    if debit != credit:
        raise ValueError('Unbalanced journal.')
    if is_opening and cash_activity:
        raise ValueError('Opening journal cannot be classified as cash flow.')
    if not is_opening:
        if cash and cash_activity not in ('operating', 'investing', 'financing'):
            raise ValueError('Classify cash movement.')
        if not cash and cash_activity in ('operating', 'investing', 'financing'):
            raise ValueError('No net cash movement to classify.')
        if cash_activity == 'internal_transfer' and not all(row[1] for row in lines):
            raise ValueError('Internal transfer must contain only cash accounts.')
    return debit
