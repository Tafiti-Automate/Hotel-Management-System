import re

from django.db import migrations


def _scope_code(branch, hotel):
    source = getattr(branch, "branch_code", "") or ""
    if not source and hotel:
        source = "".join(
            word[0]
            for word in str(hotel.name).split()
            if word and word.lower() not in {"of", "the", "and"}
        )
    return re.sub(r"[^A-Za-z0-9]", "", source).upper()[:4] or "LPO"


def _suffix(reference, fallback):
    match = re.search(r"(\d+)$", str(reference or ""))
    value = int(match.group(1)) if match else fallback
    return max(1, value)


def format_existing_references(apps, schema_editor):
    """Keep the globally assigned numeric references from migration 0021."""
    return


class Migration(migrations.Migration):

    dependencies = [
        ("procurement", "0021_global_numeric_document_numbers"),
    ]

    operations = [
        migrations.RunPython(format_existing_references, migrations.RunPython.noop),
    ]
