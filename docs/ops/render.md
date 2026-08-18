# Render worker — operations

Service: `brewledger-worker`, defined in `/render.yaml`, deployed from `worker/`
on push to `main`. See WBS 3.3.

## Dashboard settings (must match `render.yaml` exactly)

This service was created manually via the dashboard, not via Blueprint, so
`render.yaml` is documentation of intent, not enforced config — the dashboard
fields below must be set to match it by hand:

- **Root Directory: leave blank** (repo root). Do *not* set it to `worker` —
  in a pnpm monorepo this caused the Build Command to run at repo root (pnpm
  resolves the nearest `package.json`'s script, and with Root Directory unset
  during the actual build phase it picked up the root `pnpm -r build` script)
  while the Start Command's cwd was `worker/`, a real mismatch that produced
  `Error: Cannot find module '.../worker/dist/index.js'` even though the
  build itself succeeded. Keeping both commands anchored at repo root removes
  the ambiguity entirely.
- **Build Command:** `pnpm install --frozen-lockfile && pnpm --filter "@brewledger/worker..." build`
  — the `...` suffix is required, not cosmetic: it also builds
  `@brewledger/shared` (and its own `@brewledger/db` type dependency) in
  topological order, because `worker/src/db.ts` imports
  `@brewledger/shared/dist/supabase/admin` — a plain `--filter @brewledger/worker`
  builds only the worker itself and leaves that import unresolved at runtime.
- **Start Command:** `node worker/dist/index.js`

## Spin-down and cold start

Render's Free plan spins the service down after **15 minutes** with no HTTP
traffic. The next request pays a cold start while the instance boots and
re-establishes its `DATABASE_URL` pool connection.

**Measured cold start: _____ seconds** (fill in after leaving the service idle
20+ minutes and timing a `GET https://<url>/healthz` request — see WBS 3.3
manual step 8). This number feeds the UX design of the bill-scan screen, which
must account for a worker that may not respond immediately.

Because of this spin-down, the poller's own 30-second tick does not run while
the instance is asleep — `run_after` timestamps on queued jobs may be reached
late. Nothing in this system depends on sub-minute job latency; if that
assumption ever changes, this architecture needs revisiting.

## Hard rule: no customer-blocking work here

The only HTTP route on this service is `GET /healthz`. Everything else is
pulled from `job_queue` by the poller. Adding a second route that a customer
or merchant screen waits on synchronously is a defect regardless of whether it
passes tests — a request can sit behind a 30-60 second cold start with no way
to shortcut it. Anything a human is waiting on belongs in a Supabase Edge
Function instead.

## Reading logs

Render dashboard → `brewledger-worker` service → **Logs** tab. Every line the
worker emits is a single JSON object (`worker/src/log.ts`): `level`, `ts`,
`msg`, and job context (`job_id`, `job_type`) where applicable. Filter by
`"level":"error"` to find failures; a job that exhausted its 5 attempts shows
up in `job_queue` with `status='failed'` and a `last_error` — cross-reference
by `job_id`.

Any log field whose key matches `/key|secret|token|password|authorization/i`
is replaced with `[redacted]` before it is written, so the `service_role` key
and `DATABASE_URL` credentials never appear in this log stream even by
accident.

## Environment variables

Set only in the Render dashboard (Environment tab), never committed —
`render.yaml` declares them with `sync: false` for exactly this reason:

| Key | Source |
|---|---|
| `SUPABASE_URL` | prod project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | prod service_role key — bypasses RLS, this is the only deployment target permitted to hold it |
| `DATABASE_URL` | prod transaction pooler connection string |
| `NODE_ENV` | `production` |
