// No runtime export here on purpose. Consumers import types only, via the
// `@brewledger/db/types` subpath (see package.json `typesVersions`) — the
// Supabase-generated `Database` type in ./types.ts. Nothing in this repo
// opens a Postgres connection through this package; Edge Functions and the
// worker each hold their own `@supabase/supabase-js` / `pg` client (RLS
// runs per-connection role, so a single shared client here would be wrong
// regardless).
export type { Database, Json } from "./types";
