#!/usr/bin/env bash
# WBS 3.7 qa_engineer leg — "Lint rule proof-of-concept" from
# docs/api/surfaces_design.md §7. Mirrors
# scripts/test-import-boundary-regression.sh's plant/assert/remove shape,
# applied to eslint-rules/no-db-row-spread.cjs instead of the cross-app
# import boundary rule.
#
# Method: copy the disabled fixture
# eslint-rules/__fixtures__/no-db-row-spread.violation.ts.disabled to a real
# .ts path under supabase/functions/public-store/ (so it's covered by that
# ESLint config block's typed parserOptions.project — the rule needs the
# TypeScript type checker to resolve whether a spread's operand is a Row
# type), run `pnpm lint:functions`, assert it fails with the EXACT message
# "RL-3 violation: build public DTOs field by field. See WBS 3.7." on both
# violation cases in the fixture (the imported-Row-type case and the local
# /Row$/-suffix-alias case), then remove the copy and confirm clean again.
#
# Usage: bash scripts/test-lint-no-db-row-spread-regression.sh
# Exit code: 0 if the rule genuinely caught both cases and cleared
# afterward. Non-zero otherwise.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

FIXTURE_SRC="eslint-rules/__fixtures__/no-db-row-spread.violation.ts.disabled"
SCRATCH_FILE="supabase/functions/public-store/__qa_no_db_row_spread_scratch.ts"
EXPECTED_MESSAGE="RL-3 violation: build public DTOs field by field. See WBS 3.7."
LOG_DIR="$(mktemp -d)"
FAIL=0

cleanup() {
  rm -f "$SCRATCH_FILE"
  rm -rf "$LOG_DIR"
}
trap cleanup EXIT

if [ ! -f "$FIXTURE_SRC" ]; then
  echo "FAIL: fixture $FIXTURE_SRC not found — was it moved or renamed?"
  exit 1
fi

echo "== Step 1: baseline — pnpm lint:functions should currently pass =="
if ! pnpm lint:functions >"$LOG_DIR/baseline.log" 2>&1; then
  echo "FAIL: lint:functions does not pass on a clean tree. Aborting — cannot"
  echo "      trust the rest of this check on a dirty baseline."
  cat "$LOG_DIR/baseline.log"
  exit 1
fi
echo "PASS: baseline clean."
echo

echo "== Step 2: plant the disabled fixture as a real .ts file under public-store/ =="
cp "$FIXTURE_SRC" "$SCRATCH_FILE"
echo "Planted: $SCRATCH_FILE"
echo

echo "== Step 3: pnpm lint:functions must now FAIL (non-zero exit) =="
if pnpm lint:functions >"$LOG_DIR/violation.log" 2>&1; then
  echo "FAIL: lint:functions passed with a real DB-row spread present in"
  echo "      $SCRATCH_FILE. THE RULE IS NOT ENFORCING. This is an RL-3"
  echo "      breach path — a spread of a full DB row into a public DTO"
  echo "      would ship undetected."
  cat "$LOG_DIR/violation.log"
  FAIL=1
else
  occurrences=$(grep -c "$EXPECTED_MESSAGE" "$LOG_DIR/violation.log" || true)
  if [ "$occurrences" -ge 2 ]; then
    echo "PASS: lint:functions failed and reported the exact message"
    echo "      \"$EXPECTED_MESSAGE\" $occurrences times (expected >= 2 — one"
    echo "      per violation case in the fixture: the imported-Row-type"
    echo "      case AND the local /Row\$/-suffix-alias case)."
  elif [ "$occurrences" -eq 1 ]; then
    echo "FAIL: lint:functions failed but only reported the exact message"
    echo "      once — expected 2 (one per case in the fixture). Only one"
    echo "      of the two violation shapes the rule claims to cover is"
    echo "      actually firing."
    cat "$LOG_DIR/violation.log"
    FAIL=1
  else
    echo "FAIL: lint:functions failed as expected but never printed the"
    echo "      exact expected message \"$EXPECTED_MESSAGE\" — either a"
    echo "      different rule fired, or the message text has drifted from"
    echo "      what this regression check (and the design doc) expect."
    cat "$LOG_DIR/violation.log"
    FAIL=1
  fi
fi
echo

echo "== Step 4: remove the planted copy =="
rm -f "$SCRATCH_FILE"
echo "Removed: $SCRATCH_FILE"
echo

echo "== Step 5: pnpm lint:functions must PASS again (zero exit) =="
if ! pnpm lint:functions >"$LOG_DIR/cleared.log" 2>&1; then
  echo "FAIL: lint:functions still fails after the fixture was removed —"
  echo "      something else is broken, or cleanup did not fully work."
  cat "$LOG_DIR/cleared.log"
  FAIL=1
else
  echo "PASS: lint:functions is clean again after removal."
fi
echo

if [ "$FAIL" -eq 0 ]; then
  echo "REGRESSION CHECK RESULT: PASS — eslint-rules/no-db-row-spread.cjs"
  echo "genuinely catches both violation shapes and clears afterward."
  exit 0
else
  echo "REGRESSION CHECK RESULT: FAIL — see above."
  exit 1
fi
