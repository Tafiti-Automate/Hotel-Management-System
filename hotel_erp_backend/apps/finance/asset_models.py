import uuid
from django.conf import settings
from django.db import models

CATEGORY_CHOICES = [("land", "Land & Lease"), ("building", "Buildings"), ("computers", "Computers"), ("furniture", "Furniture"), ("gym", "Gym Equipment"), ("vehicles", "Vehicles"), ("others", "Others"), ("generators", "Generators"), ("laundry", "Laundry Equipment"), ("kitchen", "Kitchen Appliances"), ("refrigeration", "Refrigeration & ACs"), ("machinery", "Machinery"), ("telephone", "Telephones & Mobile Sets"), ("playground", "Playground Equipment"), ("office", "Office Equipment")]


class FixedAsset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    branch = models.ForeignKey('departments.Branch', on_delete=models.PROTECT)
    tag = models.CharField(max_length=80)
    name = models.CharField(max_length=150)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)
    opening_date = models.DateField()
    cost = models.DecimalField(max_digits=18, decimal_places=2)
    opening_depreciation = models.DecimalField(max_digits=18, decimal_places=2)
    residual_value = models.DecimalField(max_digits=18, decimal_places=2)
    annual_rate = models.DecimalField(max_digits=5, decimal_places=2)
    cost_account = models.ForeignKey('finance.LedgerAccount', on_delete=models.PROTECT, related_name='+')
    accumulated_account = models.ForeignKey('finance.LedgerAccount', on_delete=models.PROTECT, related_name='+')
    expense_account = models.ForeignKey('finance.LedgerAccount', on_delete=models.PROTECT, related_name='+')
    evidence = models.TextField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=('branch', 'tag'), name='fin_asset_unique_tag'),
            models.CheckConstraint(condition=models.Q(cost__gt=0, opening_depreciation__gte=0, residual_value__gte=0, annual_rate__gte=0, annual_rate__lte=100), name='fin_asset_valid_values')]


class AssetDepreciation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asset = models.ForeignKey(FixedAsset, on_delete=models.PROTECT, related_name='depreciations')
    period_end = models.DateField()
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    journal = models.OneToOneField('finance.LedgerJournal', on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=('asset', 'period_end'), name='fin_asset_month_unique'),
            models.CheckConstraint(condition=models.Q(amount__gt=0), name='fin_asset_dep_positive')]
