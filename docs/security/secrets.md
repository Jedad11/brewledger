# Secret Inventory (WBS 3.9)

This is the fuller secret inventory required by WBS 3.9's own acceptance
criteria: every secret, its blast radius, and a rotation procedure — plus the
gateway note and the rotation-drill record. It supersedes nothing in
[`docs/security/keys.md`](./keys.md) (WBS 3.2); that file scopes strictly to
the two Supabase API keys (`anon` and `service_role`) and their Vercel/Edge
Function/Render custody rules. This file is the superset: it repeats those
two rows for a single point of reference, then adds every other secret in the
system (database password, OCR key, VAPID key) and the rotation-drill record
that WBS 3.9 specifically requires. Where the two files describe the same
key, `keys.md`'s wording is authoritative for custody detail; this file adds
the blast-radius and rotation-steps columns in the format WBS 3.9 asks for.

## No payment gateway secret

Brew Ledger has no payment gateway integration. Money moves directly from the
customer's bank to the merchant's own PromptPay account (RL-1); the EMVCo QR
payload is built locally from the merchant's public PromptPay alias
(`stores.promptpay_id`), which is a routing identifier published in the
national PromptPay directory — not a secret, and not a bank account number.
There is therefore no gateway API key, no gateway merchant ID, and no
sandbox/live credential pair in this system. Consequently there is no
gateway-mode (`sandbox`/`live`) startup assertion in `packages/shared/src/config.ts`
— there is nothing for such an assertion to check. The equivalent hazard in
this architecture — a wrong PromptPay alias silently sending a customer's
money to a stranger — is guarded at data-entry and payload-build time
instead of at process startup:

- **WBS 4.5** — merchant self-verification of the PromptPay alias at setup
  time (the merchant scans their own generated QR and confirms the payee
  name shown by their own banking app before the alias is saved).
- **WBS 5.5** — decoded-payload assertions on every generated QR at order
  time (a forbidden-payee test asserts the payload always names the
  merchant, never a platform account, before the QR is shown to a customer).

Neither WBS entry exists in this repo yet; this note is a forward pointer for
whoever implements them, not an implementation.

## Inventory

