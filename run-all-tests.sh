#!/usr/bin/env bash
# Every test in one command. Run before any deploy.
#
# NOTE: each suite runs exactly ONCE. An earlier version ran each twice —
# once to capture the summary line, once to read the exit code — which let
# a suite print "10/11 passed" while the overall result said ALL SUITES
# PASSED, because only the second run was trusted. If a suite is flaky,
# that is a bug to find, not something to average out.
set -uo pipefail
cd "$(dirname "$0")"
FAIL=0

run_suite() {
  printf '%-22s ' "$1"
  local out rc
  out=$(node "$1.js" 2>&1); rc=$?
  printf '%s\n' "$out" | tail -1
  if [ $rc -ne 0 ]; then
    FAIL=1
    printf '%s\n' "$out" | grep -E '^\s+FAIL' | sed 's/^/                       /'
  fi
}

echo "=== Static checks ==="
run_suite test-security
run_suite test-hook
run_suite test-deploy
run_suite test-integrity
run_suite test-version

echo
echo "=== Boot path (real vendored client) ==="
run_suite test-boot

echo
echo "=== Front-end suites (jsdom, real app files, mock backend) ==="
for t in test-nav test-capture test-designer test-requirements test-admin test-dashboard; do
  run_suite "$t"
done

echo
echo "=== Database suite (PostgreSQL) ==="
if command -v psql >/dev/null 2>&1; then
  db/test/run-tests.sh 2>&1 | tail -3 || FAIL=1
else
  echo "SKIPPED — install postgresql-16 to run these (see db/test/README.md)"
  echo "          RLS and the triggers are NOT covered by the suites above."
fi

echo
if [ $FAIL -eq 0 ]; then echo "ALL SUITES PASSED"; else echo "FAILURES PRESENT"; fi
exit $FAIL
