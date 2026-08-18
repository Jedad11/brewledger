// Thin wrapper over the canonical @brewledger/shared logger (WBS 3.11).
// Kept as its own file, re-exporting the same `log.debug/info/warn/error`
// shape the rest of worker/ already calls, so this refactor touches no
// other call site in worker/src/**. Previously this file had its own
// standalone redact()/emit() implementation (WBS 3.3) — that logic now
// lives in packages/shared/src/log.ts so Edge Functions and (eventually)
// apps/shop/apps/console share the exact same redaction rules instead of
// three copies drifting apart.
import { createLogger } from "@brewledger/shared/dist/log";

// runtime "worker": the RL-3 public-cost-redaction rule in the shared
// logger is scoped to runtime === "public" specifically — this worker
// legitimately processes cost_recalc/cost_drift_check jobs and must be
// able to log cost fields when diagnosing them.
export const log = createLogger("worker");
