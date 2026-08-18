// WBS 3.7 §7 test contract — "Auth guard 401 test", synthetic handler leg.
//
// No real console-* business-logic Edge Function exists yet (design doc §6b
// — this repo hasn't reached WBS 4.x). The design doc's own §7 test contract
// anticipates exactly this gap: "any console-* function once one exists, or
// a synthetic test handler built with withConsoleAuth in the interim". This
// file IS that synthetic handler — it exists solely so
// supabase/functions/_tests/console_auth_guard.test.ts can exercise the real
// withConsoleAuth factory over real HTTP through the real Edge Runtime,
// exactly the way any future console-* function will use it. It carries no
// business logic of its own: on success it echoes back only the merchantId
// the guard resolved (proving the guard's ConsoleContext actually reached
// the handler), never a full row or anything DB-shaped.
//
// Named "qa-console-auth-probe" — deliberately NOT prefixed "_" (the
// Supabase CLI treats a leading-underscore directory under
// supabase/functions/ as shared code, same convention as _shared/, and
// silently does not serve it as a function — confirmed empirically: naming
// this "_test-console-auth-probe" made `supabase functions serve` never
// list or serve it at all) and NOT prefixed "console-" (so it is NOT swept
// up by supabase/functions/eslint.config.mjs's `console-*` import-boundary
// zone — this file is test scaffolding, not a real console-* surface, and
// should not be held to, or credited with covering, that zone's
// _shared/public/ import ban).
import { withConsoleAuth } from "../_shared/console/auth.ts";

Deno.serve(
  withConsoleAuth(async (_req, ctx) => {
    return new Response(JSON.stringify({ ok: true, merchantId: ctx.merchantId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
);
