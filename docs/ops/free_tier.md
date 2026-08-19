# Free-tier limits, mitigations and alert thresholds

WBS 3.10 — Free-Tier Survival Kit. This project runs entirely on free tiers
(Supabase Free × 2 projects, Render Free, Vercel Hobby, Float16 free OCR
quota) because the team cannot clear a GCP card pre-authorisation and cannot
fund GPU-hosted OCR (see `docs/adr/001-infrastructure-choice.md`). Every row
below is a way that choice can take the pilot down if unmitigated.

**Vendor pages checked 2026-08-19** unless a row says otherwise. Supabase and
Vercel numbers were fetched live from `supabase.com/pricing`, `render.com/docs/free`
and `vercel.com/docs/limits/overview` on that date via WebFetch and matched
the dictionary's figures exactly. Float16's pricing page returned HTTP 404 at
check time — that row's numbers are carried over from the WBS dictionary
and are **not independently re-verified against the vendor page**; re-check
before the pilot if Float16's OCR quota becomes a binding constraint.

| Service | Limit | Current usage | Mitigation | WBS entry | Alert threshold | Vendor page checked on |
|---|---|---|---|---|---|---|
| Supabase — database size | 500 MB (Free) | See latest `scripts/check-quota.mjs` run / `ALERT_WEBHOOK_URL` history | Daily quota monitor (`.github/workflows/quota.yml`) with 7-day growth projection; nightly backup as the escape hatch if a hard migration to Pro is needed | 3.10 | warn 70% (350 MB), alert 85% (425 MB) | 2026-08-19, `supabase.com/pricing` |
| Supabase — storage (all buckets) | 1 GB (Free) | See latest quota-monitor run | Same daily monitor, queries `storage.objects` per bucket (`bills`, `menu-images`) | 3.10 | warn 70% (700 MB), alert 85% (850 MB) | 2026-08-19, `supabase.com/pricing` |
| Supabase — egress | 5 GB/mo (+5 GB cached egress) | Not queryable from inside the DB — Supabase does not expose a live egress counter via SQL or a documented public API; only visible on the project dashboard | No automated check possible with the free tier's tooling. Manual: check the dashboard's Usage tab weekly during the pilot | 3.10 | Not automatable yet — flagged as a known monitoring gap, not silently assumed covered | 2026-08-19, `supabase.com/pricing` |
| Supabase — Edge Function invocations | 500,000/mo | Not tracked by this kit (no SQL-queryable counter) | Same manual-dashboard-check gap as egress | 3.10 | Not automatable yet | 2026-08-19, `supabase.com/pricing` |
| Supabase — Realtime concurrent connections | 200 peak | Not tracked by this kit | Pilot scale (single-digit shops) is nowhere near 200; revisit if realtime features expand | 3.10 | Not automatable yet | 2026-08-19, `supabase.com/pricing` |
| Supabase — inactivity pause | Project pauses after 7 days (1 week) with zero activity, goes offline until manually resumed | Mitigated continuously by `.github/workflows/keepalive.yml` (every 6h + a 23:00 UTC / 06:00 Bangkok Render warm-up) | Keep-alive workflow | 3.10 | Any single failed run is itself the alert (posts to `ALERT_WEBHOOK_URL`) | 2026-08-19, `supabase.com/pricing` |
| Supabase — automatic backups | **None on Free** | N/A | Nightly `pg_dump` via `.github/workflows/backup.yml`, 90-day GitHub Actions artifact retention, restore verified via `scripts/restore-drill.mjs` | 3.10 | Any failed nightly run alerts | 2026-08-19, `supabase.com/pricing` |
| Supabase — project count | 2 active projects per org (Free) | 2 in use: `brewledger-dev`, `brewledger-prod` | A restore-drill scratch project must always be deleted immediately after the drill (see log below) — there is no headroom for a third | 3.10 | N/A (hard cap, not a usage percentage) | 2026-08-19, `supabase.com/pricing` |
| Render — spin-down | Free web service spins down after **15 minutes** with no inbound traffic | N/A | `worker` has no customer-blocking route (`docs/ops/render.md`, WBS 3.3) | 3.3 / 3.10 | N/A | 2026-08-19, `render.com/docs/free` |
| Render — cold start | Render's own docs say **"about one minute"**; the WBS dictionary and `docs/ops/render.md` estimate **30–60s** from an unfilled manual timing step | N/A | Dedicated 23:00 UTC / 06:00 Asia/Bangkok warm-up ping (`keepalive.yml` → `morning-warmup` job) so the pilot's first bill scan of the day isn't the one paying it | 3.3 / 3.10 | N/A | 2026-08-19, `render.com/docs/free` |
| Float16 OCR | ~150 pages/day (free tier) | Not tracked by this kit — Float16 has no documented usage-query endpoint at time of writing | None automated yet; OCR volume at pilot scale (single-digit shops, a few bills/day each) is expected to stay well under this | 6.2 | Not automatable yet | per WBS dictionary, not independently re-verified against the vendor page (Float16's pricing page returned HTTP 404 on 2026-08-19) |
| Vercel Hobby — Fast Data Transfer | 100 GB/mo | Not tracked by this kit | Two small Next.js apps (`apps/shop`, `apps/console`) at pilot scale; revisit if traffic grows | 3.4 | Not automatable yet | 2026-08-19, `vercel.com/docs/limits/overview` |
| Vercel Hobby — Fast Origin Transfer | up to 10 GB | Not tracked by this kit | Same as above | 3.4 | Not automatable yet | 2026-08-19, `vercel.com/docs/limits/overview` |

**Known gap:** Supabase egress, Edge Function invocation count, Realtime
concurrency, and Vercel bandwidth have no SQL-queryable or documented public
API counter reachable without a paid observability add-on. `scripts/check-quota.mjs`
covers exactly what the dictionary asked for automated (database size,
storage bytes per bucket, row counts) — the rows above without an automated
check are not silently assumed safe, they are an open manual-check item for
whoever runs the pilot.

## Restore drill log

**A backup that has never been restored is not a backup.** This table must
have **at least one PASS row before the pilot begins** — do not treat the
`backup.yml` workflow as a working safety net until a human has actually
restored one of its dumps into a scratch project and confirmed the row
counts match, per the manual step in `BrewLedger_WBS_Dictionary.md` §3.10 and
using `scripts/restore-drill.mjs`.

| Date | Dump used | Rows before | Rows after | Result | Performed by |
|---|---|---|---|---|---|
| 2026-08-19 | `brewledger-2026-08-19.sql.gz` (real `backup.yml` run #2, `62d904c`) from `brewledger-prod` | orders 0, order_items 0, payments 0, stock_ledger 0, purchase_invoices 0, daily_financials 0 | orders 0, order_items 0, payments 0, stock_ledger 0, purchase_invoices 0, daily_financials 0 | **PASS** — all 6 manifest tables match exactly | User + orchestrating session |

Drill notes: target was a genuinely empty local `supabase start` scratch
database (all 22 migrations applied, `db.seed` temporarily disabled so no
demo data was present before restoring — re-enabled afterward, confirmed
via `git diff` that the config change didn't persist). Restored via
`docker exec -i <db container> psql -U postgres -d postgres < dump.sql`
rather than `scripts/restore-drill.mjs` directly, because this Windows
machine has no local `psql` binary on `PATH` for the script's `spawnSync`
call to find — a real environment gap in the script's assumption, not
fixed here; `psql` reached through Docker instead, and the manifest
comparison was done by hand against the same 6 tables the script checks.
Every error `psql` printed during replay was schema/policy/constraint
"already exists" (58 occurrences — expected, since this target already had
the schema from its own migrations) plus one `storage.buckets` duplicate
key (the two WBS 3.8 buckets are provisioned locally by config, and the
dump's `buckets` row collided with them) — no data-integrity or unexpected
error of any kind. First restore attempt (not logged as a row here) was run
against a target Docker crash-restarted with stale seed data still loaded,
producing a false stock_ledger/purchase_invoices mismatch (3/1 vs the
manifest's 0/0) — not a backup defect, a test-rig mistake (seed data
pre-existing on the target, unrelated to anything the dump restored);
redone from a truly clean target for the PASS row above.

The engineer leg of WBS 3.10 verified the underlying restore mechanism for
real against a local `supabase start` scratch database (not a hosted
project, and not through `backup.yml`/`restore-drill.mjs`'s actual CLI
invocation end-to-end — see `PROGRESS.md` WBS 3.10 for exactly what that
covered and did not) — that is engineering verification of the mechanism,
**not** a drill entry, and does not satisfy the PASS-row requirement above.
