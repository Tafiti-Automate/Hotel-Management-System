"""Restricted ledger workspace. No operational posting or invented opening balances."""
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.permissions import BasePermission
from rest_framework.exceptions import ValidationError, PermissionDenied
from rest_framework.views import APIView
from rest_framework.response import Response
from .ledger_models import LedgerAccount, LedgerJournal
from .ledger_service import REPORT_ROLES, _scope, create_account, prepare_journal, approve_journal, post_journal, posted_statements
from .statement_engine import KINDS, ACTIVITIES


class FinancialAccess(BasePermission):
    def has_permission(self, request, view):
        u = request.user
        employee = getattr(u, 'employee_profile', None)
        return bool(u.is_authenticated and u.is_active and employee and employee.is_active
                    and employee.branch_id and u.groups.filter(name__in=REPORT_ROLES).exists())


class AccountInput(serializers.Serializer):
    code = serializers.CharField(max_length=50)
    name = serializers.CharField(max_length=150)
    kind = serializers.ChoiceField(choices=sorted(KINDS))
    report_group = serializers.CharField(max_length=100)
    is_cash = serializers.BooleanField(default=False)


class LineInput(serializers.Serializer):
    account = serializers.CharField(max_length=50)
    debit = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=0, default=0)
    credit = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=0, default=0)


class JournalInput(serializers.Serializer):
    source_key = serializers.CharField(max_length=150)
    business_date = serializers.DateField()
    evidence = serializers.CharField(max_length=4000)
    lines = LineInput(many=True, min_length=2, max_length=200)
    is_opening = serializers.BooleanField(default=False)
    cash_activity = serializers.ChoiceField(choices=sorted(ACTIVITIES), allow_blank=True, default='')


class DateInput(serializers.Serializer):
    start = serializers.DateField()
    end = serializers.DateField()


def checked(call, **kwargs):
    try:
        return call(**kwargs)
    except DjangoValidationError as exc:
        raise ValidationError(exc.messages) from exc


def row(label, amount, group=''):
    return {'label': label, 'amount': str(amount), 'group': group}


def groups(items):
    return [row(label, value, kind) for (kind, label), value in sorted(items.items())]


def report_rows(result):
    pl, bs, cf = (result[k] for k in ('profit_and_loss', 'balance_sheet', 'cash_flow_direct'))
    return {
        'profit_and_loss': groups(pl['groups']) + [row('Net profit / loss', pl['net_profit'])],
        'balance_sheet': groups(bs['groups']) + [
            row('Prior unclosed earnings', bs['prior_unclosed_earnings'], 'equity'),
            row('Period profit / loss', bs['period_profit'], 'equity'),
            row('Total assets', bs['assets']), row('Total liabilities', bs['liabilities']),
            row('Total equity', bs['equity']), row('Unreconciled difference', bs['difference'])],
        'cash_flow': [row(k.replace('_', ' ').title(), v) for k, v in cf.items()],
        'trial_balance': [{'label': k, 'debit': str(v['debit']), 'credit': str(v['credit'])}
                          for k, v in sorted(result['trial_balance'].items())],
        'notices': [{'label': 'Provisional: posted internal journals only. Operational sources and opening balances must be reconciled. Cash flow uses direct classification; indirect format is not yet available.'}],
    }


class FinancialBase(APIView):
    permission_classes = [FinancialAccess]

    def scope(self, request):
        branch = request.user.employee_profile.branch_id
        supplied = request.query_params.get('branch')
        if supplied and supplied != str(branch):
            raise PermissionDenied('Financial reports are restricted to your property.')
        _scope(request.user, branch)
        return {'actor': request.user, 'branch_id': branch}


class FinancialStatements(FinancialBase):
    def get(self, request):
        scope = self.scope(request)
        data = DateInput(data=request.query_params)
        data.is_valid(raise_exception=True)
        result = checked(posted_statements, **scope, **data.validated_data)
        return Response(report_rows(result))


class FinancialAccounts(FinancialBase):
    def get(self, request):
        scope = self.scope(request)
        return Response(list(LedgerAccount.objects.filter(branch_id=scope['branch_id']).order_by('code')
                             .values('code', 'name', 'kind', 'report_group', 'is_cash', 'is_active')))

    def post(self, request):
        scope = self.scope(request)
        data = AccountInput(data=request.data)
        data.is_valid(raise_exception=True)
        account = checked(create_account, **scope, **data.validated_data)
        return Response({'id': str(account.pk), 'code': account.code}, status=201)


class FinancialJournals(FinancialBase):
    def get(self, request):
        scope = self.scope(request)
        journals = LedgerJournal.objects.filter(branch_id=scope['branch_id']).order_by('-business_date', '-created_at').prefetch_related('lines__account')[:200]
        return Response([{'id': str(j.pk), 'source_key': j.source_key, 'business_date': j.business_date,
                          'status': j.status, 'evidence': j.evidence, 'is_opening': j.is_opening,
                          'lines': [{'account': l.account.code, 'debit': str(l.debit), 'credit': str(l.credit)}
                                    for l in j.lines.all()]} for j in journals])

    def post(self, request):
        scope = self.scope(request)
        data = JournalInput(data=request.data)
        data.is_valid(raise_exception=True)
        values = dict(data.validated_data)
        values['lines'] = [(l['account'], l['debit'], l['credit']) for l in values['lines']]
        journal = checked(prepare_journal, **scope, **values)
        return Response({'id': str(journal.pk), 'status': journal.status}, status=201)


class FinancialJournalAction(FinancialBase):
    def post(self, request, journal_id, action):
        scope = self.scope(request)
        if action not in ('approve', 'post'):
            raise ValidationError('Unknown journal action.')
        journal = checked(approve_journal if action == 'approve' else post_journal,
                          **scope, journal_id=journal_id)
        return Response({'id': str(journal.pk), 'status': journal.status})
