import uuid
from django.conf import settings
from django.db import models


class AccountReconciliation(models.Model):
    """Immutable evidence snapshot; confirmation is separate from journal posting."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey('finance.LedgerAccount', on_delete=models.PROTECT)
    as_of = models.DateField()
    source_type = models.CharField(max_length=20, choices=[(x,x.title()) for x in ('bank','cash','inventory','supplier','customer','payroll','other')])
    source_balance = models.DecimalField(max_digits=22, decimal_places=2)
    ledger_balance = models.DecimalField(max_digits=22, decimal_places=2)
    ledger_digest = models.CharField(max_length=64)
    evidence = models.TextField()
    prepared_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    prepared_at = models.DateTimeField(auto_now_add=True)
    confirmed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+', null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=('account','as_of'), name='fin_recon_account_date')]
