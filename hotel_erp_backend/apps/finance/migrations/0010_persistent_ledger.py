import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion as deletion


class Migration(migrations.Migration):
    dependencies = [('finance', '0009_supplier_payment_authorization'),
                    ('materials_control', '0009_department_gl_mapping'),
                    migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(name='LedgerAccount', fields=[
            ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ('code', models.CharField(max_length=50)), ('name', models.CharField(max_length=150)),
            ('kind', models.CharField(max_length=10, choices=[(x, x.title()) for x in ('asset', 'liability', 'equity', 'revenue', 'expense')])),
            ('report_group', models.CharField(max_length=100)), ('is_cash', models.BooleanField(default=False)),
            ('is_active', models.BooleanField(default=True)),
            ('branch', models.ForeignKey(to='departments.branch', on_delete=deletion.PROTECT)),
        ], options={'constraints': [models.UniqueConstraint(fields=('branch', 'code'), name='fin_ledger_branch_code'),
                   models.CheckConstraint(condition=models.Q(is_cash=False) | models.Q(kind='asset'), name='fin_ledger_cash_asset')]}),
        migrations.CreateModel(name='LedgerJournal', fields=[
            ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ('source_key', models.CharField(max_length=150)), ('business_date', models.DateField()),
            ('evidence', models.TextField()), ('cash_activity', models.CharField(max_length=20, blank=True)),
            ('is_opening', models.BooleanField(default=False)),
            ('status', models.CharField(max_length=10, choices=[(x, x.title()) for x in ('draft', 'approved', 'posted')], default='draft')),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('approved_at', models.DateTimeField(null=True, blank=True)), ('posted_at', models.DateTimeField(null=True, blank=True)),
            ('branch', models.ForeignKey(to='departments.branch', on_delete=deletion.PROTECT)),
            ('period', models.ForeignKey(to='materials_control.fiscalperiod', on_delete=deletion.PROTECT)),
            ('prepared_by', models.ForeignKey(to=settings.AUTH_USER_MODEL, on_delete=deletion.PROTECT, related_name='+')),
            ('approved_by', models.ForeignKey(to=settings.AUTH_USER_MODEL, on_delete=deletion.PROTECT, related_name='+', null=True, blank=True)),
            ('posted_by', models.ForeignKey(to=settings.AUTH_USER_MODEL, on_delete=deletion.PROTECT, related_name='+', null=True, blank=True)),
        ], options={'constraints': [models.UniqueConstraint(fields=('branch', 'source_key'), name='fin_ledger_source_unique'),
                   models.UniqueConstraint(fields=('branch',), condition=models.Q(is_opening=True, status='posted'), name='fin_ledger_opening_unique')],
                   'indexes': [models.Index(fields=('branch', 'status', 'business_date'), name='fin_ledger_date_idx')]}),
        migrations.CreateModel(name='LedgerLine', fields=[
            ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ('debit', models.DecimalField(max_digits=18, decimal_places=2, default=0)),
            ('credit', models.DecimalField(max_digits=18, decimal_places=2, default=0)),
            ('journal', models.ForeignKey(to='finance.ledgerjournal', on_delete=deletion.PROTECT, related_name='lines')),
            ('account', models.ForeignKey(to='finance.ledgeraccount', on_delete=deletion.PROTECT)),
        ], options={'constraints': [models.CheckConstraint(condition=(models.Q(debit__gt=0, credit=0) | models.Q(credit__gt=0, debit=0)), name='fin_ledger_line_one_side')]}),
    ]
