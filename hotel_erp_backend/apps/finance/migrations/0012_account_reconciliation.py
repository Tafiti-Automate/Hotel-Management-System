import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion as deletion


class Migration(migrations.Migration):
    dependencies = [('finance','0011_fixed_assets'), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(name='AccountReconciliation', fields=[
            ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ('as_of', models.DateField()),
            ('source_type', models.CharField(max_length=20, choices=[(x,x.title()) for x in ('bank','cash','inventory','supplier','customer','payroll','other')])),
            ('source_balance', models.DecimalField(max_digits=22, decimal_places=2)),
            ('ledger_balance', models.DecimalField(max_digits=22, decimal_places=2)),
            ('ledger_digest', models.CharField(max_length=64)),
            ('evidence', models.TextField()),
            ('prepared_at', models.DateTimeField(auto_now_add=True)),
            ('confirmed_at', models.DateTimeField(null=True, blank=True)),
            ('account', models.ForeignKey(to='finance.ledgeraccount', on_delete=deletion.PROTECT)),
            ('prepared_by', models.ForeignKey(to=settings.AUTH_USER_MODEL, on_delete=deletion.PROTECT, related_name='+')),
            ('confirmed_by', models.ForeignKey(to=settings.AUTH_USER_MODEL, on_delete=deletion.PROTECT, related_name='+', null=True, blank=True)),
        ], options={'indexes':[models.Index(fields=('account','as_of'),name='fin_recon_account_date')]}),
    ]
