"""Recursive recipe valuation and stock consumption contract."""
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient
from apps.employees.models import Employee
from django.core.exceptions import ValidationError
from django.utils import timezone
from apps.inventory.models import InventoryBalance, StockLedger
from apps.materials_control.models import (
    Recipe, RecipeIngredient, POSPLUMapping, POSImportBatch, POSSaleLine,
)
from apps.materials_control.recipe_costing import expand_recipe_demand
from core.constants.choices import LedgerReferenceType
from tests.test_materials_control import materials_context


def build_recipe(outlet, user, name, *, sub=False, portions="2.00"):
    return Recipe.objects.create(
        name=name, outlet=outlet, is_sub_recipe=sub,
        yield_quantity=Decimal(portions), target_food_cost_percent=Decimal("30.00"),
        selling_price=Decimal("25000.00"), created_by=user,
    )


@pytest.mark.django_db
def test_nested_recipe_cost_rollup_and_pos_depletion_exactly_once(materials_context):
    user, employee, dept, branch, outlet, unit, item = materials_context
    balance = InventoryBalance.objects.get(item=item, store=outlet)
    balance.weighted_average_cost = Decimal("2500.0000")
    balance.save(update_fields=("weighted_average_cost", "updated_at"))
    child = build_recipe(outlet, user, "Nested syrup", sub=True, portions="2.00")
    RecipeIngredient.objects.create(
        recipe=child, item=item, unit=unit, quantity=Decimal("2.00"),
        trim_percent=Decimal("0.00"), created_by=user,
    )
    child.publish(user)
    parent = build_recipe(outlet, user, "Nested cocktail", portions="4.00")
    RecipeIngredient.objects.create(
        recipe=parent, sub_recipe=child, quantity=Decimal("4.00"),
        trim_percent=Decimal("0.00"), created_by=user,
    )
    assert child.total_cost == Decimal("5000.00")
    assert parent.total_cost == Decimal("10000.00")
    assert parent.cost_per_yield == child.cost_per_yield
    parent.publish(user)
    expanded=expand_recipe_demand(parent,Decimal("4.00"))
    assert expanded[item.pk] == Decimal("4.0000")

    mapping = POSPLUMapping.objects.create(
        outlet=outlet, external_plu="NESTED-PLU", recipe=parent, created_by=user,
    )
    batch = POSImportBatch.objects.create(
        outlet=outlet, business_date=timezone.localdate(),
        source="Nested Test POS", source_reference="NEST-001", created_by=user,
    )
    POSSaleLine.objects.create(
        batch=batch, external_plu=mapping.external_plu,
        external_reference="SALE-NESTED-1", quantity=Decimal("2.00"),
        net_sales=Decimal("50000.00"), created_by=user,
    )
    batch.process(user)
    balance=InventoryBalance.objects.get(item=item,store=outlet)
    assert balance.quantity_in_stock == Decimal("18.00")
    sale = POSSaleLine.objects.get(batch=batch)
    assert sale.cost_of_goods_sold == Decimal("5000.00")
    assert StockLedger.objects.filter(
        reference_id=batch.pk,reference_type=LedgerReferenceType.POS_DEPLETION
    ).count() == 1
    batch.process(user)
    assert InventoryBalance.objects.get(item=item,store=outlet).quantity_in_stock == Decimal("18.00")
    assert POSSaleLine.objects.get(batch=batch).cost_of_goods_sold == Decimal("5000.00")

    # A later store valuation must not rewrite historic POS profitability.
    balance.refresh_from_db()
    balance.weighted_average_cost = Decimal("9000.0000")
    balance.save(update_fields=("weighted_average_cost", "updated_at"))
    cost_user = get_user_model().objects.create_user(
        username="nested-cost-control", employee_code="NEST-COST",
    )
    cost_user.groups.add(Group.objects.get_or_create(name="Cost Controller")[0])
    Employee.objects.create(
        user=cost_user, department=dept, branch=branch, designation="Cost Controller",
    )
    api = APIClient()
    api.force_authenticate(cost_user)
    result = api.get("/api/v1/reports/analysis/menuEngineering/")
    assert result.status_code == 200, result.data
    matching = [row for row in result.data["rows"] if row["sku"] == parent.code]
    assert len(matching) == 1, result.data
    assert matching[0]["cogs"] == "5000.00"
    assert matching[0]["profit"] == "45000.00"
    assert matching[0]["margin_percent"] == "90.00"


@pytest.mark.django_db
def test_sub_recipe_guardrails_and_no_invalid_pos_deduction(materials_context):
    user, employee, dept, branch, outlet, unit, item = materials_context
    child=build_recipe(outlet,user,"Unpublished child",sub=True)
    parent=build_recipe(outlet,user,"Protected parent")
    with pytest.raises(ValidationError,match="published"):
        RecipeIngredient.objects.create(
            recipe=parent,sub_recipe=child,quantity=Decimal("2.00"),
        )
    with pytest.raises(ValidationError,match="itself"):
        RecipeIngredient.objects.create(
            recipe=parent,sub_recipe=parent,quantity=Decimal("2.00"),
        )
    with pytest.raises(ValidationError,match="either one Article or one sub-recipe"):
        RecipeIngredient.objects.create(
            recipe=parent,item=item,sub_recipe=child,quantity=Decimal("2.00"),
        )
