import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion as deletion


class Migration(migrations.Migration):
    dependencies = [('finance', '0010_persistent_ledger'), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(name='FixedAsset', fields=[
            ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ('tag', models.CharField(max_length=80)), ('name', models.CharField(max_length=150)),
            ('category', models.CharField(max_length=20, choices=[("land", "Land & Lease"), ("building", "Buildings"), ("computers", "Computers"), ("furniture", "Furniture"), ("gym", "Gym Equipment"), ("vehicles", "Vehicles"), ("others", "Others"), ("generators", "Generators"), ("laundry", "Laundry Equipment"), ("kitchen", "Kitchen Appliances"), ("refrigeration", "Refrigeration & ACs"), ("machinery", "Machinery"), ("telephone", "Telephones & Mobile Sets"), ("playground", "Playground Equipment"), ("office", "Office Equipment")])),
            ('opening_date', models.DateField()),
            ('cost', models.DecimalField(max_digits=18, decimal_places=2)),
            ('opening_depreciation', models.DecimalField(max_digits=18, decimal_places=2)),
            ('residual_value', models.DecimalField(max_digits=18, decimal_places=2)),
            ('annual_rate', models.DecimalField(max_digits=5, decimal_places=2)),
            ('evidence', models.TextField()), ('created_at', models.DateTimeField(auto_now_add=True)),
            ('branch', models.ForeignKey(to='departments.branch', on_delete=deletion.PROTECT)),
            ('cost_account', models.ForeignKey(to='finance.ledgeraccount', on_delete=deletion.PROTECT, related_name='+')),
            ('accumulated_account', models.ForeignKey(to='finance.ledgeraccount', on_delete=deletion.PROTECT, related_name='+')),
            ('expense_account', models.ForeignKey(to='finance.ledgeraccount', on_delete=deletion.PROTECT, related_name='+')),
            ('created_by', models.ForeignKey(to=settings.AUTH_USER_MODEL, on_delete=deletion.PROTECT, related_name='+')),
        ], options={'constraints': [models.UniqueConstraint(fields=('branch', 'tag'), name='fin_asset_unique_tag'),
            models.CheckConstraint(condition=models.Q(cost__gt=0, opening_depreciation__gte=0, residual_value__gte=0, annual_rate__gte=0, annual_rate__lte=100), name='fin_asset_valid_values')]}),
        migrations.CreateModel(name='AssetDepreciation', fields=[
            ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ('period_end', models.DateField()), ('amount', models.DecimalField(max_digits=18, decimal_places=2)),
            ('asset', models.ForeignKey(to='finance.fixedasset', on_delete=deletion.PROTECT, related_name='depreciations')),
            ('journal', models.OneToOneField(to='finance.ledgerjournal', on_delete=deletion.PROTECT)),
        ], options={'constraints': [models.UniqueConstraint(fields=('asset', 'period_end'), name='fin_asset_month_unique'),
            models.CheckConstraint(condition=models.Q(amount__gt=0), name='fin_asset_dep_positive')]}),
    ]
