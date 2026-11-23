from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Sum
from rest_framework import serializers

from apps.employees.models import (
    AttendanceRecord,
    EmployeeDocument,
    ShiftTemplate,
    LeaveRequest,
    PayrollAffector,
    PayrollEntry,
    PayrollPeriod,
    PayrollProfile,
    SalaryAdvance,
    SalaryAdvanceRepayment,
)


class CleanModelSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = self.instance or self.Meta.model()
        for field, value in attrs.items():
            setattr(instance, field, value)
        try:
            instance.full_clean(exclude=None)
        except DjangoValidationError as error:
            detail = getattr(error, "message_dict", None) or getattr(error, "messages", None) or str(error)
            raise serializers.ValidationError(detail) from error
        return attrs


class ShiftTemplateSerializer(CleanModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = ShiftTemplate
        fields = "__all__"
        read_only_fields = ("id", "created_by", "created_at", "updated_at")


class AttendanceRecordSerializer(CleanModelSerializer):
    employee_name = serializers.CharField(source="employee.user.get_full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.user.employee_code", read_only=True)
    department_name = serializers.CharField(source="employee.department.name", read_only=True)
    branch_name = serializers.CharField(source="employee.branch.name", read_only=True)
    shift_name = serializers.CharField(source="shift.name", read_only=True, default="")
    reviewed_by_name = serializers.CharField(source="approved_by.get_full_name", read_only=True, default="")

    class Meta:
        model = AttendanceRecord
        fields = "__all__"
        read_only_fields = (
            "id", "approved_by", "approved_at", "created_by",
            "created_at", "updated_at",
        )

    def validate(self, attrs):
        if self.instance and self.instance.approved_at:
            raise serializers.ValidationError("Approved attendance is immutable; use a controlled payroll correction.")
        return super().validate(attrs)


class PayrollProfileSerializer(CleanModelSerializer):
    employee_name = serializers.CharField(source="employee.user.get_full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.user.employee_code", read_only=True)
    department_name = serializers.CharField(source="employee.department.name", read_only=True)
    branch_name = serializers.CharField(source="employee.branch.name", read_only=True)

    class Meta:
        model = PayrollProfile
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class PayrollAffectorSerializer(CleanModelSerializer):
    employee_name = serializers.CharField(source="employee.user.get_full_name", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    approved_by_name = serializers.CharField(source="approved_by.get_full_name", read_only=True)
    category_label = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = PayrollAffector
        fields = "__all__"
        read_only_fields = (
            "id", "approved_by", "approved_at", "created_at", "updated_at", "created_by",
        )

    def validate(self, attrs):
        if self.instance and self.instance.is_approved:
            raise serializers.ValidationError("Approved affectors are immutable; deactivate and create a replacement.")
        return super().validate(attrs)


class SalaryAdvanceSerializer(CleanModelSerializer):
    employee_name = serializers.CharField(source="employee.user.get_full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.user.employee_code", read_only=True)
    department_name = serializers.CharField(source="employee.department.name", read_only=True)
    branch_name = serializers.CharField(source="employee.branch.name", read_only=True)
    approved_by_name = serializers.CharField(source="approved_by.get_full_name", read_only=True)

    class Meta:
        model = SalaryAdvance
        fields = "__all__"
        read_only_fields = (
            "id", "balance", "status", "approved_by", "approved_at",
            "created_at", "updated_at", "created_by",
        )

    def create(self, validated_data):
        validated_data["balance"] = validated_data["principal_amount"]
        return super().create(validated_data)

    def validate(self, attrs):
        if self.instance and self.instance.status != SalaryAdvance.STATUS_DRAFT:
            raise serializers.ValidationError("Only draft salary advances can be edited.")
        if self.instance is None:
            # A new draft's outstanding balance is initialized to the principal.
            # Model.clean() compares balance with principal, so populate it
            # *before* full_clean(), not only in create() after validation.
            candidate = SalaryAdvance(balance=attrs["principal_amount"])
            for field, value in attrs.items():
                setattr(candidate, field, value)
            try:
                candidate.full_clean()
            except DjangoValidationError as error:
                detail = getattr(error, "message_dict", None) or getattr(error, "messages", None) or str(error)
                raise serializers.ValidationError(detail) from error
            return attrs
        return super().validate(attrs)


class PayrollPeriodSerializer(CleanModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    calculated_by_name = serializers.CharField(source="calculated_by.get_full_name", read_only=True)
    submitted_by_name = serializers.CharField(source="submitted_by.get_full_name", read_only=True)
    approved_by_name = serializers.CharField(source="approved_by.get_full_name", read_only=True)
    posted_by_name = serializers.CharField(source="posted_by.get_full_name", read_only=True)
    employee_count = serializers.SerializerMethodField()
    gross_total = serializers.SerializerMethodField()
    deduction_total = serializers.SerializerMethodField()
    net_total = serializers.SerializerMethodField()
    employer_nssf_total = serializers.SerializerMethodField()

    class Meta:
        model = PayrollPeriod
        fields = "__all__"
        read_only_fields = (
            "id", "status", "statutory_rule_version", "calculated_by", "calculated_at",
            "submitted_by", "submitted_at", "approved_by", "approved_at", "posted_by",
            "posted_at", "created_at", "updated_at", "created_by",
        )

    @staticmethod
    def _sum(obj, field):
        return obj.entries.aggregate(total=Sum(field))["total"] or 0

    def get_employee_count(self, obj):
        return obj.entries.count()

    def get_gross_total(self, obj):
        return self._sum(obj, "gross_pay")

    def get_deduction_total(self, obj):
        return self._sum(obj, "total_deductions")

    def get_net_total(self, obj):
        return self._sum(obj, "net_pay")

    def get_employer_nssf_total(self, obj):
        return self._sum(obj, "nssf_employer")

    def validate(self, attrs):
        if self.instance and self.instance.status != PayrollPeriod.STATUS_DRAFT:
            raise serializers.ValidationError("Only a draft payroll period can be edited.")
        return super().validate(attrs)


class PayrollEntrySerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.user.get_full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.user.employee_code", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True)
    branch_name = serializers.CharField(source="period.branch.name", read_only=True)
    period_label = serializers.CharField(source="period.label", read_only=True)

    class Meta:
        model = PayrollEntry
        fields = "__all__"
        read_only_fields = tuple(field.name for field in PayrollEntry._meta.fields)


class SalaryAdvanceRepaymentSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="advance.employee.user.get_full_name", read_only=True)
    period_label = serializers.CharField(source="payroll_entry.period.label", read_only=True)

    class Meta:
        model = SalaryAdvanceRepayment
        fields = "__all__"
        read_only_fields = tuple(field.name for field in SalaryAdvanceRepayment._meta.fields)


class LeaveRequestSerializer(CleanModelSerializer):
    employee_name = serializers.CharField(source="employee.user.get_full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.user.employee_code", read_only=True)
    department_name = serializers.CharField(source="employee.department.name", read_only=True)
    branch_name = serializers.CharField(source="employee.branch.name", read_only=True)
    reviewed_by_name = serializers.CharField(source="reviewed_by.get_full_name", read_only=True)
    leave_type_label = serializers.CharField(source="get_leave_type_display", read_only=True)

    class Meta:
        model = LeaveRequest
        fields = "__all__"
        read_only_fields = (
            "id", "status", "review_note", "reviewed_by", "reviewed_at",
            "created_at", "updated_at", "created_by",
        )

    def validate(self, attrs):
        if self.instance and self.instance.status != "pending":
            raise serializers.ValidationError("Reviewed leave requests are immutable.")
        return super().validate(attrs)


class EmployeeDocumentSerializer(CleanModelSerializer):
    employee_name = serializers.CharField(source="employee.user.get_full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.user.employee_code", read_only=True)
    department_name = serializers.CharField(source="employee.department.name", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeDocument
        fields = "__all__"
        read_only_fields = (
            "id", "original_name", "content_type", "file_size",
            "created_at", "updated_at", "created_by",
        )

    def validate_file(self, value):
        if value.size > 8 * 1024 * 1024:
            raise serializers.ValidationError("Employee documents must be 8 MB or smaller.")
        allowed = {
            "application/pdf", "image/png", "image/jpeg", "image/webp",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }
        content_type = getattr(value, "content_type", "")
        if content_type and content_type not in allowed:
            raise serializers.ValidationError("Upload a PDF, DOC/DOCX, PNG, JPG, or WEBP document.")
        return value

    def create(self, validated_data):
        upload = validated_data["file"]
        validated_data.update(
            original_name=getattr(upload, "name", ""),
            content_type=getattr(upload, "content_type", ""),
            file_size=getattr(upload, "size", 0),
        )
        return super().create(validated_data)

    def get_download_url(self, obj):
        if not obj.file:
            return ""
        request = self.context.get("request")
        url = obj.file.url
        return request.build_absolute_uri(url) if request and not url.startswith(("http://", "https://")) else url
