#!/usr/bin/env bash
set -euo pipefail

python manage.py migrate --noinput --settings=core.settings.prod

if [[ -n "${TAFITI_PRODUCTION_RESEED_KEY:-}" ]]; then
  if [[ "${TAFITI_PRODUCTION_RESEED_CONFIRM:-}" != "RESET-TAFITI-PRODUCTION" ]]; then
    echo "TAFITI_PRODUCTION_RESEED_KEY is set, but TAFITI_PRODUCTION_RESEED_CONFIRM is not RESET-TAFITI-PRODUCTION." >&2
    exit 1
  fi
  if [[ "${TAFITI_EXTERNAL_BACKUP_CONFIRMED:-}" != "YES" ]]; then
    echo "Create/confirm a Neon/PostgreSQL backup, then set TAFITI_EXTERNAL_BACKUP_CONFIRMED=YES before the destructive reseed." >&2
    exit 1
  fi

  python manage.py reseed_operational_data \
    --hotel-name "Tafiti Hotel" \
    --execute \
    --confirm RESEED-OPERATIONAL-DATA \
    --external-backup-confirmed \
    --once-key "${TAFITI_PRODUCTION_RESEED_KEY}" \
    --settings=core.settings.prod
else
  # Normal deployments keep the fixed client-approved operational roles synchronized.
  python manage.py setup_hotel_roles --settings=core.settings.prod
fi

# Historical/demo operations are disabled by default so a clean production reset
# stays clean. Enable deliberately only when a presentation dataset is required.
if [[ "${SEED_HISTORICAL_OPERATIONS:-0}" == "1" ]]; then
  python manage.py seed_historical_operations \
    --days 60 \
    --batch-key production-initial-v1 \
    --commit \
    --production-only \
    --settings=core.settings.prod
fi

python manage.py check --settings=core.settings.prod
