from datetime import date
from decimal import Decimal as D
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError, PermissionDenied
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.materials_control.models import FiscalPeriod
from apps.finance.ledger_service import create_account, prepare_journal, approve_journal, post_journal
from apps.finance.reconciliation_service import prepare_reconciliation, confirm_reconciliation, reconciliation_register


@pytest.mark.django_db
def test_reconciliation_snapshot_and_independent_confirmation():
    branch = Branch.objects.create(name='Reconciliation property')
    foreign = Branch.objects.create(name='Other reconciliation property')
    dept = Department.objects.create(name='Reconciliation department')
    def actor(key, role, prop):
        u = get_user_model().objects.create_user(username=key, employee_code=key, password='test-only')
        u.groups.add(Group.objects.get_or_create(name=role)[0])
        Employee.objects.create(user=u, branch=prop, department=dept, designation=role)
        return u
    maker = actor('recon-maker','Cost Controller',branch)
    manager = actor('recon-finance','Financial Manager',branch)
    gm = actor('recon-gm','General Manager',branch)
    outsider = actor('recon-other','Financial Manager',foreign)
    args = {'branch_id':branch.pk}
    FiscalPeriod.objects.create(branch=branch,name='April',start_date=date(2026,4,1),end_date=date(2026,4,30))
    for code,kind in [('cash','asset'),('capital','equity'),('sales','revenue')]:
        create_account(actor=manager,**args,code=code,name=code,kind=kind,report_group=code,is_cash=code=='cash')
    def post(key, day, lines, opening=False, activity=''):
        j = prepare_journal(actor=maker,**args,source_key=key,business_date=day,evidence='Verified test evidence',lines=lines,is_opening=opening,cash_activity=activity)
        approve_journal(actor=gm,**args,journal_id=j.pk)
        post_journal(actor=manager,**args,journal_id=j.pk)
    post('opening',date(2026,4,1),[('cash',D('100'),D('0')),('capital',D('0'),D('100'))],True)
    payload = dict(**args,account_code='cash',as_of=date(2026,4,30),source_type='bank',source_balance=D('100'),evidence='Bank statement')
    entry = prepare_reconciliation(actor=manager,**payload)
    with pytest.raises(ValidationError):
        confirm_reconciliation(actor=manager,**args,entry_id=entry.pk)
    with pytest.raises(PermissionDenied):
        confirm_reconciliation(actor=outsider,**args,entry_id=entry.pk)
    confirm_reconciliation(actor=gm,**args,entry_id=entry.pk)
    report_args = dict(**args,start=date(2026,4,1),end=date(2026,4,30))
    assert reconciliation_register(actor=maker,**report_args)[0]['status']=='confirmed'
    post('sale',date(2026,4,2),[('cash',D('20'),D('0')),('sales',D('0'),D('20'))],activity='operating')
    assert reconciliation_register(actor=maker,**report_args)[0]['status']=='stale'
    new = prepare_reconciliation(actor=maker,**payload)
    with pytest.raises(ValidationError):
        confirm_reconciliation(actor=gm,**args,entry_id=new.pk)
