# Key Inventory

BrewLedger has no payment gateway secret key. RL-1: money moves directly from
the customer's bank to the merchant's own PromptPay account; the EMVCo QR
payload is built locally from the merchant's public PromptPay alias, which is
a routing identifier published in the national directory, not a secret. There
is nothing to rotate here because there is nothing gateway-shaped in this
architecture.

| Key | Where it may live | Where it may never live | Blast radius if leaked | Rotation procedure |
|---|---|---|---|---|
| `anon` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `apps/shop` and `apps/console` env, committed `.env.example` as a name only, the public browser bundle | Nowhere restricted — it is designed to ship in the browser | Low on its own. It only grants what RLS policies allow the `anon` role: published stores, their menu items, their option groups, their open future slots. A leak is only dangerous if an RLS policy is wrong, which is a schema bug, not a key-handling one | Rotate from the Supabase dashboard (Project Settings → API), redeploy both Vercel projects with the new value. No merchant notification needed unless paired with an RLS gap |
| `service_role` key | Supabase Edge Function secrets, Render worker environment variables only | Any `NEXT_PUBLIC_*` variable, any browser bundle, `apps/shop`, `apps/console` client code, any committed file, any log line | **Total compromise.** This key bypasses Row Level Security entirely — every store's cost, margin, stock, and customer data becomes readable and writable by whoever holds it | Rotate immediately from the Supabase dashboard the moment a leak is suspected, redeploy every Edge Function and the Render worker with the new value, then audit access logs for the exposure window. Because the blast radius includes every merchant's financial data, this also requires notifying pilot stores that their data may have been exposed, not just rotating the key |
| Database password | Supabase-managed `DATABASE_URL` (pooler connection string), Render worker environment variables, local `supabase/.env` if used for direct `psql` — never committed | `.env.example` (values), any client-side code, any Edge Function (Edge Functions use `supabase-js` with the `service_role` key, not a direct Postgres connection) | High — direct, unrestricted SQL access to the database, bypassing RLS and PostgREST entirely | Rotate from the Supabase dashboard (Project Settings → Database), update `DATABASE_URL` on Render, confirm no other consumer holds the old string |
| Float16 API key (Typhoon OCR) | `FLOAT16_API_KEY` in Render worker environment variables only | `apps/shop`, `apps/console`, any browser bundle, any Edge Function that a customer's request path touches (OCR is async worker territory per the critical-path rule) | Moderate — a leaked key lets someone spend the merchant's/team's OCR quota, and depending on Float16's account model, may expose billing or read past requests. It does not by itself expose BrewLedger's own database | Rotate from the Float16 dashboard, update the Render environment variable, redeploy the worker |

## Absolutes

- `service_role` key: Render worker and Edge Function secrets only. Never a `NEXT_PUBLIC_*` variable, never in a browser bundle. `packages/shared/src/supabase/admin.ts` throws at import time if `window` is defined, as a runtime backstop — it is not a substitute for keeping the key out of client code in the first place.
- No `.env.example` file may contain a real value — names and comments only. Verified before every commit touching these files with `grep` for the literal project ref and any key material.
- A leaked `anon` key is a non-event by design as long as RLS is correct. A leaked `service_role` key is the worst-case incident this product can have, because it is a total bypass of RL-3 for every merchant at once.
