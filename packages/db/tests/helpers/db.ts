// WBS 3.5 QA test helper — a real Postgres client for schema/RLS/trigger
// tests that a mock cannot prove anything about.
//
// Target: a LOCAL Docker Postgres instance started via `supabase start`
// (see supabase/config.toml — local API on :54321, DB on :54322). The
// connection string below is the well-known, publicly documented default
// that the Supabase CLI itself assigns to every local stack — it is not a
// secret and is not the linked `brewledger-dev` project's credential. Never
// point this helper at a hosted project; see tests/README.md.
//
// Override with TEST_DATABASE_URL if you deliberately want a different
// local target (e.g. a different local port).
import { Client } from "pg";

export const LOCAL_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Opens a fresh client. Callers are responsible for `.end()`-ing it
 * (prefer the `withTx` helper below for anything that writes rows).
 */
export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();
  return client;
}

/**
 * Checks whether the local stack is reachable without throwing. Tests use
 * this in `beforeAll` to skip (not silently pass) when no local Postgres is
 * running, rather than failing with an opaque ECONNREFUSED per test.
 */
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

/**
 * Runs `fn` inside a transaction that is ALWAYS rolled back, even if `fn`
 * throws — the standard, foolproof way to exercise inserts/updates/
 * constraints/triggers against a real database while guaranteeing the
 * database is byte-for-byte unchanged afterwards. No manual DELETE cleanup
 * to get wrong or forget.
 *
 * `fn` receives the client plus `savepoint`/`rollbackToSavepoint` helpers for
 * asserting that a *specific* statement raises without aborting the whole
 * transaction (Postgres aborts the entire tx on the first error until a
 * ROLLBACK or a SAVEPOINT recovery).
 */
export async function withRollback<T>(
  fn: (
    client: Client,
    tx: {
      savepoint: (name: string) => Promise<void>;
      rollbackToSavepoint: (name: string) => Promise<void>;
    },
  ) => Promise<T>,
): Promise<T> {
  const client = await connect();
  try {
    await client.query("begin");
    const tx = {
      savepoint: async (name: string) => {
        await client.query(`savepoint ${name}`);
      },
      rollbackToSavepoint: async (name: string) => {
        await client.query(`rollback to savepoint ${name}`);
      },
    };
    try {
      return await fn(client, tx);
    } finally {
      await client.query("rollback");
    }
  } finally {
    await client.end();
  }
}
