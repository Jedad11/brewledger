#!/usr/bin/env bash
# WBS 3.2 QA regression check — proves `pnpm lint:boundary` actually enforces
# the RL-3 import boundary rather than merely looking correct on paper.
#
# Method: plant a deliberate violation (apps/shop importing the service_role
# admin client), confirm the lint command fails (non-zero exit), remove the
# violation, confirm it passes again (zero exit). The scratch file lives
# under apps/shop only for the duration of this script and is always removed
# — apps/shop is live on Vercel and must show zero diff afterwards.
#
# Usage: bash scripts/test-import-boundary-regression.sh
# Exit code: 0 if the regression check itself passed (i.e. the boundary rule
# behaved correctly in both the violating and clean states). Non-zero if the
# boundary rule failed to catch the violation, or failed to clear afterward,
# or if any other unexpected error occurred.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

SCRATCH_FILE="apps/shop/src/app/__qa_boundary_regression_scratch.ts"
LOG_DIR="$(mktemp -d)"
FAIL=0

cleanup() {
  rm -f "$SCRATCH_FILE"
  rm -rf "$LOG_DIR"
}
trap cleanup EXIT

echo "== Step 1: baseline — pnpm lint:boundary should currently pass =="
if ! pnpm lint:boundary >"$LOG_DIR/baseline.log" 2>&1; then
  echo "FAIL: lint:boundary does not pass on a clean tree. Aborting — cannot"
  echo "      trust the rest of this check on a dirty baseline."
  cat "$LOG_DIR/baseline.log"
  exit 1
fi
echo "PASS: baseline clean."
echo

echo "== Step 2: plant a deliberate RL-3 violation in apps/shop =="
mkdir -p "$(dirname "$SCRATCH_FILE")"
cat > "$SCRATCH_FILE" <<'EOF'
// QA regression scratch file — WBS 3.2 boundary check. Deleted automatically.
import { createAdminClient } from "../../../../packages/shared/src/supabase/admin";

export const _scratch = createAdminClient;
EOF
echo "Planted: $SCRATCH_FILE"
echo

echo "== Step 3: pnpm lint:boundary must now FAIL (non-zero exit) =="
if pnpm lint:boundary >"$LOG_DIR/violation.log" 2>&1; then
  echo "FAIL: lint:boundary passed with a deliberate service_role import in"
  echo "      apps/shop present. THE BOUNDARY RULE IS NOT ENFORCING. This is"
  echo "      an RL-3 breach path — a real service_role import would ship to"
  echo "      the public bundle undetected."
  cat "$LOG_DIR/violation.log"
  FAIL=1
else
  if grep -q "admin" "$LOG_DIR/violation.log"; then
    echo "PASS: lint:boundary failed as expected and flagged the admin import."
  else
    echo "PASS (weak): lint:boundary failed as expected, but the failure"
    echo "      output didn't obviously reference the admin import — check"
    echo "      manually that it's the right rule firing, not a coincidence."
    cat "$LOG_DIR/violation.log"
  fi
fi
echo

echo "== Step 4: remove the violation =="
rm -f "$SCRATCH_FILE"
echo "Removed: $SCRATCH_FILE"
echo

echo "== Step 5: pnpm lint:boundary must PASS again (zero exit) =="
if ! pnpm lint:boundary >"$LOG_DIR/cleared.log" 2>&1; then
  echo "FAIL: lint:boundary still fails after the violation was removed —"
  echo "      something else is broken, or cleanup did not fully work."
  cat "$LOG_DIR/cleared.log"
  FAIL=1
else
  echo "PASS: lint:boundary is clean again after removal."
fi
echo

if [ "$FAIL" -eq 0 ]; then
  echo "REGRESSION CHECK RESULT: PASS — the import boundary rule genuinely"
  echo "catches the violation and clears afterward."
  exit 0
else
  echo "REGRESSION CHECK RESULT: FAIL — see above."
  exit 1
fi