| Secret | Purpose | Lives in | NEVER lives in | Blast radius if leaked | Rotation steps |
|---|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses Row Level Security entirely; used by Supabase Edge Functions and the Render worker for the two operations that legitimately need cross-tenant or write access RLS would otherwise block | Supabase Edge Function secrets (`supabase secrets set`), Render worker environment variables | Any `NEXT_PUBLIC_*` variable, any browser bundle, `apps/shop`, `apps/console` client code, any committed file (`.env`, `.env.example` values), any log line (`worker/src/log.ts`'s `redact()` strips any key matching `/key\|secret\|token\|password\|authorization/i` before a log line can carry it, as a backstop — not a substitute for keeping it out of logs in the first place) | **Full read/write access to every merchant's financial data with RLS bypassed.** This is a total compromise: every store's cost, margin, stock, revenue, and customer data becomes readable and writable by whoever holds it. Requires immediate rotation and pilot store notification — not just a key swap | 1. Supabase Dashboard → Project Settings → API → reveal/regenerate `service_role`. 2. `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<new value> --project-ref <prod-ref>` for every Edge Function scope. 3. Update the Render `brewledger-worker` environment variable and trigger a redeploy. 4. Confirm the old key is rejected (`curl` the REST API with the old key, expect 401). 5. Audit Supabase API logs for the exposure window. 6. Notify pilot stores that their data may have been exposed |
| `SUPABASE_ANON_KEY` (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Public client key for `apps/shop` and `apps/console`; grants exactly what RLS allows the `anon` role — published stores, their menu items, their option groups, their open future slots | `NEXT_PUBLIC_SUPABASE_ANON_KEY` in both apps' env, committed `.env.example` as a name only, the public browser bundle (by design) | Nowhere restricted — it is designed to ship in the browser | Low on its own; a leak only matters if an RLS policy is wrong, which is a schema bug, not a key-handling one | Supabase Dashboard → Project Settings → API → rotate `anon`, redeploy both Vercel projects with the new value. No merchant notification needed unless paired with an RLS gap |
| Database password (`DATABASE_URL`) | Direct Postgres connection string for the transaction-pooler, used only where PostgREST cannot express the operation — currently the worker's atomic job claim (`FOR UPDATE SKIP LOCKED` in `worker/src/db.ts`) | Render worker environment variables, Supabase-managed connection string, local `supabase/.env` for direct `psql` if used | `.env.example` (values), any client-side code, any Edge Function (Edge Functions use `supabase-js` with `SUPABASE_SERVICE_ROLE_KEY`, never a direct Postgres connection) | High — direct, unrestricted SQL access, bypassing both RLS and PostgREST entirely | Supabase Dashboard → Project Settings → Database → reset password, update the Render `DATABASE_URL` environment variable, redeploy the worker, confirm no other consumer holds the old string |
| `FLOAT16_API_KEY` | Authenticates OCR calls to Typhoon OCR via the Float16 API (WBS 6.2) for purchase-bill extraction | Render worker environment variables only | `apps/shop`, `apps/console`, any browser bundle, any Edge Function (OCR is async worker territory per the critical-path rule — a human is never waiting on it) | Moderate — a leaked key lets someone spend the team's/merchant's OCR quota and, depending on Float16's account model, may expose billing or read past requests. It does not by itself expose Brew Ledger's own database | Rotate from the Float16 dashboard, update the Render `FLOAT16_API_KEY` environment variable, redeploy the worker |
| VAPID private key (`VAPID_PRIVATE_KEY`) | Signs Web Push messages for order-status notifications (WBS 5.8); paired with a public VAPID key that ships in both browser bundles | Supabase Edge Function secrets, Render worker environment variables | Any `NEXT_PUBLIC_*` variable, any browser bundle, any committed file | Moderate — lets an attacker send push notifications impersonating Brew Ledger to any subscribed browser (spam/phishing vector), and forces re-registration of every push subscription once the key pair changes. Does not expose financial data | Generate a new VAPID key pair (`web-push generate-vapid-keys` or the Supabase/Render equivalent), set the new private key via `supabase secrets set` and the Render environment, ship the new public key in the next `apps/shop`/`apps/console` deploy, accept that existing push subscriptions signed under the old key will silently stop delivering until each browser resubscribes |

## Rotation-drill record

WBS 3.9's acceptance criteria requires that rotation "has been performed once
as a drill" for at least the highest-blast-radius secret. The `service_role`
key is live-in-use by the local dev stack and any deployed environment, so an
actual rotation was **not** performed as part of landing this WBS entry —
doing so against a running system is a live-incident-shaped action, not a
config task, and is explicitly out of scope for this dispatch. What follows
is the documented procedure a human runs to perform (and prove) the drill,
per the dictionary's manual step 5:

1. Open Supabase Dashboard → **Project Settings → API → JWT Settings** for
   the target project.
2. Locate the `service_role` key rotation control (Supabase rotates the
   underlying JWT secret, which invalidates both `anon` and `service_role`
   at once — there is no way to rotate `service_role` alone at the JWT-secret
   layer; see Supabase's docs for the current UI, which has moved between
   "Reveal/Regenerate" and "Rotate JWT secret" across dashboard versions).
3. Trigger the rotation. Supabase issues new `anon` and `service_role`
   values immediately.
4. Update every consumer in the same maintenance window, in this order, to
   minimize downtime: Edge Function secrets (`supabase secrets set` for
   `SUPABASE_SERVICE_ROLE_KEY`), the Render worker's `SUPABASE_SERVICE_ROLE_KEY`
   and `SUPABASE_ANON_KEY`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars on Vercel
   for both `apps/shop` and `apps/console`, then redeploy all three.
5. Confirm the old keys are rejected (401 from a `curl` against the REST API
   using the pre-rotation value).
6. Record the date, operator, and reason (scheduled drill vs. suspected leak)
   in this section.

**Drill log:**

| Date | Operator | Reason | Outcome |
|---|---|---|---|
| _(not yet performed)_ | — | — | — |

A human must perform and log the actual drill against a real Supabase project
before this row can be filled in. Until then, treat this procedure as
reviewed-but-unproven.
