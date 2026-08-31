from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("audit_logs", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="AuditChainState",
            fields=[
                ("id", models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
                ("last_hash", models.CharField(blank=True, default="", max_length=64)),
                ("sequence", models.PositiveBigIntegerField(default=0)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Audit chain state",
                "verbose_name_plural": "Audit chain state",
            },
        ),
        migrations.AlterField(
            model_name="auditlog",
            name="entity_id",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="chain_sequence",
            field=models.PositiveBigIntegerField(blank=True, db_index=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="request_id",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="user_agent",
            field=models.CharField(blank=True, default="", max_length=500),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="previous_hash",
            field=models.CharField(blank=True, default="", editable=False, max_length=64),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="entry_hash",
            field=models.CharField(blank=True, db_index=True, default="", editable=False, max_length=64),
        ),
    ]
