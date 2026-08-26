#!/usr/bin/env bash
# Applies the shim, the real migrations and the test files to a scratch
# database. Nothing here touches a live project.
set -uo pipefail
cd "$(dirname "$0")/../.."

DB="qgrid_test_$$"
PSQL="psql -v ON_ERROR_STOP=1 -q"

cleanup() { dropdb --if-exists "$DB" 2>/dev/null || true; }
trap cleanup EXIT

createdb "$DB" || { echo "Could not create a scratch database. Is PostgreSQL running?"; exit 1; }

echo "Applying shim and migrations to $DB"
for f in db/test/00-shim.sql db/001-init-inspections.sql db/002-app-wiring.sql db/seed.sql db/seed-division-mvs.sql; do
  $PSQL -d "$DB" -f "$f" >/dev/null || { echo "FAILED applying $f"; exit 1; }
done

FAIL=0
for f in db/test/9*.sql; do
  echo
  echo "--- $(basename "$f")"
  psql -d "$DB" -v ON_ERROR_STOP=1 -f "$f" || FAIL=1
done

echo
[ $FAIL -eq 0 ] && echo "DATABASE SUITE PASSED" || echo "DATABASE SUITE FAILED"
exit $FAIL
