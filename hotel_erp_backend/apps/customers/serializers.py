from rest_framework import serializers

from apps.customers.models import Customer, CustomerLedger, Payment, PaymentAllocation


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class CustomerLedgerSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerLedger
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class PaymentAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentAllocation
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")
