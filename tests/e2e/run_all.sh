#!/usr/bin/env bash
# FiruWalk E2E runner — pristine seed → full Playwright suite → pristine seed.
set -uo pipefail
cd /home/z/my-project

PY=/home/z/.venv/bin/python

echo "━━━ [1/3] Reseeding database to pristine demo state ━━━"
bun prisma/seed.ts >/dev/null 2>&1 || { echo "SEED FAILED"; exit 1; }
echo "seed OK"

echo "━━━ [2/3] Running Playwright end-to-end suite (via :81 gateway) ━━━"
$PY -m pytest tests/e2e -q --tb=short -p no:cacheprovider
status=$?

echo "━━━ [3/3] Restoring pristine demo state ━━━"
bun prisma/seed.ts >/dev/null 2>&1 && echo "seed restored OK"

echo
if [ $status -eq 0 ]; then
  echo "✅ E2E SUITE PASSED — every screen and flow verified."
else
  echo "❌ E2E SUITE FAILED — see failures above; screenshots in tests/e2e/screenshots/"
fi
exit $status
