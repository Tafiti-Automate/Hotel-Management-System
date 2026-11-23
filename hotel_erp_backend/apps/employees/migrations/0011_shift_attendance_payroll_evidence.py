"""Hotel shift schedules, approved daily attendance and immutable payroll snapshots."""
import uuid
from decimal import Decimal

import core.validators.quantities
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0010_employeedocument_leaverequest_payrollperiod_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ShiftTemplate",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=100)),
                ("starts_at", models.TimeField()),
                ("ends_at", models.TimeField()),
                ("unpaid_break_minutes", models.PositiveSmallIntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                ("branch", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="hr_shifts", to="departments.branch")),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_%(class)ss", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("branch__name", "starts_at", "name"), "abstract": False},
        ),
        migrations.AddConstraint(
            model_name="shifttemplate",
            constraint=models.UniqueConstraint(fields=("branch", "name"), name="unique_hr_shift_per_branch"),
        ),
        migrations.CreateModel(
            name="AttendanceRecord",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("work_date", models.DateField()),
                ("status", models.CharField(choices=[
                    ("present", "Present"), ("paid_leave", "Approved paid leave"),
                    ("unpaid_leave", "Approved unpaid leave"), ("absent", "Unpaid absence"),
                    ("rest", "Paid rest day"), ("public_holiday", "Paid public holiday"),
                ], max_length=20)),
                ("worked_hours", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=6, validators=[core.validators.quantities.validate_non_negative_decimal])),
                ("overtime_hours", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=6, validators=[core.validators.quantities.validate_non_negative_decimal])),
                ("overtime_pay", models.DecimalField(decimal_places=2, default=Decimal("0.00"), help_text="Approved gross overtime in UGX; calculated from a verified employer policy outside payroll.", max_digits=18, validators=[core.validators.quantities.validate_non_negative_decimal])),
                ("note", models.TextField(blank=True)),
                ("approved_at", models.DateTimeField(blank=True, null=True)),
                ("employee", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="attendance_records", to="employees.employee")),
                ("shift", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="attendance_records", to="employees.shifttemplate")),
                ("approved_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="approved_hr_attendance", to=settings.AUTH_USER_MODEL)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_%(class)ss", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-work_date", "employee__user__first_name"), "abstract": False},
        ),
        migrations.AddConstraint(
            model_name="attendancerecord",
            constraint=models.UniqueConstraint(fields=("employee", "work_date"), name="unique_employee_daily_attendance"),
        ),
        migrations.AddField(
            model_name="payrollentry",
            name="overtime_hours",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=6),
        ),
        migrations.AddField(
            model_name="payrollentry",
            name="overtime_pay",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=18),
        ),
    ]
