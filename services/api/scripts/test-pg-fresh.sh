#!/usr/bin/env bash
set -euo pipefail

DB_PREFIX="${DB_PREFIX:-crewcue_test}"
DB_NAME="${DB_PREFIX}_$(date +%s)_$RANDOM"
PG_URL_BASE="${PG_URL_BASE:-postgres://crewcue:crewcue@localhost:5432}"

cleanup() {
  if psql "${PG_URL_BASE}/postgres" -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | rg -q "^1$"; then
    dropdb --if-exists "${DB_NAME}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

createdb "${DB_NAME}"
DATABASE_URL="${PG_URL_BASE}/${DB_NAME}" npm run test:pg

echo "test:pg passed on fresh database ${DB_NAME}"
