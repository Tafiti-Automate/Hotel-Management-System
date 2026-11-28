from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

ZERO = Decimal('0.00')


def month_end(day):
    return date(day.year, day.month, monthrange(day.year, day.month)[1])


def next_month_end(day):
    return month_end(day + timedelta(days=1))


def monthly_charge(cost, accumulated, residual, rate):
    if any(not isinstance(x, Decimal) or not x.is_finite() for x in (cost, accumulated, residual, rate)):
        raise ValueError('Finite Decimal values required.')
    if cost <= 0 or min(accumulated, residual, rate) < 0 or rate > 100 or accumulated + residual > cost:
        raise ValueError('Invalid asset cost, accumulated depreciation, residual value or rate.')
    return min(cost - accumulated - residual, (cost * rate / Decimal(1200)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
