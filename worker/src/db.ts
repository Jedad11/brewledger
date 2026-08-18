// This process is the only deployment target permitted to hold the
// service_role key. It bypasses Row Level Security entirely (RL-3) — never
// port this pattern into apps/shop or apps/console. See
// packages/shared/src/supabase/admin.ts and eslint.config.mjs.
import { Pool } from "pg";
import { createAdminClient } from "@brewledger/shared/dist/supabase/admin";
import { loadWorkerConfig } from "@brewledger/shared/dist/config";
import { log } from "./log";

// WBS 3.9: validated once, at module load (this file is imported first thing
// by src/index.ts), so a missing/misnamed env var fails the whole process at
// startup with a named error instead of surfacing later as an opaque
// undefined deep in a job handler. Deliberately validates the FULL worker
// set (including FLOAT16_API_KEY and VAPID_PRIVATE_KEY, neither used in this
// file) rather than just the three vars below — those two are consumed by
// handlers landing in WBS 6.2/5.8, and this is the one place guaranteed to
// run before any of them do.
const config = loadWorkerConfig();

// The atomic job claim (FOR UPDATE SKIP LOCKED) is raw SQL that PostgREST
// cannot express — this pool talks to Postgres directly via the transaction
// pooler connection string, bypassing PostgREST/RLS same as the admin client.
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 5,
});

pool.on("error", (err) => {
  log.error("pg pool error", { error: err.message });
});

// Reserved for handlers (WBS 6.x/7.x) that need the Supabase client surface
// (storage, RPC) rather than raw SQL. Not used by the queue poller itself.
export const admin = createAdminClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
