from django.db import migrations


CATALOGUE_GROUPS = (
    {
        "major": "Beverages",
        "group": "Soft Drinks",
        "code": "BEV-SD",
        "description": "Soft drinks, bottled water and related non-alcoholic beverages.",
        "skus": ("TAF-WATER-500",),
        "names": ("Mineral Water 500ml", "Rwenzori Mineral Water 500ml"),
    },
    {
        "major": "Food Supplies",
        "group": "Rice & Grains",
        "code": "FOOD-RG",
        "description": "Rice, grains and related dry food staples.",
        "skus": ("TAF-RICE-25",),
        "names": ("Long Grain Rice",),
    },
    {
        "major": "Housekeeping Supplies",
        "group": "Cleaning & Hygiene",
        "code": "HKS-CH",
        "description": "Cleaning, hygiene and housekeeping consumables.",
        "skus": ("TAF-SOAP-5L",),
        "names": ("Liquid Hand Soap", "Mukwano Liquid Hand Soap 5L"),
    },
    {
        "major": "Stationery",
        "group": "Paper Products",
        "code": "STA-PP",
        "description": "Printing paper and related office paper products.",
        "skus": ("TAF-PAPER-A4",),
        "names": ("A4 Printing Paper", "A4 Printing Paper 80gsm", "A4 Printing Paper Ream"),
    },
)


def _unique_code(Category, desired, exclude_id=None):
    base = desired[:30]
    candidate = base
    number = 2
    qs = Category.objects.all()
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    while qs.filter(code__iexact=candidate).exists():
        suffix = f"-{number}"
        candidate = f"{base[:30-len(suffix)]}{suffix}"
        number += 1
    return candidate


def _ensure_group(Category, major, name, code, description):
    group = Category.objects.filter(name__iexact=name).first()
    if group:
        changed = []
        if group.parent_id != major.id:
            group.parent_id = major.id
            changed.append("parent")
        if not group.code:
            group.code = _unique_code(Category, code, exclude_id=group.id)
            changed.append("code")
        if description and not group.description:
            group.description = description
            changed.append("description")
        if changed:
            group.save(update_fields=changed)
        return group
    return Category.objects.create(
        name=name,
        code=_unique_code(Category, code),
        parent_id=major.id,
        description=description,
        is_active=True,
    )


def forward(apps, schema_editor):
    Category = apps.get_model("inventory", "Category")
    Item = apps.get_model("inventory", "Item")

    # Create the client-approved middle level and move the known operational articles.
    for spec in CATALOGUE_GROUPS:
        major = Category.objects.filter(name__iexact=spec["major"], parent_id__isnull=True).first()
        if not major:
            continue
        group = _ensure_group(
            Category,
            major,
            spec["group"],
            spec["code"],
            spec["description"],
        )
        direct_items = Item.objects.filter(category_id=major.id)
        matching_ids = list(
            direct_items.filter(sku__in=spec["skus"]).values_list("id", flat=True)
        )
        matching_ids += list(
            direct_items.filter(name__in=spec["names"]).values_list("id", flat=True)
        )
        if matching_ids:
            Item.objects.filter(id__in=set(matching_ids)).update(category_id=group.id)

    # Repair any other legacy direct-to-major assignments without losing inventory.
    # This is a one-time compatibility path; new API writes reject such assignments.
    for major in Category.objects.filter(parent_id__isnull=True):
        remaining = Item.objects.filter(category_id=major.id)
        if not remaining.exists():
            continue
        fallback_name = f"Other {major.name}"[:100]
        fallback_code = f"{(major.code or 'CAT')[:20]}-OTHER"
        fallback = _ensure_group(
            Category,
            major,
            fallback_name,
            fallback_code,
            f"Legacy items awaiting finer classification within {major.name}.",
        )
        remaining.update(category_id=fallback.id)


def reverse(apps, schema_editor):
    # Deliberately non-destructive. Reversing should not flatten a catalogue and
    # silently discard administrator classification work performed after migration.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0024_complete_received_department_requisitions"),
    ]

    operations = [
        migrations.RunPython(forward, reverse),
    ]
