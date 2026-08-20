// WBS 5.3 — "Slot generation" deliverable. Calls the SQL-side
// generate_pickup_slots_for_store (packages/db/migrations/0028) over the
// pool's direct Postgres connection (worker/src/db.ts) — timezone math
// stays in Postgres, this file's only job is picking WHICH stores to
// generate for and reporting the total.
//
// Two trigger paths, both landing here as the same job_type:
//   - Nightly: job.store_id is null -> every store with hours configured.
//   - On demand: job.store_id is set -> that one store only. Enqueued by
//     apps/console's saveStoreProfile (settings/store/actions.ts) right
//     after a successful save, so a merchant who edits opens_at/closes_at
//     sees slots for the new hours without waiting for the next nightly
//     run. Re-running for a store that already has today's slots is a
//     no-op for those rows (ON CONFLICT DO NOTHING inside the SQL
//     function), so enqueuing on every save rather than diffing old vs new
//     hours is deliberately simple, not wasteful in a way that matters.
import { pool } from "../db";
import { log } from "../log";
import type { Job, JobHandler } from "./types";

const DEFAULT_INTERVAL_MINUTES = 15;
const DAYS_AHEAD = 7;

export const generateSlots: JobHandler = async (job: Job) => {
  const intervalMinutes =
    typeof job.payload.intervalMinutes === "number" && job.payload.intervalMinutes > 0
      ? job.payload.intervalMinutes
      : DEFAULT_INTERVAL_MINUTES;

  const storeIds = job.store_id ? [job.store_id] : await allStoreIdsWithHours();

  let totalInserted = 0;
  for (const storeId of storeIds) {
    const { rows } = await pool.query<{ generate_pickup_slots_for_store: number }>(
      `select generate_pickup_slots_for_store($1, $2, $3) as generate_pickup_slots_for_store`,
      [storeId, intervalMinutes, DAYS_AHEAD],
    );
    totalInserted += rows[0]?.generate_pickup_slots_for_store ?? 0;
  }

  log.info("generate_slots completed", {
    job_id: job.id,
    store_count: storeIds.length,
    slots_inserted: totalInserted,
  });
};

async function allStoreIdsWithHours(): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from stores where opens_at is not null and closes_at is not null`,
  );
  return rows.map((r) => r.id);
}
