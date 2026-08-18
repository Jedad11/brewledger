// WBS 3.8 QA test helper — a real Postgres client, for building storage RLS
// test fixtures the same way packages/db/tests/helpers/db.ts does. Kept as
// its own copy rather than a cross-package import of packages/db's tests/
// directory (that directory isn't part of @brewledger/db's published
// surface) — same target, same local-only guardrail.
//
// Target: the LOCAL Docker Postgres instance started via `supabase start`
// (supabase/config.toml — local API on :54321, DB on :54322). This
// connection string is the well-known Supabase CLI local default, not a
// secret and not the linked `brewledger-dev` project's credential. Never
// point this at a hosted project.
import { Client } from "pg";

export const LOCAL_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();
  return client;
}

export async function isReachable(): Promise<boolean> {
  try {
    const client = await connect();
    await client.query("select 1");
    await client.end();
    return true;
  } catch {
    return false;
  }
}
