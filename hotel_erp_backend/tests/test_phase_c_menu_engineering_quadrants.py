"""Oracle-style menu engineering: four-quadrant classification and unpriced guards."""
from decimal import Decimal

from apps.reports.views import classify_menu_recipes


def sale_row(code, portions, sales, cogs, unpriced=0):
    return {
        "sku": code, "article": code, "quantity": Decimal(str(portions)),
        "sales": Decimal(str(sales)), "cogs": Decimal(str(cogs)),
        "unpriced": unpriced, "transactions": 1,
    }


def test_all_four_menu_quadrants_use_popularity_and_unit_contribution():
    recipes = [
        sale_row("Star", "30", "3000", "600"),
        sale_row("Plowhorse", "25", "250", "200"),
        sale_row("Puzzle", "5", "750", "250"),
        sale_row("Dog", "2", "20", "18"),
    ]
    classified, meta = classify_menu_recipes(recipes)
    assert {row["sku"]: row["classification"] for row in classified} == {
        "Star": "Star", "Plowhorse": "Plowhorse",
        "Puzzle": "Puzzle", "Dog": "Dog",
    }
    assert meta == {
        "eligible_recipes": 4, "unclassified_recipes": 0,
        "popularity_threshold": "15.5000",
        "unit_contribution_threshold": "45.75",
    }
    star = next(row for row in classified if row["sku"] == "Star")
    assert star["unit_contribution"] == "80.00"
    assert star["margin_percent"] == "80.00"
    assert star["recommended_action"]


def test_unknown_historical_cost_is_unclassified_and_never_affects_thresholds():
    rows, meta = classify_menu_recipes([
        sale_row("Known", "4", "800", "200"),
        sale_row("Unknown", "1000", "999999", "0", unpriced=1),
        sale_row("Zero revenue", "30", "0", "0"),
    ])
    assert meta["eligible_recipes"] == 1
    assert meta["popularity_threshold"] == "4.0000"
    assert meta["unit_contribution_threshold"] == "150.00"
    assert meta["unclassified_recipes"] == 2
    invalid = [row for row in rows if row["classification"] == "Unclassified"]
    assert len(invalid) == 2
    assert all(row["profit"] is None and row["unit_contribution"] is None for row in invalid)


def test_empty_and_fractional_pos_depletion_is_deterministic():
    assert classify_menu_recipes([])[1]["eligible_recipes"] == 0
    data, summary = classify_menu_recipes([
        sale_row("Quarter portion", "0.1255", "1000.00", "200.00"),
    ])
    assert data[0]["quantity"] == "0.1255"
    assert data[0]["classification"] == "Star"
    assert summary["eligible_recipes"] == 1
