// This process is the only deployment target permitted to hold the
// service_role key. It bypasses Row Level Security entirely (RL-3) — never
// port this pattern into apps/shop or apps/console. See
// packages/shared/src/supabase/admin.ts and eslint.config.mjs.
import { Pool } from "pg";
import { createAdminClient } from "@brewledger/shared/dist/supabase/admin";
import { log } from "./log";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`worker: missing required env var ${name}`);
  return v;
}

// The atomic job claim (FOR UPDATE SKIP LOCKED) is raw SQL that PostgREST
// cannot express — this pool talks to Postgres directly via the transaction
// pooler connection string, bypassing PostgREST/RLS same as the admin client.
export const pool = new Pool({
  connectionString: required("DATABASE_URL"),
  max: 5,
});

pool.on("error", (err) => {
  log.error("pg pool error", { error: err.message });
});

// Reserved for handlers (WBS 6.x/7.x) that need the Supabase client surface
// (storage, RPC) rather than raw SQL. Not used by the queue poller itself.
export const admin = createAdminClient(
  required("SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
);
