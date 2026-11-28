from datetime import date
from decimal import Decimal as D
import pytest
from apps.finance.asset_calculation import monthly_charge, next_month_end


def test_monthly_straight_line():
    assert monthly_charge(D('1200000'), D('0'), D('0'), D('4')) == D('4000.00')


def test_cap_at_residual_and_zero_rate():
    assert monthly_charge(D('1200'), D('1095'), D('100'), D('20')) == D('5')
    assert monthly_charge(D('1200'), D('0'), D('0'), D('0')) == D('0.00')


def test_invalid_policy():
    with pytest.raises(ValueError):
        monthly_charge(D('100'), D('90'), D('20'), D('4'))


def test_calendar_month_sequence():
    assert next_month_end(date(2024,1,31)) == date(2024,2,29)
    assert next_month_end(date(2026,12,31)) == date(2027,1,31)
