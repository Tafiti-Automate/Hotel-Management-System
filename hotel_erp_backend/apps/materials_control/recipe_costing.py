"""Recursive recipe consumption expansion.

All leaves are stock Articles; intermediate recipes are measured in their yield
units. Cycle checks apply both at editing and execution time. POS quantities
remain at four decimal places until batch aggregation and ledger rounding.
"""
from collections import defaultdict
from decimal import Decimal
from django.core.exceptions import ValidationError

def expand_recipe_demand(recipe, yield_quantity, *, require_published=True, _ancestors=None):
    from apps.materials_control.models import Recipe
    from apps.materials_control.models import RecipeIngredient

    if require_published and recipe.status != Recipe.STATUS_PUBLISHED:
        raise ValidationError("A POS mapped recipe or sub-recipe must be published.")
    ancestors = frozenset(_ancestors or ())
    if recipe.pk in ancestors:
        raise ValidationError("Recursive recipe cycle detected; no stock was deducted.")
    if not recipe.yield_quantity or recipe.yield_quantity <= 0:
        raise ValidationError("Recipe yield quantity must be positive.")
    factor = Decimal(str(yield_quantity)) / recipe.yield_quantity
    if factor <= 0:
        raise ValidationError("Consumed recipe quantity must be positive.")
    demand = defaultdict(lambda: Decimal("0.0000"))
    for ingredient in RecipeIngredient.objects.filter(recipe=recipe).select_related(
        "item", "unit", "sub_recipe", "sub_recipe__outlet"
    ):
        amount = ingredient.gross_base_quantity * factor
        if ingredient.sub_recipe_id:
            if ingredient.sub_recipe.outlet_id != recipe.outlet_id:
                raise ValidationError("Recursive recipe outlet boundary violation.")
            inner = expand_recipe_demand(
                ingredient.sub_recipe, amount,
                require_published=require_published,
                _ancestors=ancestors | {recipe.pk},
            )
            for item_id, qty in inner.items():
                demand[item_id] += qty
        else:
            if not ingredient.item_id:
                raise ValidationError("Recipe contains an ingredient without an Article.")
            demand[ingredient.item_id] += amount
    return dict(demand)
