from datetime import date
from decimal import Decimal as D
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import PermissionDenied, ValidationError
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.materials_control.models import FiscalPeriod
from apps.finance.ledger_models import LedgerJournal
from apps.finance.ledger_service import create_account, prepare_journal, approve_journal, post_journal, posted_statements


@pytest.mark.django_db
def test_gl_authorized_workflow():
    branch = Branch.objects.create(name='Ledger Hotel')
    foreign = Branch.objects.create(name='Foreign Ledger Hotel')
    dept = Department.objects.create(name='Ledger Audit')
    def actor(role, prop, key):
        u = get_user_model().objects.create_user(username=key, employee_code=key, password='test-only')
        u.groups.add(Group.objects.get_or_create(name=role)[0])
        Employee.objects.create(user=u, branch=prop, department=dept, designation=role)
        return u
    maker = actor('Cost Controller', branch, 'gl-maker')
    manager = actor('Financial Manager', branch, 'gl-finance')
    approver = actor('General Manager', branch, 'gl-gm')
    outsider = actor('Financial Manager', foreign, 'gl-foreign')
    admin = actor('System Administrator', branch, 'gl-admin')
    period = FiscalPeriod.objects.create(branch=branch, name='April', start_date=date(2026,4,1), end_date=date(2026,4,30))
    for code, kind in [('cash', 'asset'), ('capital', 'equity'), ('sales', 'revenue')]:
        create_account(actor=manager, branch_id=branch.pk, code=code, name=code, kind=kind, report_group=code, is_cash=code=='cash')
    args = dict(branch_id=branch.pk, source_key='verified-opening', business_date=date(2026,4,1), evidence='Approved opening trial balance', lines=[('cash', D('100'), D('0')), ('capital', D('0'), D('100'))], is_opening=True)
    with pytest.raises(PermissionDenied):
        prepare_journal(actor=outsider, **args)
    opening = prepare_journal(actor=maker, **args)
    key = dict(branch_id=branch.pk, journal_id=opening.pk)
    with pytest.raises(ValidationError):
        post_journal(actor=manager, **key)
    with pytest.raises(PermissionDenied):
        approve_journal(actor=maker, **key)
    with pytest.raises(ValidationError):
        prepare_journal(actor=maker, **args)
    approve_journal(actor=approver, **key)
    post_journal(actor=manager, **key)
    with pytest.raises(ValidationError):
        post_journal(actor=manager, **key)
    sale = prepare_journal(actor=maker, branch_id=branch.pk, source_key='sale-1', business_date=date(2026,4,2), evidence='receipt 1', lines=[('cash',D('20'),D('0')),('sales',D('0'),D('20'))], cash_activity='operating')
    report_args = dict(branch_id=branch.pk, start=date(2026,4,2), end=date(2026,4,30))
    assert posted_statements(actor=maker, **report_args)['profit_and_loss']['net_profit'] == D('0')
    for forbidden in (outsider, admin):
        with pytest.raises(PermissionDenied):
            posted_statements(actor=forbidden, **report_args)
    approve_journal(actor=approver, branch_id=branch.pk, journal_id=sale.pk)
    period.status = FiscalPeriod.STATUS_CLOSED
    period.save(update_fields=['status'])
    with pytest.raises(ValidationError):
        post_journal(actor=manager, branch_id=branch.pk, journal_id=sale.pk)
    assert LedgerJournal.objects.filter(status='posted').count() == 1
