#!/usr/bin/env bash
# WBS 3.7 qa_engineer leg — "Cross-import boundary test" from
# docs/api/surfaces_design.md §7, for supabase/functions/eslint.config.mjs's
# public-* / console-* disjoint-scope zones. Mirrors
# scripts/test-import-boundary-regression.sh's plant/assert/remove shape.
#
# Why this script exists and isn't redundant with the manual verification
# the engineer leg already did: the engineer leg found and fixed a real bug
# here — the zone target "./supabase/functions/public-*" (bare glob, no
# trailing "/**") never matches a NESTED file like
# public-store/deep/nested/file.ts, because minimatch's bare `*` does not
# span `/`. The fix was "./supabase/functions/public-*/**". This script
# specifically plants its scratch files NESTED one level down (not directly
# inside the function directory) in BOTH directions, so a regression back to
# the bare-glob form would be caught here, not just re-confirmed against the
# same shallow case the original bug report used.
#
# Usage: bash scripts/test-functions-import-boundary-regression.sh
# Exit code: 0 if both directions of the boundary genuinely fire on a nested
# file and clear afterward. Non-zero otherwise.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PUBLIC_SCRATCH="supabase/functions/public-store/deep/nested/__qa_boundary_scratch.ts"
CONSOLE_SCRATCH="supabase/functions/console-orders/deep/nested/__qa_boundary_scratch.ts"
LOG_DIR="$(mktemp -d)"
FAIL=0

cleanup() {
  rm -f "$PUBLIC_SCRATCH" "$CONSOLE_SCRATCH"
  rm -rf "supabase/functions/public-store/deep"
  rm -rf "supabase/functions/console-orders"
  rm -rf "$LOG_DIR"
}
trap cleanup EXIT

echo "== Step 1: baseline — pnpm lint:functions should currently pass =="
if ! pnpm lint:functions >"$LOG_DIR/baseline.log" 2>&1; then
  echo "FAIL: lint:functions does not pass on a clean tree. Aborting."
  cat "$LOG_DIR/baseline.log"
  exit 1
fi
echo "PASS: baseline clean."
echo

echo "== Step 2: plant a NESTED public-* file importing _shared/console/ =="
mkdir -p "$(dirname "$PUBLIC_SCRATCH")"
cat > "$PUBLIC_SCRATCH" <<'EOF'
// QA regression scratch file — WBS 3.7 boundary check. Deleted automatically.
// Deliberately nested two directories deep under public-store/ to prove the
// zone glob matches nested files, not just files directly in the function
// directory (the exact bug the engineer leg found and fixed).
import { withConsoleAuth } from "../../../_shared/console/auth.ts";

export const _scratch = withConsoleAuth;
EOF
echo "Planted: $PUBLIC_SCRATCH"
echo

echo "== Step 3: pnpm lint:functions must FAIL for the nested public-* violation =="
if pnpm lint:functions >"$LOG_DIR/public-violation.log" 2>&1; then
  echo "FAIL: lint:functions passed with public-store/deep/nested/ importing"
  echo "      _shared/console/. THE BOUNDARY RULE DOES NOT REACH NESTED"
  echo "      FILES — this is the exact minimatch regression the engineer"
  echo "      leg already fixed once (bare '*' doesn't span '/'; the zone"
  echo "      target must be '.../public-*/**')."
  cat "$LOG_DIR/public-violation.log"
  FAIL=1
elif grep -q "public-\* may never import _shared/console/" "$LOG_DIR/public-violation.log"; then
  echo "PASS: lint:functions failed and flagged the nested public-*"
  echo "      violation with the expected message."
else
  echo "PASS (weak): lint:functions failed as expected, but the expected"
  echo "      message text wasn't found — check manually that the right"
  echo "      rule fired."
  cat "$LOG_DIR/public-violation.log"
fi
echo

rm -f "$PUBLIC_SCRATCH"
rm -rf "supabase/functions/public-store/deep"
echo "Removed: $PUBLIC_SCRATCH"
echo

echo "== Step 4: pnpm lint:functions must PASS again after removing it =="
if ! pnpm lint:functions >"$LOG_DIR/public-cleared.log" 2>&1; then
  echo "FAIL: lint:functions still fails after the public-* violation was"
  echo "      removed — something else is broken, or cleanup didn't work."
  cat "$LOG_DIR/public-cleared.log"
  FAIL=1
else
  echo "PASS: lint:functions is clean again."
fi
echo

echo "== Step 5: plant a NESTED console-* file importing _shared/public/ =="
mkdir -p "$(dirname "$CONSOLE_SCRATCH")"
cat > "$CONSOLE_SCRATCH" <<'EOF'
// QA regression scratch file — WBS 3.7 boundary check. Deleted automatically.
// Deliberately nested two directories deep under console-orders/ (no real
// console-* function exists yet — this directory is scratch-only, matching
// the "console-*" zone glob without implying a real function lives here).
import { createPublicClient } from "../../../_shared/public/db.ts";

export const _scratch = createPublicClient;
EOF
echo "Planted: $CONSOLE_SCRATCH"
echo

echo "== Step 6: pnpm lint:functions must FAIL for the nested console-* violation =="
if pnpm lint:functions >"$LOG_DIR/console-violation.log" 2>&1; then
  echo "FAIL: lint:functions passed with console-orders/deep/nested/"
  echo "      importing _shared/public/. THE BOUNDARY RULE DOES NOT REACH"
  echo "      NESTED FILES in the console-* direction either."
  cat "$LOG_DIR/console-violation.log"
  FAIL=1
elif grep -q "console-\* may never import _shared/public/" "$LOG_DIR/console-violation.log"; then
  echo "PASS: lint:functions failed and flagged the nested console-*"
  echo "      violation with the expected message."
else
  echo "PASS (weak): lint:functions failed as expected, but the expected"
  echo "      message text wasn't found — check manually that the right"
  echo "      rule fired."
  cat "$LOG_DIR/console-violation.log"
fi
echo

rm -f "$CONSOLE_SCRATCH"
rm -rf "supabase/functions/console-orders"
echo "Removed: $CONSOLE_SCRATCH"
echo

echo "== Step 7: pnpm lint:functions must PASS again after removing it =="
if ! pnpm lint:functions >"$LOG_DIR/console-cleared.log" 2>&1; then
  echo "FAIL: lint:functions still fails after the console-* violation was"
  echo "      removed — something else is broken, or cleanup didn't work."
  cat "$LOG_DIR/console-cleared.log"
  FAIL=1
else
  echo "PASS: lint:functions is clean again."
fi
echo

if [ "$FAIL" -eq 0 ]; then
  echo "REGRESSION CHECK RESULT: PASS — both zone directions genuinely catch"
  echo "a NESTED violation and clear afterward."
  exit 0
else
  echo "REGRESSION CHECK RESULT: FAIL — see above."
  exit 1
fi
