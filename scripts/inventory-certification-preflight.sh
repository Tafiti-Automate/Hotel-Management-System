#!/usr/bin/env bash
# Inventory certification preflight — checks source, never changes production data.
# Run in an isolated checkout of the FINAL candidate, with dependencies installed.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -n "$(git status --porcelain 2>/dev/null || true)" ]; then
  echo "NOTE: Working tree is not clean. Record its hash and review all changes." >&2
fi

echo "[A] Django configuration and exact migration state"
python hotel_erp_backend/manage.py check --settings=core.settings.test
python hotel_erp_backend/manage.py makemigrations --check --dry-run --settings=core.settings.test

echo "[A-B-C] Full Django transaction, permission and accounting test suite"
python -m pytest hotel_erp_backend/tests -q

echo "[D] Frontend static permissions, TypeScript and production build"
(
  cd frontend
  npm run typecheck
  npm test
  npm run build
)

echo "PASS: Source checks only — NOT a hotel acceptance or financial certification."
echo "Next: restore an isolated PostgreSQL staging database, run the read-only audits,"
echo "witness all mandatory inventory and accounting scenarios, and collect signatures."
