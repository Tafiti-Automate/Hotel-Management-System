"""Published nested recipes with strict article-versus-recipe line constraints."""
import django.db.models.deletion
from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("materials_control", "0002_gl_account_mapping")]
    operations = [
        migrations.AlterField(
            model_name="recipeingredient", name="item",
            field=models.ForeignKey(
                to="inventory.item", related_name="recipe_ingredients",
                on_delete=django.db.models.deletion.PROTECT, null=True, blank=True
            ),
        ),
        migrations.AddField(
            model_name="recipeingredient", name="sub_recipe",
            field=models.ForeignKey(
                to="materials_control.recipe", related_name="used_in_recipes",
                on_delete=django.db.models.deletion.PROTECT, null=True, blank=True,
                help_text="Published sub-recipe, in its configured yield unit."
            ),
        ),
        migrations.RemoveConstraint(model_name="recipeingredient", name="unique_recipe_ingredient"),
        migrations.AddConstraint(
            model_name="recipeingredient", constraint=models.UniqueConstraint(
                fields=("recipe","item"), condition=models.Q(item__isnull=False),
                name="unique_recipe_ingredient",
            ),
        ),
        migrations.AddConstraint(
            model_name="recipeingredient", constraint=models.UniqueConstraint(
                fields=("recipe","sub_recipe"), condition=models.Q(sub_recipe__isnull=False),
                name="unique_recipe_sub_recipe",
            ),
        ),
        migrations.AddConstraint(
            model_name="recipeingredient", constraint=models.CheckConstraint(
                condition=(
                    models.Q(item__isnull=False, sub_recipe__isnull=True)
                    | models.Q(item__isnull=True, sub_recipe__isnull=False)
                ), name="recipe_ingredient_exactly_one_source"
            ),
        ),
        migrations.AlterModelOptions(
            name="recipeingredient",
            options={"ordering": ("item__name", "sub_recipe__name")},
        ),
    ]
