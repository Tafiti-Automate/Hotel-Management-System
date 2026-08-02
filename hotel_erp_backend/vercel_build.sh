#!/usr/bin/env bash
set -euo pipefail

python manage.py migrate --noinput --settings=core.settings.prod
python manage.py setup_hotel_roles --settings=core.settings.prod
python manage.py seed_historical_operations \
  --branch KLA \
  --days 60 \
  --batch-key production-initial-v1 \
  --commit \
  --production-only \
  --settings=core.settings.prod
python manage.py check --settings=core.settings.prod
