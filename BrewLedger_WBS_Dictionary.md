# WBS Dictionary
## Project: Brew Ledger — Financial infrastructure for Thai independent coffee SMEs
**Tech Stack: Next.js (React + TypeScript, responsive / mobile-first) × 2 separate surfaces on Vercel + Supabase (PostgreSQL + Row Level Security + Auth + Storage + Realtime + Edge Functions) + Node.js async worker on Render + Direct merchant-owned PromptPay (locally generated EMVCo QR, no gateway) + Typhoon OCR via Float16 API + Web Push API (VAPID) with polling fallback**

> **Infrastructure decision (locked, revised).** The original plan targeted GCP (Cloud Run + Cloud SQL + GCS + self-hosted PaddleOCR + Firebase Auth). That plan is **withdrawn** because GCP requires a card pre-authorisation hold (~400 THB) the team cannot currently clear, and because self-hosting a vision model demands GPU spend this PoC has no budget for. The replacement stack was selected against three hard constraints: **no card required to sign up, a genuine free tier (not a trial), and no GPU.**
>
> - **Supabase Free** — Postgres, Auth, Storage, Realtime, Edge Functions. No card required.
> - **Render Free** — the only one of Render / Railway / Fly.io that still offers a permanent free tier without a credit card. Railway removed its free tier in 2023 and now requires a card at signup; Fly.io removed free allowances in 2024 and offers only a 2-VM-hour trial. Both are therefore excluded for the same reason GCP was.
> - **Vercel Hobby** — unchanged from the original plan.
> - **Typhoon OCR via Float16** — a Thai-optimised open vision-language OCR model, benchmarked ahead of GPT-4o and Gemini 2.5 Flash on Thai document understanding, served through an API with a **$5/day free credit (~150 pages/day)**. This replaces self-hosted PaddleOCR entirely and removes the GPU requirement.
>
> **Total infrastructure cost through the PoC: 0 THB/month.**

> **The workload split is a hard architectural rule, not a preference.** Render's free tier spins a service down after 15 minutes of inactivity, and the next request pays a 30–60 second cold start. That is fatal on a page where a customer is waiting to buy coffee, and harmless on a bill that is being OCR'd in the background. Therefore:
>
> - **Critical path — customer is waiting** (menu, slot check, order creation, QR issue, payment webhook, order status) → **Supabase Edge Functions**. Never Render.
> - **Async path — nobody is waiting** (OCR extraction, unit-cost recomputation, nightly P&L aggregation, scheduled jobs) → **Render worker**. Never blocking a request.
>
> Any WBS entry that places a customer-blocking request on the Render worker is a defect, regardless of whether it passes its tests.

> **Platform decision (locked).** Brew Ledger is a **web application only**. There is no native app, no Flutter build, no App Store / Play Store submission, and no PWA install requirement. Both surfaces are ordinary responsive web apps opened in a mobile browser. Any WBS entry that implies a native SDK is out of scope by definition. Two browser-native capabilities replace the native equivalents:
>
> - **Order notifications** → Web Push API (VAPID) with a **mandatory polling fallback** inside the Owner Console while the tab is open, because Safari/iOS Web Push support is materially weaker than Android Chrome.
> - **Bill camera capture** → `<input type="file" accept="image/*" capture="environment">` with a MediaDevices `getUserMedia()` path where supported.

> **Surface separation (read before starting any task).** Brew Ledger ships **two distinct front-end surfaces off two distinct API scopes**:
>
> 1. **Owner Console** — authenticated (Phone OTP), merchant-scoped, sees menu, orders, cost, profit, expenses, reports, settings.
> 2. **Customer Web** — completely unauthenticated, single-store scoped, sees menu, options, pick-up time slots, payment, and its own order status.
>
> These are **not** the same codebase route tree and **not** the same API. Every WBS entry below carries a **Surface** row in its metadata table naming which surface it belongs to. If an entry's Surface is `Customer Web`, that entry may never read, join to, serialize, or log a cost, margin, expense, stock, or store-aggregate field. This is Red Line RL-3 and it is enforced structurally, not by convention (see 3.6, 3.7, 8.4).

> Each entry covers: **Scope / Statement of Work**, **Deliverables**, **Acceptance**, **Associated Activities**, a **Claude Code Prompt** (copy-paste ready), and (where technically applicable) **Schema / Pseudocode** and **Testing** blocks.

> **Revision note.** The UI/UX design is complete and delivered as an interactive prototype. Phase 2.0 has been reduced from seven entries to three, and every frontend entry now implements a specification rather than originating a design. See the section **"Design is complete — how this changes every frontend entry"** below before starting any screen work.

---

## 🤖 How to use the Claude Code Prompt blocks

Every entry carries one of two execution markers.

| Marker | Meaning |
|---|---|
| **▶️ Claude Code Prompt** | Paste the fenced block into Claude Code from the repository root. It is written to be self-contained: it states the stack, the file paths, the constraints, and the acceptance criteria. Read the generated diff before accepting it. |
| **🔴 [Manual Action Required]** | Claude Code **cannot** complete this task — it needs a browser, a human identity, a card, a phone, or a dashboard click. The entry opens with an alert, then gives numbered Thai instructions. Claude Code's own job on these entries is limited to consuming the credentials **after** you have obtained them. |

**Rule for Claude Code on manual entries.** When Claude Code reads a WBS entry marked 🔴, it must stop and print the alert below before doing anything else, then print the Thai steps verbatim, then wait. It must not attempt to script around a signup wall, and it must not invent placeholder credentials and continue.

```
⚠️  MANUAL ACTION REQUIRED — WBS {code}
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

---

## 🎨 Design is complete — how this changes every frontend entry

**Revision status.** The UI/UX design was completed in Claude Design and delivered as an interactive prototype with a full handoff specification. This changes the nature of every entry that produces a screen: those entries no longer *design and build*, they **implement an existing specification**. Phase 2.0 has been reduced from seven entries to three accordingly.

### The precedence rule

When an implementation entry and the delivered design disagree, resolve in this order:

| Rank | Source | Why it ranks here |
|---|---|---|
| 1 | **A red line (RL-1 / RL-2 / RL-3)** | Non-negotiable. If the prototype ever contradicts a red line, the red line wins and the prototype is corrected. |
| 2 | **`/docs/design/state_matrix.md`** | Exact Thai copy per state. Never paraphrase it — the copy was written and reviewed deliberately. |
| 3 | **`/docs/design/interaction_spec.md`** | Realtime vs optimistic vs confirm behaviour, timeouts, tap targets. |
| 4 | **`/docs/design/component_inventory.md`** | Prop contracts. |
| 5 | **The prototype HTML/JS in `/design/`** | Rendered reference for anything the documents leave open. |
| 6 | **This WBS entry's own description** | Context and rationale. Where it describes a screen the prototype already defines, the prototype governs. |

### What every frontend entry now does differently

Entries producing a screen — **4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.4, 5.5, 5.8, 5.9, 5.10, 5.12, 6.1, 6.4, 6.5, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7** — are amended as follows, without rewriting each entry:

1. **Do not invent copy.** Every user-facing string comes from `/docs/design/state_matrix.md`. If a string is needed that the matrix does not contain, add it to the matrix in the same pull request rather than inlining it in a component.
2. **Do not invent components.** Use `packages/ui` (2.2). If a component is genuinely missing, add it to the component inventory first, then build it in `packages/ui`, then use it — never define a one-off in an app.
3. **Do not invent states.** The state matrix enumerates every state per screen. Implement all of them, including the ones that feel unlikely — the no-recipe dashboard state is the state most pilot shops will actually be in.
4. **Do not re-derive layout from the entry description.** Open the corresponding prototype screen and match it. The entry's Scope block explains *why* the screen is shaped that way; the prototype is *what* it looks like.
5. **The acceptance criteria in each entry still apply in full**, and the red line clauses still gate. Design completion removes design ambiguity, not verification obligations. In particular 8.4's isolation suite and 8.5's audit are unchanged.

### The one open gap

The transaction ledger (**รายการเดินบัญชี**) **is built** — it lives in `console-reports.js` under the screen key `ledger` — but it is **absent from the `P5 Handoff.md` screen inventory and state matrix**. Because those two documents are the source of truth for every implementation entry, an undocumented screen is one that will quietly not get built. Tracked as GAP-1 in 2.1: document it from the implementation before Phase 7 entries begin. It blocks nothing else.

### Standard prompt preamble

Every frontend entry's Claude Code prompt should be prefixed with this block. It is stated once here rather than duplicated 25 times:

```
Before writing any component, read:
  /docs/design/screen_inventory.md      — which screen, which route, which states
  /docs/design/state_matrix.md          — the exact Thai copy for every state
  /docs/design/interaction_spec.md      — realtime / optimistic / confirm / timeouts
  /docs/design/component_inventory.md   — prop contracts for packages/ui
  /docs/design/rules.md                 — the four rules that do not bend
and open the corresponding screen in the prototype under /design/.

Implement what is specified. Do not paraphrase copy, do not add states, do not define
one-off components, and do not redesign a layout the prototype already settles. If the
specification and this WBS entry disagree on appearance, the specification wins; if either
contradicts a red line, the red line wins and the specification is corrected in the same
pull request.
```

---

## 🚩 Red Lines (project-wide constraints)

These three constraints override feature convenience, schedule pressure, and demo polish. They appear in the **Acceptance** block of every entry they touch, and they are audited as a gate in 8.5. A build that ships any feature in violation of a red line is not a build that ships.

| ID | Red Line | Why it exists | Enforced structurally by |
|---|---|---|---|
| **RL-1** | Customer money must move **directly from the customer's bank to the merchant's own PromptPay account**. Funds may never pass through, rest in, or be orchestrated out of any Brew Ledger account, and no Brew Ledger identifier may ever appear as payee. | Receiving, holding, pooling, or forwarding other people's money attracts Bank of Thailand supervision and risks classification as an unlicensed e-Money service (cf. the PayAll enforcement precedent). The merchant-owned PromptPay model removes the intermediary entirely rather than licensing one, which is the strongest available position. | 4.5, 5.5, 5.6, 5.11, 8.5 |
| **RL-2** | A merchant must be able to **create a menu, publish a store link, take an order, and get paid without ever entering a BOM/recipe**. Costing features degrade gracefully; they never block selling. | The target user is a one-person cafe. Every competitor's unit-costing feature is gated behind mandatory recipe entry, which is precisely why that user never adopts it. Forced BOM entry kills onboarding. | 4.4, 6.7, 6.9, 7.6, 8.5 |
| **RL-3** | Customer Web must **never** expose ingredient cost, unit cost, margin, profit, expense, stock level, or store-level sales aggregates — not in a response body, not in a debug field, not in a JS bundle, not by URL guessing, not by inspecting a network request. | The customer is a stranger with a public link. Cost and margin data is the merchant's competitive information; leaking it destroys merchant trust irrecoverably and is the single most likely way this product loses a pilot store. | 3.6, 3.7, 5.1, 5.10, 8.4, 8.5 |

**RL-3 has a new enforcement surface on this stack.** Because Supabase exposes Postgres directly to the browser through PostgREST, an unprotected table is a public table. On this architecture RL-3 is enforced first by **Row Level Security policies at the database level** (3.6) and only second by application serializers (3.7). A missing RLS policy on this stack is not a code-review nit; it is a live data leak reachable with `curl`.

---

## 📖 Term Glossary

| Term | Meaning |
|---|---|
| **Owner Console** | The authenticated merchant-facing web surface. Route tree `apps/console`, API scope `/functions/v1/console-*`. Requires an OTP session bound to exactly one `merchant_id`. |
| **Customer Web** | The unauthenticated buyer-facing web surface. Route tree `apps/shop`, API scope `/functions/v1/public-*` plus RLS-guarded `anon` reads. Scoped to exactly one `store_slug` taken from the URL. Never issues a user account. |
| **Surface** | Which of the two front ends a WBS entry belongs to. Also the row name in each metadata table. `Shared / Backend` means the entry produces server code consumed by both, in which case the entry must state its serialization boundary. |
| **Edge Function** | A Deno-runtime serverless function hosted by Supabase. Used for every request a human is waiting on. Free tier allowance: 500,000 invocations/month. |
| **Worker** | The Node.js service on Render that drains `job_queue`. Cold-starts after 15 minutes idle; therefore only ever runs work nobody is waiting for. |
| **RLS** | Row Level Security. Postgres-level per-row access policy. On this stack it is the primary RL-3 enforcement mechanism because the database is directly reachable from the browser. |
| **anon key / service_role key** | Supabase's two API keys. `anon` is public, ships in the browser bundle, and is powerless without RLS. `service_role` bypasses RLS entirely and may exist **only** in the Render worker and in Edge Function secrets — never in any Next.js bundle, never in `NEXT_PUBLIC_*`. |
| **Store** | One physical cafe. In MVP a merchant owns exactly one store; the schema carries `store_id` from day one so multi-branch (Phase 2 product, not MVP) does not require a migration. |
| **Store Slug** | The public URL-safe identifier in `brewledger.app/s/{slug}`. The only thing a customer needs. Encoded into the printable store QR. |
| **Time-slot** | A bounded pick-up window (e.g. 08:00–08:15) with a fixed order capacity. Customers may only choose a slot the system has opened and that is not full. |
| **Slot Quota** | The maximum number of orders accepted in one time-slot. When `booked_count >= capacity` the slot auto-closes and disappears from Customer Web. |
| **Paid Order** | An order whose gateway webhook has confirmed settlement. **Only paid orders enter the store queue, notify the merchant, deduct stock, or appear in P&L.** An unpaid order is never work for the merchant. |
| **Cash Sale** | A walk-in sale taken at the counter and typed into the Owner Console by hand. Counts toward revenue, stock deduction, and P&L; carries no gateway fee. Without it, P&L is wrong. |
| **BOM** | Bill of Materials — the per-menu-item recipe mapping menu item → ingredient quantities. **Always optional** (RL-2). |
| **Unit Cost** | The current cost of one base unit of an ingredient (e.g. THB per gram), derived from the most recent confirmed purchase bill. Stored in satang as an integer. |
| **Cost Snapshot** | The unit cost **frozen onto the order line at the moment of sale**. Historical P&L reads snapshots only. Without this, last month's profit silently changes every time milk gets more expensive — which is both accounting-wrong and the fastest way to lose a merchant's trust in the numbers. |
| **Cost per Cup** | `Σ (bom_line.qty_in_base_unit × ingredient.unit_cost)` for one menu item. Undefined (`null`, not zero) when the menu item has no BOM. |
| **Profit per Dish** | Selling price minus cost per cup, ranked by **total profit contribution**, not by units sold or revenue. This ranking is the headline MVP KPI. |
| **Cost Drift** | A rise in an ingredient's unit cost exceeding a configured threshold versus its trailing baseline, which mechanically reduces margin on every menu item using that ingredient. |
| **AI Brief** | The short generated shopping/prep summary shown at the top of the Owner Console dashboard on open, derived from stock levels, upcoming slot bookings, and recent usage rate. |
| **PromptPay Alias** | The merchant's own PromptPay identifier — mobile number, national ID, or tax ID — published in the national PromptPay directory. The only payment detail Brew Ledger stores. It is a routing alias, not a bank account number. |
| **PromptPay Payload** | The EMVCo-format string encoding "pay this alias this amount". Generated locally by a pure function (5.5) with no network call and no credentials. Not a service call and not a regulated activity. |
| **Payment Confirmation** | The merchant's explicit action marking an order paid, after seeing the transfer in their own banking app. Replaces the gateway webhook. Carries the same side effects: stock deduction, notification, P&L inclusion. |

| **Confirmation Guard** | The `and status = 'PENDING_PAYMENT'` predicate that makes payment confirmation idempotent. A merchant double-tapping on a slow connection is the same threat a retrying gateway used to be. |
| **Base Unit** | The canonical measurement unit an ingredient is stored in (`g`, `ml`, `piece`). Purchases arrive in kg/L/pack and are normalized on entry. All cost math happens in base units only. |
| **Stock Ledger** | Append-only movement log for ingredients. Stock level is derived from the ledger, never overwritten in place, so any number on a report can be traced to the movement that caused it. |
| **Project Pause** | Supabase free-tier projects are paused after ~7 days without activity. Mitigated by the keep-alive in 3.10. A paused project is a hard outage, not a slow response. |
| **status: PENDING_PAYMENT** | Order created, gateway QR issued, no confirmed settlement. Invisible to the merchant queue. |
| **status: ACCEPTED** | Payment confirmed. In the merchant queue. Stock deducted. Counts in P&L. |
| **status: PREPARING / READY / COLLECTED** | The three forward transitions the merchant drives; the customer sees each one on the tracking page. |
| **status: CANCELLED / REFUNDED** | Merchant-driven termination, always paired with an automatic gateway refund and a compensating stock ledger entry. |
| **Satang** | All money is stored as an integer number of satang (1 THB = 100 satang). No floats anywhere in the money path. |

---

## 🧩 Requirement Index (MVP feature IDs)

The **Requirement** row in each metadata table refers to these IDs.

| ID | Feature | Surface |
|---|---|---|
| F01 | Reach store via link or QR — no install, no signup | Customer Web |
| F02 | Menu listing with option groups (hot/cold, sweetness) | Customer Web |
| F03 | Pick-up time-slot selection, system-opened slots only | Customer Web |
| F04 | PromptPay QR generated locally, payable to the merchant's own alias | Customer Web |
| F05 | Merchant confirms payment → order enters queue (idempotent) | Owner Console |
| F06 | Real-time / polled order status display | Customer Web |
| F07 | Status lookup by phone number or order code, no login | Customer Web |
| F08 | Merchant login and identity verification via phone OTP | Owner Console |
| F09 | Store name, pick-up address, open/close hours | Owner Console |
| F10 | Menu and price creation with **no forced BOM** | Owner Console |
| F11 | Merchant PromptPay setup with self-verification | Owner Console |
| F12 | Subscription tier management and feature gating | Owner Console |
| F13 | AI Brief — what to buy / prep before opening | Owner Console |
| F14 | Dashboard: today's sales, net profit, expenses, order count | Owner Console |
| F15 | Cost Drift Alert with affected-menu impact | Owner Console |
| F16 | Low stock alert based on real usage rate | Owner Console |
| F17 | New paid order notification (Web Push + polling fallback) | Owner Console |
| F18 | Per-slot order quota and automatic close when full | Owner Console |
| F19 | Order status update propagating to the customer | Owner Console |
| F20 | Cancel / reject order with automatic refund | Owner Console |
| F21 | Manual cash sale entry | Owner Console |
| F22 | Bill photo capture or upload in-browser | Owner Console |
| F23 | OCR extraction of item / qty / price with confirm-or-edit step | Owner Console |
| F24 | Automatic ingredient unit-cost update and per-cup profit recompute | Owner Console |
| F25 | Automatic stock deduction by recipe with unit conversion | Owner Console |
| F26 | Suggested standard BOM the merchant edits rather than authors | Owner Console |
| F27 | Daily P&L | Owner Console |
| F28 | Profit per Dish, ranked by profit | Owner Console |
| F29 | Monthly / yearly comparison with gateway fee breakdown | Owner Console |

**Explicitly out of MVP scope (Phase 2 — do not build):** at-table QR ordering · cash-flow forecasting · AI chatbot advisor · tax suite · multi-branch · report export · cross-store benchmarking.

---

## 👥 Team Roster

> **Two-developer team.** Ownership is split by layer rather than by phase: **M1** owns everything below the API line (platform accounts, data, RLS, payments, OCR, worker, security/QA gate-keeping, and project coordination), and **M2** owns everything a user touches (both front-end surfaces) plus the order/costing/reporting business logic behind them. Where an entry needs both, the metadata table names both, e.g. `M2 (UI), M1 (API)`. Peer review (8.4, 8.5) is necessarily the other person.

| Code | Member | Role | Primary workstreams |
|---|---|---|---|
| **M1** | Jedsadapiphat Daengdeeloet | Backend Infrastructure, Payments & Project Lead | Phase 1.0 project management and red line compliance, Phase 3.0 platform provisioning and schema/RLS, gateway/webhook/payment path, OCR pipeline, Render worker, security and QA gate-keeping |
| **M2** | Woraprat Chaikeenee | Full-Stack Developer (Front-end & Business Logic) | Phase 2.0 design system, Customer Web, Owner Console front-end, order loop and costing business logic, reports |

---

## Phase 1.0 — Project Management

---

### 1.1 Project Kickoff and MVP Scope Lock

| Field | Detail |
|---|---|
| **WBS Code** | 1.1 |
| **Type** | Work Package |
| **Requirement** | Project initiation |
| **Owner** | M1 |
| **Surface** | N/A — planning artefact |
| **Red Line Touch** | RL-1, RL-2, RL-3 (introduced and signed) |
| **Automation** | ▶️ Claude Code (document generation) |

**Scope / Statement of Work**
Run a half-day kickoff that locks the 29 MVP features (F01–F29), the eight WBS phases, and named ownership for every leaf task. The session's second half is a walkthrough of the three red lines and the Phase 2 exclusion list, because the most expensive failure mode on this project is not slipping a date — it is quietly building an aggregator payment flow or a mandatory BOM step and discovering it at pilot time. This revision adds a third agenda item: the infrastructure change from GCP to Supabase/Render/Vercel, and the two new operational risks it introduces (free-tier project pause, worker cold start).

**Deliverables**
- Project plan committed at `/docs/project_plan.md` — phase map, leaf task list, owner per task, dependency notes
- Signed red line acknowledgement page inside the plan, one line per member
- Locked feature list F01–F29 with the Phase 2 exclusion list restated verbatim
- Infrastructure decision record at `/docs/adr/001-infrastructure-choice.md` recording why GCP/Railway/Fly.io were rejected and what the free-tier limits imply
- Scheduled dates for the estimation workshop (1.2), gate review (1.4), and pilot readiness review (1.7)

**Acceptance**
- Every leaf task in the WBS has exactly one named owner, M1 or M2
- Both members have read and signed the red line page
- The Phase 2 exclusion list appears in the plan and no leaf task implements anything on it
- The ADR names the specific free-tier constraints the team has accepted: 500 MB database, 1 GB storage, 7-day pause, 15-minute worker spin-down, 150 OCR pages/day
- Plan is committed to git and linked from the repository README

**Associated Activities**
- Walk F01–F29 and confirm no scope additions
- Assign owners phase by phase
- Read the three red lines aloud and record objections or ambiguities as open questions
- Identify the critical path (gateway sandbox access → 5.5 → 5.6 → 5.7 → 6.x costing → 7.x reports)
- Draft and commit the plan and the ADR

**▶️ Claude Code Prompt**
```
Create the project governance documents for Brew Ledger, a web-only pre-order and
unit-costing product for Thai independent coffee shops. Two-developer team: M1
(Jedsadapiphat, backend/infra/payments/lead) and M2 (Woraprat, frontend/business logic).

Create these files:

1. /docs/project_plan.md
   - Phase map for 8 phases: 1.0 Project Management, 2.0 Design & UX,
     3.0 Platform Setup & Backend Foundation, 4.0 Auth/Onboarding/Merchant Settings,
     5.0 Order Loop, 6.0 OCR/Inventory/Unit Costing, 7.0 Dashboard/Alerts/Reports,
     8.0 QA/Security/Deployment
   - A leaf task table with columns: WBS code, task, owner, depends-on, status
   - A red line acknowledgement section with a signature line per member for RL-1
     (payments settle directly to the merchant's own gateway account, never through
     a Brew Ledger central account), RL-2 (a merchant can sell without ever entering
     a BOM), RL-3 (Customer Web never exposes cost, margin, profit, expense, stock,
     or store aggregates)
   - The locked MVP feature list F01-F29
   - A verbatim Phase 2 exclusion list: at-table QR ordering, cash-flow forecasting,
     AI chatbot advisor, tax suite, multi-branch, report export, cross-store benchmarking
   - The critical path: gateway sandbox access -> QR generation -> webhook -> order
     lifecycle -> costing -> reports

2. /docs/adr/001-infrastructure-choice.md
   Use the standard ADR format (Status / Context / Decision / Consequences).
   Context: the team cannot clear GCP's ~400 THB card pre-authorisation hold, and has
   no budget for GPU inference.
   Decision: Supabase Free (Postgres + RLS + Auth + Storage + Realtime + Edge Functions),
   Render Free (async worker only), Vercel Hobby (two Next.js surfaces), Typhoon OCR via
   the Float16 API (Thai-optimised, $5/day free credit, roughly 150 pages/day).
   Rejected alternatives with reasons: GCP (card hold), AWS (card hold), Railway (free
   tier removed 2023, card required at signup), Fly.io (free allowances removed 2024,
   2-VM-hour trial only), self-hosted PaddleOCR (needs a GPU).
   Consequences: list each accepted free-tier constraint and its mitigation --
   500 MB database, 1 GB storage, 5 GB egress, 7-day inactivity pause, Render 15-minute
   spin-down with 30-60s cold start, 150 OCR pages/day, and no automatic backups.
   State the architectural rule this forces: anything a human waits on runs on Supabase
   Edge Functions; anything nobody waits on runs on the Render worker.

3. /docs/README.md that links both.

Write in English. Use tables where the template above uses tables. Do not invent dates --
leave date fields as TBD placeholders.
```

---

### 1.2 Wideband Delphi Estimation Workshop

| Field | Detail |
|---|---|
| **WBS Code** | 1.2 |
| **Type** | Work Package |
| **Requirement** | Estimation |
| **Owner** | M1 (facilitator), all participate |
| **Surface** | N/A — planning artefact |
| **Red Line Touch** | None |
| **Automation** | ▶️ Claude Code (scaffold only — estimates are human judgement) |

**Scope / Statement of Work**
Run a two-round Wideband Delphi estimation over every leaf task in this dictionary. Each member estimates silently, the group discusses only the outliers, then re-estimates. Tasks with unusually wide spread are flagged for splitting rather than averaged — wide spread on this project almost always means the task hides an unknown. On the revised stack the known-unknowns have changed: gateway KYC turnaround is unchanged, but PaddleOCR accuracy is replaced by **Typhoon OCR accuracy on crumpled Thai market receipts**, and a new one appears — **Supabase RLS policy correctness**, which is easy to write and easy to get subtly wrong.

**Deliverables**
- Estimation table at `/docs/estimates.md` with one agreed story-point figure per leaf task
- Round-1 → round-2 delta log showing convergence
- Outlier list (round-2 variance > 50%) with a decision per item: split, spike, or accept
- Four named spike tasks carried into the risk register (1.5): gateway sandbox onboarding, Typhoon OCR accuracy on real Thai receipts, iOS Safari Web Push reliability, RLS policy verification under an adversarial `anon` key

**Acceptance**
- Every leaf task has a final agreed estimate
- No leaf task remains with > 50% inter-estimator variance without an explicit written decision
- The four known-unknown spikes are scheduled before their dependent tasks start

**Associated Activities**
- Prepare the estimation sheet from this dictionary's leaf list
- Run round 1 (silent, independent)
- Discuss outliers only
- Run round 2
- Compute convergence, record decisions, commit

**▶️ Claude Code Prompt**
```
Generate /docs/estimates.md as an empty Wideband Delphi estimation workbook for the
Brew Ledger WBS.

Read the WBS dictionary at /docs/wbs_dictionary.md and extract every leaf entry
(every "### N.N Title" heading). For each one emit a table row with columns:
WBS code | Task title | Owner | R1-M1 | R1-M2 | Spread % | R2-M1 | R2-M2 | Agreed SP | Decision

Leave all estimate cells blank for humans to fill. Compute nothing.

Below the table add:
- A "Convergence log" section with an empty table: WBS code | R1 spread | R2 spread | Notes
- An "Outliers (>50% variance after round 2)" section with columns:
  WBS code | Spread | Decision (split / spike / accept) | Rationale
- A "Named spikes" section pre-seeded with these four, each with an empty
  owner/target-date/exit-criteria block:
    S1 Gateway sandbox onboarding and KYC eligibility for sole-proprietor pilot stores
    S2 Typhoon OCR extraction accuracy on real crumpled Thai market receipts
    S3 iOS Safari Web Push reliability for merchant order notifications
    S4 Supabase RLS policy verification against an adversarial anon key

Add a short header explaining the two-round rule: estimate silently, discuss only
outliers, re-estimate, and split rather than average any task still above 50% spread.
```

---

### 1.3 Daily Standups

| Field | Detail |
|---|---|
| **WBS Code** | 1.3 |
| **Type** | Work Package |
| **Requirement** | Coordination |
| **Owner** | M1 (scribe), all attend |
| **Surface** | N/A — process artefact |
| **Red Line Touch** | None |
| **Automation** | ▶️ Claude Code (template + generator script) |

**Scope / Statement of Work**
Run a 15-minute standup every working day using the standard three-question format, plus one project-specific fourth question: "did anything you built yesterday touch money, cost, or the customer surface?" That fourth question exists to surface red line risk daily rather than at audit time. Notes are committed so blockers persist across days.

**Deliverables**
- One markdown file per standup at `/docs/standups/YYYY-MM-DD.md`
- Each file records the four answers per attendee plus a blockers section
- A `npm run standup` script that scaffolds today's file from the template
- Any "yes" to the fourth question is cross-linked into the red line compliance register (1.6)

**Acceptance**
- A standup file exists for every working day
- Blockers open longer than 48 hours are escalated at the next standup and added to the risk register
- Every red line touch flagged in standup appears in the 1.6 register within one working day

**Associated Activities**
- Book the recurring slot
- Designate M1 as scribe
- Commit notes immediately after each meeting
- Cross-link red line touches into 1.6

**▶️ Claude Code Prompt**
```
Create the standup tooling for Brew Ledger.

1. /docs/standups/_TEMPLATE.md with, for each of M1 (Jedsadapiphat) and M2 (Woraprat):
   - What I finished yesterday
   - What I am doing today
   - What is blocking me
   - Did anything I built yesterday touch money, cost, or the customer surface?
     (yes/no + WBS code + one line; any "yes" must be copied into
     /docs/red_line_register.md within one working day)
   Then a shared "Blockers" table: blocker | owner | opened date | age in days | escalated?

2. scripts/new-standup.mjs — a plain Node ESM script, no dependencies, that copies the
   template to /docs/standups/<today in Asia/Bangkok, YYYY-MM-DD>.md, refuses to
   overwrite an existing file, and prints the created path.

3. Register it in package.json as "standup": "node scripts/new-standup.mjs".

Keep the script under 40 lines. Use the Asia/Bangkok timezone explicitly -- do not rely
on the host machine's local time.
```

---

### 1.4 Phase Gate Reviews

| Field | Detail |
|---|---|
| **WBS Code** | 1.4 |
| **Type** | Work Package |
| **Requirement** | Progress control |
| **Owner** | M1 |
| **Surface** | N/A — process artefact |
| **Red Line Touch** | RL-1, RL-2, RL-3 (gate criteria) |
| **Automation** | ▶️ Claude Code (template generation) |

**Scope / Statement of Work**
Hold a one-hour gate review at the close of Phases 3.0, 5.0, and 7.0. Each gate assesses completion against acceptance criteria, re-prioritises remaining work, and makes explicit cut decisions if an MVP feature is at risk. A phase does not close on "the code is written"; it closes on its entries' acceptance criteria being demonstrably met, including their red line clauses. Gate 3 acquires a new mandatory item on this stack: proof that RLS is on and correct for every table, because everything downstream inherits that guarantee.

**Deliverables**
- Gate minutes at `/docs/gates/gate_phase_{3,5,7}.md`
- Status per workstream: on-track / at-risk / blocked
- Written cut or deferral decisions with the feature ID affected
- Updated project plan and risk register

**Acceptance**
- Each gate records a status for every entry in the closing phase
- Every deferral names the feature ID and the reason
- No phase is marked closed while any of its red line acceptance clauses is unverified
- **Gate 3 specifically confirms RLS is enabled on every table and that an `anon`-key probe cannot read any merchant-only column (RL-3)**
- **Gate 5 specifically confirms an end-to-end paid order settled into a merchant sandbox account (RL-1)**

**Associated Activities**
- Collect entry-level status ahead of the meeting
- Walk acceptance criteria, not commit logs
- Re-baseline the remaining plan
- Commit minutes

**▶️ Claude Code Prompt**
```
Create three phase gate review templates for Brew Ledger at
/docs/gates/gate_phase_3.md, gate_phase_5.md, and gate_phase_7.md.

Each file has:
- Header: phase name, date (TBD), attendees M1 and M2
- An entry status table: WBS code | Entry title | Acceptance met? (Y/N/Partial) |
  Evidence link | Status (on-track / at-risk / blocked)
  Pre-populate the WBS code and title rows by reading /docs/wbs_dictionary.md and
  selecting the entries belonging to that phase.
- A "Red line verification" block listing every entry in that phase whose
  "Red Line Touch" row is non-empty, with columns: red line | how verified |
  evidence link | verified? (Y/N)
- A "Cut / deferral decisions" table: feature ID | decision | reason | new target phase
- A "Re-baselined plan" section
- A "Gate outcome" line: PASS / PASS WITH CONDITIONS / FAIL, with a rule stated in
  bold that a gate cannot be marked PASS while any red line row is unverified

Add these phase-specific mandatory gate items:
- Gate 3: RLS is enabled on every table; an anon-key probe cannot read any
  merchant-only column; database backup job has run successfully at least once;
  Supabase keep-alive is scheduled and proven.
- Gate 5: an end-to-end paid order settled into a MERCHANT sandbox gateway account,
  not a platform account; a duplicate webhook produced exactly one state transition.
- Gate 7: a zero-BOM store can complete a full sell-to-report cycle with costs shown
  as null rather than zero.
```

---

### 1.5 Risk Register Maintenance

| Field | Detail |
|---|---|
| **WBS Code** | 1.5 |
| **Type** | Work Package |
| **Requirement** | Risk tracking |
| **Owner** | M1 |
| **Surface** | N/A — process artefact |
| **Red Line Touch** | RL-1 (regulatory risk tracking) |
| **Automation** | ▶️ Claude Code (register scaffold with seeded risks) |

**Scope / Statement of Work**
Maintain a living risk register with probability, impact, mitigation, owner, and status. Seeded at kickoff with the risks this project actually carries rather than generic ones. The infrastructure change replaces two GCP-era risks with four free-tier risks that are specific, foreseeable, and each capable of taking the pilot down: Supabase project pause, Render cold start on a customer-visible path, the absence of automatic backups, and the daily OCR page ceiling.

**Deliverables**
- `/docs/risk_register.md` with columns: ID, description, probability (L/M/H), impact (L/M/H), mitigation, owner, status
- Minimum seeded risks: R1 gateway KYC eligibility, R2 OCR accuracy, R3 iOS Web Push, R4 webhook duplication, R5 e-Money reclassification, R6 pilot store churn, **R7 Supabase project pause**, **R8 free-tier quota exhaustion (500 MB DB / 1 GB storage / 5 GB egress)**, **R9 no automatic backups**, **R10 Render cold start leaking onto a customer-blocking path**, **R11 Typhoon OCR daily credit exhaustion**
- R1 is **retired**: the gateway KYC eligibility risk no longer exists because the MVP uses merchant-owned PromptPay, which a sole proprietor sets up with no documents. It is replaced by R1b, the manual-confirmation risk that the new model introduces

**Acceptance**
- Every phase with an external dependency (gateway, OCR API, browser API, free-tier platform) has at least one register entry
- R5 is permanently open for the life of the project and reviewed at every gate
- R7, R9 and R10 each name the WBS entry that implements their mitigation (3.10, 3.10, 3.3)
- Register is updated whenever a standup changes a risk's status

**Associated Activities**
- Seed the register at kickoff
- Review at each standup where status changed
- Review the full register at each gate (1.4)
- Close risks only when their mitigation has actually shipped

**▶️ Claude Code Prompt**
```
Create /docs/risk_register.md for Brew Ledger with columns:
ID | Risk | Probability (L/M/H) | Impact (L/M/H) | Mitigation | Mitigating WBS entry | Owner | Status

Seed exactly these rows with a sensible first-pass probability and impact, and write a
concrete mitigation for each -- not a generic one:

R1b Manual payment confirmation is missed or delayed, so a customer who has paid waits
    while their order sits unconfirmed. This is the risk the merchant-owned PromptPay model
    introduces in exchange for removing gateway KYC entirely. Mitigation: the pending-payment
    section sits at the TOP of the order inbox, the amount is shown large for comparison
    against the merchant's banking app, and unconfirmed orders auto-expire with the slot
    released. Planned upgrade: slip-verification API at roughly 0.14-0.20 THB per slip.
    Owner M1.
R2  Typhoon OCR extraction accuracy on crumpled, faded, or handwritten Thai market
    receipts is below usable. DORMANT as of 2026-08-22: OCR (WBS 6.2/6.3) is deferred, so
    this risk is not currently active. Reopen if OCR is un-deferred. Owner M1.
R3  iOS Safari Web Push is unreliable for merchant order notifications. Mitigation is the
    mandatory in-tab polling fallback. Owner M2.
R4  Gateway webhook duplication or retry double-counts revenue and stock. Mitigation is
    the DB-level unique idempotency key. Owner M1.
R5  Regulatory reclassification as an unlicensed e-Money service if anyone introduces a
    central settlement account. PERMANENTLY OPEN, reviewed at every gate. Owner M1.
R6  Pilot store churn during the PoC. Owner M1.
R7  Supabase free project auto-pauses after ~7 days of inactivity, taking the store link
    offline. Mitigation is the scheduled keep-alive in WBS 3.10. Owner M1.
R8  Free-tier quota exhaustion: 500 MB database, 1 GB storage, 5 GB egress. Mitigation is
    client-side image compression before upload plus the quota monitor in WBS 3.10.
    Owner M1.
R9  Supabase free tier has no automatic backups; a data loss event is unrecoverable and
    the data is merchant financial records. Mitigation is the scheduled logical dump in
    WBS 3.10. Owner M1.
R10 Render free-tier cold start (30-60s) leaks onto a customer-blocking path. Mitigation
    is the architectural rule that only async work runs on Render, enforced by review.
    Owner M1.
R11 Typhoon OCR daily free credit (~150 pages) exhausted as the pilot grows. DORMANT as of
    2026-08-22: OCR (WBS 6.2/6.3) is deferred, so this risk is not currently active. Reopen
    if OCR is un-deferred. Owner M1.

Below the table add a "Review cadence" section stating: reviewed at every standup where
status changed, in full at every phase gate, and that a risk may only be closed when its
mitigation has actually shipped -- not when it is planned.
```

---

### 1.6 Red Line Compliance Register

| Field | Detail |
|---|---|
| **WBS Code** | 1.6 |
| **Type** | Work Package |
| **Requirement** | RL-1, RL-2, RL-3 |
| **Owner** | M1 |
| **Surface** | N/A — governance artefact |
| **Red Line Touch** | RL-1, RL-2, RL-3 |
| **Automation** | ▶️ Claude Code (register generated from this dictionary) |

**Scope / Statement of Work**
Maintain a single register that maps each red line to every WBS entry that touches it, the enforcement mechanism used, and the verification evidence. This is the document the 8.5 audit reads from, and it is the document that makes the difference between "we believe we comply" and "here is the test that proves it". On this stack the RL-3 rows gain a database dimension: each one must cite the **RLS policy** as well as the application serializer, because on Supabase the database is directly reachable by the browser and the serializer is the second line of defence, not the first.

**Deliverables**
- `/docs/red_line_register.md` with one row per (red line × WBS entry) pair
- Columns: red line, WBS entry, enforcement mechanism, verification method, evidence link, status
- RL-1 rows must cite the gateway account configuration and the settlement destination proven in sandbox
- RL-3 rows must cite **both** the RLS policy name and the automated isolation test that proves the case — never a manual check

**Acceptance**
- Every entry in this dictionary with a non-empty **Red Line Touch** row has a corresponding register row
- No RL-3 row is marked verified on the basis of manual inspection alone
- Every RL-3 row on a table-backed entry names a specific RLS policy
- Register is reviewed at every gate (1.4) and is an input to 8.5

**Associated Activities**
- Build the initial register from this dictionary's Red Line Touch rows
- Update as entries complete
- Attach evidence links from the 8.x test suites
- Present at gates

**▶️ Claude Code Prompt**
```
Generate /docs/red_line_register.md for Brew Ledger.

Read /docs/wbs_dictionary.md. For every entry whose metadata table has a non-empty
"Red Line Touch" row, emit one register row per red line named there.

Columns:
Red Line | WBS entry | Entry title | Enforcement mechanism | Verification method |
Evidence link | Status (Not started / In progress / Verified)

Fill "Enforcement mechanism" and "Verification method" from the entry's Acceptance block
where it is stated; otherwise write TBD. Leave "Evidence link" blank and set every Status
to "Not started".

Group the output into three sections, one per red line, each preceded by the red line's
full statement:

RL-1  Customer money moves directly from the customer's bank to the merchant's own
      PromptPay account. Funds never pass through, rest in, or are orchestrated out of any
      Brew Ledger account, and no Brew Ledger identifier may ever appear as payee.
RL-2  A merchant can create a menu, publish a store link, take an order, and get paid
      without ever entering a BOM. Costing degrades gracefully and never blocks selling.
RL-3  Customer Web never exposes ingredient cost, unit cost, margin, profit, expense,
      stock level, or store-level aggregates -- not in a response body, a debug field, a
      JS bundle, by URL guessing, or by inspecting a network request.

Add two rules in bold at the top:
1. An RL-3 row on any table-backed entry MUST name a specific Postgres RLS policy in the
   enforcement column. On Supabase the database is directly reachable from the browser,
   so an application-layer serializer alone is not enforcement.
2. No RL-3 row may be marked Verified on the basis of manual inspection. It requires a
   named automated test from the 8.4 isolation suite.
```

---

### 1.7 PoC Readiness Pack and Final Report

| Field | Detail |
|---|---|
| **WBS Code** | 1.7 |
| **Type** | Work Package |
| **Requirement** | Project deliverable |
| **Owner** | M1 (lead), all contribute |
| **Surface** | N/A — written deliverable |
| **Red Line Touch** | RL-1 (pilot store eligibility) |
| **Automation** | ▶️ Claude Code (document assembly) |

**Scope / Statement of Work**
Assemble the written pack that closes the build and opens the pilot: what was built, what was proven, what was deliberately not built, what it costs to run, and what the go/no-go criteria are for continuing past the PoC. This is the artefact the Innoventure judges and any prospective pilot store read. It must be honest about the free-tier operating constraints rather than presenting the system as production-hardened, because a pilot store that discovers the pause behaviour on its own will not return.

**Deliverables**
- `/docs/poc_readiness.md` — architecture summary, feature coverage F01–F29, red line audit result, known limitations, operating cost, support contacts
- Go/no-go decision criteria for continuing past the PoC, stated numerically before the pilot starts
- Known-limitations section naming the free-tier behaviours in plain language
- Runbook cross-links to 8.9

**Acceptance**
- Every MVP feature is marked shipped / partial / cut with a reason
- The red line audit result from 8.5 is included verbatim, not summarised
- Known limitations explicitly include: project pause behaviour, worker cold start, OCR daily ceiling, no automatic backups beyond the scheduled dump, and no SLA
- The go/no-go criteria are numeric and were written **before** pilot data existed

**Associated Activities**
- Collect status from all phases
- Import the 8.5 audit verbatim
- Write the limitations section without softening it
- Agree go/no-go thresholds with both members and commit them before onboarding store 1

**▶️ Claude Code Prompt**
```
Assemble /docs/poc_readiness.md for Brew Ledger by reading the repository's existing
docs: project_plan.md, adr/001-infrastructure-choice.md, risk_register.md,
red_line_register.md, and the gate minutes in /docs/gates/.

Sections:

1. What Brew Ledger is -- three sentences, no marketing language.
2. Architecture summary -- a text diagram of Vercel (two Next.js surfaces) ->
   Supabase (Postgres + RLS + Auth + Storage + Realtime + Edge Functions) ->
   Render worker -> Typhoon OCR via Float16, plus the licensed payment gateway
   receiving webhooks. State the critical-path vs async-path rule.
3. Feature coverage -- a table of F01 to F29 with columns:
   ID | Feature | Surface | Status (Shipped / Partial / Cut) | Reason if not shipped.
   Populate Status as TBD.
4. Red line audit result -- insert the 8.5 audit verbatim if
   /docs/audits/red_line_audit.md exists; otherwise insert a placeholder marked
   "PENDING -- 8.5 not yet complete" and make it visually obvious.
5. Known limitations -- write these in plain language a cafe owner would understand,
   in Thai as well as English:
     - the store link goes offline if the system is idle for about a week unless the
       keep-alive is running
     - the first bill scan of the day can take up to a minute to start
     - about 150 bill pages per day are covered by the free OCR allowance
     - backups run on a schedule the team controls; there is no vendor SLA
6. Operating cost -- a table of each service, plan, monthly cost (0 THB), and the
   specific quota that will force an upgrade first.
7. Go/no-go criteria for continuing past the PoC -- numeric thresholds with blanks for
   the team to fill BEFORE the pilot starts, covering at minimum: free-to-paid
   conversion rate, number of stores still active at day 90, OCR correction rate, and
   payment success rate.
8. Support contacts and links to the 8.9 runbook.

Mark clearly anywhere data does not yet exist. Never fabricate a metric.
```

---
## Phase 2.0 — Design Intake and System Port

> **Status change (this revision): the UI/UX design is complete.** Phase 2.0 originally contained seven entries covering persona work, route mapping, wireframing, hi-fi design, design-system authoring, flow specification, and usability testing. Six of those are now satisfied by the delivered design package. This phase is reduced to three entries: verify the assets, port the design system into code, and run the usability test that design completion does *not* substitute for.
>
> **Delivered assets** (committed at `/design/`):
>
> | Asset | Contains |
> |---|---|
> | `P0 Foundation.html` | Tokens, semantic colour roles, Thai type scale, money rules, nav shells, all component states |
> | `Customer Web.html` | 7 customer screens, fully interactive |
> | `Owner Console.html` | Login, dashboard, orders, order detail, quick sale, notifications |
> | `Console Setup.html` | Store profile, menu list, item editor + recipe block, payments, link/QR, plan |
> | `Console Reports.html` | Bill capture, bill review, inventory, P&L, profit-per-dish, period comparison |
> | `brewledger-tokens.css` | Project token layer — semantic money colours, tap targets, 8 order-status treatments |
> | `_ds/brewledger-design-system-.../` | Base design system: colours, typography, spacing, effects, adherence lint config |
> | `P5 Handoff.md` | Screen inventory, state matrix with exact Thai copy, interaction spec, component inventory |
>
> Every prototype carries a hidden state switcher (press **D**) exposing the alternate states.

---

### 2.1 Design Asset Intake and Gap Verification

| Field | Detail |
|---|---|
| **WBS Code** | 2.1 |
| **Type** | Work Package |
| **Requirement** | All UI features |
| **Owner** | M2 |
| **Surface** | Both |
| **Red Line Touch** | RL-2, RL-3 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Commit the design package into the repository, verify it against the locked feature list, and record what it does *not* cover. Design completion is not the same as design coverage: the package must be checked screen by screen against F01–F29 before any implementation entry treats it as authoritative. One gap is already known and is recorded below rather than discovered mid-build.

**Deliverables**
- Design package committed at `/design/` with the directory structure preserved
- `/docs/design/coverage.md` — every feature F01–F29 mapped to the prototype screen implementing it, or marked as a gap
- `/docs/design/gaps.md` — screens specified but not built, with a decision per item
- The `P5 Handoff.md` state matrix and component inventory extracted into `/docs/design/` as the canonical implementation reference

**Acceptance**
- Every screen listed in the `P5 Handoff.md` screen inventory opens and its state switcher works
- Every feature F01–F29 is either mapped to a screen or listed in `gaps.md` with an owner and a decision
- **Every screen present in the prototype has a corresponding row in the screen inventory.** Verify by enumerating the `TABS` and `SCREENS` maps in each prototype's JS and reconciling against the inventory — a screen that exists in code but not in the documentation will not be implemented. One such screen is already known: the transaction ledger (GAP-1).
- The design system's own adherence lint config (`_adherence.oxlintrc.json`) is wired into the repo lint pipeline

**Associated Activities**
- Commit the package
- Walk every screen and every state switcher position
- Map screens to F01–F29
- Record gaps and decide each one
- Wire the adherence lint config

**▶️ Claude Code Prompt**
```
Ingest the completed BrewLedger design package and verify its coverage.

1. Commit the design package to /design/ preserving its structure:
     /design/P0 Foundation.html
     /design/Customer Web.html
     /design/Owner Console.html
     /design/Console Setup.html
     /design/Console Reports.html
     /design/brewledger-tokens.css
     /design/_ds/brewledger-design-system-.../   (tokens, styles, bundle, manifest, adherence config)
     /design/P5 Handoff.md
   Add /design/README.md explaining that every prototype has a hidden state switcher on
   the D key, and that P5 Handoff.md is the canonical specification that outranks any
   inference drawn from looking at a screen.

2. Extract from P5 Handoff.md into separate reference files so implementation entries can
   cite them precisely:
     /docs/design/screen_inventory.md   (section 1)
     /docs/design/state_matrix.md       (section 2 — includes exact Thai copy per state)
     /docs/design/interaction_spec.md   (section 3 — realtime, optimistic, confirm, timeouts)
     /docs/design/component_inventory.md (section 4 — component props contracts)
     /docs/design/rules.md              (section 5 — the four non-negotiable rules)

3. Produce /docs/design/coverage.md: read the Requirement Index (F01-F29) from
   /docs/wbs_dictionary.md and the screen inventory, and emit a table:
   Feature ID | Feature | Prototype screen | Prototype file | Covered? (Y/N/Partial)

4. Produce /docs/design/gaps.md listing anything specified but not delivered. Seed it with
   the one gap already identified:

     GAP-1  รายการเดินบัญชี (transaction ledger) — BUILT BUT UNDOCUMENTED
            The screen EXISTS and is complete in the delivered package. It is implemented in
            console-reports.js under the screen key `ledger`, registered in TABS as
            ['ledger','รายการเดินบัญชี'], and reachable from Console Reports.html.
            What is missing is documentation: it has no row in the P5 Handoff screen
            inventory and no section in the state matrix. Since those two documents are the
            source of truth for every implementation entry, an undocumented screen is a
            screen that will not get built.
            Action: add it to /docs/design/screen_inventory.md and
            /docs/design/state_matrix.md by reading the implementation directly. Record:
              route            /console/transactions  (assign this route; the prototype does
                               not name one because Console Reports.html is a tabbed shell)
              surface/auth     Console / authenticated
              views            รายวัน (default) and รายเดือน, toggled by a segmented control
              daily columns    เวลา / รายการ / ประเภท / จำนวนเงิน
              summary bar      รับเข้า / จ่ายออก / คงเหลือสุทธิ, net figure largest
              monthly columns  วันที่ / จำนวนรายการ / รับเข้า / จ่ายออก / คงเหลือ + month total
              row types (6)    ขายออนไลน์ / ขายหน้าร้าน / ซื้อวัตถุดิบ / ค่าธรรมเนียม /
                               ค่าธรรมเนียม (BrewLedger ออกให้) / คืนเงิน
              row linking      rows carry data-src="order" | "bill" to open the source record
              states (3)       default · วันที่ไม่มีรายการ · กำลังโหลด, plus the
                               วันที่มีแต่เงินสด variant (the common case for a shop still
                               awaiting gateway approval)
              empty copy       วันนี้ยังไม่มีรายการ /
                               รายการจะขึ้นที่นี่เมื่อมีการขายหรือบันทึกบิลซื้อ
              absorbed fee     rendered as its own muted row type and EXCLUDED from จ่ายออก
                               (verified in code: dayOut filters k!=='feeabs'), with the note
                               ค่าธรรมเนียมที่ BrewLedger ออกให้ แสดงไว้ให้เห็นโครงสร้างต้นทุนจริง
                               แต่ไม่ได้นับรวมในยอดจ่ายออก
            Owner: M2. Blocks: nothing. Must be closed before the Phase 7 entries start so
            the screen is not silently dropped from the build.

5. Wire /design/_ds/.../_adherence.oxlintrc.json into the repository lint pipeline so
   generated frontend code is checked against the design system automatically. If the rules
   conflict with the RL-3 import boundary from WBS 3.1, the RL-3 rule wins — document any
   conflict in /docs/design/README.md rather than silently disabling either.

6. Do NOT modify any file inside /design/. It is a delivered artefact and the reference of
   record. Implementation work reads from it and never edits it.
```

---

### 2.2 Design System Port to `packages/ui`

| Field | Detail |
|---|---|
| **WBS Code** | 2.2 |
| **Type** | Work Package |
| **Requirement** | All UI features |
| **Owner** | M2 |
| **Surface** | Both |
| **Red Line Touch** | RL-3 (import boundary) |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Convert the delivered CSS token layer and prototype markup into the typed React component package both Next.js apps import. This replaces the original 2.5 entry, which called for authoring a design system from scratch — that work is done, and what remains is a mechanical but exacting port. The risk in this entry is drift: a component that looks right but silently loses a token, a state, or a tap-target rule. The acceptance criteria therefore compare rendered output against the prototype rather than against a description of it.

**Deliverables**
- `packages/ui` containing the token layer and every component in the `P5 Handoff.md` component inventory
- Tailwind preset generated from the delivered CSS custom properties — not hand-transcribed
- Typed props matching the component inventory contracts exactly
- Component gallery rendering every component in every state with the Thai copy from the state matrix
- Visual comparison against the prototype for each component

**Acceptance**
- **Every component in the `P5 Handoff.md` inventory exists in `packages/ui` with the exact prop contract specified**
- `MoneyValue` renders `—` for `null` and never `0` — asserted by unit test, per the delivered rules
- `OnboardingStrip` cannot accept a recipe step — enforced by its type, not by convention (RL-2)
- Tap-target tokens are preserved: `--tap-min: 44px`, `--tap-wet: 56px`, and `StatusButton` cannot be rendered below 56px
- All 8 order-status treatments match the delivered token values exactly
- `packages/ui` contains no cost, margin, or profit *formatting logic* beyond `MoneyValue`'s null handling, because this package is imported by the unauthenticated Customer Web surface (RL-3)

**Associated Activities**
- Generate the Tailwind preset from the delivered CSS
- Port components one at a time, comparing rendered output to the prototype
- Write the prop contracts from the component inventory
- Build the gallery with real Thai copy
- Verify token fidelity by diff, not by eye

**▶️ Claude Code Prompt**
```
Port the delivered BrewLedger design system into packages/ui as typed React components.

SOURCE OF TRUTH, in this order of precedence:
  1. /docs/design/component_inventory.md   — prop contracts
  2. /docs/design/state_matrix.md          — every state and its exact Thai copy
  3. /design/brewledger-tokens.css         — project token layer
  4. /design/_ds/.../tokens/*.css          — base design system tokens
  5. The prototype HTML/JS files           — rendered reference
Never infer a value from a screenshot when a token exists for it.

1. Token pipeline — generate, do not transcribe.
   Write scripts/build-tokens.mjs that parses the CSS custom properties from
   /design/_ds/.../tokens/*.css and /design/brewledger-tokens.css and emits:
     packages/ui/src/tokens.css        (the custom properties, imported by both apps)
     packages/ui/tailwind-preset.ts    (a Tailwind theme extension derived from the same values)
   Hand-transcribing these values will introduce drift. Parse them.
   Preserve exactly: --font-thai stack (Noto Sans Thai leads because Manrope has no Thai
   glyphs), --lh-thai-body 1.5, --lh-thai-head 1.35, --tap-min 44px, --tap-wet 56px,
   the semantic money roles, and all 8 order-status bg/fg pairs.

2. Components — implement every entry in the component inventory with its exact prop
   contract:
     MoneyValue          value: number|null (satang), role, decimals?, size?
     OrderStatusBadge    status: 8-value union; 'ready' is the only filled badge
     OrderCard           order, variant: 'inbox'|'detail', showNextAction, unseen, handlers
     SlotPicker          slots, value, onChange, showRemainingBelow = 2, fullMessage
     ConfidenceField     label, value, confidence: 'high'|'low', unit?, onChange, autoFocusIfLow
     EmptyState          title, body, action?  (action omitted where the empty state is
                         legitimately optional — inventory and recipes)
     UntrackedDisclosure trackedCount, totalCount, untrackedRevenue?, variant
     StatusButton        label, onPress, minHeight: 56, optimistic: true
     OnboardingStrip     steps: [store, menu, payments]
     RecipeBlock         itemName, recipe, suggestion, onUse, onChange
     MetricCard          label, value: number|null, role, note?
     NavShell            surface, active, badge?  — bottom bar <1280px, sidebar >=1280px

3. Type-level enforcement of the delivered rules — make violations compile errors:
   - MoneyValue's value prop is `number | null`, never `number | undefined` defaulting to 0.
     Unit-test that null renders "—" and that no code path can produce "0" for a null input.
   - OnboardingStrip's steps prop is a fixed tuple type of exactly
     ['store','menu','payments']. A recipe step must not be expressible. Cite RL-2 in a
     comment.
   - StatusButton's minHeight is typed as the literal 56, not number.
   - RecipeBlock has no `required` or `error` prop and no validation surface at all.

4. Gallery at packages/ui/src/gallery.tsx rendering every component in every state, using
   the exact Thai strings from /docs/design/state_matrix.md. This gallery is the artefact
   used to verify the port visually against the prototype.

5. packages/ui/README.md documenting: the source-of-truth precedence above, the rule that
   this package must never gain cost/margin/profit formatting logic beyond MoneyValue's
   null handling (RL-3, because Customer Web imports it), and the instruction that changing
   a token means changing the source CSS and re-running the build, never editing the
   generated output.

6. Fidelity check: for each component, render the gallery entry and the corresponding
   prototype element and diff the computed styles for font-family, font-size, line-height,
   colour, and min-height. Report any divergence rather than silently accepting it.
```

**Testing**
- Unit: `MoneyValue(null)` renders `—`; no input produces `0` for an unknown value
- Type: a recipe step passed to `OnboardingStrip` fails typecheck
- Type: `StatusButton` with `minHeight` below 56 fails typecheck
- Token: generated Tailwind preset values match the source CSS exactly
- Visual: computed styles match the prototype for every component

---

### 2.3 Usability Testing — 15-Minute Onboarding Target

| Field | Detail |
|---|---|
| **WBS Code** | 2.3 |
| **Type** | Work Package |
| **Requirement** | F08, F09, F10 |
| **Owner** | M2 |
| **Surface** | Both |
| **Red Line Touch** | RL-2 |
| **Automation** | ▶️ Claude Code (protocol) + 🔴 Manual (sessions) |

**Scope / Statement of Work**
Test the delivered prototype with real cafe owners. This entry survives the design completion unchanged in purpose, because a finished design is evidence of intent, not evidence of comprehension. The measurement is unchanged: can a merchant who has never seen the product reach a published store link that can take an order, unaided, in under 15 minutes. The advantage now is that the test runs against a genuinely interactive prototype rather than a lo-fi stand-in, so findings are more likely to hold in the built product.

**Deliverables**
- `/docs/design/usability_protocol.md` — tasks, facilitator script, may-say/must-not-say list
- Recording sheet per participant
- Minimum 3 merchant participants and 5 customer participants
- Findings report with a prioritised fix list, each item mapped to the prototype screen and the implementing WBS entry

**Acceptance**
- At least 2 of 3 merchants publish a working store link in under 15 minutes unaided
- **No merchant is blocked by, or asks about, a recipe step during onboarding (RL-2)** — if one opens the recipe block unprompted that is recorded as a finding, not a task
- All 5 customer participants reach the QR screen without asking a question
- Every blocking or major issue has an owner, a target WBS entry, and a decision before that entry starts
- Findings that require a design change are fixed in the prototype **before** the corresponding implementation entry begins, not after

**Associated Activities**
- Recruit participants
- Run sessions against the delivered prototype, using the state switcher to reach edge states
- Record times and verbatim Thai quotes
- Triage findings and route each to a prototype fix or an implementation note

**▶️ Claude Code Prompt**
```
Create /docs/design/usability_protocol.md and /docs/design/usability_recording_sheet.md
for testing the completed BrewLedger prototype.

Test against the delivered prototypes in /design/ — Customer Web.html for the customer
flow, and Owner Console.html plus Console Setup.html for the merchant flow. The hidden
state switcher (D key) is for the FACILITATOR only, to set up a scenario before the
participant starts. Never demonstrate it to a participant.

Protocol:
- Objective as one number: a merchant who has never seen this product reaches a published
  store link that can accept an order, unaided, in under 15 minutes. State why 15 minutes:
  it is the length of a real lull between customers, the only moment this user tries new
  software.
- Participants: 3+ independent cafe owners, 5+ people with no prior exposure.
- Merchant tasks, given as goals not instructions:
    T1 sign in with your phone number
    T2 set up your shop so a customer can find it
    T3 add three drinks you actually sell, with prices
    T4 get the link a customer would use
  No recipe task. If a participant opens the recipe block unprompted, record it — that is
  a finding about the design, not a task they were meant to complete.
- Customer tasks:
    T1 order two iced lattes for pick-up tomorrow morning
    T2 find out whether your order is ready
- Facilitator script with explicit MAY SAY / MUST NOT SAY lists. May restate a goal; must
  never name a button, point at the screen, or explain a concept.
- Edge-state scenarios to set up with the state switcher before specific participants:
    one merchant starts on the no-recipe dashboard state
    one customer starts with all of today's slots full
    one customer hits the expired-QR state mid-task
- Thai consent and recording notice for the participant to read.

Recording sheet, one page per participant:
- Metadata: role, shop size, current tools, app comfort 1-5
- Per task: start, end, completed unaided Y/N, tap count, errors, hesitations
- Verbatim quote section — instruct the note-taker to write exactly what was said in Thai,
  never a summary
- Issue log: issue | severity (blocking/major/minor) | task | prototype screen | owner |
  target WBS entry | fix in prototype or note for implementation?
- A dedicated RL-2 field: "Did the participant ask about, look for, or get blocked by
  ingredients / recipe / cost entry?" Any yes escalates immediately.

Add a rule at the top: any finding that requires a design change is fixed in the PROTOTYPE
before the implementing WBS entry starts. Implementing a screen known to have a usability
defect and fixing it later costs more than fixing the prototype now.
```

---

## Phase 3.0 — Platform Setup, Backend Foundation and Infrastructure

> **This phase carries the majority of the project's manual actions.** Every platform account below must be created by a human before any dependent entry can run. Do them in order — 3.2 before 3.3 before 3.4 — because each one produces credentials the next consumes. None of them requires a credit or debit card.

---

### 3.1 Repository, Monorepo Layout and CI

| Field | Detail |
|---|---|
| **WBS Code** | 3.1 |
| **Type** | Work Package |
| **Requirement** | Foundation |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-3 (import boundary lint rule) |
| **Automation** | 🔴 Manual (GitHub repo creation) + ▶️ Claude Code (everything inside it) |

**Scope / Statement of Work**
Stand up the pnpm monorepo that holds both front-end surfaces, the shared UI package, the Supabase Edge Functions, the Render worker, and the database migrations. The single most important structural decision in this entry is the **import boundary**: `apps/shop` must be physically incapable of importing from `apps/console` or from any module that handles cost, and this must fail CI rather than fail review. RL-3 is cheap to enforce here and expensive to retrofit.

**Deliverables**
- Monorepo at the layout below, pnpm workspaces, TypeScript project references
- ESLint rule set including a `no-restricted-imports` boundary blocking `apps/shop` → `apps/console` and `apps/shop` → `packages/costing`
- GitHub Actions CI: install → typecheck → lint → unit test → build, on every PR
- Conventional commits and a PR template that includes a red line checkbox
- `.env.example` at every package root documenting required variables without values

**Acceptance**
- `pnpm install && pnpm build` succeeds from a clean clone
- **A deliberate import of a costing module from `apps/shop` fails CI with a clear error (RL-3)**
- CI runs on every PR and blocks merge on failure
- No secret value is committed anywhere in history

**Associated Activities**
- Create the repo and protect `main`
- Scaffold the workspace layout
- Write and test the boundary lint rule with a deliberate violation
- Wire CI and confirm it blocks

**🔴 [Manual Action Required] — GitHub repository creation and branch protection**

```
⚠️  MANUAL ACTION REQUIRED — WBS 3.1
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

**ขั้นตอนที่ต้องทำเอง:**
1. เข้า `https://github.com` สมัครบัญชี (ถ้ายังไม่มี) — ใช้บัญชีทีมหรือบัญชีส่วนตัวของ M1 ก็ได้ **ไม่ต้องใช้บัตร**
2. กด **New repository** ตั้งชื่อ `brewledger` เลือก **Private** และ **ไม่ต้อง** ติ๊ก Add README (เราจะสร้างเอง)
3. เชิญ M2 เข้าร่วม: **Settings → Collaborators → Add people** ใส่ username ของ M2 ให้สิทธิ์ **Write**
4. ตั้ง branch protection: **Settings → Branches → Add branch protection rule**
   - Branch name pattern: `main`
   - ติ๊ก **Require a pull request before merging**
   - ติ๊ก **Require status checks to pass before merging** (เลือก check ชื่อ `ci` หลังจากรัน CI ครั้งแรกแล้ว)
5. เปิด GitHub Actions: **Settings → Actions → General → Allow all actions**
6. ที่เครื่องตัวเอง รันคำสั่งนี้เพื่อเชื่อม repo (แทน `<user>` ด้วยชื่อบัญชีจริง):
   ```
   git init
   git remote add origin https://github.com/<user>/brewledger.git
   ```
7. แจ้ง URL ของ repo กลับมาให้ Claude Code เพื่อใช้ในขั้นตอนถัดไป

**▶️ Claude Code Prompt**
```
Scaffold the Brew Ledger monorepo. pnpm workspaces + TypeScript project references.

Layout:
  apps/shop            Next.js 15 App Router -- Customer Web, UNAUTHENTICATED
  apps/console         Next.js 15 App Router -- Owner Console, phone-OTP authenticated
  packages/ui          shared design system (already specified in WBS 2.5)
  packages/db          SQL migrations, seed scripts, generated DB types
  packages/costing     unit costing / BOM / margin logic -- MERCHANT ONLY
  packages/shared      types and pure helpers safe for BOTH surfaces
  supabase/functions   Supabase Edge Functions (Deno) -- the critical request path
  worker               Node.js service deployed to Render -- async jobs only
  scripts              ops scripts (keep-alive, backup, quota check)

Root config: pnpm-workspace.yaml, tsconfig.base.json with path aliases, .editorconfig,
.gitignore (must ignore .env, .env.local, *.key, and any dump file), .nvmrc pinned to
Node 20.

CRITICAL -- the import boundary. Add ESLint config so that these all FAIL lint:
  - anything under apps/shop importing from apps/console
  - anything under apps/shop importing from packages/costing
  - anything under apps/shop or packages/ui importing a module whose path matches
    /costing|margin|profit|expense|stock|bom|recipe/
Implement with eslint no-restricted-imports patterns plus an eslint-plugin-boundaries
zone config. The error message must read:
  "RL-3 violation: Customer Web may not import merchant cost logic. See WBS 3.1."
Then PROVE it: create apps/shop/src/__boundary_test__/violation.ts.disabled containing a
forbidden import, and document in packages/db/README.md how to rename it to .ts to verify
CI fails. Do not leave an active violation in the tree.

CI at .github/workflows/ci.yml, job name exactly "ci", triggered on pull_request and
push to main:
  pnpm install --frozen-lockfile -> pnpm typecheck -> pnpm lint -> pnpm test -> pnpm build
Cache the pnpm store. Fail fast.

Also create:
  - .github/pull_request_template.md with a mandatory checklist:
      [ ] Does this PR touch money, cost, or the Customer Web surface?
      [ ] If yes, which red line (RL-1 / RL-2 / RL-3) and how is it enforced?
      [ ] Red line register (/docs/red_line_register.md) updated?
  - .env.example at every package root listing required variable NAMES with empty values
    and a comment for each. Never a real value.
  - commitlint with conventional commits.
  - Root README.md documenting the layout, the import boundary rule, and the
    critical-path-vs-async-path architectural rule.
```

---

### 3.2 Supabase Project Provisioning and Environments

| Field | Detail |
|---|---|
| **WBS Code** | 3.2 |
| **Type** | Work Package |
| **Requirement** | Foundation |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-3 (key handling) |
| **Automation** | 🔴 Manual (account + project creation) |

**Scope / Statement of Work**
Create the Supabase organisation and the two projects the free tier allows — one production, one development — and capture the credentials the rest of the build consumes. The free tier permits exactly **two active projects**, which is why there is no separate staging: development doubles as staging and is expected to be paused periodically, while production is kept alive by 3.10. Understanding the key model here is the single highest-consequence piece of knowledge in the project: `anon` is public and safe only because RLS exists; `service_role` bypasses RLS entirely and leaking it is a total compromise.

**Deliverables**
- Supabase organisation with two projects: `brewledger-prod`, `brewledger-dev`
- Database password stored in the team password manager, never in git
- Captured per project: Project URL, `anon` key, `service_role` key, direct connection string, pooler connection string
- Supabase CLI linked locally and able to run migrations against `dev`
- A written key-handling rule committed to `/docs/security/keys.md`

**Acceptance**
- Both projects exist and are reachable
- `supabase link` and `supabase db push` succeed against `dev`
- `service_role` key appears **only** in Render environment variables and Supabase Edge Function secrets — never in any `NEXT_PUBLIC_*` variable, never in a client bundle, never in git
- The team can state, without looking it up, which key is safe in a browser and why

**Associated Activities**
- Create the organisation and both projects
- Record credentials in the password manager
- Install and link the CLI
- Write the key-handling rule and have both members read it

**🔴 [Manual Action Required] — Supabase account, projects, and credentials**

```
⚠️  MANUAL ACTION REQUIRED — WBS 3.2
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

**ขั้นตอนที่ต้องทำเอง:**
1. เข้า `https://supabase.com` กด **Start your project** แล้วสมัครด้วย **GitHub account** (ใช้บัญชีเดียวกับข้อ 3.1) — **ไม่ต้องใช้บัตรเครดิต/เดบิต**
2. สร้าง Organization ชื่อ `BrewLedger` เลือกแผน **Free**
3. กด **New project** สร้างโปรเจกต์แรก:
   - Name: `brewledger-dev`
   - Database Password: กด **Generate a password** แล้ว **คัดลอกเก็บไว้ทันที** (Supabase จะไม่แสดงให้ดูอีก)
   - Region: เลือก **Southeast Asia (Singapore)** — ใกล้ไทยที่สุด latency ต่ำสุด
   - รอประมาณ 2 นาทีจนสถานะขึ้นเป็น *Active*
4. ทำซ้ำข้อ 3 อีกครั้งเพื่อสร้าง `brewledger-prod` (รหัสผ่านคนละตัวกัน)
   > ⚠️ แผน Free ให้ **แค่ 2 โปรเจกต์ที่ active พร้อมกัน** ห้ามสร้างเกินนี้ ไม่งั้นต้องลบของเดิมทิ้ง
5. เก็บค่าที่ต้องใช้ ของ**ทั้งสองโปรเจกต์** — ไปที่ **Project Settings → API** คัดลอก:
   - **Project URL** (เช่น `https://xxxxx.supabase.co`)
   - **anon / public key** ← ตัวนี้ปลอดภัยที่จะอยู่ในเบราว์เซอร์ เพราะ RLS ป้องกันอยู่
   - **service_role key** ← ⚠️ **ตัวนี้ข้าม RLS ทั้งหมด ห้ามใส่ใน frontend เด็ดขาด ห้าม commit ลง git เด็ดขาด** ใช้ได้เฉพาะใน Render worker กับ Edge Function secrets เท่านั้น
6. ไปที่ **Project Settings → Database** คัดลอก **Connection string** ทั้งแบบ *Direct* และ *Transaction pooler*
7. เก็บทุกค่าข้างต้นไว้ใน password manager ของทีม (เช่น Bitwarden ซึ่งใช้ฟรีได้) **ห้ามส่งผ่านแชทหรือใส่ในไฟล์ในโปรเจกต์**
8. ติดตั้ง Supabase CLI ที่เครื่อง:
   ```
   npm install -g supabase
   supabase login
   ```
   (คำสั่ง login จะเปิดเบราว์เซอร์ให้กดยืนยัน)
9. เชื่อมโปรเจกต์ dev เข้ากับ repo:
   ```
   supabase link --project-ref <project-ref ของ brewledger-dev>
   ```
   (`project-ref` คือส่วน `xxxxx` ใน Project URL)
10. แจ้งกลับมาว่า link สำเร็จ พร้อมส่ง **Project URL และ anon key ของ dev เท่านั้น** ให้ Claude Code — **ห้ามส่ง service_role key หรือรหัสผ่านฐานข้อมูลมาในแชท**

**▶️ Claude Code Prompt** *(runs only after the manual steps above are complete)*
```
Wire the Brew Ledger repo to Supabase. The human has already created the projects and
holds the credentials.

1. supabase/config.toml -- initialise Supabase local config for this repo. Set the
   project id, enable the local dev stack (db, auth, storage, edge functions), and set
   auth to phone/OTP mode with email signup disabled.

2. Environment variable contracts. Create these .env.example files with names and
   comments only, never values:

   apps/shop/.env.example
     NEXT_PUBLIC_SUPABASE_URL=        # safe in browser
     NEXT_PUBLIC_SUPABASE_ANON_KEY=   # safe in browser ONLY because RLS is enforced
     # NEVER add SUPABASE_SERVICE_ROLE_KEY here. It bypasses RLS. RL-3.

   apps/console/.env.example
     NEXT_PUBLIC_SUPABASE_URL=
     NEXT_PUBLIC_SUPABASE_ANON_KEY=
     # NEVER add SUPABASE_SERVICE_ROLE_KEY here either.

   worker/.env.example
     SUPABASE_URL=
     SUPABASE_SERVICE_ROLE_KEY=       # server-only, bypasses RLS, Render env var only
     DATABASE_URL=                    # pooler connection string
     FLOAT16_API_KEY=
     VAPID_PRIVATE_KEY=

3. packages/shared/src/supabase/client.ts -- a browser client factory using ONLY the
   anon key, typed against the generated DB types.

4. packages/shared/src/supabase/admin.ts -- a service-role client factory that THROWS
   AT IMPORT TIME if it detects it is running in a browser bundle:
     if (typeof window !== 'undefined') throw new Error('RL-3: service_role client
     imported into a browser bundle. See WBS 3.2.')
   Add a file-top comment explaining this file must never be imported from apps/shop.

5. Add a lint rule (extending the 3.1 boundary config) forbidding any import of
   packages/shared/src/supabase/admin from apps/shop or apps/console client components.

6. /docs/security/keys.md documenting, in a table: key name, where it may live, where it
   may never live, blast radius if leaked, rotation procedure. Cover anon key,
   service_role key, database password, gateway secret key, Float16 API key.
   State plainly that a leaked service_role key is a total compromise of every merchant's
   financial data and requires immediate rotation plus pilot store notification.

7. package.json scripts: "db:push", "db:reset", "db:diff", "db:types" wired to the
   Supabase CLI, with db:types generating packages/db/src/types.ts.
```

---

### 3.3 Render Worker Service Provisioning

| Field | Detail |
|---|---|
| **WBS Code** | 3.3 |
| **Type** | Work Package |
| **Requirement** | Foundation |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-3 (`service_role` custody) |
| **Automation** | 🔴 Manual (account + service creation) + ▶️ Claude Code (worker code) |

**Scope / Statement of Work**
Create the Render service that drains the job queue and stand up the worker skeleton it runs. Render was selected because it is the only one of the three post-Heroku platforms that still offers a permanent free tier without requiring a credit card. Its cost is a 15-minute idle spin-down and a 30–60 second cold start, which is why this service is architecturally forbidden from serving any request a human is waiting on. The worker holds the `service_role` key and is therefore the most security-sensitive deployment target in the project.

**Deliverables**
- Render Web Service `brewledger-worker` on the Free plan, deploying from the `worker` directory on push to `main`
- Worker skeleton: health endpoint, job-queue poller, graceful shutdown, structured logging
- Environment variables set in the Render dashboard, never in git
- `render.yaml` blueprint committed so the service is reproducible
- Documented cold-start behaviour and the rule that forbids customer-blocking work here

**Acceptance**
- `GET /healthz` returns 200 with the commit SHA and queue depth
- The worker claims a job, processes it, and marks it done without another instance double-claiming it
- **No customer-blocking route exists on this service** — the only HTTP surface is `/healthz`
- `service_role` key is present only as a Render environment variable
- A cold start is measured and recorded in `/docs/ops/render.md`

**Associated Activities**
- Create the Render account and service
- Set environment variables
- Implement the poller with atomic claim
- Measure and record cold start time

**🔴 [Manual Action Required] — Render account and worker service**

```
⚠️  MANUAL ACTION REQUIRED — WBS 3.3
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

**ขั้นตอนที่ต้องทำเอง:**
1. เข้า `https://render.com` กด **Get Started** แล้วสมัครด้วย **GitHub account** เดียวกับข้อ 3.1
   > Render เป็นเจ้าเดียวใน Render/Railway/Fly.io ที่ยังมี free tier ถาวรและ**ไม่ต้องผูกบัตร** — ถ้าระบบขอบัตรแปลว่ากดผิดแผน ให้ย้อนกลับมาเลือก Free
2. กด **New + → Web Service**
3. เลือก **Build and deploy from a Git repository** แล้วกด **Connect** ที่ repo `brewledger`
   - ถ้าไม่เห็น repo ให้กด **Configure account** เพื่อให้สิทธิ์ Render เข้าถึง repo นั้น
4. ตั้งค่าดังนี้:
   - Name: `brewledger-worker`
   - Region: **Singapore**
   - Branch: `main`
   - Root Directory: `worker`
   - Runtime: **Node**
   - Build Command: `pnpm install --frozen-lockfile && pnpm build`
   - Start Command: `node dist/index.js`
   - Instance Type: **Free** ← ต้องเลือกอันนี้
5. กด **Advanced** แล้วเพิ่ม Environment Variables ทีละตัว (ค่าเอามาจาก password manager ที่เก็บไว้ตอนข้อ 3.2):
   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | Project URL ของ **prod** |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key ของ **prod** |
   | `DATABASE_URL` | Transaction pooler connection string |
   | `NODE_ENV` | `production` |
   > ⚠️ ค่าเหล่านี้ต้องพิมพ์/วางในหน้า Render เท่านั้น **ห้าม commit ลง git**
6. กด **Create Web Service** แล้วรอ build เสร็จ
7. คัดลอก URL ที่ได้ (เช่น `https://brewledger-worker.onrender.com`) เก็บไว้ใช้ในข้อ 3.10
8. **ทดสอบ cold start จริง**: ปล่อยทิ้งไว้ 20 นาทีโดยไม่เรียก แล้วเปิด `https://<url>/healthz` จับเวลาว่าใช้เวลากี่วินาทีกว่าจะตอบ — บันทึกตัวเลขจริงลงใน `/docs/ops/render.md` เพราะต้องใช้อ้างอิงตอนออกแบบ UX ของหน้าสแกนบิล

**▶️ Claude Code Prompt**
```
Build the Brew Ledger async worker at worker/. Node 20, TypeScript, deployed to Render
Free. This service processes ONLY work that nobody is waiting on.

HARD ARCHITECTURAL RULE to encode in the README and enforce in review: Render Free spins
down after 15 minutes idle and cold-starts in 30-60 seconds. Therefore this service must
never serve a customer-blocking request. Its only HTTP surface is /healthz. Everything
else is pulled from the job queue.

1. worker/src/index.ts
   - Minimal HTTP server exposing GET /healthz returning
     { ok: true, sha: process.env.RENDER_GIT_COMMIT, queueDepth: <n>, uptimeSec: <n> }
   - Start the poller loop
   - Graceful shutdown on SIGTERM: stop claiming new jobs, finish the in-flight job,
     then exit. Render sends SIGTERM on deploy and on spin-down.

2. worker/src/queue.ts -- the job queue poller.
   Poll every 30 seconds. Claim atomically so two instances can never double-process:
     UPDATE job_queue SET status='processing', attempts=attempts+1,
            claimed_at=now(), claimed_by=$workerId
     WHERE id = (
       SELECT id FROM job_queue
       WHERE status='pending' AND (run_after IS NULL OR run_after <= now())
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *;
   Use FOR UPDATE SKIP LOCKED -- do not implement optimistic retry.
   On success set status='done', processed_at=now().
   On failure set status='failed', last_error=<message>, and re-queue with exponential
   backoff via run_after while attempts < 5. After 5 attempts leave it failed for human
   review.

3. worker/src/handlers/ -- a handler registry keyed by job_type, with stubs for:
     'ocr_extract', 'cost_recalc', 'daily_aggregate', 'cost_drift_check',
     'low_stock_check', 'push_notify'
   Each stub logs and returns; real implementations arrive in later WBS entries.

4. worker/src/db.ts -- a Supabase client built from SUPABASE_SERVICE_ROLE_KEY.
   Add a top-of-file comment: this process is the only deployment target permitted to
   hold the service_role key. It bypasses RLS entirely.

5. worker/src/log.ts -- structured JSON logging (level, ts, job_id, job_type, msg).
   Add a redaction helper that strips any key matching
   /key|secret|token|password|authorization/i before logging. Never log a full row.

6. render.yaml at the repo root declaring the service: name brewledger-worker, env node,
   plan free, region singapore, rootDir worker, buildCommand and startCommand as
   configured, healthCheckPath /healthz, and envVars listed with sync:false so values
   are never stored in git.

7. /docs/ops/render.md documenting: the spin-down behaviour, a blank field for the
   measured cold start, the rule that no customer-blocking work runs here, and how to
   read logs in the Render dashboard.
```

---

### 3.4 Vercel Project Provisioning and Environment Wiring

| Field | Detail |
|---|---|
| **WBS Code** | 3.4 |
| **Type** | Work Package |
| **Requirement** | Foundation |
| **Owner** | M1 (setup), M2 (consumes) |
| **Surface** | Both |
| **Red Line Touch** | RL-3 (two separate deployments) |
| **Automation** | 🔴 Manual (account + project creation) + ▶️ Claude Code (app scaffolds) |

**Scope / Statement of Work**
Create **two separate Vercel projects** from the one monorepo — one per surface — and wire their environment variables. Two projects rather than one is a deliberate RL-3 decision: separate builds mean the Customer Web bundle physically cannot contain Owner Console code, and separate environment scopes mean a merchant-only variable cannot leak into the public bundle by configuration mistake.

**Deliverables**
- Vercel projects `brewledger-shop` (root `apps/shop`) and `brewledger-console` (root `apps/console`)
- Environment variables set per project, per environment (production / preview)
- Preview deployments on every PR, production on `main`
- Both Next.js apps scaffolded and deploying successfully
- `/docs/ops/vercel.md` recording both URLs and the variable matrix

**Acceptance**
- Both projects build and deploy from `main`
- A PR produces two preview URLs
- **Neither production bundle contains the `service_role` key** — verified by searching the built output
- The console project's variables are not present in the shop project
- Build fails, rather than silently succeeding, if a required variable is missing

**Associated Activities**
- Create both Vercel projects with the correct root directories
- Set variables per project
- Scaffold both Next.js apps
- Grep both built bundles for forbidden strings

**🔴 [Manual Action Required] — Vercel account and two projects**

```
⚠️  MANUAL ACTION REQUIRED — WBS 3.4
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

**ขั้นตอนที่ต้องทำเอง:**
1. เข้า `https://vercel.com` กด **Sign Up** เลือก **Continue with GitHub** (บัญชีเดียวกับข้อ 3.1) เลือกแผน **Hobby** — **ไม่ต้องใช้บัตร**
2. **สร้างโปรเจกต์ที่ 1 (Customer Web):**
   - กด **Add New… → Project** เลือก repo `brewledger` กด **Import**
   - Project Name: `brewledger-shop`
   - Framework Preset: **Next.js**
   - กด **Edit** ตรง **Root Directory** แล้วเลือกโฟลเดอร์ `apps/shop` ← **สำคัญมาก ถ้าไม่ตั้งจะ build ผิดโฟลเดอร์**
   - เปิดหัวข้อ **Environment Variables** ใส่ 2 ตัวนี้ (ค่าจาก password manager ตอนข้อ 3.2 ของ **prod**):
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - ⚠️ **ห้ามใส่ `SUPABASE_SERVICE_ROLE_KEY` ในโปรเจกต์นี้เด็ดขาด** — หน้าเว็บนี้ลูกค้าทั่วไปเปิดได้ ใครก็เปิดดู bundle ได้
   - กด **Deploy**
3. **สร้างโปรเจกต์ที่ 2 (Owner Console):** ทำซ้ำข้อ 2 ทั้งหมด แต่เปลี่ยนเป็น
   - Project Name: `brewledger-console`
   - Root Directory: `apps/console`
   - Environment Variables: ใส่ 2 ตัวเดียวกัน (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) — **ยังคงห้ามใส่ service_role**
4. ตั้งค่า **Ignored Build Step** ให้ทั้งสองโปรเจกต์ เพื่อไม่ให้ build ซ้ำโดยไม่จำเป็น: ไปที่ **Settings → Git → Ignored Build Step** ใส่คำสั่ง
   - โปรเจกต์ shop: `npx turbo-ignore --fallback=HEAD^`
   - โปรเจกต์ console: `npx turbo-ignore --fallback=HEAD^`
5. คัดลอก URL ของทั้งสองโปรเจกต์ (เช่น `brewledger-shop.vercel.app`) เก็บไว้ แล้วนำไปใส่ใน `/docs/ops/vercel.md`
6. **ตรวจสอบความปลอดภัยด้วยตัวเอง** — เปิดหน้าเว็บ `brewledger-shop.vercel.app` แล้วกด F12 → แท็บ Sources → กด Ctrl+F ค้นหาคำว่า `service_role` **ต้องไม่เจอ** ถ้าเจอให้หยุดทุกอย่างแล้วไป rotate key ใหม่ทันทีที่ Supabase (**Project Settings → API → Rotate**)

**▶️ Claude Code Prompt**
```
Scaffold both Next.js applications for Brew Ledger. Next.js 15 App Router, TypeScript,
Tailwind, consuming packages/ui. Deployed as two SEPARATE Vercel projects from one repo.

apps/shop -- Customer Web, UNAUTHENTICATED:
  - Route group per /docs/design/route_map.md:
      app/s/[slug]/page.tsx           store menu
      app/s/[slug]/cart/page.tsx      cart
      app/s/[slug]/checkout/page.tsx  slot + name + phone
      app/s/[slug]/pay/[code]/page.tsx PromptPay QR
      app/o/[code]/page.tsx           order tracking
      app/track/page.tsx              lookup by phone + code
  - Supabase browser client using the ANON key only
  - No auth provider, no session, no login route -- this surface never issues an account
  - A root-level comment in app/layout.tsx stating RL-3: this bundle must never contain
    cost, margin, profit, expense, stock, or store aggregate data

apps/console -- Owner Console, phone-OTP AUTHENTICATED:
  - Routes per the route map: /console/login, /console, /console/orders,
    /console/orders/[id], /console/sales/quick, /console/menu, /console/menu/[id],
    /console/expenses/capture, /console/expenses/[id]/review, /console/inventory,
    /console/reports/pnl, /console/reports/profit-per-dish, /console/reports/overview,
    /console/settings/store, /console/settings/payments, /console/settings/link,
    /console/settings/subscription
  - Middleware that redirects any unauthenticated request to /console/login by DEFAULT
    (deny by default -- the allow-list is /console/login only)

Both apps:
  - next.config.js with transpilePackages for packages/ui and packages/shared
  - A startup env guard: a module that validates required NEXT_PUBLIC_* variables are
    present and THROWS AT BUILD TIME with a clear message if any is missing. A missing
    variable must fail the build, never silently render a broken page.
  - An explicit assertion in the same guard that process.env.SUPABASE_SERVICE_ROLE_KEY is
    UNDEFINED in these apps. If it is defined, throw:
      "RL-3 violation: service_role key present in a browser-deployed app. See WBS 3.4."
  - Thai as the default locale, lang="th" on <html>
  - The design system tokens from packages/ui applied via the shared Tailwind preset

Also add scripts/check-bundle.mjs -- a post-build script that greps .next/static for the
strings in /docs/design/forbidden_fields.json plus "service_role", and exits non-zero on
any hit. Wire it into both apps' build scripts and into CI.

Finally write /docs/ops/vercel.md with a variable matrix table: variable | shop project |
console project | worker | may appear in browser bundle? -- and blank fields for the two
deployment URLs.
```

---
### 3.5 Core Data Model — PostgreSQL Schema and Migrations

| Field | Detail |
|---|---|
| **WBS Code** | 3.5 |
| **Type** | Work Package |
| **Requirement** | Foundation for all |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-1, RL-2, RL-3 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Author the complete PostgreSQL schema as versioned SQL migrations. Three design decisions in this entry are load-bearing for the whole product and are expensive to change later. **First**, all money is integer satang — no floats anywhere in the money path. **Second**, `order_items` carries a frozen `unit_cost_snapshot_satang` written once at sale time, so historical P&L is immutable while `ingredients.current_unit_cost_satang` moves with every confirmed bill; without this split, last month's profit silently changes when milk gets more expensive. **Third**, the schema contains **no** platform balance, float, escrow, or payout table — the absence is the structural proof of RL-1 and is asserted by a test.

**Deliverables**
- Ordered SQL migrations in `packages/db/migrations/`
- Generated TypeScript types at `packages/db/src/types.ts`
- Seed script producing one demo merchant, one store, a menu, slots, and a zero-BOM item
- ER documentation at `/docs/db/schema.md`
- A schema-introspection test asserting no balance/escrow/payout table exists

**Acceptance**
- `supabase db reset` applies every migration cleanly from scratch
- **No column in the money path is `float`, `real`, or `double precision`** — asserted by an introspection test
- **`bom_lines` is optional: a `menu_items` row can be inserted and sold with zero related `bom_lines` (RL-2)** — asserted by an insert test
- **No table named or shaped like a platform balance, float, escrow, or payout exists (RL-1)** — asserted by an introspection test
- Every table carries `store_id` (or reaches one by a single join) so 3.6 can scope it
- Seed data includes at least one menu item with no BOM whose cost resolves to `null`, never `0`

**Associated Activities**
- Write migrations in dependency order
- Generate types and commit them
- Write the seed script
- Write the three introspection/insert assertion tests
- Document the cost-snapshot rule prominently

**Schema (abridged — full DDL generated by the prompt below)**
```sql
-- Money: integer satang everywhere. 1 THB = 100 satang. No floats.
-- Cost: two distinct concepts, deliberately separated.
--   ingredients.current_unit_cost_satang  -> moves with each confirmed bill (forward-looking)
--   order_items.unit_cost_snapshot_satang -> frozen at sale (historical truth)

create table merchants (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  phone text not null,
  subscription_tier text not null default 'free'
    check (subscription_tier in ('free','starter','growth','scale')),
  created_at timestamptz not null default now()
);

create table stores (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  slug text not null unique,                          -- brewledger.app/s/{slug}
  name text not null,
  pickup_address text,
  timezone text not null default 'Asia/Bangkok',
  opens_at time, closes_at time,
  promptpay_id text,                                  -- RL-1: the MERCHANT's own alias
  promptpay_type text check (promptpay_type in ('msisdn','nid','taxid')),
  promptpay_verified_at timestamptz,                  -- merchant scanned and confirmed (4.5)
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  category_id uuid references menu_categories(id) on delete set null,
  name text not null,
  description text,
  image_path text,
  price_satang integer not null check (price_satang >= 0),
  availability text not null default 'available'
    check (availability in ('available','out_of_stock','hidden')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  base_unit text not null check (base_unit in ('g','ml','piece')),
  current_unit_cost_satang integer,                   -- null until a bill is confirmed
  current_stock_base_unit numeric(14,3) not null default 0,
  low_stock_threshold numeric(14,3),
  updated_at timestamptz not null default now()
);

-- RL-2: OPTIONAL. A menu_item is sellable with zero rows here.
create table bom_lines (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete restrict,
  qty_base_unit numeric(14,4) not null check (qty_base_unit > 0),
  unique (menu_item_id, ingredient_id)
);

create table pickup_slots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  capacity integer not null check (capacity > 0),
  booked_count integer not null default 0 check (booked_count >= 0),
  is_open boolean not null default true,
  unique (store_id, slot_start),
  check (booked_count <= capacity)                    -- 5.3 relies on this
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  order_code text not null unique,                    -- short, customer-facing
  customer_name text not null,
  customer_phone text,
  pickup_slot_id uuid references pickup_slots(id) on delete restrict,
  channel text not null default 'online' check (channel in ('online','cash')),
  status text not null default 'PENDING_PAYMENT' check (status in
    ('PENDING_PAYMENT','ACCEPTED','PREPARING','READY','COLLECTED','CANCELLED','REFUNDED','EXPIRED')),
  subtotal_satang integer not null,
  total_satang integer not null,
  total_cost_snapshot_satang integer,                 -- null when no item had a BOM
  paid_at timestamptz,
  payment_confirmed_by text,                          -- 5.6: which session confirmed
  payment_confirmed_at timestamptz,
  refund_status text check (refund_status in ('pending','done')),  -- 5.11
  expires_at timestamptz,                             -- PENDING_PAYMENT auto-expiry
  created_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  store_id uuid not null,                             -- denormalised for RLS scoping
  menu_item_id uuid references menu_items(id) on delete set null,
  item_name_snapshot text not null,                   -- name at time of sale
  quantity integer not null check (quantity > 0),
  unit_price_snapshot_satang integer not null,
  unit_cost_snapshot_satang integer,                  -- NULL, never 0, when no BOM (RL-2)
  options_snapshot jsonb not null default '[]'::jsonb
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  store_id uuid not null,
  method text not null default 'promptpay_direct',
  payee_alias text not null,                          -- RL-1 evidence, per row: the merchant's
  amount_satang integer not null,
  status text not null check (status in ('pending','succeeded','failed','expired')),
  qr_payload text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Append-only. Stock level is DERIVED from this, never overwritten in place.
create table stock_ledger (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  delta_base_unit numeric(14,4) not null,
  reason text not null check (reason in
    ('purchase','sale','waste','adjustment','cancellation_reversal')),
  order_id uuid references orders(id) on delete set null,
  purchase_invoice_id uuid references purchase_invoices(id) on delete set null,
  created_at timestamptz not null default now()
);

create table purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  image_path text not null,
  vendor_name text,
  invoice_date date,
  total_satang integer,
  ocr_status text not null default 'pending'
    check (ocr_status in ('pending','processed','failed','manual')),
  review_status text not null default 'needs_review'
    check (review_status in ('needs_review','confirmed')),
  raw_ocr_output jsonb,
  created_at timestamptz not null default now()
);

create table purchase_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references purchase_invoices(id) on delete cascade,
  store_id uuid not null,
  ingredient_id uuid references ingredients(id) on delete set null,
  raw_text text,
  qty_base_unit numeric(14,3),
  unit_cost_satang integer,
  total_satang integer,
  mapping_confidence numeric(3,2)
);

create table job_queue (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','processing','done','failed')),
  attempts integer not null default 0,
  run_after timestamptz,
  claimed_at timestamptz, claimed_by text,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table daily_financials (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  business_date date not null,
  gross_revenue_satang integer not null default 0,
  total_cogs_satang integer,                          -- null-aware: excludes untracked
  untracked_item_count integer not null default 0,    -- disclosed in 7.5, never hidden
  other_expense_satang integer not null default 0,
  net_profit_satang integer,
  order_count integer not null default 0,
  unique (store_id, business_date)
);

-- RL-1 STRUCTURAL PROOF: there is deliberately no platform_balance, escrow,
-- float, ledger_account, or payout table in this schema. 8.5 asserts this.
```

**▶️ Claude Code Prompt**
```
Author the complete PostgreSQL schema for Brew Ledger as ordered Supabase SQL migrations
in packages/db/migrations/. Target Postgres 15 on Supabase.

Use the abridged DDL in WBS 3.5 of /docs/wbs_dictionary.md as the specification and
complete it. Also create menu_categories, menu_option_groups, menu_options, and
order_item_options which are referenced but not fully expanded there.

NON-NEGOTIABLE RULES:

1. MONEY. Every monetary column is `integer` satang. 1 THB = 100 satang. Never numeric,
   never float, never real, never double precision, anywhere in the money path. Name every
   money column with a _satang suffix so violations are visible in review.

2. COST SNAPSHOT -- the most important rule in the schema. Two separate concepts:
     ingredients.current_unit_cost_satang   moves when a bill is confirmed (forward-looking)
     order_items.unit_cost_snapshot_satang  written ONCE at sale, never updated (historical)
   Add a SQL comment on both columns explaining why. Add a trigger that RAISES an exception
   on any UPDATE to order_items.unit_cost_snapshot_satang after insert. Without this,
   last month's profit changes every time an ingredient price moves, which is
   accounting-wrong and destroys merchant trust in every number the product shows.

3. RL-2. bom_lines is optional. A menu_items row must be insertable and sellable with zero
   bom_lines. There must be no NOT NULL, no FK, and no trigger from menu_items requiring a
   recipe. When a menu item has no BOM its cost is NULL -- never 0.

4. RL-1. Do NOT create any table representing a platform balance, escrow, float, wallet,
   ledger_account, or payout. Add a comment block at the end of the final migration stating
   that this absence is deliberate and is the structural proof of RL-1.

5. Every table must carry store_id or reach one through exactly one join, so RLS in WBS 3.6
   can scope it. Denormalise store_id onto order_items, payments, and purchase_line_items
   for this reason and add a comment saying so.

6. Indexes: orders(store_id, created_at desc), orders(order_code), orders(status) partial
   where status='PENDING_PAYMENT', payments(order_id),
   stock_ledger(store_id, ingredient_id, created_at desc),
   daily_financials(store_id, business_date) unique, job_queue(status, run_after) partial
   where status='pending', pickup_slots(store_id, slot_start).

7. updated_at triggers where the column exists.

Then produce:

a) packages/db/seed.sql -- one demo merchant, one published store with slug 'demo-cafe',
   4 menu items of which AT LEAST ONE has no bom_lines at all (to prove RL-2 and to give
   the reports a null-cost case), 3 ingredients with unit costs, today's pickup slots at
   15-minute intervals from 07:00 to 10:00 with capacity 3, and one confirmed purchase
   invoice.

b) packages/db/tests/schema.test.ts -- introspection tests that FAIL the build if:
   - any column whose name matches /satang|price|cost|amount|fee|total/ is not integer
   - any table name matches /balance|escrow|float|wallet|payout|ledger_account/  (RL-1)
   - inserting a menu_item with no bom_lines and then selling it raises any error  (RL-2)
   - updating order_items.unit_cost_snapshot_satang after insert does NOT raise

c) /docs/db/schema.md -- table-by-table documentation, an ER description, and a
   prominent section titled "Why cost is stored twice" explaining the snapshot rule in
   plain language with a worked example: a latte sold on 1 March at 12 THB cost must still
   report 12 THB cost on 1 April after milk rises to 15 THB.

d) Wire "db:types" to generate packages/db/src/types.ts from the live dev schema.
```

**Testing**
- Migration test: `supabase db reset` from scratch applies all migrations with no error
- Introspection test: no float/real/double in any money column
- Introspection test: no balance/escrow/float/wallet/payout table (RL-1)
- Insert test: a menu item with zero `bom_lines` inserts, sells, and reports `null` cost (RL-2)
- Trigger test: updating a cost snapshot after insert raises
- Constraint test: `booked_count` cannot exceed `capacity`

---

### 3.6 Row Level Security Policies and Tenant Isolation

| Field | Detail |
|---|---|
| **WBS Code** | 3.6 |
| **Type** | Work Package |
| **Requirement** | Foundation, F01 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | **RL-3 (primary enforcement point)** |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Write the Row Level Security policies that are the **primary** RL-3 enforcement mechanism on this stack. This entry exists because Supabase exposes Postgres to the browser through PostgREST: a table with RLS disabled is a table the public internet can read with `curl` and the `anon` key that ships in the Customer Web bundle. The rule is deny-by-default — RLS enabled on every table with no policy — and then a minimal, explicitly justified allow-list. The `anon` role gets read access to exactly four things: published stores, their menus, their option groups, and their open future slots. Nothing else. Not orders, not payments, not ingredients, not costs.

**Deliverables**
- A migration enabling RLS on **every** table in `public`
- Merchant policies scoping every merchant-owned table through `auth.uid()` → `merchants.auth_user_id` → `stores.merchant_id`
- Exactly four `anon` SELECT policies: `stores` (published only), `menu_items` (available only, published store), `menu_option_groups`/`menu_options`, `pickup_slots` (open, not full, future only)
- Order access for customers via a security-definer RPC keyed on `order_code`, never a table-level `anon` policy on `orders`
- `/docs/security/rls.md` documenting every policy and its justification

**Acceptance**
- **Every table in `public` has `row level security` enabled** — asserted by an introspection test that fails CI otherwise
- **An `anon`-key client cannot select from `ingredients`, `bom_lines`, `purchase_invoices`, `purchase_line_items`, `stock_ledger`, `daily_financials`, `payments`, `job_queue`, or `merchants` — zero rows, not filtered rows (RL-3)**
- An `anon`-key client selecting `menu_items` receives only rows belonging to published stores, and only the allow-listed columns via the public view
- Merchant A authenticated cannot read any row belonging to merchant B — asserted for every merchant-owned table
- An unpublished store is invisible to `anon` even with a correct slug

**Associated Activities**
- Enable RLS everywhere first, before writing a single policy
- Write merchant scoping policies table by table
- Write the four `anon` policies and justify each in a comment
- Build the security-definer RPC for customer order lookup
- Write the adversarial test suite that runs with a real `anon` key

**Pseudocode (policy shape)**
```sql
-- Step 1: deny by default, everywhere, before any policy is written.
alter table merchants            enable row level security;
alter table stores               enable row level security;
alter table menu_items           enable row level security;
alter table ingredients          enable row level security;
alter table bom_lines            enable row level security;
alter table orders               enable row level security;
alter table order_items          enable row level security;
alter table payments             enable row level security;
alter table stock_ledger         enable row level security;
alter table purchase_invoices    enable row level security;
alter table purchase_line_items  enable row level security;
alter table daily_financials     enable row level security;
alter table pickup_slots         enable row level security;
alter table job_queue            enable row level security;
-- ...every table. No exceptions.

-- Helper: the set of store ids owned by the authenticated merchant.
create or replace function auth_store_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select s.id from stores s
  join merchants m on m.id = s.merchant_id
  where m.auth_user_id = auth.uid();
$$;

-- Merchant policy shape, repeated per merchant-owned table.
create policy merchant_rw_ingredients on ingredients
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

-- The ONLY four anon read policies. Each is justified inline.
-- 1. A published store is public by design: the customer has its link.
create policy anon_read_published_stores on stores
  for select to anon using (is_published = true);

-- 2. Menu items of a published store. Column narrowing happens in the public view (3.7);
--    this policy narrows rows only.
create policy anon_read_published_menu on menu_items
  for select to anon using (
    availability <> 'hidden'
    and store_id in (select id from stores where is_published = true)
  );

-- 3. Open, future, non-full slots only. A full slot must be ABSENT, not disabled.
create policy anon_read_open_slots on pickup_slots
  for select to anon using (
    is_open = true and booked_count < capacity and slot_start > now()
    and store_id in (select id from stores where is_published = true)
  );

-- 4. Option groups/options for visible menu items. (analogous)

-- Customer order lookup is NOT a table policy. It is a narrow RPC that returns only
-- allow-listed fields, so orders/order_items stay closed to anon entirely.
create or replace function public_order_status(p_order_code text)
returns table (order_code text, status text, pickup_at timestamptz,
               item_name text, quantity integer)
language sql stable security definer set search_path = public as $$
  select o.order_code, o.status, ps.slot_start, oi.item_name_snapshot, oi.quantity
  from orders o
  join order_items oi on oi.order_id = o.id
  left join pickup_slots ps on ps.id = o.pickup_slot_id
  where o.order_code = p_order_code;
$$;
-- Note the return signature: no cost, no fee, no margin, no store aggregate. RL-3.
revoke all on function public_order_status(text) from public;
grant execute on function public_order_status(text) to anon;
```

**▶️ Claude Code Prompt**
```
Write the Row Level Security migration for Brew Ledger at
packages/db/migrations/<next>_rls.sql, plus its adversarial test suite.

CONTEXT THAT MAKES THIS CRITICAL: Supabase exposes Postgres to the browser via PostgREST
using the anon key, which ships inside the public Customer Web bundle. A table without RLS
is readable by anyone on the internet with curl. RLS is therefore the PRIMARY enforcement
of red line RL-3 -- application serializers are the second line, not the first.

Step 1. Enable RLS on EVERY table in schema public. Write them out one per line
explicitly; do not use a DO block that could silently skip a table added later. Then add a
test (below) that fails if any table lacks it.

Step 2. Create a stable security-definer helper auth_store_ids() returning the store ids
owned by the currently authenticated merchant via
auth.uid() -> merchants.auth_user_id -> stores.merchant_id.
Set search_path = public on every security definer function.

Step 3. Merchant policies. For every merchant-owned table (stores, menu_categories,
menu_items, menu_option_groups, menu_options, ingredients, bom_lines, pickup_slots,
orders, order_items, payments, stock_ledger, purchase_invoices, purchase_line_items,
daily_financials, job_queue) create a FOR ALL policy TO authenticated with both USING and
WITH CHECK scoping on store_id in (select auth_store_ids()). For merchants itself, scope
on auth_user_id = auth.uid().

Step 4. Exactly FOUR anon SELECT policies, each with an inline SQL comment justifying why
this specific data is safe to expose to a stranger holding a public link:
  - stores where is_published = true
  - menu_items where availability <> 'hidden' and the store is published
  - menu_option_groups / menu_options for visible menu items
  - pickup_slots where is_open and booked_count < capacity and slot_start > now()
    and the store is published
Create NO other anon policy. In particular orders, order_items, payments, ingredients,
bom_lines, stock_ledger, purchase_*, daily_financials, job_queue and merchants must have
NO anon policy at all.

Step 5. Customer order tracking. Do NOT open orders to anon. Instead create a
security-definer RPC public_order_status(p_order_code text) returning ONLY:
order_code, status, pickup slot start, item name, quantity.
No cost, no unit_cost_snapshot, no fee, no margin, no totals beyond what the customer paid,
no store aggregates. Revoke from public, grant execute to anon.
Add a second RPC public_order_lookup(p_phone text, p_order_code text) for the /track
screen requiring BOTH values to match, so a phone number alone enumerates nothing.

Step 6. Tests at packages/db/tests/rls.test.ts using a REAL anon-key Supabase client, not
a mocked one:
  - introspection: every table in public has relrowsecurity = true -- fail CI otherwise
  - anon selecting each of ingredients, bom_lines, purchase_invoices, purchase_line_items,
    stock_ledger, daily_financials, payments, job_queue, merchants, orders, order_items
    returns ZERO rows (assert length === 0, and assert it is not merely an empty table by
    confirming service_role sees rows in the same fixture)
  - anon selecting menu_items sees only published-store rows
  - an unpublished store is invisible to anon even with the exact correct slug
  - a full slot (booked_count = capacity) is absent from the anon slot query
  - merchant A authenticated cannot read ANY row of merchant B, asserted per table in a
    loop over the table list
  - public_order_status returns no field whose name matches
    /cost|margin|profit|fee|expense|stock/

Step 7. /docs/security/rls.md -- a table of every policy: table | role | operation |
predicate | justification. Add a section at the top titled "Why RLS is the first line, not
the last" explaining the PostgREST exposure in two paragraphs, and a rule that any new
table requires an RLS policy in the SAME pull request that creates it.
```

**Testing**
- Introspection test: every `public` table has RLS enabled (fails CI otherwise)
- Adversarial `anon` test per restricted table: zero rows returned
- Cross-tenant test: merchant A reads nothing of merchant B, per table
- Slot visibility test: full slot absent, not disabled
- RPC signature test: no cost-shaped field in any public RPC return type

---

### 3.7 API Surface Separation and Public Serializer

| Field | Detail |
|---|---|
| **WBS Code** | 3.7 |
| **Type** | Work Package |
| **Requirement** | Foundation |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-3 (second line of defence) |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Split the Edge Function surface into two disjoint scopes — `public-*` and `console-*` — and build the allow-list serializers that construct every Customer Web response field by field. The serializer never spreads a database row. This is deliberately redundant with RLS: RLS stops the database from returning the data, and the serializer stops the application from emitting it if a future policy change, a service-role call, or a join ever brings it into memory. Defence in depth is warranted here because a single leak of merchant cost data to a customer is unrecoverable reputationally.

**Deliverables**
- `supabase/functions/public-*` and `supabase/functions/console-*` with disjoint shared code
- `packages/shared/src/serializers/public.ts` — explicit field-by-field DTO builders
- A lint rule forbidding object spread of a DB row inside any `public-*` function
- Response snapshot tests for every public endpoint
- A shared Zod schema per public DTO, exported for both the function and the client

**Acceptance**
- **No public serializer uses object spread or `Object.assign` on a database row** — enforced by lint
- Every public endpoint has a snapshot test whose fixture is reviewed and committed
- Adding a field to a public DTO requires editing the serializer **and** updating the snapshot — it can never happen by accident
- A `console-*` function is unreachable without a valid merchant JWT
- Public DTO field names are cross-checked in CI against `/docs/design/forbidden_fields.json`

**Associated Activities**
- Scaffold both function scopes
- Write the DTO builders and Zod schemas
- Write the anti-spread lint rule and prove it with a deliberate violation
- Commit reviewed response snapshots

**▶️ Claude Code Prompt**
```
Build the Edge Function surface separation and public serializers for Brew Ledger.
Supabase Edge Functions, Deno runtime, TypeScript.

Two disjoint scopes under supabase/functions/:
  public-*   unauthenticated, anon key, scoped to one store_slug from the request
  console-*  requires a valid merchant JWT, scoped to that merchant's stores

Shared code lives in supabase/functions/_shared/, but public-* and console-* must import
from DIFFERENT subdirectories (_shared/public/ and _shared/console/) with no cross-import.
Add a lint rule that fails on any import from _shared/console/ inside a public-* function.

1. packages/shared/src/serializers/public.ts
   Explicit builder functions, one per public DTO. Each one names every field it emits.
   NEVER use object spread, Object.assign, or JSON round-tripping of a database row.
   Example shape to follow exactly:

     export function toPublicMenuItem(row: MenuItemRow): PublicMenuItem {
       return {
         id: row.id,
         name: row.name,
         description: row.description,
         imageUrl: row.image_path ? publicImageUrl(row.image_path) : null,
         priceSatang: row.price_satang,
         availability: row.availability,
       };            // every field listed by hand -- this is the point
     }

   Build DTOs for: PublicStore, PublicMenuItem, PublicOptionGroup, PublicOption,
   PublicSlot, PublicOrderStatus, PublicPaymentIntent.
   Add a file header comment: "RL-3. Every field emitted to Customer Web is listed here by
   hand. If you are about to add a spread operator to this file, stop and read WBS 3.7."

2. A matching Zod schema per DTO in packages/shared/src/serializers/public.schema.ts,
   using .strict() so an unexpected key throws rather than passing through. Export a
   parseOrThrow helper each public function calls before responding, so an unlisted field
   fails loudly at runtime as well as at review.

3. ESLint rule: inside apps/shop and supabase/functions/public-*, ban
   SpreadElement on any identifier whose type resolves to a DB row type, plus a blanket ban
   on Object.assign and structuredClone of row-typed values. Error message:
   "RL-3 violation: build public DTOs field by field. See WBS 3.7."
   Prove it with a .disabled fixture file as in WBS 3.1.

4. Auth guard for console-* at _shared/console/auth.ts: verify the Supabase JWT, resolve
   auth.uid() to a merchant row, attach merchant_id and the owned store ids to the request
   context, and return 401 with no body detail on failure. Deny by default -- a console
   function with no explicit guard call must not compile (enforce by making the handler
   factory require the context as a parameter).

5. Response snapshot tests at supabase/functions/_tests/public_snapshots.test.ts.
   For every public endpoint, snapshot the exact response body against a committed
   fixture. Add a CI step that greps every committed snapshot for the substrings in
   /docs/design/forbidden_fields.json and fails on any hit.

6. /docs/api/surfaces.md documenting both scopes, the auth model of each, and a table of
   every public endpoint with its exact response field list.
```

**Testing**
- Lint test: a deliberate row spread inside a public serializer fails CI
- Snapshot test: every public endpoint response matches its committed fixture
- CI scan: no committed public snapshot contains a forbidden field substring
- Auth test: a `console-*` function without a JWT returns 401 with no leaked detail
- Zod test: an extra unexpected key on a public DTO throws rather than passing through

---
### 3.8 Supabase Storage for Bill Images

| Field | Detail |
|---|---|
| **WBS Code** | 3.8 |
| **Type** | Work Package |
| **Requirement** | F22 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-3 (bill images are merchant-private) |
| **Automation** | 🔴 Manual (bucket creation) + ▶️ Claude Code (policies + upload path) |

**Scope / Statement of Work**
Create the storage buckets and the access policies for supplier bill images and menu photos, and enforce client-side compression before upload. The free tier allows 1 GB total, which sounds generous until an unmodified phone camera upload of 4 MB per bill exhausts it in about 250 bills. Compression to roughly 200 KB extends that to about 5,000 bills, which comfortably covers the PoC. Bill images are merchant-private and must never be publicly readable — a supplier invoice reveals purchase prices, which is exactly the data RL-3 protects.

**Deliverables**
- Two buckets: `bills` (private) and `menu-images` (public read)
- Storage RLS policies scoping `bills` to the owning merchant
- Client-side compression utility targeting ≤ 200 KB, longest edge ≤ 1600 px
- Signed-URL helper with short expiry for bill viewing
- Storage usage reporting wired into the 3.10 quota monitor

**Acceptance**
- **A bill image is not retrievable by URL without a valid signed URL scoped to the owning merchant (RL-3)**
- Merchant A cannot generate a signed URL for merchant B's bill
- An uploaded phone photo is compressed to ≤ 200 KB before leaving the browser, verified on a real device photo
- Menu images are publicly readable (they appear on Customer Web by design)
- Signed URLs expire in ≤ 5 minutes

**Associated Activities**
- Create both buckets with correct visibility
- Write storage policies
- Implement and test compression on a real phone photo
- Wire usage into the quota monitor

**🔴 [Manual Action Required] — Storage bucket creation**

```
⚠️  MANUAL ACTION REQUIRED — WBS 3.8
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

**ขั้นตอนที่ต้องทำเอง:** *(ทำทั้งใน `brewledger-dev` และ `brewledger-prod`)*
1. เข้า Supabase Dashboard เลือกโปรเจกต์ แล้วไปที่เมนู **Storage** ทางซ้าย
2. กด **New bucket** สร้างถังที่ 1:
   - Name: `bills`
   - Public bucket: **ปิดไว้ (ห้ามติ๊ก)** ← สำคัญมาก บิลซื้อของมีราคาต้นทุนอยู่ในนั้น ถ้าเปิด public คือข้อมูลต้นทุนร้านรั่วทันที
   - กด **Save**
3. กด **New bucket** สร้างถังที่ 2:
   - Name: `menu-images`
   - Public bucket: **เปิด (ติ๊ก)** ← อันนี้เปิดได้ เพราะรูปเมนูต้องแสดงบนหน้าเว็บลูกค้าอยู่แล้ว
   - กด **Save**
4. ตั้งขนาดไฟล์สูงสุด: กดเข้าไปในแต่ละ bucket → **Configuration** → ตั้ง **File size limit** = `1 MB` (กันเผลออัปโหลดรูปดิบจากกล้องซึ่งใหญ่ 3-5 MB)
5. ตั้ง MIME type ที่อนุญาต: ใส่ `image/jpeg, image/png, image/webp` เท่านั้น
6. ยืนยันด้วยตัวเองว่า bucket `bills` ปิดจริง — คัดลอก URL ของไฟล์ทดสอบไปเปิดในหน้าต่าง incognito **ต้องเปิดไม่ได้** ถ้าเปิดได้แปลว่าตั้งค่าผิด ให้กลับไปแก้ทันที

**▶️ Claude Code Prompt**
```
Implement Brew Ledger storage handling for bill images and menu photos.

1. Storage RLS migration at packages/db/migrations/<next>_storage_policies.sql

   Bucket 'bills' -- PRIVATE, merchant-scoped. Object path convention:
     bills/{store_id}/{invoice_id}.jpg
   Policies on storage.objects:
     - INSERT to authenticated where bucket_id='bills' and
       (storage.foldername(name))[1]::uuid in (select auth_store_ids())
     - SELECT to authenticated with the same predicate
     - DELETE to authenticated with the same predicate
     - NO anon policy of any kind
   Add a comment: a supplier invoice contains purchase prices, which is precisely the data
   RL-3 protects. This bucket is never public.

   Bucket 'menu-images' -- PUBLIC READ. Path: menu-images/{store_id}/{menu_item_id}.webp
     - SELECT to anon (public by design; these render on Customer Web)
     - INSERT/UPDATE/DELETE to authenticated scoped to auth_store_ids()

2. packages/shared/src/storage/compress.ts -- browser-side image compression, no
   dependencies beyond the Canvas API:
     compressImage(file: File, opts?): Promise<Blob>
   Defaults: longest edge 1600px, JPEG quality 0.8, target <= 200 KB. Loop quality down in
   steps of 0.05 to a floor of 0.5 until under target. Preserve EXIF orientation by reading
   the orientation tag and rotating on canvas -- phone photos are routinely sideways and an
   upside-down bill wrecks OCR accuracy.
   Add a comment explaining the quota arithmetic: the free tier is 1 GB; at 4 MB per raw
   camera photo that is ~250 bills, at 200 KB it is ~5,000, which covers the PoC.

3. packages/shared/src/storage/bills.ts
     uploadBill(file, storeId, invoiceId)  -> compress, upload, return the object path
     getBillSignedUrl(path)                -> signed URL with 300 second expiry
   Never return or log a raw public URL for a bills object.

4. packages/shared/src/storage/usage.ts -- report total bytes per bucket, consumed by the
   quota monitor in WBS 3.10.

5. Tests:
   - a real-ish large fixture image compresses to <= 200 KB
   - EXIF-rotated fixture comes out upright
   - anon cannot read a bills object (integration test against a real anon client)
   - merchant A cannot create a signed URL for merchant B's bill path
   - signed URL expiry is <= 300s
```

---

### 3.9 Configuration, Secrets and Gateway Credential Handling

| Field | Detail |
|---|---|
| **WBS Code** | 3.9 |
| **Type** | Work Package |
| **Requirement** | Foundation, F11 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-1, RL-3 |
| **Automation** | 🔴 Manual (dashboard secret entry) + ▶️ Claude Code (config module) |

**Scope / Statement of Work**
Establish where every secret lives, how it is loaded, and how a missing one fails. With the payment gateway removed the secret inventory is smaller than originally planned — there is no gateway secret key, because there is no gateway. The remaining high-consequence secret is the Supabase `service_role` key, whose leak is a total compromise of every merchant's financial data. A related RL-1 rule is encoded here: the merchant's PromptPay alias is stored, but **no merchant bank account number, name, or branch is ever persisted** — the alias is a routing identifier published in the national PromptPay directory, and the mapping from alias to account lives with the banking system, never with us.

**Deliverables**
- `packages/shared/src/config.ts` — typed, validated configuration loader that throws on missing required values at startup
- Secret inventory at `/docs/security/secrets.md`: name, purpose, storage location, blast radius, rotation procedure
- Gateway credentials stored in Supabase Edge Function secrets and Render environment variables only
- Startup assertion that gateway mode (`sandbox`/`live`) matches the deployment environment

**Acceptance**
- A missing required secret **fails startup with a named error**, never a runtime `undefined`
- **No secret value appears anywhere in git history** — verified with a secret scanner in CI
- **No merchant bank account number, name, or branch is persisted in the database (RL-1)** — only the gateway's own merchant identifier
- A production deployment cannot start while pointed at gateway sandbox mode, and vice versa
- Rotation for each secret is documented and has been performed once as a drill

**Associated Activities**
- Write the config loader with schema validation
- Populate the secret inventory
- Enter secrets in both dashboards
- Add a secret scanner to CI and run it over full history
- Perform one rotation drill

**🔴 [Manual Action Required] — Entering secrets in Supabase and Render dashboards**

```
⚠️  MANUAL ACTION REQUIRED — WBS 3.9
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

**ขั้นตอนที่ต้องทำเอง:**
1. **ตั้ง secrets ของ Edge Functions** (ทำผ่าน CLI ที่เครื่องตัวเอง ค่าจะถูกส่งไปเก็บที่ Supabase ไม่ลง git):
   ```
   supabase secrets set VAPID_PRIVATE_KEY=<ค่าจาก WBS 5.8> --project-ref <prod-ref>
   ```
   > หมายเหตุ: ไม่มี secret ของ payment gateway อีกต่อไป เพราะ MVP ใช้พร้อมเพย์ของร้านโดยตรง
   > เบอร์พร้อมเพย์ของร้านไม่ใช่ความลับ (มันคือเบอร์ที่ลูกค้าโอนเข้า) จึงเก็บในฐานข้อมูลปกติ ไม่ใช่ใน secrets
2. ตรวจว่าตั้งครบ: `supabase secrets list --project-ref <prod-ref>` (จะเห็นแค่ชื่อ ไม่เห็นค่า — ถูกต้องแล้ว)
3. **ตั้ง env vars ของ Render**: เข้า Render Dashboard → เลือก `brewledger-worker` → **Environment** → เพิ่มให้ครบตามตารางในข้อ 3.3 บวกอีก 2 ตัว:
   - `FLOAT16_API_KEY` (จะได้จากข้อ 6.2)
   - `VAPID_PRIVATE_KEY` (จะได้จากข้อ 5.8)
4. **ห้ามทำเด็ดขาด** — ห้ามใส่ค่าเหล่านี้ลงในไฟล์ `.env` ที่อยู่ใน repo, ห้ามส่งผ่านแชท, ห้ามใส่ใน Vercel (เพราะ Vercel build เป็น frontend ที่คนทั่วไปเปิด bundle ดูได้)
5. **ซ้อมการ rotate หนึ่งรอบ** เพื่อพิสูจน์ว่าทำได้จริงตอนฉุกเฉิน: เข้า Supabase → **Project Settings → API → JWT Settings** ดูวิธี rotate `service_role` แล้วจดขั้นตอนจริงลงใน `/docs/security/secrets.md` (ยังไม่ต้อง rotate จริงถ้าระบบกำลังใช้งานอยู่ แค่จดขั้นตอนให้ครบ)

**▶️ Claude Code Prompt**
```
Build the configuration and secret handling layer for Brew Ledger.

1. packages/shared/src/config.ts -- a typed config loader using Zod.
   Define three separate schemas so each runtime only validates what it legitimately has:
     browserConfigSchema  : NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
     edgeConfigSchema     : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PRIVATE_KEY
     workerConfigSchema   : the edge set plus DATABASE_URL, FLOAT16_API_KEY
   Each loader throws at module load with a message naming the exact missing variable and
   the WBS entry that documents it. Never fall back to a default for a secret. Never log a
   value, only names.

2. No gateway mode assertion is needed — there is no gateway and no sandbox/live split.
   The equivalent hazard in this architecture is a wrong PromptPay alias sending every
   customer's money to a stranger, which is guarded at data-entry time instead: see the
   merchant self-verification step in WBS 4.5 and the decoded-payload assertions in WBS 5.5.

3. RL-1 schema guard. Add a test at packages/db/tests/rl1_no_bank_details.test.ts that
   introspects the schema and FAILS if any column name matches
   /bank_account|account_number|account_name|swift|iban|branch/. Only the gateway's own
   PromptPay alias (stores.promptpay_id) may be stored. That alias is a routing identifier
   published in the national PromptPay directory, not an account number; the mapping from
   alias to bank account lives with the banking system and never with us.

4. /docs/security/secrets.md -- an inventory table:
   Secret | Purpose | Lives in | NEVER lives in | Blast radius if leaked | Rotation steps
   Rows for: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, database password,
   FLOAT16_API_KEY, VAPID private key.
   For service_role write the blast radius plainly: full read/write access to every
   merchant's financial data with RLS bypassed; requires immediate rotation and pilot
   store notification.

5. Add gitleaks (or trufflehog) to .github/workflows/ci.yml scanning the FULL history, not
   just the diff, and failing the build on any hit. Add a .gitleaks.toml allow-listing the
   .env.example files by path so documented variable NAMES do not trip it.

6. Add a pre-commit hook via husky running the same scan on staged files.
```

---

### 3.10 Free-Tier Survival Kit — Keep-alive, Backup and Quota Monitoring

| Field | Detail |
|---|---|
| **WBS Code** | 3.10 |
| **Type** | Work Package |
| **Requirement** | Foundation (operational) |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | None |
| **Automation** | 🔴 Manual (GitHub secrets) + ▶️ Claude Code (workflows + scripts) |

**Scope / Statement of Work**
This entry has no equivalent in the original GCP plan and exists entirely because of the free-tier choice. Three specific behaviours will take the pilot down if unmitigated, and all three are foreseeable: a Supabase free project **pauses after about seven days of inactivity** and goes offline until manually restored; the free tier has **no automatic backups**, and the data at risk is merchant financial records; and crossing a quota such as egress causes requests to start failing with 402 rather than degrading. Each mitigation is scheduled, tested, and alerting — a backup that has never been restored is not a backup.

**Deliverables**
- Keep-alive: a GitHub Actions cron hitting a trivial Supabase endpoint every 6 hours
- Backup: a nightly logical dump committed to a private artefact store, with restore tested
- Quota monitor: a daily check of database size, storage bytes, and egress against thresholds, alerting at 70% and 85%
- Render warm-up ping before the daily OCR peak so the first bill of the morning is not the one paying the cold start
- `/docs/ops/free_tier.md` documenting every limit, its mitigation, and its alert threshold

**Acceptance**
- **A restore from a backup dump into a scratch database has been performed and verified at least once, with row counts matching** — a backup that has never been restored does not count as a backup
- The keep-alive has run continuously for 7+ consecutive days with no pause event
- Quota alerts fire at 70% and 85% and were tested by temporarily lowering the threshold
- The documented limits match the vendor's live pricing page as of the check date, with the date recorded

**Associated Activities**
- Write the three workflows
- Add repository secrets
- Run one full restore drill and record row counts before and after
- Test alerting by lowering a threshold artificially
- Record the limits with a verification date

**🔴 [Manual Action Required] — GitHub Actions secrets and alert destination**

```
⚠️  MANUAL ACTION REQUIRED — WBS 3.10
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

**ขั้นตอนที่ต้องทำเอง:**
1. เข้า repo บน GitHub → **Settings → Secrets and variables → Actions → New repository secret** เพิ่มทีละตัว:
   | ชื่อ Secret | ค่า |
   |---|---|
   | `SUPABASE_PROJECT_REF` | project-ref ของ prod |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key ของ prod |
   | `SUPABASE_DB_URL` | Direct connection string ของ prod |
   | `SUPABASE_ACCESS_TOKEN` | สร้างที่ `https://supabase.com/dashboard/account/tokens` กด **Generate new token** |
   | `RENDER_WORKER_URL` | URL ของ worker จากข้อ 3.3 |
   | `ALERT_WEBHOOK_URL` | ดูข้อ 2 ด้านล่าง |
2. **สร้างช่องทางแจ้งเตือน** (เลือกอย่างใดอย่างหนึ่ง ฟรีทั้งคู่):
   - **แบบ Discord:** สร้าง server ส่วนตัว → คลิกขวาที่ช่อง → **Edit Channel → Integrations → Webhooks → New Webhook** → **Copy Webhook URL**
   - **แบบ LINE Notify:** เข้า `https://notify-bot.line.me` → เข้าสู่ระบบ → **My page → Generate token** → เลือกกลุ่มที่จะให้แจ้งเตือน → คัดลอก token
   นำค่าที่ได้ไปใส่เป็น secret ชื่อ `ALERT_WEBHOOK_URL`
3. **ทำ backup restore drill ด้วยตัวเองหนึ่งรอบ** (ข้อนี้สำคัญที่สุดในทั้ง WBS — backup ที่ไม่เคย restore ไม่นับว่าเป็น backup):
   - รอให้ workflow `backup.yml` รันครั้งแรกสำเร็จ แล้วดาวน์โหลดไฟล์ dump จาก **Actions → เลือก run → Artifacts**
   - สร้างโปรเจกต์ Supabase ชั่วคราวขึ้นมาใหม่ **หรือ** ใช้ local `supabase start`
   - restore ด้วยคำสั่ง: `psql <connection-string-ของที่ใหม่> < dump.sql`
   - เทียบจำนวนแถวของตารางหลัก (`orders`, `order_items`, `payments`) ระหว่างต้นทางกับที่ restore มา **ต้องเท่ากัน**
   - จดผลลงใน `/docs/ops/free_tier.md` พร้อมวันที่ทำ แล้วลบโปรเจกต์ชั่วคราวทิ้ง (อย่าลืม เพราะแผน Free ให้แค่ 2 โปรเจกต์)
4. ทดสอบว่าการแจ้งเตือนทำงานจริง: แก้ threshold ในไฟล์ `scripts/check-quota.mjs` ให้ต่ำผิดปกติชั่วคราว (เช่น 1%) แล้วรัน workflow มือ ดูว่าข้อความเข้า Discord/LINE จริงไหม แล้วค่อยแก้กลับ

**▶️ Claude Code Prompt**
```
Build the free-tier survival kit for Brew Ledger. This exists because the project runs on
Supabase Free and Render Free, which have three specific failure modes that will take the
pilot down if unmitigated.

1. .github/workflows/keepalive.yml
   Cron every 6 hours plus workflow_dispatch. Supabase free projects pause after ~7 days
   of inactivity and go OFFLINE until manually restored -- for a live store link that is a
   hard outage, not a slow page.
   Steps: curl the Supabase REST endpoint with the anon key against a trivial query
   (select 1 from a tiny table, or the auth health endpoint). Assert HTTP 200. On failure,
   POST to ALERT_WEBHOOK_URL. Also ping RENDER_WORKER_URL/healthz in the same job.
   Add a second cron entry at 23:00 UTC (06:00 Asia/Bangkok) that pings the Render worker
   specifically, so the first bill scan of the morning does not pay the 30-60s cold start.

2. .github/workflows/backup.yml
   Nightly at 18:00 UTC (01:00 Asia/Bangkok, after close). Steps:
     - install postgresql-client and the supabase CLI
     - pg_dump the prod database using SUPABASE_DB_URL, schema + data, --no-owner
     - gzip it
     - upload as a GitHub Actions artifact with 90-day retention, named
       brewledger-YYYY-MM-DD.sql.gz
     - write a manifest recording per-table row counts (orders, order_items, payments,
       stock_ledger, purchase_invoices, daily_financials) and upload alongside
     - on failure POST to ALERT_WEBHOOK_URL with the job URL
   Supabase Free has NO automatic backups and the data is merchant financial records.
   Add a comment saying so at the top of the file.

3. scripts/check-quota.mjs + .github/workflows/quota.yml (daily)
   Query and report:
     - database size: select pg_database_size(current_database())  vs 500 MB
     - storage bytes per bucket via the Storage API              vs 1 GB
     - row counts of the largest tables, to spot runaway growth
   Thresholds: warn at 70%, alert loudly at 85%. Post a formatted summary to
   ALERT_WEBHOOK_URL on every run so the team sees the trend, not only the breach.
   Include a projection line: at the current 7-day growth rate, days remaining until each
   quota is hit.

4. scripts/restore-drill.mjs
   Takes a dump path and a target connection string, restores, then compares per-table row
   counts against the manifest and prints a pass/fail table. This is the script the human
   runs during the mandatory restore drill.

5. /docs/ops/free_tier.md
   A table: Service | Limit | Current usage | Mitigation | WBS entry | Alert threshold |
   Vendor page checked on (date)
   Rows for: Supabase database 500 MB, storage 1 GB, egress 5 GB, edge function
   invocations 500k/mo, realtime 200 concurrent, 7-day inactivity pause, no backups,
   2-project limit; Render 15-min spin-down and 30-60s cold start; Float16 ~150 OCR
   pages/day; Vercel Hobby bandwidth.
   Add a "Restore drill log" section with columns: date | dump used | rows before |
   rows after | result | performed by. State in bold that a backup which has never been
   restored is not a backup, and that this table must have at least one PASS row before
   the pilot begins.
```

**Testing**
- Workflow test: keep-alive succeeds against a live project and alerts on a forced failure
- Restore drill: row counts match between source manifest and restored database
- Quota test: thresholds fire when artificially lowered
- Cold-start test: the morning warm-up ping measurably reduces first-request latency

---

### 3.11 Observability, Logging and Error Tracking

| Field | Detail |
|---|---|
| **WBS Code** | 3.11 |
| **Type** | Work Package |
| **Requirement** | Foundation |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-3 (log redaction) |
| **Automation** | 🔴 Manual (Sentry account) + ▶️ Claude Code (instrumentation) |

**Scope / Statement of Work**
Instrument the system so a failed payment or a stuck job is diagnosable without a database session, while ensuring logs themselves never become an RL-3 leak. Two logging rules carry real risk: never log a whole row (an `orders` row joined to items carries cost snapshots), and never log a secret. Free-tier log retention is short — Supabase retains one day on the free plan — so anything needed for post-incident analysis must be captured to an external sink at the moment it happens.

**Deliverables**
- Structured JSON logging across Edge Functions and the worker with a shared redaction helper
- Sentry (free tier) wired into both Next.js apps and the worker
- Correlation id propagated from Customer Web request → Edge Function → job → worker
- A minimal ops dashboard route in the Owner Console showing queue depth, failed jobs, and dead-lettered webhooks
- Alerting on: payment webhook failure, job failed after final retry, OCR quota exhaustion

**Acceptance**
- **No log line contains a secret, a full database row, or any cost/margin field for a Customer Web request (RL-3)** — asserted by redaction unit tests
- A payment can be traced end to end by correlation id across all three runtimes
- A job that fails all retries produces exactly one alert, not one per attempt
- Sentry receives errors from all three deployment targets with the release SHA attached

**Associated Activities**
- Create the Sentry project and capture the DSN
- Implement the shared logger and redaction
- Thread correlation ids through every boundary
- Build the ops dashboard route
- Test each alert path once

**🔴 [Manual Action Required] — Sentry account and project**

```
⚠️  MANUAL ACTION REQUIRED — WBS 3.11
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

**ขั้นตอนที่ต้องทำเอง:**
1. เข้า `https://sentry.io` กด **Get Started** สมัครด้วย GitHub เลือกแผน **Developer (Free)** — ฟรี 5,000 errors/เดือน **ไม่ต้องใช้บัตร**
2. สร้าง Project 3 ตัว (กด **Projects → Create Project** ทีละอัน):
   - Platform **Next.js** ชื่อ `brewledger-shop`
   - Platform **Next.js** ชื่อ `brewledger-console`
   - Platform **Node.js** ชื่อ `brewledger-worker`
3. คัดลอก **DSN** ของแต่ละโปรเจกต์ (หน้า **Settings → Client Keys (DSN)**)
4. นำ DSN ไปใส่ตามที่:
   - `brewledger-shop` DSN → ใส่ใน Vercel project `brewledger-shop` เป็น env var ชื่อ `NEXT_PUBLIC_SENTRY_DSN`
   - `brewledger-console` DSN → ใส่ใน Vercel project `brewledger-console` ชื่อเดียวกัน
   - `brewledger-worker` DSN → ใส่ใน Render worker เป็น `SENTRY_DSN`
   > DSN ไม่ใช่ความลับระดับ secret (มันอยู่ใน frontend อยู่แล้ว) แต่ก็ไม่ควร commit ลง git
5. ตั้งค่าการแจ้งเตือน: **Settings → Alerts → Create Alert Rule** เลือก *An issue is first seen* แล้วส่งเข้าอีเมลทีมหรือ Discord webhook เดียวกับข้อ 3.10

**▶️ Claude Code Prompt**
```
Instrument Brew Ledger for observability across three runtimes: two Next.js apps on
Vercel, Supabase Edge Functions (Deno), and the Node worker on Render.

1. packages/shared/src/log.ts -- one structured logger used everywhere.
   JSON lines: { ts, level, runtime, correlationId, storeId?, orderId?, jobId?, msg, ... }
   MANDATORY redaction helper applied to every payload before emit:
     - drop any key matching /key|secret|token|password|authorization|service_role/i
     - drop any key matching /cost|margin|profit|unit_cost|snapshot|fee_satang/i when
       runtime === 'public' (RL-3: a Customer Web request must never emit cost data, not
       even into a log sink)
     - NEVER log a whole row object. Provide logRow(row, allowedKeys[]) which picks only
       the named keys, and make the plain logger reject an object with more than 12 keys
       with a developer-facing error telling them to use logRow.
   Unit-test every redaction rule.

2. Correlation ids. Generate one in apps/shop and apps/console on every outbound request
   (header x-correlation-id). Read and propagate it in every Edge Function. Persist it onto
   job_queue.payload.correlation_id so the worker continues the same trace. Add it to every
   log line and to every Sentry scope.

3. Sentry:
   - apps/shop and apps/console: @sentry/nextjs, DSN from NEXT_PUBLIC_SENTRY_DSN, release
     set to the Vercel commit SHA, tracesSampleRate 0.1, and a beforeSend hook applying the
     same redaction helper.
   - worker: @sentry/node with the Render commit SHA.
   - Edge Functions: a lightweight fetch-based error reporter; do not pull a heavy SDK into
     the Deno bundle.

4. Alerting via ALERT_WEBHOOK_URL (reuse the WBS 3.10 destination) for exactly three
   conditions, each debounced so one incident is one message:
     - a payment webhook fails signature verification or is dead-lettered
     - a job reaches its final retry and stays failed
     - the Float16 OCR daily credit is exhausted
   Debounce by (condition, storeId) with a 15-minute window.

5. An ops route in apps/console at /console/_ops (merchant-scoped, and visible only to a
   merchant flagged is_internal) showing: queue depth by status, jobs failed in the last
   24h with last_error, dead-lettered webhooks, and the timestamp of the last successful
   backup and keep-alive run.

6. /docs/ops/observability.md documenting the log schema, the redaction rules and why they
   exist, how to trace one payment end to end by correlation id, and the note that Supabase
   free retains logs for about one day so anything needed later must be captured to Sentry
   at the time it happens.
```

**Testing**
- Redaction unit test per rule, including a full-row attempt being rejected
- Trace test: one synthetic payment produces a single correlation id visible in all three runtimes
- Debounce test: five identical failures within the window produce one alert
- RL-3 log test: a Customer Web request path emits no cost-shaped key under any log level

---
## Phase 4.0 — Authentication, Onboarding and Merchant Settings

---

### 4.1 Phone OTP Authentication

| Field | Detail |
|---|---|
| **WBS Code** | 4.1 |
| **Type** | Work Package |
| **Requirement** | F08 |
| **Owner** | M1 (API), M2 (UI) |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-3 (disjoint auth scopes) |
| **Automation** | 🔴 Manual (SMS provider account) + ▶️ Claude Code (implementation) |

**Scope / Statement of Work**
Implement merchant sign-in by phone OTP through Supabase Auth. Phone is the right identifier for this user: a one-person cafe owner will not remember a password and will not check a work email, but always has the phone in their apron. Supabase Auth does not send SMS itself — it delegates to a provider that must be configured with credentials, which is the manual step. Customer Web never touches this system at all; it issues no account of any kind (F01), and that separation is a structural RL-3 boundary rather than a UI decision.

**Deliverables**
- Supabase Auth configured for phone OTP with email/password sign-up disabled
- SMS provider connected and sending to Thai numbers in `+66` format
- `/console/login` — phone entry, OTP entry, resend with cooldown, error states in Thai
- Merchant row auto-provisioned on first successful verification
- Rate limiting: per phone number and per IP

**Acceptance**
- A Thai mobile number receives a working OTP and reaches `/console` in under 60 seconds
- **Customer Web has no login route, no session, and no auth provider mounted (F01, RL-3)**
- OTP resend is rate-limited with a visible cooldown; brute force is throttled per number and per IP
- First verification creates exactly one `merchants` row bound to `auth.users.id`
- An expired or wrong code produces a Thai error that does not disclose whether the number is registered

**Associated Activities**
- Create the SMS provider account and configure Supabase Auth
- Build the two-step login UI
- Implement merchant auto-provisioning as a database trigger or post-verify hook
- Test with real Thai numbers on real handsets

**🔴 [Manual Action Required] — SMS provider and Supabase Auth configuration**

```
⚠️  MANUAL ACTION REQUIRED — WBS 4.1
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

**ขั้นตอนที่ต้องทำเอง:**
1. **สมัครผู้ให้บริการ SMS** — Supabase ไม่ได้ส่ง SMS เอง ต้องต่อกับผู้ให้บริการภายนอก เลือกหนึ่งเจ้า:
   - **Twilio** (`https://www.twilio.com/try-twilio`) — สมัครฟรีได้เครดิตทดลองประมาณ $15 พอสำหรับทดสอบทั้ง PoC แต่ **ต้องยืนยันตัวตนด้วยเบอร์โทรจริง** และบัญชี trial ส่งได้เฉพาะเบอร์ที่ verify ไว้แล้ว
   - **MessageBird / Vonage** — ทางเลือกสำรอง ขั้นตอนคล้ายกัน
   > ⚠️ ถ้าเจ้าไหนบังคับผูกบัตร ให้ข้ามไปใช้อีกเจ้า — เงื่อนไขข้อนี้เหมือนกับตอนเลือก hosting คือห้ามติดกำแพงบัตร
2. ใน Twilio: **Phone Numbers → Buy a number** เลือกเบอร์ที่รองรับ SMS (ถ้าใช้ trial ให้ใช้เบอร์ทดลองที่ระบบแจกให้)
3. คัดลอกค่า 3 ตัวจากหน้า **Account Info**: `Account SID`, `Auth Token`, และเบอร์ที่จะใช้ส่ง (`Messaging Service SID` หรือ `From number`)
4. **ตั้งค่าใน Supabase**: เข้า Dashboard → เลือกโปรเจกต์ → **Authentication → Providers → Phone**
   - เปิดสวิตช์ **Enable Phone provider**
   - เลือก SMS provider เป็น **Twilio**
   - วางค่า Account SID / Auth Token / Message Service SID ที่คัดลอกมา
   - ตั้ง **OTP expiry** = `600` วินาที (10 นาที)
   - กด **Save**
5. **ปิดช่องทางที่ไม่ใช้**: ไปที่ **Authentication → Providers → Email** แล้ว **ปิด Enable Email provider** (โปรเจกต์นี้ใช้เบอร์โทรอย่างเดียว การเปิดอีเมลทิ้งไว้คือช่องทางสมัครที่ไม่มีใครเฝ้า)
6. **ตั้ง rate limit**: **Authentication → Rate Limits** ตั้งค่าส่ง OTP ไม่เกิน 5 ครั้ง/ชั่วโมง/เบอร์
7. **ทดสอบจริง**: ใช้เบอร์มือถือไทยจริงของทีมทดสอบขอ OTP หนึ่งครั้ง ต้องได้รับ SMS ภายใน 60 วินาที
   - ถ้าใช้ Twilio trial ต้องเพิ่มเบอร์ที่จะทดสอบใน **Verified Caller IDs** ก่อน ไม่งั้นส่งไม่ออก
8. บันทึกไว้ใน `/docs/ops/auth.md` ว่าใช้ผู้ให้บริการเจ้าไหน เครดิตคงเหลือเท่าไร และจะหมดเมื่อไร (เป็นความเสี่ยงที่ต้องเฝ้าระหว่าง pilot)

**▶️ Claude Code Prompt**
```
Implement merchant phone-OTP authentication for Brew Ledger's Owner Console.
Supabase Auth phone provider is already configured by the human (WBS 4.1 manual steps).

1. Database: a trigger on auth.users AFTER INSERT that provisions exactly one row in
   public.merchants (auth_user_id, phone, subscription_tier 'free'). Make it idempotent -- ON CONFLICT (auth_user_id) DO NOTHING --
   so a replayed webhook or a re-run migration cannot create a duplicate merchant.

2. apps/console/app/console/login/page.tsx -- a two-step client flow:
   Step 1: phone number input. Thai UX rules -- accept the number as the user naturally
   types it (0812345678, 081-234-5678, +66812345678) and normalise to E.164 +66 before
   sending. Show the normalised number back for confirmation.
   Step 2: 6-digit OTP input with per-digit boxes, auto-advance, paste support, and a
   resend button disabled behind a visible 60-second countdown.
   All copy in Thai. Error copy must NOT disclose whether a number is registered --
   use one generic message for wrong code and unknown number alike.

3. apps/console/middleware.ts -- deny by default. Every route under /console requires a
   valid session EXCEPT /console/login. Redirect unauthenticated requests to /console/login
   preserving the intended path as ?next=. Do not implement an allow-list of protected
   routes; implement a deny-list of exactly one public route, so a new page added later is
   protected automatically.

4. Rate limiting beyond Supabase's own: a small table auth_attempts (phone_hash, ip_hash,
   attempted_at) and a check in the send-OTP path allowing at most 5 sends per phone per
   hour and 20 per IP per hour. Hash both values with a server-side salt -- do not store raw
   phone numbers or IPs for this purpose.

5. RL-3 / F01 assertion test: a test that scans apps/shop for any import of
   @supabase/auth-helpers, any signIn/signUp/getSession call, and any route matching
   /login|signup|auth/. It must find NONE and fail the build if it does. Customer Web
   issues no account of any kind.

6. Session handling: httpOnly cookie-based session via the Supabase SSR helpers, refreshed
   in middleware. Session must survive a page reload and a browser restart within the
   configured lifetime -- a cafe owner will not re-authenticate mid-service.

Write all user-facing strings in Thai. Add /docs/ops/auth.md noting the SMS provider in
use and that its credit balance is a live pilot risk to monitor.
```

**Testing**
- Integration: real Thai number receives OTP and reaches `/console` in < 60s
- Unit: number normalisation across the three common Thai input formats
- Security: 6th OTP request within an hour is rejected
- Security: wrong code and unknown number produce identical responses
- Structural: `apps/shop` contains no auth code (fails build otherwise)

---

### 4.2 Merchant Session, Roles and Route Guards

| Field | Detail |
|---|---|
| **WBS Code** | 4.2 |
| **Type** | Work Package |
| **Requirement** | F08 |
| **Owner** | M1 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-3 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Bind every authenticated request to exactly one merchant and exactly one store, and make that binding the only way data is reached. The guard resolves `auth.uid()` to a merchant and its stores once per request and passes that context explicitly; no handler is permitted to accept a `store_id` from the client and trust it. This is the application-layer complement to the RLS policies in 3.6 — RLS makes a cross-tenant read return nothing, and the guard makes it impossible to attempt.

**Deliverables**
- `_shared/console/auth.ts` guard resolving JWT → merchant → owned store ids
- A handler factory that cannot be constructed without the resolved context
- Client-side session context provider for the console app
- 401/403 handling with no information disclosure in the body

**Acceptance**
- **A request supplying another merchant's `store_id` in its body or query is rejected, not silently scoped** — asserted per console endpoint
- No console handler reads `store_id` directly from client input
- An expired session redirects to login without a flash of authenticated content
- 401 and 403 bodies contain no merchant, store, or existence information

**Associated Activities**
- Implement the guard and the handler factory
- Refactor every console function to take the context parameter
- Write cross-tenant attempt tests
- Verify no authenticated-content flash on expiry

**▶️ Claude Code Prompt**
```
Implement the merchant session guard and route protection for Brew Ledger's Owner Console.

1. supabase/functions/_shared/console/auth.ts
   requireMerchant(req): verifies the Supabase JWT, resolves auth.uid() -> merchants row ->
   owned store ids, and returns { merchantId, storeIds, tier, absorbGatewayFee }.
   Throws 401 with an empty body on any failure. Never reveal whether a user exists.

2. A handler factory in the same directory:
     export const consoleHandler = (fn: (req: Request, ctx: MerchantCtx) => Promise<Response>)
   The factory calls requireMerchant first and passes ctx. Type it so a console function
   CANNOT be exported without going through the factory -- the raw handler signature must
   not satisfy the export contract. The goal is that forgetting the guard is a compile
   error, not a review miss.

3. THE CENTRAL RULE, enforce it everywhere: no console handler may accept store_id from
   client input and trust it. Every query scopes on ctx.storeIds. If a request body
   contains a store_id, the handler must assert it is a member of ctx.storeIds and return
   403 otherwise -- never silently substitute the caller's own store, because silent
   substitution hides an attack and confuses a genuine bug.

4. apps/console: a SessionProvider client component exposing the merchant context, plus a
   useMerchant() hook. On session expiry, redirect to /console/login immediately with no
   render of authenticated content -- guard in middleware, not only in the component tree,
   so there is no flash of merchant data.

5. Cross-tenant test suite at supabase/functions/_tests/tenant_isolation.test.ts:
   seed two merchants A and B with one store each, then for EVERY console endpoint attempt
   the request as A supplying B's store_id / order_id / invoice_id / ingredient_id.
   Every attempt must return 403 or 404 and never B's data. Write it as a loop over an
   endpoint manifest so a newly added endpoint that is not in the manifest fails the test.
```

**Testing**
- Cross-tenant attempt per endpoint returns 403/404, never data
- Compile test: a console function exported without the factory fails typecheck
- Session expiry produces no authenticated-content flash
- 401/403 bodies contain no identifying information

---

### 4.3 Store Profile Setup

| Field | Detail |
|---|---|
| **WBS Code** | 4.3 |
| **Type** | Work Package |
| **Requirement** | F09 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | None |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Let a merchant create the store record a customer will see: name, pick-up address, opening hours, and the slug that forms the public link. This is step two of the 15-minute onboarding target from 2.7, so it must be short and must not ask for anything the merchant would have to go and look up. Slug generation is automatic from the store name with a Thai-to-Latin transliteration fallback, editable but never blank.

**Deliverables**
- `/console/settings/store` — name, pick-up address, opening/closing time, slug
- Automatic slug generation with Thai transliteration and uniqueness check
- Publish/unpublish toggle gating Customer Web visibility
- Onboarding progress indicator showing what remains before the store can take an order

**Acceptance**
- A store is created and published in under 3 minutes from a blank state
- Slug is unique, URL-safe, and auto-suggested from a Thai store name without the merchant typing Latin characters
- **Unpublishing immediately removes the store from Customer Web** (verified against the 3.6 `anon` policy)
- Opening hours are stored with an explicit timezone and drive the "closed" state on Customer Web
- No field in this form is mandatory that the merchant would need to leave the shop to find

**Associated Activities**
- Build the form with inline validation
- Implement Thai→Latin slug transliteration with a collision suffix
- Wire publish state to the public policy
- Measure completion time in a dry run

**▶️ Claude Code Prompt**
```
Build the store profile screen for Brew Ledger's Owner Console at
apps/console/app/console/settings/store/page.tsx.

Fields: store name (Thai), pick-up address, opening time, closing time, public slug,
published toggle. Nothing else -- this is step 2 of a 15-minute onboarding target and every
extra field costs completion.

1. Slug generation. Auto-suggest from the store name. The name will be Thai, so implement
   a Thai-to-Latin transliteration (RTGS-style is fine, correctness matters less than
   producing a stable readable ASCII slug) with a fallback to 'cafe' plus a short random
   suffix if transliteration yields nothing usable. Lowercase, hyphenate, strip
   non-[a-z0-9-]. Check uniqueness against stores.slug and append -2, -3 on collision.
   The merchant may edit it; it may never be blank. Show a live preview of the final URL:
   brewledger.app/s/{slug}

2. Opening hours: two time inputs plus the store timezone (default Asia/Bangkok, stored
   explicitly on the row). These drive the "closed right now" state on Customer Web, so
   store times as time-of-day plus timezone, not as timestamps.

3. Publish toggle. Explain in Thai microcopy exactly what it does: published means anyone
   with the link can see the menu and order; unpublished means the link shows a closed
   message. Do not use the word "public" without explaining it.

4. An onboarding progress strip at the top showing the three things needed before the store
   can take an order: (1) store profile, (2) at least one menu item, (3) payment gateway
   linked. Each is a link to its screen with a done/not-done state. Do NOT include recipes
   or ingredients anywhere in this list -- RL-2, a merchant must be able to sell without
   ever entering a BOM.

5. Validation inline and in Thai. Save with an optimistic toast and a real error state.

Use packages/ui primitives only. All copy Thai.
```

---

### 4.4 Menu and Price Builder (No BOM Required)

| Field | Detail |
|---|---|
| **WBS Code** | 4.4 |
| **Type** | Work Package |
| **Requirement** | F10 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | **RL-2 (primary enforcement point)** |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Build the menu editor, and build it so that a merchant can add a drink and a price and be finished. This entry is the primary enforcement point of RL-2. Every competing product gates unit costing behind mandatory recipe entry, and that gate is precisely why the target user never adopts unit costing. Here the recipe block exists, is collapsed, is labelled optional, has no blocking validation, and never nags. A merchant who ignores it forever must still be able to sell, get paid, and see revenue — with cost displayed as an em dash, never as zero.

**Deliverables**
- `/console/menu` list and `/console/menu/[id]` editor
- Required fields: name and price. Everything else optional.
- Optional option groups (hot/cold, sweetness) with price deltas
- Collapsed, optional recipe block deferring to 6.7
- Menu photo upload using the 3.8 compression path
- Availability toggle driving realtime updates on Customer Web

**Acceptance**
- **A menu item saves with only a name and a price, and is immediately sellable (RL-2)**
- **The recipe block is collapsed by default, is labelled optional, has no validation that can block saving, and produces no nagging copy anywhere in the flow (RL-2)**
- An item with no BOM shows cost as "—" and never as `0` anywhere in the console
- Toggling availability updates Customer Web within 2 seconds via Realtime
- Adding three items takes under 2 minutes measured in a dry run

**Associated Activities**
- Build the list and editor
- Implement option groups with deltas
- Add the collapsed recipe block with an explicit "you can do this later" affordance
- Audit every string in the flow for nagging
- Measure the three-item timing

**▶️ Claude Code Prompt**
```
Build the menu editor for Brew Ledger's Owner Console. This screen is the primary
enforcement point of red line RL-2 -- read this whole prompt before writing code.

RL-2 states: a merchant must be able to create a menu, publish a store link, take an order
and get paid WITHOUT ever entering a recipe/BOM. Every competitor gates unit costing behind
mandatory recipe entry, and that gate is exactly why this user never adopts it.

Screens:
  apps/console/app/console/menu/page.tsx        list, reorder, availability toggle
  apps/console/app/console/menu/[id]/page.tsx   editor

Editor fields:
  REQUIRED: name (Thai), price in THB (store as integer satang -- multiply on save,
            divide on display, never hold money in a float)
  OPTIONAL: description, photo, category, option groups, recipe

Option groups: e.g. "ร้อน/เย็น/ปั่น" and "ระดับความหวาน", each option carrying a price
delta in satang which may be zero or negative.

THE RECIPE BLOCK -- implement exactly this behaviour:
  - Rendered collapsed by default, below the save button in visual priority
  - Labelled in Thai as optional, e.g. "สูตร (ใส่ทีหลังได้)"
  - Zero validation. Saving with it empty must succeed with no warning, no confirm dialog,
    no yellow banner, no toast, no badge, and no asterisk anywhere
  - When empty, cost displays as "—" everywhere in the console. NEVER 0, NEVER "0.00",
    NEVER "ยังไม่ได้ใส่ต้นทุน" as a warning-styled element
  - No copy anywhere in this flow may imply the merchant is incomplete, behind, or missing
    something. Write a comment above the component stating this and citing WBS 4.4 / RL-2
    so a future contributor does not "helpfully" add a completion prompt

Photo upload: use packages/shared/src/storage/compress.ts from WBS 3.8, upload to the
menu-images bucket at menu-images/{store_id}/{menu_item_id}.webp.

Availability toggle: writes menu_items.availability and must reflect on Customer Web within
2 seconds. Rely on Supabase Realtime on the menu_items table filtered by store_id.

Tests to include:
  - insert an item with only name and price, then complete a full sale of it, asserting no
    error and cost === null (not 0)
  - a string audit test that scans this route's rendered output for Thai nag words
    (ยังไม่, ควรใส่, กรุณาใส่สูตร, ไม่ครบ) and FAILS if any appear in the recipe block area
  - timing check documented: adding three items should take under 2 minutes
```

**Testing**
- Save with name + price only, then sell it: no error, cost `null`
- String audit: no nagging copy in the recipe block region
- Availability toggle reflects on Customer Web in < 2s
- Money round-trip: 45.50 THB → 4550 satang → "45.50" with no float drift

---

### 4.5 Merchant PromptPay Setup

| Field | Detail |
|---|---|
| **WBS Code** | 4.5 |
| **Type** | Work Package |
| **Requirement** | F11 |
| **Owner** | M1 |
| **Surface** | Owner Console |
| **Red Line Touch** | **RL-1 (primary enforcement point)** |
| **Automation** | ▶️ Claude Code |

> **Revision (payment model change).** This entry previously covered onboarding each pilot store to a licensed payment gateway (2C2P / Omise) and shepherding its KYC. That approach is **withdrawn for the MVP** for two reasons that surfaced during pilot-store screening: 2C2P requires a commercial registration at least one year old, which excludes most sole-proprietor coffee shops outright, and gateway KYC takes 15–20 business days, which does not fit the delivery window. The replacement is direct merchant-owned PromptPay, which removes the gateway from the MVP entirely.

**Scope / Statement of Work**
Capture the merchant's own PromptPay identifier — a mobile number, a national ID, or a tax ID — and nothing else. That single value is all the system needs to produce a payable QR for every subsequent order. This is the strongest possible position on RL-1: money moves bank-to-bank from the customer directly into the merchant's own account, and Brew Ledger is not a party to the transaction in any capacity. There is no gateway account, no settlement instruction, no intermediary, and therefore no plausible reading under which the platform is handling funds.

The trade-off this buys is stated honestly in 5.6: without a gateway there is no webhook, so payment confirmation becomes a merchant action rather than an automatic event.

**Deliverables**
- `/console/settings/payments` reworked: PromptPay ID entry with type selector (มือถือ / บัตรประชาชน / เลขผู้เสียภาษี)
- Client-side validation and normalisation of each identifier type
- A live QR preview the merchant can scan with their own banking app to verify the payee is themselves
- `stores.promptpay_id` and `stores.promptpay_type` replacing `gateway_provider` and `gateway_merchant_id`
- Thai explainer describing exactly where the money goes

**Acceptance**
- **The merchant scans the preview QR with their own banking app and sees their own name as the payee** — this is the verification step, and it is the merchant's own eyes rather than a claim in a document (RL-1)
- A sole-proprietor merchant with no commercial registration completes this screen successfully
- **No bank account number, account name, branch, SWIFT, or IBAN is stored** — the PromptPay identifier is a routing alias, not an account number, and the mapping from alias to account lives with the banking system
- A store with no PromptPay ID cannot be published as orderable, and the console says why in plain Thai
- Setup completes in under 60 seconds

**Associated Activities**
- Migrate the schema columns
- Build the entry screen with type-aware validation
- Implement the live preview using the 5.5 generator
- Write the Thai explainer and have a non-technical reader confirm it is clear

**▶️ Claude Code Prompt**
```
Rework the payment settings screen for BrewLedger. The gateway integration is REMOVED from
the MVP; merchants receive money directly through their own PromptPay.

Read /docs/design/state_matrix.md for the payments screen before starting. Reuse the
delivered layout — only the fields and copy change.

1. Migration: on `stores`, replace gateway_provider and gateway_merchant_id with
     promptpay_id    text
     promptpay_type  text check (promptpay_type in ('msisdn','nid','taxid'))
   Add a comment: this is a routing alias published into the PromptPay directory, not a bank
   account number. RL-1 — Brew Ledger stores the alias only and is never a party to the
   transfer.

2. apps/console/app/console/settings/payments/page.tsx
   - Type selector: เบอร์มือถือ / เลขบัตรประชาชน / เลขผู้เสียภาษี
   - One input, validated and normalised per type:
       msisdn  10 digits starting 0; strip spaces and hyphens; store as 0812345678
       nid     13 digits; validate the check digit (weighted sum mod 11) and reject early —
               a typo here means every future QR pays a stranger
       taxid   13 digits
   - LIVE QR PREVIEW beneath the input, regenerated on every valid change, using the
     generator from WBS 5.5 with a 1.00 THB amount.
   - Thai instruction beside it: `สแกน QR นี้ด้วยแอปธนาคารของคุณเอง แล้วดูว่าชื่อผู้รับเงิน
     เป็นชื่อคุณถูกต้องหรือไม่ (ยังไม่ต้องกดโอน)` — this is the verification step and it must
     be prominent, not a footnote. A wrong digit here sends every customer's money to a
     stranger and the merchant would not discover it until someone complains.
   - A confirmation checkbox the merchant ticks after verifying, persisted as
     promptpay_verified_at. Publishing requires it.

3. Thai explainer, always visible:
     `เงินจากลูกค้าโอนเข้าบัญชีพร้อมเพย์ของคุณโดยตรง ไม่ผ่าน BrewLedger
      เราเก็บแค่เบอร์พร้อมเพย์ไว้สร้าง QR เท่านั้น ไม่เห็นและไม่เก็บเลขบัญชีธนาคารของคุณ
      ไม่มีค่าธรรมเนียมจากเรา`

4. Publish gating: a store with no verified PromptPay ID cannot be published. Explain in
   Thai and link here. Never silently disable the toggle.

5. Remove from the codebase: the gateway adapter interface, the provider implementations,
   the sandbox stub, and any GATEWAY_* variable from config. Delete rather than comment out. Record the removal in
   /docs/adr/007-licensed-gateway.md by superseding it with a new ADR, 008, stating the
   reason: sole-proprietor merchants cannot clear gateway KYC and the 15-20 business day
   turnaround does not fit the delivery window.

6. Tests:
   - each identifier type validates and normalises correctly; an invalid NID check digit is
     rejected
   - a store cannot be published without promptpay_verified_at
   - schema introspection still finds no bank-detail-shaped column (reuse the WBS 3.9 test)
   - static analysis: no file imports a payment gateway SDK anywhere in the tree
```

---

### 4.6 Store QR and Public Link Generation

| Field | Detail |
|---|---|
| **WBS Code** | 4.6 |
| **Type** | Work Package |
| **Requirement** | F01 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-3 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Generate the printable QR and shareable link that is the store's entire customer acquisition surface. The merchant will print this and tape it to the counter, so it must be legible at counter distance after being printed on an inkjet, and it must include a short human-readable URL for customers who would rather type. The QR encodes only the public store URL — nothing else, and in particular no identifier that could be used to enumerate other stores.

**Deliverables**
- `/console/settings/link` — QR preview, copy link, download PNG and print-ready PDF
- A print layout at A5 and A6 with the store name, the URL in text, and a Thai call to action
- Copy-to-clipboard with confirmation
- QR error correction level tuned for print

**Acceptance**
- A printed A6 QR scans reliably from 30 cm on a mid-range Android phone
- The QR encodes exactly `https://{host}/s/{slug}` and nothing else
- The printable sheet shows the URL as readable text alongside the QR
- **The QR encodes no merchant id, store id, or token that could enumerate other stores (RL-3)**

**Associated Activities**
- Generate QR at print resolution with appropriate error correction
- Build the print layout
- Test scanning from a real print at real distance
- Verify the encoded payload contains only the public URL

**▶️ Claude Code Prompt**
```
Build the store link and QR screen for Brew Ledger at
apps/console/app/console/settings/link/page.tsx.

1. QR generation client-side (use the 'qrcode' npm package). Encode EXACTLY
   https://{host}/s/{slug} and nothing else -- no merchant id, no store id, no token, no
   tracking parameter. Add a comment citing RL-3: anything else in this payload is a
   potential enumeration vector, and this image gets photographed by strangers.

2. Error correction level M or Q, and render at a minimum of 1024x1024 for download so an
   inkjet print stays crisp. Include a quiet zone.

3. Screen contents:
   - Live QR preview
   - The full URL as selectable text with a copy button and a Thai confirmation toast
   - Download PNG
   - Download print-ready PDF

4. Print layout, generated client-side, in A5 and A6:
   - Store name large at the top
   - QR centred, occupying at least 60% of the sheet width
   - The URL printed as readable text beneath the QR, because some customers will type it
   - A Thai call to action, e.g. "สแกนสั่งล่วงหน้า รับที่ร้านได้เลย"
   - No Brew Ledger branding larger than the store's own name -- this sheet belongs to the
     merchant's counter, not to us

5. An unpublished store shows the QR greyed out with a Thai explanation and a link to the
   publish toggle, rather than generating a QR that leads to a closed page.

6. Test: decode the generated QR payload in a unit test and assert it matches the expected
   URL exactly, with no extra query parameters.
```

---

### 4.7 Subscription Tiers and Feature Gating

| Field | Detail |
|---|---|
| **WBS Code** | 4.7 |
| **Type** | Work Package |
| **Requirement** | F12 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Implement the tier model and the gates it drives. During the PoC every pilot store runs on a tier that includes everything, but the gating mechanism must exist from the start so the commercial model can be tested without a refactor, and so the team learns which features merchants actually reach for. Two gating rules are absolute: ordering and payment are never gated, because a merchant who cannot sell has no reason to stay; and cost visibility is never used as a paywall in a way that forces BOM entry (RL-2).

**Deliverables**
- Four tiers: `free`, `starter`, `growth`, `scale` with a feature matrix
- `useFeature(flag)` hook and a server-side equivalent
- `/console/settings/subscription` showing the current tier and what each includes
- Upgrade prompts that state the benefit rather than blocking the screen

**Acceptance**
- **Ordering, payment, and order management are available on every tier including `free`**
- Changing a merchant's tier changes available features without a deploy
- A gated feature shows a clear explanation, never a broken or empty screen
- **No gate can be satisfied only by entering a BOM (RL-2)**

**Associated Activities**
- Define the feature matrix
- Implement the flag resolution on both client and server
- Build the subscription screen
- Audit every gate against the two absolute rules

**▶️ Claude Code Prompt**
```
Implement subscription tiers and feature gating for Brew Ledger.

Tiers on merchants.subscription_tier: free | starter | growth | scale

Feature matrix -- implement in packages/shared/src/features.ts as a single source of truth
consumed by both client and server:

  ALWAYS AVAILABLE ON EVERY TIER INCLUDING FREE (never gate these):
    pre-order and pickup, PromptPay payment, order queue and status management,
    cash sale entry, basic daily revenue total, menu management, store settings
  starter adds: unit costing, cost drift alerts, ingredient and stock tracking
  growth  adds: cash-flow forecast, AI advisor
  scale   adds: multi-branch, full tax suite, priority support
  (growth and scale features are Phase 2 product -- gate them as "coming soon", do not
   build them)

Two absolute rules to encode as tests:
  1. A merchant on 'free' can complete the entire sell-and-get-paid loop. Write an
     integration test that runs the full loop as a free-tier merchant and asserts no gate
     is hit.
  2. RL-2: no gate may be satisfiable only by entering a BOM. Write a test that asserts
     no feature flag's unlock condition references bom_lines.

Implementation:
  - useFeature(flag) client hook reading tier from the session context
  - requireFeature(ctx, flag) server helper for console Edge Functions, returning 402 with
    a machine-readable reason when denied
  - apps/console/app/console/settings/subscription/page.tsx showing the current tier, a
    comparison table, and what upgrading would unlock

Upgrade prompts: state the benefit in one Thai sentence and keep the surrounding screen
usable. Never render a blank screen, a modal that traps the user, or a disabled control
with no explanation.
```

---

### 4.8 Fee Model Documentation (Superseded Entry)

| Field | Detail |
|---|---|
| **WBS Code** | 4.8 |
| **Type** | Work Package (reduced) |
| **Requirement** | F12 |
| **Owner** | M1 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-1 |
| **Automation** | ▶️ Claude Code |

> **Revision.** This entry previously implemented a per-merchant switch deciding who bears the ~1.5–3% gateway fee, plus the accounting attribution that followed from it. **With the gateway removed there is no fee to bear.** Customer money moves bank-to-bank on the PromptPay rail; the sending bank may charge the customer under normal PromptPay rules, but no fee flows through or is attributable to Brew Ledger or the merchant's use of this product. The entry is reduced to removing the now-dead machinery and stating the position clearly, because a business plan that still claims to absorb fees would be describing a cost that does not exist.

**Scope / Statement of Work**
Remove the fee absorption switch and its attribution logic, and replace it in the console with a plain statement of the actual fee position. This matters beyond code hygiene: the PoC budget previously reserved roughly 81,000 THB for absorbed gateway fees across 30 stores over three months. That line is now zero, and the business plan, the pitch, and the go/no-go criteria in 1.7 should reflect it rather than carrying a phantom cost.

**Deliverables**
- Removal of `merchants.absorb_gateway_fee`, `orders.gateway_fee_satang`, and `orders.fee_borne_by`
- Removal of the fee lines from the P&L (7.5) and period comparison (7.7)
- A plain Thai fee statement on the subscription screen
- Updated PoC cost projection with the gateway fee line removed

**Acceptance**
- **No fee-bearing or fee-attribution field remains in the schema** — asserted by introspection
- The console states the fee position in one plain sentence with no asterisk
- The P&L no longer renders a gateway fee line, and its reconciliation test still passes with the term removed
- `/docs/poc_readiness.md` operating cost table shows no gateway fee line

**Associated Activities**
- Drop the columns and remove the switch
- Remove the fee lines from both reports and update their reconciliation tests
- Write the Thai statement
- Update the PoC cost projection

**▶️ Claude Code Prompt**
```
Remove the gateway fee absorption machinery from BrewLedger. The gateway is gone; the fee
it charged does not exist.

1. Migration: drop merchants.absorb_gateway_fee, orders.gateway_fee_satang, and
   orders.fee_borne_by. Add a comment recording why: the MVP uses direct merchant-owned
   PromptPay, so no per-transaction fee flows through this product.

2. Remove every reference: the WBS 4.8 switch, the fee attribution in the confirmation path,
   the absorbed-fee line in the WBS 7.5 P&L, the three-line fee breakdown in the WBS 7.7
   period comparison, and the absorbed-fee projection in the /console/_ops view.
   Update the P&L reconciliation test: net profit is now
   gross_revenue - total_cogs - other_expense, with no fee term. The test must still assert
   exact integer-satang equality.

3. apps/console/app/console/settings/subscription/page.tsx — replace the fee status line
   with a plain statement:
     `ไม่มีค่าธรรมเนียมต่อรายการ ลูกค้าโอนเข้าพร้อมเพย์ของร้านโดยตรง
      (ธนาคารของลูกค้าอาจคิดค่าธรรมเนียมตามเงื่อนไขพร้อมเพย์ปกติ ซึ่งไม่เกี่ยวกับ BrewLedger)`
   The parenthetical is not hedging — it is accurate, and a merchant who later hears a
   customer mention a transfer fee should already know it was never ours.

4. Update /docs/poc_readiness.md: remove the gateway fee line from the operating cost table
   and reduce the PoC reserve accordingly. The previous projection reserved roughly
   81,000 THB for absorbed fees across 30 stores over three months; that line is now zero.
   State the change explicitly rather than silently editing the number, so the revision is
   traceable when someone compares against the earlier plan.

5. Verify with the WBS 3.5 schema introspection test that no fee-bearing or fee-attribution
   column remains anywhere.
```

## Phase 5.0 — Order Loop: Pre-order, Payment and Fulfilment

> **Every entry in this phase runs on Supabase Edge Functions, never the Render worker.** A human is waiting on every request here. The only exception is the notification fan-out in 5.8, which is enqueued rather than awaited.

---

### 5.1 Public Store Page and Menu Browse

| Field | Detail |
|---|---|
| **WBS Code** | 5.1 |
| **Type** | Work Package |
| **Requirement** | F01, F02 |
| **Owner** | M2 |
| **Surface** | Customer Web |
| **Red Line Touch** | **RL-3** |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Build the page a stranger lands on from a QR or a link: store identity, menu, availability, and nothing else. This is the most exposed surface in the product and the one where an RL-3 failure is most likely and most damaging. It renders from the `anon` key under the 3.6 policies and the 3.7 serializers, and it must be fast on a mid-range Android on mobile data because the customer is standing on a street.

**Deliverables**
- `/s/[slug]` server-rendered with the public serializer
- Realtime subscription reflecting availability changes without a refresh
- States: store closed, store unpublished, no menu items yet, all slots full today
- Performance budget met on a throttled mobile connection

**Acceptance**
- **The rendered HTML and the client bundle contain no cost, margin, profit, expense, stock, or aggregate field (RL-3)** — asserted by the 3.4 bundle scan and a snapshot test
- An item toggled unavailable in the console disappears from an open customer page within 2 seconds
- An unpublished store renders a closed message, never a 500 or a blank page
- LCP under 2.5 s on a throttled 4G profile with a cold cache
- The page is usable without JavaScript for browsing (progressive enhancement)

**Associated Activities**
- Build the page from the public DTOs only
- Wire the Realtime subscription
- Implement every empty and closed state
- Measure and tune performance on a throttled profile

**▶️ Claude Code Prompt**
```
Build the public store page for Brew Ledger's Customer Web at
apps/shop/app/s/[slug]/page.tsx.

This is the most exposed surface in the product. A stranger reaches it from a printed QR.
RL-3 applies with no exceptions: no cost, unit cost, margin, profit, expense, stock level,
ingredient, or store-level aggregate may appear in the HTML, the JSON, the props, the
client bundle, or a debug attribute.

1. Data access: Supabase anon client only, under the RLS policies from WBS 3.6, mapped
   through toPublicStore / toPublicMenuItem / toPublicOptionGroup from WBS 3.7. Never
   select * from any table. Enumerate columns explicitly in the query as a second layer of
   defence behind RLS.

2. Server-render the initial payload for speed and for no-JS browsing, then hydrate a
   Realtime subscription on menu_items filtered by store_id so an availability change in the
   console appears here within 2 seconds without a refresh.

3. Layout, mobile-first at 375px: store name, open/closed status computed from opening
   hours in the store timezone, pick-up address, then the menu grouped by category. Each
   item shows name, description, photo, price. Unavailable items render greyed with a Thai
   "หมดชั่วคราว" label rather than disappearing, so a returning customer understands why
   their usual drink is missing.

4. Every state must be designed, not defaulted:
   - store not found or unpublished -> a calm Thai message, HTTP 404, no stack trace
   - store closed right now -> menu still browsable, ordering disabled, next opening time shown
   - no menu items yet -> a Thai message telling the customer the shop has not added drinks yet
   - all of today's slots full -> browsable menu, a clear message, and tomorrow's slots offered

5. Performance budget: LCP under 2.5s on a throttled 4G profile with a cold cache. Use
   next/image with explicit sizes, preload the largest image, and keep the client bundle for
   this route under 100 KB gzipped. Add a CI check on the route bundle size.

6. Tests:
   - a response snapshot committed and scanned against /docs/design/forbidden_fields.json
   - a test asserting the rendered HTML contains none of those substrings
   - a Realtime test: toggling availability updates an open page within 2 seconds
   - each of the four states above renders its intended content
```

---

### 5.2 Item Options and Cart

| Field | Detail |
|---|---|
| **WBS Code** | 5.2 |
| **Type** | Work Package |
| **Requirement** | F02 |
| **Owner** | M2 |
| **Surface** | Customer Web |
| **Red Line Touch** | RL-3 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Let the customer configure a drink and build a small order. Coffee ordering has a specific shape: two or three option groups, almost always including temperature and sweetness, and a typical basket of one to three drinks. The cart lives client-side until checkout because creating an order row for every abandoned browse would fill a 500 MB database with garbage and complicate the slot quota.

**Deliverables**
- Bottom-sheet option selector with single- and multi-select groups
- Client-side cart persisted to `sessionStorage` with quantity editing
- Running total computed in satang
- Re-validation of prices and availability at checkout

**Acceptance**
- Options render correctly for single-select and multi-select groups with price deltas
- The cart survives a page reload within the session but is not persisted across days
- **No order row is created until checkout** — verified by browsing without checking out and asserting zero new rows
- The total displayed matches the total charged, recomputed server-side at checkout
- A price or availability change between add-to-cart and checkout is caught and surfaced, not silently charged

**Associated Activities**
- Build the option sheet
- Implement the cart store with session persistence
- Implement server-side re-validation
- Test the stale-price path deliberately

**▶️ Claude Code Prompt**
```
Build item options and the cart for Brew Ledger's Customer Web.

1. apps/shop/components/ItemOptionsSheet.tsx -- a bottom sheet (packages/ui Sheet) opened
   from a menu item. Renders option groups: single-select as radio, multi-select as
   checkbox, each option showing its price delta only when non-zero. Quantity stepper.
   A sticky footer showing the computed line total and an add-to-cart button.
   Thai copy throughout. Minimum 44x44px tap targets.

2. apps/shop/lib/cart.ts -- a client-side cart store (Zustand or a small custom store).
   Persist to sessionStorage, not localStorage: the cart should survive a reload during the
   session but must not resurrect days later as a stale order.
   Shape: { menuItemId, nameSnapshot, unitPriceSatang, options: [{groupId, optionId, name,
   deltaSatang}], quantity }
   All arithmetic in integer satang. Never hold money in a float; format for display only
   at the render boundary.

3. IMPORTANT -- no order row is created while browsing. The cart is purely client-side
   until checkout (WBS 5.4). Creating a row per abandoned browse would fill the 500 MB
   free-tier database with garbage and would corrupt slot quota accounting. Add a comment
   saying so, and a test that browses and adds to cart then asserts zero rows were inserted.

4. apps/shop/app/s/[slug]/cart/page.tsx -- line items with edit and remove, a subtotal, and
   a proceed button. Empty state in Thai with a link back to the menu.

5. Server-side re-validation at checkout: before creating the order, re-fetch every menu
   item and option by id and compare price and availability against what the cart holds. On
   any mismatch, do NOT silently charge the new price. Return a structured diff and show a
   Thai message naming what changed, with a confirm-or-remove choice. Test this path
   deliberately by mutating a price between add-to-cart and checkout.
```

---

### 5.3 Time-slot Engine and Quota Enforcement

| Field | Detail |
|---|---|
| **WBS Code** | 5.3 |
| **Type** | Work Package |
| **Requirement** | F03, F18 |
| **Owner** | M1 (engine), M2 (UI) |
| **Surface** | Both |
| **Red Line Touch** | None |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Generate pick-up slots from the store's hours and enforce their capacity atomically. This entry answers the capacity question that has been open since pre-order was chosen as the MVP wedge: a one-person cafe physically cannot make twenty drinks for 08:00, so the system must cap what it accepts rather than accepting orders the merchant cannot fulfil. The reservation must be atomic, because two customers taking the last slot at the same moment is not a rare edge case at 07:45 — it is the normal peak condition.

**Deliverables**
- Slot generation from store hours with configurable interval and per-slot capacity
- Atomic reservation using a conditional update, never read-then-write
- Automatic close when `booked_count` reaches `capacity`
- Slot release on order expiry or cancellation
- Merchant capacity configuration in the console

**Acceptance**
- **Two concurrent reservations of the last remaining slot result in exactly one success and one clean, actionable failure** — asserted by a concurrency test
- **`booked_count` can never exceed `capacity`** — guaranteed by a database check constraint, not only by application logic
- A full slot is absent from the customer's list, not shown-then-rejected
- An expired unpaid order releases its slot within one minute
- The merchant can change capacity per slot and the change takes effect immediately

**Associated Activities**
- Implement generation and the daily rollover job
- Implement atomic reservation and release
- Build the customer picker and the merchant capacity UI
- Write the concurrency test with genuine parallel requests

**Pseudocode (atomic reservation)**
```sql
-- The only correct shape. A read-then-write here loses money and trust at 07:45.
update pickup_slots
   set booked_count = booked_count + 1,
       is_open = case when booked_count + 1 >= capacity then false else is_open end
 where id = $1
   and is_open = true
   and booked_count < capacity
   and slot_start > now()
returning id, booked_count, capacity;
-- Zero rows returned means the slot filled while the customer was deciding.
-- The caller must surface that as a specific, recoverable state -- never a generic error.
```

**▶️ Claude Code Prompt**
```
Build the pick-up time-slot engine for Brew Ledger.

WHY THIS MATTERS: the target merchant is a one-person cafe. They physically cannot make
20 drinks for 08:00. The system must cap what it accepts rather than accepting orders that
cannot be fulfilled -- an unfulfillable pre-order is worse than no pre-order.

1. Slot generation. A worker job 'generate_slots' (WBS 3.3 queue) running nightly plus on
   demand when store hours change. From stores.opens_at, closes_at and timezone, generate
   pickup_slots at a configurable interval (default 15 minutes) with a configurable
   capacity (default 3) for the next 7 days. Idempotent -- re-running must not duplicate,
   rely on the unique (store_id, slot_start) constraint with ON CONFLICT DO NOTHING.

2. ATOMIC RESERVATION -- this is the critical piece. Implement in an Edge Function as a
   single conditional UPDATE exactly as specified in the WBS 5.3 pseudocode. Never
   read-then-write, never SELECT then UPDATE, never check-then-act in application code.
   Zero rows returned means the slot filled while the customer was deciding; surface that
   as a specific recoverable state that re-renders the picker with fresh availability and a
   Thai message, not as a generic error toast.

3. Release. Implement releaseSlot(slotId) as the mirrored conditional update
   (booked_count - 1, and reopen if it drops below capacity). Called on order expiry
   (WBS 5.7) and cancellation (WBS 5.11). Guard with booked_count > 0.

4. Customer picker UI at apps/shop/app/s/[slug]/checkout: show only slots that are open,
   future, and not full -- a full slot must be ABSENT from the list. Group by hour. Show
   remaining capacity only as a soft signal ("เหลือ 1 ที่") when it is 1 or 2, to create
   urgency without exposing exact business volume.

5. Merchant capacity UI: per-slot capacity override and a bulk default, in the console.
   Changing capacity takes effect immediately for future slots.

6. CONCURRENCY TEST -- required, not optional. Fire 10 genuinely parallel reservation
   requests at a slot with capacity 1 (use Promise.all against a real database, not mocks).
   Assert exactly 1 success and 9 clean failures, and assert booked_count === 1 afterwards.
   Then assert the database check constraint (booked_count <= capacity) independently by
   attempting a direct over-increment and expecting it to raise.
```

**Testing**
- Concurrency: 10 parallel reservations on capacity 1 → exactly 1 success, final count 1
- Constraint: direct over-increment raises at the database level
- Release: expired order returns capacity within one minute
- Visibility: full slot absent from the customer query
- Idempotency: re-running generation creates no duplicates

---

### 5.4 Checkout and Order Draft Creation

| Field | Detail |
|---|---|
| **WBS Code** | 5.4 |
| **Type** | Work Package |
| **Requirement** | F03 |
| **Owner** | M2 (UI), M1 (API) |
| **Surface** | Customer Web |
| **Red Line Touch** | RL-3 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Turn a client-side cart into a `PENDING_PAYMENT` order with a reserved slot and a frozen cost snapshot. The cost snapshot is written here, at order creation, and never again — this is the moment that makes historical P&L immutable. The customer supplies a name and optionally a phone; no account is created, and the phone is used only for order lookup and merchant contact.

**Deliverables**
- `public-create-order` Edge Function: validate → reserve slot → snapshot costs → insert order → return order code
- Short, human-readable order code generation
- Name and phone capture with Thai-friendly validation
- Expiry set on creation for the unpaid window

**Acceptance**
- **`order_items.unit_cost_snapshot_satang` is written at creation from the current BOM, and is `null` — never `0` — for items without a BOM (RL-2)**
- Slot reservation and order insert occur in one transaction; a failure leaves no orphan reservation
- The order code is short, unambiguous in Thai handwriting, and unique
- **The response contains no cost field of any kind (RL-3)**
- An order is created with a name only; phone is optional

**Associated Activities**
- Implement the transactional creation path
- Implement code generation avoiding ambiguous characters
- Write the cost snapshot resolution
- Test the orphan-reservation failure path

**▶️ Claude Code Prompt**
```
Build order draft creation for Brew Ledger at
supabase/functions/public-create-order/index.ts.

Input: store slug, cart lines (menu item id, option ids, quantity), pickup slot id,
customer name, optional customer phone.

Execute in ONE database transaction, in this order:

1. Re-validate the cart server-side against current prices and availability (WBS 5.2).
   On mismatch return 409 with a structured diff. Never charge a price the customer did
   not see.

2. Reserve the slot with the atomic conditional update from WBS 5.3. Zero rows -> return
   410 SLOT_FULL with fresh availability so the UI can re-render the picker.

3. COST SNAPSHOT -- the load-bearing step. For each line, resolve the current cost:
     select sum(bl.qty_base_unit * i.current_unit_cost_satang)
       from bom_lines bl join ingredients i on i.id = bl.ingredient_id
      where bl.menu_item_id = $1
   Write the result to order_items.unit_cost_snapshot_satang.
   If the item has NO bom_lines, or ANY referenced ingredient has a null
   current_unit_cost_satang, write NULL -- never 0, never a partial sum treated as
   complete. A partial cost silently understates COGS and overstates profit, which is worse
   than admitting the cost is unknown.
   Set orders.total_cost_snapshot_satang to the sum of the line snapshots ONLY if every
   line has a non-null snapshot; otherwise null. Comment this rule and cite WBS 3.5.

4. Generate orders.order_code: 6 characters, uppercase, from an alphabet excluding
   ambiguous glyphs (no O/0, I/1/l, S/5, Z/2) because this code gets read aloud across a
   counter and written on a cup. Retry on unique collision.

5. Insert the order as PENDING_PAYMENT with expires_at = now() + 15 minutes.

6. Return ONLY: orderCode, totalSatang, pickupAt, expiresAt, and the line items with name,
   quantity and unit price. NO cost field, no snapshot, no fee, no margin. Run the response
   through the WBS 3.7 public serializer and its .strict() Zod schema.

Failure handling: if any step after slot reservation fails, the transaction rolls back and
the reservation is released automatically. Write an explicit test that forces a failure at
step 5 and asserts booked_count returned to its prior value.

Customer name/phone: name required, phone optional. Validate the phone loosely -- accept
Thai formats and normalise to +66, but never block an order because a phone looks unusual.
No account is created. No password. No session.
```

**Testing**
- Snapshot test: item without BOM → `null` cost, not `0`
- Snapshot test: item whose ingredient has null unit cost → `null` order-level total
- Rollback test: forced failure after reservation returns `booked_count` to its prior value
- Code test: 10,000 generated codes contain no ambiguous glyph and no collision
- RL-3 test: response body contains no cost-shaped key

---

### 5.5 PromptPay QR Generation (Local, EMVCo Standard)

| Field | Detail |
|---|---|
| **WBS Code** | 5.5 |
| **Type** | Work Package |
| **Requirement** | F04 |
| **Owner** | M1 |
| **Surface** | Customer Web |
| **Red Line Touch** | **RL-1 (primary enforcement point)** |
| **Automation** | ▶️ Claude Code |

> **Revision — and a correction to an earlier rule.** The previous version of this entry carried a hard prohibition: *"never construct a PromptPay payload locally; the QR always comes from the licensed gateway."* **That rule was wrong for this architecture and is withdrawn.** It was written for an aggregator model in which Brew Ledger would receive money on behalf of many merchants, where building payment instructions outside a licensed perimeter genuinely is a regulatory question. In the merchant-owned model the payee is the merchant's own PromptPay alias, so the analysis changes completely.
>
> **Where the regulatory line actually sits.** The activity that attracts Bank of Thailand supervision is *receiving, holding, pooling, or forwarding other people's money*. Encoding a QR is none of those things — a PromptPay payload is a published EMVCo data format that says "pay this alias this amount", and the transfer itself happens bank-to-bank between two parties Brew Ledger is not one of. Generating it locally is therefore **safer** than routing through a gateway, because it removes the intermediary entirely rather than adding one. The one rule that does not change: **the payee is always the merchant's own alias, never any Brew Ledger identifier.** That constraint is enforced by a test in this entry.

**Scope / Statement of Work**
Generate the payable QR for each order from the merchant's PromptPay alias and the order total, and render the screen the customer pays from. The generation itself is a pure function with no network call, no credentials, and no external dependency at runtime — which is precisely why this approach survives a free-tier outage, a gateway approval delay, and a merchant who has no commercial registration. The screen around the QR still matters as much as the QR: the customer switching to a banking app and back is the most fragile moment in the flow.

**Deliverables**
- `packages/shared/src/promptpay/` — payload generation with an EMVCo-conformant CRC-16 implementation
- Order-level QR issuance producing a payload and an expiry, with no external call
- `/s/{slug}/pay/{code}` rendered per the delivered prototype
- Conformance test suite against known-good payloads

**Acceptance**
- **Every generated payload encodes the order's store's `promptpay_id` as payee** — asserted by decoding the payload in test, not by inspecting the calling code (RL-1)
- **No Brew Ledger identifier — phone, tax ID, account, or alias of any kind — can appear as payee in any code path**, asserted by a test that scans generated payloads for a forbidden-identifier list
- A generated payload scans correctly in at least two real Thai banking apps, showing the correct payee name and a locked amount
- Generation performs no network request and requires no secret
- The screen matches the prototype's four states: waiting, returned-from-bank, expired, confirmed

**Associated Activities**
- Implement the payload builder and CRC-16
- Verify against known-good payloads from an independent generator
- Wire issuance into order creation
- Test-scan on real banking apps
- Build the screen from the prototype

**Schema / Pseudocode**
```
PromptPay payload structure (EMVCo, Bank of Thailand profile)

  00  Payload Format Indicator      "01"
  01  Point of Initiation           "11" static | "12" dynamic (amount specified -> use 12)
  29  Merchant Account Information
        00  AID                     "A000000677010111"   (PromptPay)
        01  mobile number           0066812345678        (0812345678 -> 66 + drop leading 0)
        02  national ID / tax ID    1234567890123        (used instead of 01, not alongside)
  53  Currency                      "764"                (THB, ISO 4217)
  54  Transaction Amount            "55.00"              (omit entirely for a static QR)
  58  Country                       "TH"
  63  CRC-16/CCITT-FALSE            computed over everything above, including "6304"

Each field is encoded as ID(2) + LENGTH(2, zero-padded) + VALUE.
The CRC is computed last, over the full string with "6304" appended, then the four
hex digits are written in its place.

Worked example, 55.00 THB to 081-234-5678:
  000201                                        format
  010212                                        dynamic (amount present)
  29370016A00000067701011101130066812345678     PromptPay, mobile
  5303764                                       THB
  54055.00                                      amount
  5802TH                                        Thailand
  6304XXXX                                      CRC

Note the amount is a plain decimal string, NOT satang. Convert at this boundary only:
  amountString = (totalSatang / 100).toFixed(2)
Everything else in the system stays in integer satang.
```

**▶️ Claude Code Prompt**
```
Implement local PromptPay QR generation for BrewLedger. No gateway, no network call, no
credentials.

BACKGROUND worth encoding as a comment at the top of the module: PromptPay QR is a published
EMVCo data format, not a service call. Generating one is string encoding plus a checksum.
The payee is ALWAYS the merchant's own PromptPay alias, so money moves bank-to-bank between
the customer and the merchant and Brew Ledger is not a party to it (RL-1). If anyone ever
proposes making the payee anything other than the merchant's own alias, that is a regulatory
reclassification, not a refactor.

1. packages/shared/src/promptpay/generate.ts

   Use the `promptpay-qr` npm package as the implementation, and ALSO write our own
   conformance tests against it (below) rather than trusting it blindly — this is the one
   function in the system where a silent bug sends real money to the wrong person.

     import generatePayload from 'promptpay-qr'

     export function buildPromptPayPayload(input: {
       promptpayId: string;          // normalised: 0812345678 | 13-digit NID | 13-digit taxid
       promptpayType: 'msisdn' | 'nid' | 'taxid';
       amountSatang: number;
     }): string

   Rules:
   - Convert satang to a decimal string at THIS boundary only:
     (amountSatang / 100).toFixed(2). Everywhere else in the system money stays an integer.
   - amountSatang must be a positive integer; throw on 0, negative, or non-integer.
   - A missing or empty promptpayId throws. Never fall back to a default, a placeholder, or
     any other identifier. There is no house account to fall back to.

2. Conformance tests at packages/shared/src/promptpay/generate.test.ts — required:
   - Decode each generated payload back into its TLV fields and assert tag 29 contains the
     expected merchant alias. Assert on the DECODED payload, not on the arguments passed in.
   - Verify the CRC by recomputing it independently (write a second small CRC-16/CCITT-FALSE
     implementation in the test file rather than importing the same one under test).
   - Assert tag 54 equals the expected decimal string for a spread of amounts:
     5500 -> "55.00", 100 -> "1.00", 12345 -> "123.45", 99 -> "0.99".
   - Assert tag 01 is "12" whenever an amount is present.
   - FORBIDDEN-PAYEE TEST: maintain a list of any Brew Ledger-controlled identifiers (team
     phone numbers, any tax ID, any test alias used in fixtures) and assert no generated
     payload in the entire test suite contains any of them. This is the automated form of
     RL-1 for this entry.
   - Golden-file test: at least three payloads compared byte-for-byte against strings
     produced by an independent generator, committed as fixtures.

3. supabase/functions/public-create-charge/index.ts — replaces the gateway call.
   Input: orderCode. Load the order and its store.
   - If store.promptpay_id is null or promptpay_verified_at is null, return 409 with a
     machine-readable reason. Never issue a QR for an unverified store.
   - Build the payload. Insert a payments row: method 'promptpay_direct', payee_alias (the
     merchant's, recorded per transaction as RL-1 evidence), amount_satang, qr_payload,
     expires_at = now() + 15 minutes, status 'pending'.
   - Return to the client ONLY: qrPayload, amountSatang, expiresAt, orderCode.
   This runs on an Edge Function and completes with no outbound network call, so it stays
   fast and cannot fail because a third party is down.

4. apps/shop/app/s/[slug]/pay/[code]/page.tsx — build from the delivered prototype. Read
   /docs/design/state_matrix.md for the exact Thai copy of all four states: waiting,
   returned-from-bank (checking), expired, confirmed. Render the QR client-side from the
   payload string with the `qrcode` package.
   Behaviour from /docs/design/interaction_spec.md: 15-minute countdown sourced from
   expiresAt rather than a timer started at render; poll order status every 3 seconds while
   visible; fire an immediate re-check on visibilitychange back to visible; on expiry offer
   `ขอ QR ใหม่` which re-issues for the same order while the slot is still held.

5. Remove the old CI static-analysis rule that failed the build on EMVCo tag patterns
   outside the gateway adapter. It was written under the withdrawn aggregator assumption and
   now blocks correct code. Replace it with a narrower rule: fail the build if any file
   outside packages/shared/src/promptpay/ constructs an EMVCo payload, so payload building
   stays in exactly one tested place.
```

**Testing**
- Decoded payload's tag 29 contains the merchant alias, for every generated QR
- CRC verified by an independent implementation
- Amount encoding correct across the satang→decimal boundary
- Forbidden-payee scan finds no Brew Ledger identifier in any generated payload
- Golden-file comparison against an independent generator
- Real-device scan in two Thai banking apps shows correct payee and locked amount
- Unverified store returns 409 rather than issuing a QR

---

### 5.6 Merchant Payment Confirmation

| Field | Detail |
|---|---|
| **WBS Code** | 5.6 |
| **Type** | Work Package |
| **Requirement** | F05 |
| **Owner** | M1 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-1 |
| **Automation** | ▶️ Claude Code |

> **Revision.** This entry previously implemented an idempotent gateway webhook handler. With the gateway removed there is no webhook, and payment confirmation becomes an explicit merchant action. This is the real cost of the payment model change and it is stated plainly rather than minimised: **the system cannot observe that money arrived.** It is not in the path of the funds, so there is no transaction log to read and no callback to receive. What it can do is make confirming take one tap, put the pending order in front of the merchant at the moment they are already looking at their banking app, and record who confirmed and when.

**Scope / Statement of Work**
Build the confirmation path: a pending-payment queue in the console, a one-tap confirm that moves an order into the working queue, and the same downstream effects the webhook previously triggered — stock deduction, notification, and P&L inclusion. Confirmation is a state transition with real side effects, so it routes through the 5.7 lifecycle guard like every other transition and is protected against double-firing even though a human rather than a retrying gateway is now the source.

**Deliverables**
- `/console/orders` gains a **รอยืนยันการชำระเงิน** section above the working queue
- `console-confirm-payment` Edge Function: verify ownership → transition to `ACCEPTED` → deduct stock → enqueue notification
- Confirmation audit fields: who confirmed, when, from which device session
- Auto-expiry of unconfirmed orders at the 15-minute window, releasing the slot
- A "ยังไม่ได้รับเงิน" action that expires the order immediately and releases the slot

**Acceptance**
- **A double-tap or a retried request confirms exactly once** — enforced by a conditional update on the current status, not by a disabled button
- Confirming performs stock deduction and P&L inclusion in the same transaction, exactly as the webhook path did
- **The pending section shows the order total prominently**, because the merchant is comparing it against a figure in their banking app
- An order not confirmed within its window expires automatically and returns its slot to the pool
- Every confirmation writes an audit row naming the confirming session
- Tap target for the confirm control is at least 56px (`--tap-wet`)

**Associated Activities**
- Build the pending section per the delivered prototype's order-card vocabulary
- Implement the confirm function with a conditional-update guard
- Wire stock deduction and notification to the same transaction
- Implement the expiry sweep
- Test double-confirmation and concurrent confirmation

**Schema / Pseudocode**
```typescript
// The guard is the WHERE clause, not the UI. A human double-tapping on a slow connection
// is the same threat a retrying gateway used to be.
async function confirmPayment(ctx: MerchantCtx, orderId: string) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query(`
      update orders
         set status = 'ACCEPTED',
             paid_at = now(),
             payment_confirmed_by = $2,
             payment_confirmed_at = now()
       where id = $1
         and store_id = any($3)              -- 4.2: never trust a client-supplied store
         and status = 'PENDING_PAYMENT'      -- the idempotency guard
      returning *`, [orderId, ctx.sessionId, ctx.storeIds]);

    if (rows.length === 0) return { already: true };   // second tap: no-op, not an error

    const order = rows[0];
    await tx.update('payments', { order_id: orderId }, { status: 'succeeded' });
    await deductStockForOrder(tx, order);                    // 6.8, atomic with confirmation
    await enqueueJob(tx, 'push_notify', { orderId });        // 5.8, async
    await writeStatusHistory(tx, orderId, 'PENDING_PAYMENT', 'ACCEPTED', ctx.sessionId);
    return { already: false, order };
  });
}
```

**▶️ Claude Code Prompt**
```
Implement merchant payment confirmation for BrewLedger, replacing the removed gateway
webhook handler.

CONTEXT: there is no gateway and therefore no webhook. The system cannot observe that money
arrived — it is not in the path of the funds. The merchant sees the transfer in their own
banking app (which pushes a notification of its own) and confirms in one tap. Design for
that reality rather than papering over it.

1. Migration:
   - orders: add payment_confirmed_by (text), payment_confirmed_at (timestamptz)
   - payments: replace provider / provider_charge_id / settlement_destination with
     method (text, 'promptpay_direct'), payee_alias (text — the merchant's own alias,
     recorded per transaction as RL-1 evidence)
   - drop webhook_events and dead_letter_webhooks; there are no webhooks to be idempotent
     about. Note the removal in the migration comment so the change is traceable.

2. supabase/functions/console-confirm-payment/index.ts
   Implement exactly the pseudocode in WBS 5.6. The critical points:
   - The idempotency guard is `and status = 'PENDING_PAYMENT'` in the WHERE clause. A second
     tap returns zero rows and is a silent no-op, NOT an error shown to the merchant — they
     tapped twice because the first tap felt slow, and showing them an error for that is
     punishing a reasonable reaction.
   - Scope on ctx.storeIds from the WBS 4.2 guard. Never accept a store_id from the client.
   - Stock deduction is in the same transaction (WBS 6.8). Notification is enqueued, not
     awaited.
   - Route the status change through transitionOrder() from WBS 5.7 if that helper is
     already in place; otherwise write the history row inline and refactor when 5.7 lands.

3. Also implement console-reject-payment for the `ยังไม่ได้รับเงิน` case: transition to
   EXPIRED, release the slot (WBS 5.3), no stock movement.

4. apps/console/app/console/orders/page.tsx — add a pending section ABOVE the working queue.
   Read /docs/design/state_matrix.md and reuse the delivered OrderCard vocabulary; this is a
   new section, not a new visual language.
   Each pending card shows, in this priority: the TOTAL in large type (the merchant is
   comparing it against a number in their banking app), the customer name, the order code,
   the pickup slot, and a countdown to expiry.
   Two controls: `ได้รับเงินแล้ว` (primary, minimum 56px, full width) and `ยังไม่ได้รับเงิน`
   (secondary, requires one confirmation step).
   Thai copy for the section header: `รอยืนยันการชำระเงิน`
   Empty state: `ไม่มีออเดอร์ที่รอยืนยัน`

5. Expiry sweep: extend the WBS 5.7 'expire_orders' job so an order still PENDING_PAYMENT
   past expires_at transitions to EXPIRED and releases its slot. An unpaid order holding an
   08:00 slot is capacity taken from a paying customer.

6. Tests — all required:
   - two sequential confirm calls -> exactly one status transition, one stock deduction set,
     one notification job; the second returns { already: true } and surfaces no error
   - ten CONCURRENT confirm calls (Promise.all against a real database) -> exactly one
     processed
   - confirming another merchant's order returns 403 and mutates nothing
   - a forced failure during stock deduction rolls back the status change as well
   - the expiry sweep releases the slot and the slot reappears for customers
   - reject-payment expires the order and moves no stock

7. Update /docs/known_issues.md with an honest entry: payment confirmation is manual because
   the system is deliberately not in the path of the funds. State the consequence — an order
   is not in the working queue until the merchant confirms — and the planned mitigation:
   slip-verification API integration, costed at roughly 0.14-0.20 THB per slip, as a Phase 2
   item. Do not describe manual confirmation as a temporary workaround; describe it as the
   current design with a known upgrade path.
```

**Testing**
- Two sequential confirms → exactly one of everything; second is a silent no-op
- Ten concurrent confirms → exactly one processed
- Cross-merchant confirm → 403, no mutation
- Rollback on stock-deduction failure reverts the status change
- Expiry sweep releases the slot

---

### 5.7 Order Status Lifecycle

| Field | Detail |
|---|---|
| **WBS Code** | 5.7 |
| **Type** | Work Package |
| **Requirement** | F19 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | None |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Define the order state machine and make every transition legal-by-construction rather than by convention. Statuses in this system carry side effects — entering `ACCEPTED` deducts stock and notifies, entering `CANCELLED` refunds and reverses stock — so an illegal transition is not a display bug, it is a stock and money bug. The expiry sweep also lives here: an unpaid order holding a peak slot is capacity stolen from a paying customer.

**Deliverables**
- A single transition table with allowed source→target pairs and their side effects
- A guard function that is the only permitted way to change `orders.status`
- Expiry sweep job releasing slots for unpaid orders past `expires_at`
- Status history table for audit

**Acceptance**
- **An illegal transition throws and is never silently ignored** — asserted for every disallowed pair
- Every transition writes a history row with actor and timestamp
- An unpaid order past expiry moves to `EXPIRED` and releases its slot within one minute
- Side effects fire exactly once per transition, verified under retry
- No code path anywhere updates `orders.status` directly, bypassing the guard

**Associated Activities**
- Write the transition table and guard
- Refactor every status change to route through the guard
- Implement the expiry sweep as a queued job
- Add a static analysis rule against direct status updates

**▶️ Claude Code Prompt**
```
Implement the order status lifecycle for Brew Ledger at
supabase/functions/_shared/orders/lifecycle.ts.

States: PENDING_PAYMENT, ACCEPTED, PREPARING, READY, COLLECTED, CANCELLED, REFUNDED, EXPIRED

Allowed transitions ONLY (everything else must throw):
  PENDING_PAYMENT -> ACCEPTED     side effects: deduct stock, notify merchant
  PENDING_PAYMENT -> EXPIRED      side effects: release slot
  PENDING_PAYMENT -> CANCELLED    side effects: release slot
  ACCEPTED        -> PREPARING    side effects: notify customer
  ACCEPTED        -> CANCELLED    side effects: refund, reverse stock, release slot
  PREPARING       -> READY        side effects: notify customer
  PREPARING       -> CANCELLED    side effects: refund, reverse stock, release slot
  READY           -> COLLECTED    side effects: none
  READY           -> CANCELLED    side effects: refund, reverse stock, release slot
  CANCELLED       -> REFUNDED     side effects: none (refund settled)

1. Express this as a const transition map with its side effects, and export
   transitionOrder(tx, orderId, to, actor) as the ONLY permitted way to change
   orders.status. It must:
   - load the current status FOR UPDATE
   - throw IllegalTransition(from, to) if the pair is not in the map -- never silently
     ignore, never no-op
   - apply side effects inside the same transaction
   - write an order_status_history row (order_id, from, to, actor, actor_type, created_at)

2. Add a migration for order_status_history and RLS scoping it to the owning store.

3. STATIC ANALYSIS RULE for CI: fail the build if any file outside lifecycle.ts contains an
   update to orders.status -- grep for /update.*orders.*status|status:\s*'(ACCEPTED|
   PREPARING|READY|COLLECTED|CANCELLED|REFUNDED|EXPIRED)'/ outside the allowed file.
   Message: "Order status must change through transitionOrder(). See WBS 5.7."
   Status changes here have stock and money side effects; a direct update is a data
   corruption bug, not a shortcut.

4. Expiry sweep: a worker job 'expire_orders' running every minute:
     select id from orders
      where status = 'PENDING_PAYMENT' and expires_at < now()
      limit 100
   and calling transitionOrder(..., 'EXPIRED') for each. An unpaid order holding an 08:00
   slot is capacity stolen from a paying customer.

5. Tests:
   - every disallowed pair throws IllegalTransition (loop over the full matrix)
   - each allowed transition fires its side effects exactly once, verified under a forced
     retry of the same call
   - expiry sweep releases the slot and the slot becomes visible to customers again
   - history rows are written for every transition with the correct actor
```

---

### 5.8 Owner Order Inbox and Web Push Notification

| Field | Detail |
|---|---|
| **WBS Code** | 5.8 |
| **Type** | Work Package |
| **Requirement** | F17 |
| **Owner** | M2 (UI), M1 (push) |
| **Surface** | Owner Console |
| **Red Line Touch** | None |
| **Automation** | 🔴 Manual (VAPID key generation) + ▶️ Claude Code |

**Scope / Statement of Work**
Get a new paid order in front of the merchant reliably. Reliability here is a browser problem: iOS Safari Web Push is materially weaker than Android Chrome, and this merchant is a single person who may have the tab backgrounded while steaming milk. The polling fallback is therefore mandatory rather than a nicety, and the audible cue matters more than the visual one because the merchant is not looking at the screen.

**Deliverables**
- `/console/orders` inbox grouped by pick-up slot with an "new since last look" marker
- Web Push subscription with VAPID, plus a mandatory in-tab polling fallback
- Audible and vibration cue with a merchant-controlled toggle
- Subscription lifecycle handling: permission denied, revoked, expired

**Acceptance**
- **A paid order appears in the inbox within 10 seconds with the tab open, on both Android Chrome and iOS Safari, with push permission denied** — the polling path alone must satisfy this
- Push, where supported and granted, delivers within 10 seconds with the tab closed
- The audible cue is loud enough to hear over an espresso grinder, and can be muted
- A revoked or expired subscription is detected and re-requested without breaking the inbox
- New orders are visually distinct from already-seen orders

**Associated Activities**
- Generate VAPID keys and store the private key as a secret
- Implement the service worker and subscription flow
- Implement the polling fallback and prove it works with push denied
- Test on real Android and iOS handsets

**🔴 [Manual Action Required] — VAPID key generation**

```
⚠️  MANUAL ACTION REQUIRED — WBS 5.8
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

**ขั้นตอนที่ต้องทำเอง:**
1. สร้างคู่กุญแจ VAPID ที่เครื่องตัวเอง (ใช้ครั้งเดียว):
   ```
   npx web-push generate-vapid-keys
   ```
2. จะได้ค่าออกมา 2 ตัว — เก็บให้ถูกที่:
   - **Public Key** → ใส่เป็น env var ชื่อ `NEXT_PUBLIC_VAPID_PUBLIC_KEY` ใน Vercel project `brewledger-console` (ค่านี้อยู่ใน frontend ได้ ไม่เป็นความลับ)
   - **Private Key** → ใส่เป็น secret ชื่อ `VAPID_PRIVATE_KEY` ที่ **Supabase Edge Function secrets** และที่ **Render worker** เท่านั้น:
     ```
     supabase secrets set VAPID_PRIVATE_KEY=<ค่าที่ได้> --project-ref <prod-ref>
     ```
   > ⚠️ **ห้ามใส่ Private Key ใน Vercel เด็ดขาด** — ถ้าหลุด คนอื่นจะส่ง push แอบอ้างเป็นระบบเราได้
3. เก็บทั้งคู่ไว้ใน password manager ด้วย (ถ้าหายต้องสร้างใหม่ และ subscription เดิมของทุกร้านจะใช้ไม่ได้ทั้งหมด ต้องให้ทุกร้านกดอนุญาตใหม่)
4. **ทดสอบบนมือถือจริงทั้งสองระบบ** อย่าทดสอบแค่บนคอมพิวเตอร์:
   - Android + Chrome: เปิด console ในมือถือ กดอนุญาตการแจ้งเตือน ปิดแท็บ แล้วให้เพื่อนสั่งออเดอร์ทดสอบ ต้องเด้งแจ้งเตือนภายใน 10 วินาที
   - iPhone + Safari: **ต้องกด "เพิ่มไปยังหน้าจอโฮม" ก่อน** ถึงจะขออนุญาต push ได้ (ข้อจำกัดของ iOS) ทดสอบทั้งกรณีอนุญาตและกรณี**ปฏิเสธ** — กรณีปฏิเสธต้องยังเห็นออเดอร์ใหม่ภายใน 10 วินาทีถ้าเปิดแท็บค้างไว้ ผ่านระบบ polling
5. บันทึกผลการทดสอบจริงของแต่ละรุ่นเครื่องลงใน `/docs/ops/push_matrix.md`

**▶️ Claude Code Prompt**
```
Build the merchant order inbox and notification system for Brew Ledger.

CONTEXT: the merchant is one person who may be steaming milk with the tab backgrounded.
iOS Safari Web Push is materially less reliable than Android Chrome. The polling fallback is
therefore MANDATORY, not a progressive enhancement -- the acceptance criterion is that a new
order is visible within 10 seconds with push DENIED and the tab open.

1. apps/console/app/console/orders/page.tsx -- the inbox.
   Group by pick-up slot ascending, with the next slot pinned at the top. Each card shows:
   order code, customer name, pick-up time, item lines with options and quantity, total,
   and the current status with its action buttons (WBS 5.9).
   Mark orders arrived since the merchant last viewed with a persistent visual treatment
   (not a toast that disappears while they are making a drink). Persist last-seen per
   merchant so it survives a reload.

2. Realtime + polling, both:
   - Supabase Realtime subscription on orders filtered by store_id and status = ACCEPTED
   - AND a 10-second poll while the document is visible, as the fallback that does not
     depend on the socket staying up on a flaky mobile connection
   - Deduplicate by order id so both paths arriving does not double-render

3. Web Push:
   - Service worker at apps/console/public/sw.js handling push and notificationclick
     (focus the existing tab if open, otherwise open /console/orders)
   - Subscription flow requesting permission at a sensible moment -- after the merchant's
     FIRST paid order, not on first page load, because a permission prompt before any value
     is delivered gets denied and cannot be re-asked
   - Store subscriptions in a push_subscriptions table scoped by store_id, with RLS
   - The 'push_notify' worker handler sends via web-push using VAPID_PRIVATE_KEY
   - Handle 404/410 from the push service by deleting the dead subscription row

4. Audible cue: a short sound plus navigator.vibrate on a new order, with a merchant toggle
   persisted in settings. Choose or synthesise a tone that cuts through grinder noise --
   mid-high frequency, repeated twice. Respect the toggle everywhere.

5. iOS handling: detect iOS Safari without standalone mode and show a Thai hint explaining
   that adding the site to the home screen enables notifications. Never block the inbox on it.

6. Tests:
   - with push permission DENIED and the tab open, a new paid order appears within 10s
   - Realtime and poll arriving together render one card, not two
   - a 410 from the push service removes the subscription row
   - last-seen marker persists across reload

7. /docs/ops/push_matrix.md -- a table for recording real-device results:
   device | OS version | browser | standalone? | permission | push latency | poll latency
```

---

### 5.9 Order Status Update (Merchant Actions)

| Field | Detail |
|---|---|
| **WBS Code** | 5.9 |
| **Type** | Work Package |
| **Requirement** | F19 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | None |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Give the merchant the three forward transitions they drive — preparing, ready, collected — as controls usable with one wet hand while holding a milk jug. Every action routes through the 5.7 guard. Optimistic UI is required because the merchant will tap and immediately look away, and a spinner they never see is worse than a state that briefly corrects itself.

**Deliverables**
- Status action buttons on each order card and on the detail screen
- Optimistic update with rollback and a clear error state
- Bulk "mark all ready" for a slot
- Customer-facing propagation within 5 seconds

**Acceptance**
- Each action routes through `transitionOrder` and never updates status directly
- Tap targets are at least 56 px tall on the inbox card — this is used with wet hands in a hurry
- An optimistic update that fails rolls back visibly and explains why in Thai
- A status change appears on the customer's tracking page within 5 seconds
- Bulk action is atomic per order and reports partial failure honestly

**Associated Activities**
- Build the action controls
- Implement optimistic mutation with rollback
- Implement the bulk action
- Verify propagation timing end to end

**▶️ Claude Code Prompt**
```
Build merchant order status actions for Brew Ledger.

Physical context: the merchant taps these with one wet hand while holding a milk jug, then
immediately looks away. Design for that, not for a desktop mouse.

1. Action controls on the inbox card and on /console/orders/[id]:
     ACCEPTED  -> [เริ่มทำ]      -> PREPARING
     PREPARING -> [พร้อมรับ]     -> READY
     READY     -> [รับแล้ว]      -> COLLECTED
   Only the single valid next action is shown as a primary button. Cancel (WBS 5.11) is
   secondary and requires confirmation.
   Minimum 56px tall on the card. Full-width on mobile. High contrast.

2. Every action calls the console Edge Function which calls transitionOrder() from WBS 5.7.
   Never update orders.status directly from the client or from the function body.

3. Optimistic UI with rollback: apply the new state immediately, reconcile on response, and
   on failure roll back visibly with a Thai explanation of what happened. The merchant taps
   and looks away, so a spinner they never see is useless -- but a silently wrong state is
   worse than a brief correction.

4. Bulk action: "ทำเสร็จทั้งช่วงเวลานี้" marking every ACCEPTED/PREPARING order in one slot
   as READY. Process per order, not as one transaction, and report honestly if some
   succeeded and some failed -- name the ones that failed.

5. Propagation: after a successful transition the customer's tracking page must reflect it
   within 5 seconds. Verify via the Realtime channel on orders, with the tracking page's own
   poll as fallback (WBS 5.10).

6. Tests: illegal transitions are not offered in the UI at all; a failed transition rolls
   back the optimistic state; bulk partial failure is reported per order; end-to-end
   propagation to the customer page under 5 seconds.
```

---

### 5.10 Customer Order Tracking (No Login)

| Field | Detail |
|---|---|
| **WBS Code** | 5.10 |
| **Type** | Work Package |
| **Requirement** | F06, F07 |
| **Owner** | M2 |
| **Surface** | Customer Web |
| **Red Line Touch** | **RL-3** |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Let a customer see their order's progress without an account, and let them find it again on a different device using their phone number and order code. The lookup requires both values together: a phone number alone must never enumerate orders, because that would turn a guessable identifier into a customer list. Data returned comes only from the narrow RPC defined in 3.6.

**Deliverables**
- `/o/[code]` — live status with a visual progress indicator
- `/track` — lookup requiring both phone and order code
- Poll plus Realtime, with poll as the reliable path
- Terminal states handled: collected, cancelled, refunded, expired

**Acceptance**
- **The tracking response contains only order code, status, pick-up time, item names and quantities — no cost, fee, margin, or store aggregate (RL-3)**
- **A phone number alone returns nothing; both values are required** — asserted by an enumeration test
- Status changes appear within 5 seconds
- An order code from another store cannot be viewed by guessing
- Terminal states render a clear final message rather than an indefinite spinner

**Associated Activities**
- Build both screens on the 3.6 RPCs
- Implement poll + Realtime with dedupe
- Write the enumeration attempt test
- Design every terminal state

**▶️ Claude Code Prompt**
```
Build customer order tracking for Brew Ledger's Customer Web. No account, no login.

1. apps/shop/app/o/[code]/page.tsx
   Data comes ONLY from the public_order_status(order_code) RPC defined in WBS 3.6.
   Do not query the orders table directly -- anon has no policy on it, deliberately.
   Display: order code, a horizontal progress indicator (รับออเดอร์ -> กำลังทำ -> พร้อมรับ
   -> รับแล้ว), pick-up time, and the item lines with quantity.
   RL-3: no cost, no fee, no margin, no store aggregate, not even in a data attribute or a
   __NEXT_DATA__ payload. Snapshot-test the serialized page props against the forbidden
   field list.

2. Live updates: poll the RPC every 5 seconds while the document is visible, plus a
   Realtime subscription as the fast path. Poll is the RELIABLE path here; treat Realtime as
   an optimisation. Stop polling on a terminal state.

3. apps/shop/app/track/page.tsx -- lookup on a different device.
   Requires BOTH phone number and order code, via public_order_lookup(phone, code).
   A phone number alone must return nothing. This is not a convenience trade-off: a
   phone-only lookup turns a guessable identifier into a customer list for whoever tries it.
   Write an explicit enumeration test that submits 100 phone numbers with no code and
   asserts zero results every time.

4. Terminal states, each with designed Thai copy and no spinner:
   - COLLECTED -> thank-you message with a link back to the store menu
   - CANCELLED / REFUNDED -> plain explanation and, if refunded, the expected timeframe
   - EXPIRED -> explain the payment window passed, offer a link to order again
   - unknown code -> a neutral "ไม่พบออเดอร์นี้" that does not confirm whether the code
     format is valid

5. Rate limit the lookup endpoint per IP to blunt brute-force enumeration of order codes.
```

---

### 5.11 Order Cancellation and Merchant-Initiated Refund

| Field | Detail |
|---|---|
| **WBS Code** | 5.11 |
| **Type** | Work Package |
| **Requirement** | F20 |
| **Owner** | M1 |
| **Surface** | Owner Console |
| **Red Line Touch** | **RL-1** |
| **Automation** | ▶️ Claude Code |

> **Revision.** Automatic gateway refunds are no longer possible: Brew Ledger never held the money and has no charge to reverse. **The refund is a transfer the merchant makes from their own banking app**, exactly as they would if a customer had paid at the counter. The system's job is to make that impossible to forget, easy to execute, and recorded honestly — not to pretend it can move money it never touched.

**Scope / Statement of Work**
Let a merchant cancel an order they cannot fulfil, and drive the refund they now owe the customer to completion. Because the refund happens outside the system, the risk shifts from a failing API call to a merchant who cancels and then forgets to transfer. The design answers that directly: an order in `CANCELLED` with an outstanding refund stays visible and unresolved in the console until the merchant marks it refunded, and the customer's tracking page tells them a refund is coming and roughly when.

**Deliverables**
- Cancel action with mandatory reason capture (unchanged)
- A **รอคืนเงิน** state that persists in the console until explicitly resolved
- Refund helper: the customer's phone number and the exact amount, one tap to copy
- Compensating `stock_ledger` entries with reason `cancellation_reversal` (unchanged)
- Slot release and customer notification (unchanged)

**Acceptance**
- **No code path attempts to move money.** The system records an obligation and tracks its resolution (RL-1)
- **A cancelled order with an unresolved refund remains visible in the console indefinitely** — it does not age out of the list, because an unrefunded customer is a permanent problem until it is fixed
- Stock is reversed by a new compensating ledger row; the original deduction is never edited or deleted
- The slot is released and becomes available to other customers
- The customer's tracking page shows the cancellation, the reason, and the expected refund timeframe within 5 seconds
- Marking refunded writes who resolved it and when

**Associated Activities**
- Implement the cancel path through the lifecycle guard
- Build the pending-refund surface
- Implement compensating stock entries
- Test that a pending refund cannot be dismissed without resolution

**▶️ Claude Code Prompt**
```
Implement order cancellation and refund tracking for BrewLedger.

RL-1: the system NEVER moves money. It never held the customer's payment, so there is
nothing to reverse programmatically. The merchant transfers the refund from their own
banking app. This entry makes that obligation impossible to lose track of.

1. supabase/functions/console-cancel-order/index.ts
   Input: orderId, reason (required — ของหมด / เครื่องเสีย / ลูกค้าขอยกเลิก /
   ร้านปิดกะทันหัน / อื่นๆ).
   In one transaction:
   a. transitionOrder(orderId, 'CANCELLED', ctx) — WBS 5.7 guard, never a direct update
   b. release the slot (WBS 5.3 conditional update)
   c. compensating stock_ledger rows, reason 'cancellation_reversal', positive deltas
      mirroring the original deduction. NEVER edit or delete the original row — the ledger
      is append-only so any figure on a report traces to the movement that produced it
   d. if the order was already ACCEPTED (money received), set refund_status = 'pending'.
      If it was still PENDING_PAYMENT, no refund is owed; set refund_status = null.

2. Migration: orders gains refund_status ('pending' | 'done' | null),
   refund_resolved_by, refund_resolved_at.

3. Console — a `รอคืนเงิน` section, placed BELOW the working queue but above completed
   orders, that persists until every entry is resolved. Do not let it collapse by default
   and do not age entries out. An unrefunded customer is a permanent problem until fixed.
   Each row shows:
     - the amount to refund, large
     - the customer's phone number with a one-tap copy control
     - the customer name and order code
     - how long the refund has been outstanding, in plain Thai (`ค้างมา 2 วัน`)
     - a `โอนคืนแล้ว` button
   Thai helper line: `โอนคืนลูกค้าผ่านแอปธนาคารของคุณ แล้วกดยืนยันที่นี่`
   Deliberately no "dismiss" or "ignore" control. The only way out of this list is resolving
   it, and that is the point of the screen.

4. console-resolve-refund: sets refund_status = 'done' with the resolving session and
   timestamp, and transitions CANCELLED -> REFUNDED via the lifecycle guard. Idempotent by
   the same conditional-update pattern as WBS 5.6.

5. Guard rails:
   - only ACCEPTED, PREPARING, or READY orders may be cancelled by the merchant
   - a COLLECTED order cannot be cancelled through the API even if the UI is bypassed
   - cancelling a PENDING_PAYMENT order releases the slot and owes no refund

6. Customer side: the tracking page shows the cancellation and the reason within 5 seconds,
   with Thai copy for the refund timeframe. Read the exact string from
   /docs/design/state_matrix.md — the delivered prototype already specifies this state.
   Do not use the word "error"; a shop running out of milk is a normal event.

7. Tests:
   - stock reversal creates a NEW ledger row and leaves the original untouched; net stock
     returns to its pre-order level
   - the slot becomes available to a new customer after cancellation
   - a cancelled ACCEPTED order appears in the pending-refund list and cannot be removed
     from it except by resolving
   - a cancelled PENDING_PAYMENT order does NOT appear there
   - resolve-refund is idempotent under a double tap
   - a COLLECTED order cannot be cancelled through the API
```

### 5.12 Manual Cash Sale Entry

| Field | Detail |
|---|---|
| **WBS Code** | 5.12 |
| **Type** | Work Package |
| **Requirement** | F21 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Let the merchant record a walk-in cash sale in a few taps. Without this the P&L is simply wrong: most of a Thai independent cafe's revenue still arrives at the counter, and a product that reports only its own pre-orders as revenue will show a merchant a profit figure they know is false — which ends their trust in every other number the product shows. Cash sales deduct stock and count in P&L exactly like paid online orders, but carry no gateway fee.

**Deliverables**
- `/console/sales/quick` — tap menu items, adjust quantity, record
- `channel = 'cash'` orders created directly in `ACCEPTED`
- Stock deduction and cost snapshot identical to the online path
- Recent cash sales list with an undo window

**Acceptance**
- A three-item cash sale is recorded in under 15 seconds
- Cash sales appear in P&L revenue with **no gateway fee** attributed
- Stock deducts identically to the online path
- **An item with no BOM records a cash sale with `null` cost, not `0` (RL-2)**
- An undo within 2 minutes fully reverses the sale including stock

**Associated Activities**
- Build the fast-entry grid
- Reuse the order creation path with `channel='cash'`
- Implement the undo window
- Time a three-item entry in a dry run

**▶️ Claude Code Prompt**
```
Build quick cash sale entry for Brew Ledger at
apps/console/app/console/sales/quick/page.tsx.

WHY THIS EXISTS: most revenue at a Thai independent cafe still arrives as cash or a
direct transfer at the counter. Without this screen the P&L reports only pre-orders and
shows the merchant a profit number they KNOW is wrong -- which destroys their trust in every
other number the product produces. This is not a convenience feature.

1. UI: a grid of menu item tiles, largest and most-sold first. Tap adds one. Tap again adds
   another. A running total. One big confirm button. Optional option selection via long
   press, defaulting to the most common option set so the fast path stays one tap per drink.
   Target: a three-item sale recorded in under 15 seconds. Time it and record the result.

2. Creation: reuse the WBS 5.4 order creation logic with channel = 'cash'. Differences:
   - status starts at ACCEPTED, not PENDING_PAYMENT (the money is already in the till)
   - no payment row and no QR -- the money is already in the till
   - no pickup slot, no slot reservation
   - customer_name defaults to 'หน้าร้าน'
   Identical in every other respect: cost snapshot written the same way, stock deducted the
   same way, counted in P&L the same way.

3. RL-2: an item with no BOM records unit_cost_snapshot_satang = NULL, never 0. Same rule as
   the online path. Test it explicitly here too, because this is the path a zero-BOM merchant
   will actually use most.

4. Recent sales strip along the bottom showing the last 5 cash sales with an undo button
   active for 2 minutes. Undo must fully reverse: delete or cancel the order AND write
   compensating stock_ledger rows (never edit the originals). After 2 minutes, direct the
   merchant to the order detail screen to cancel properly.

5. Tests:
   - a cash sale appears in P&L revenue with zero gateway fee
   - stock deducts identically to an online order for the same items
   - a zero-BOM item records null cost
   - undo within the window returns stock to its prior level via compensating rows
   - timing check documented for the three-item target
```

---
## Phase 6.0 — Inventory and Unit Costing (Manual Entry; OCR Deferred)

> **Scope change (2026-08-22): OCR is deferred, not removed.** 6.2 (Typhoon integration) and 6.3 (OCR parsing) are cut from the active build. The architecture already treats manual entry as first-class — 6.1 and 6.4 were designed from the start as "one component, two entry points," with OCR as an optional accelerator layered on top of a manual form that writes the same rows. Cutting 6.2/6.3 removes the Float16 dependency, the daily quota risk (R11), and the accuracy risk (R2) without touching the costing model, the schema, or 6.5/6.6/6.8/6.9, none of which know or care whether a purchase price was typed or extracted. 6.1 and 6.4 below are rescoped to manual-only; their OCR-handling paragraphs are struck through and kept for reference if this is un-deferred later. Nothing in this phase has been implemented yet, so this is a pure planning-doc change.
>
> **Everything in this phase runs on the Render worker except purchase entry itself.** The worker still owns cost recalculation (6.9) and cost drift checks (7.4), neither of which has a human waiting, so the 30–60 second cold start remains acceptable there and only there.

---

### 6.1 Purchase / Bill Entry (Manual)

| Field | Detail |
|---|---|
| **WBS Code** | 6.1 |
| **Type** | Work Package |
| **Requirement** | F22 (rescoped — see phase banner) |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-3 (bill images are merchant-private) |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Let a merchant record a supplier purchase directly — vendor, date, line items, quantities, prices — typed in, with an optional photo of the bill attached purely as a private reference image. No extraction pipeline runs against it. This *is* the manual-entry path that 6.4 always kept available; with 6.2/6.3 deferred, it is now the only path, so it is built as the primary flow rather than a fallback link.

**Deliverables**
- `/console/expenses/capture` — a purchase entry form: vendor, date, line items (name, qty, unit, unit cost), optional photo attachment via `<input capture="environment">`
- Client-side compression and EXIF rotation via the 3.8 utility, applied to the optional attachment only
- If a photo is attached, upload to the private `bills` bucket and link it to the `purchase_invoices` row for reference — **no job is enqueued, no extraction runs**
- Submission goes straight to the 6.4 confirmation/write step; there is no waiting state, because nothing runs in the background

**Acceptance**
- A merchant can complete a purchase entry with or without attaching a photo
- If attached, images are ≤ 200 KB and correctly oriented after upload
- **The uploaded image is not retrievable without a merchant-scoped signed URL (RL-3)**
- No `ocr_extract` job, or any other background job, is enqueued by this entry

**Associated Activities**
- Build the manual entry form
- Wire optional photo compression and upload as a reference attachment
- Test on a real crumpled receipt photo purely as an attachment (no extraction to verify)

<details>
<summary>Deferred: original OCR-queue design (restore only if 6.2/6.3 are un-deferred)</summary>

~~Two practical realities drove the original design: phone photos of receipts are routinely rotated and 3–5 MB raw, which would exhaust the 1 GB free storage in about 250 bills; and the merchant is photographing a crumpled slip on a metal counter under fluorescent light, so capture guidance materially changes downstream accuracy. The form was to insert a `purchase_invoices` row with `ocr_status 'pending'`, enqueue an `ocr_extract` job (WBS 3.3 queue), and show an honest processing state accounting for the worker's 30–60s cold start ("กำลังอ่านบิล... ใบแรกของวันอาจใช้เวลาถึง 1 นาที") before landing on 6.4. That whole path is dormant, not deleted — restoring it means re-enabling 6.2/6.3 and adding the enqueue call back into this entry's submit handler.~~

</details>

**▶️ Claude Code Prompt**
```
Build supplier purchase entry for Brew Ledger at
apps/console/app/console/expenses/capture/page.tsx.

This is a manual data-entry form, not a capture-then-extract flow. OCR is deferred (see WBS
Phase 6.0 banner) -- do not add any job enqueue or extraction call here.

1. Form fields: vendor name, invoice date, line items (repeatable row: name, qty, unit,
   unit cost in THB, computed line total), and an optional photo attachment.

2. Photo attachment is OPTIONAL and PURELY REFERENCE: <input type="file" accept="image/*"
   capture="environment">, gallery selection allowed. If provided, compress via
   packages/shared/src/storage/compress.ts from WBS 3.8 (max edge 1600px, target <= 200KB,
   EXIF orientation corrected) and upload to the PRIVATE bills bucket at
   bills/{store_id}/{invoice_id}.jpg. Do NOT enqueue any job and do NOT set an ocr_status
   field -- there is no extraction pipeline to track.

3. Submit hands the typed line items straight to the 6.4 confirmation/write step (same
   transaction: purchase_invoices, purchase_line_items, ingredient cost update, stock
   ledger, cost_recalc job). There is no intermediate "processing" state.

4. Money: parse to integer satang. Never float.

5. Tests: a 4MB photo fixture compresses under 200KB when attached; an EXIF-rotated fixture
   uploads upright; submitting without a photo works and creates no bills-bucket object;
   submitting never enqueues an ocr_extract job or any job at all.
```

---

### 6.2 Typhoon OCR Integration via Float16

| Field | Detail |
|---|---|
| **WBS Code** | 6.2 |
| **Type** | Work Package |
| **Requirement** | F23 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | None |
| **Automation** | ⏸️ **DEFERRED** — not in the active build. Do not create the Float16 account or start this entry until it is un-deferred. |

> **DEFERRED (2026-08-22).** See the Phase 6.0 banner. 6.1/6.4 no longer depend on this entry — they are manual-only. Content below is kept intact for when OCR is restored.

**Scope / Statement of Work**
Integrate Thai-language OCR through Typhoon OCR served by Float16, replacing the self-hosted PaddleOCR of the original plan. Typhoon is an open vision-language model built specifically for Thai document extraction and benchmarked ahead of GPT-4o and Gemini 2.5 Flash on Thai document understanding, with a v1.5 that improved handwriting and irregular-form handling — which is what a market receipt is. Using the hosted API removes the GPU requirement entirely. The free allowance is roughly 150 pages per day, and the quota path must degrade gracefully rather than failing the merchant's evening.

**Deliverables**
- OCR client in the worker calling the Float16 Typhoon endpoint
- Quota tracking with graceful degradation when the daily credit is exhausted
- Retry with backoff and a dead-letter path
- Raw model output persisted for debugging and future accuracy work
- Accuracy spike results recorded against real Thai receipts

**Acceptance**
- A real Thai supplier receipt returns structured markdown/text within 30 seconds of the job starting
- **Quota exhaustion queues the job for the next day and tells the merchant plainly — it never silently drops the bill or shows a raw error**
- `raw_ocr_output` is persisted for every attempt, successful or not
- Retries are bounded and a permanently failed extraction lands the merchant in manual entry with the image attached
- The measured accuracy on a 20-receipt real-world sample is recorded before this is relied upon

**Associated Activities**
- Create the Float16 account and key
- Implement the client with quota accounting
- Run the accuracy spike on 20 real receipts and record per-field results
- Implement degradation and dead-lettering

**🔴 [Manual Action Required] — Float16 account and API key**

```
⚠️  MANUAL ACTION REQUIRED — WBS 6.2
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

**ขั้นตอนที่ต้องทำเอง:**
1. เข้า `https://float16.cloud` กด **Sign up** สมัครบัญชี (สมัครด้วยอีเมลทีม)
2. ไปที่หน้า **Use case → OCR Thai Document** หรือหน้า API/Playground เพื่อยืนยันว่าบริการ Typhoon OCR เปิดใช้งานอยู่
3. สร้าง **API Key** จากหน้า dashboard แล้วคัดลอกเก็บไว้
4. ตรวจสอบโควต้าฟรีในหน้าบัญชี — ตามข้อมูลที่ใช้ออกแบบระบบคือ **เครดิตฟรี $5 ต่อวัน ประมาณ 150 หน้า** และคิด **$0.03 ต่อหน้า** หลังจากนั้น
   > บันทึกตัวเลขจริงที่เห็นในหน้าเว็บ ณ วันที่สมัคร ลงใน `/docs/ops/ocr.md` พร้อมวันที่ เพราะราคาและโควต้าอาจเปลี่ยน
5. นำ API Key ไปตั้งเป็น env var ที่ **Render worker** เท่านั้น (ชื่อ `FLOAT16_API_KEY`) — เข้า Render Dashboard → `brewledger-worker` → **Environment** → **Add Environment Variable**
   > ⚠️ ห้ามใส่ใน Vercel หรือ frontend ใดๆ เพราะ worker เป็นตัวเดียวที่เรียก OCR
6. **ทดสอบด้วยบิลจริงก่อนเขียนโค้ดต่อ** — ใช้ playground ของ Float16 อัปโหลดบิลซื้อของจริงจากร้านกาแฟ 3-5 ใบ (ควรมีทั้งใบพิมพ์ชัดและใบยับ/ซีดจาง) ดูว่าอ่านได้แม่นแค่ไหน แล้วบันทึกผลไว้
   > นี่คือ spike S2 ในตารางความเสี่ยง (ข้อ 1.2/1.5) ถ้าความแม่นยำต่ำกว่าที่รับได้ ต้องรู้ตั้งแต่ตอนนี้ ไม่ใช่ตอนร้านนำร่องใช้จริง
7. คำนวณโควต้าเทียบกับการใช้งานจริง: ร้านนำร่อง 30 ร้าน × บิล 2-3 ใบ/วัน ≈ **60-90 หน้า/วัน** ซึ่งอยู่ใต้โควต้าฟรี 150 หน้า/วัน — บันทึกการคำนวณนี้ไว้ และตั้งเตือนเมื่อใช้เกิน 70%

**▶️ Claude Code Prompt**
```
Implement the Typhoon OCR integration for Brew Ledger in the Render worker.

Model context: Typhoon OCR is an open Thai-optimised vision-language document model served
by Float16. It replaces the originally planned self-hosted PaddleOCR, which needed a GPU
this project has no budget for. Free allowance is roughly 150 pages/day; usage estimate is
60-90 pages/day at 30 pilot stores.

1. worker/src/ocr/typhoon.ts
   extractBill(imageBuffer: Buffer, mimeType: string): Promise<OcrResult>
   - POST to the Float16 Typhoon OCR endpoint with FLOAT16_API_KEY from config (WBS 3.9)
   - Request markdown/structured output; Typhoon returns text in markdown with tables as
     HTML, which suits a receipt's line-item layout
   - 30 second timeout per page
   - Return { rawText, rawResponse, pagesUsed }

2. QUOTA HANDLING -- required, not optional. Track pages used per UTC day in an
   ocr_usage table (day, pages_used, updated_at).
   - Before each call, check the day's usage against a configured daily budget (default 140,
     deliberately under the ~150 free allowance to leave headroom)
   - If exhausted: do NOT fail the job. Re-queue it with run_after = next day 00:15 UTC,
     set the invoice's ocr_status to 'pending', and surface a Thai message on the invoice
     row: "คิวอ่านบิลเต็มวันนี้ ระบบจะอ่านให้พรุ่งนี้เช้า — หรือกรอกเองได้เลย" with a link
     to manual entry. Alert the team (WBS 3.11).
   - A dropped bill or a raw error string shown to a merchant is a trust failure; a clear
     "tomorrow, or do it yourself now" is not.

3. Retry: up to 3 attempts with exponential backoff for transient failures (5xx, timeout).
   Do NOT retry a 4xx. After the final attempt set ocr_status 'failed' and route the
   merchant to manual entry with the image attached (WBS 6.4).

4. Always persist the raw response to purchase_invoices.raw_ocr_output, on success AND on
   failure. This is the dataset that lets the team measure and improve accuracy later; it is
   cheap to keep and impossible to recreate.

5. Accuracy spike harness at worker/src/ocr/spike.ts: takes a directory of real receipt
   images plus a hand-written ground-truth JSON per image, runs extraction, and reports
   per-field accuracy (vendor, date, line item name, quantity, unit price, total) plus an
   overall usable/not-usable rate. Run this on at least 20 REAL Thai receipts including
   crumpled and faded ones before the pipeline is relied upon, and commit the results to
   /docs/ops/ocr.md.

6. /docs/ops/ocr.md: the provider, the free quota AS OBSERVED with the date checked, the
   usage projection arithmetic, the degradation behaviour, and the spike results table.
```

**Testing**
- A real Thai receipt returns structured text within 30 s
- Quota exhaustion re-queues rather than failing, and the merchant message appears
- 5xx retries, 4xx does not
- `raw_ocr_output` persisted on both success and failure
- Spike harness produces per-field accuracy on 20 real receipts

---

### 6.3 OCR Parsing and Line-item Extraction

| Field | Detail |
|---|---|
| **WBS Code** | 6.3 |
| **Type** | Work Package |
| **Requirement** | F23 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | None |
| **Automation** | ⏸️ **DEFERRED** — depends on 6.2, also deferred. |

> **DEFERRED (2026-08-22).** See the Phase 6.0 banner. Content below is kept intact for when OCR is restored.

**Scope / Statement of Work**
Turn the model's text output into structured line items with quantities, units, and prices, and attach a confidence to each field so the review screen can direct the merchant's attention. Thai receipts have no standard layout, mix Thai and Arabic numerals, and abbreviate units inconsistently — `กก.`, `กิโล`, `kg`, and `ก.ก.` all appear. The parser must be conservative: a field it is unsure about should be marked low-confidence rather than guessed, because a wrong price silently propagates into every cost figure the product shows.

**Deliverables**
- Parser extracting vendor, date, line items (name, qty, unit, unit price, total), and total
- Thai unit normalisation to base units with a documented conversion table
- Per-field confidence scoring
- Ingredient matching against existing `ingredients` with fuzzy Thai matching
- Arithmetic validation: line totals summing to the stated total

**Acceptance**
- On the 20-receipt spike sample, line items are extracted with recorded per-field accuracy
- **Every ambiguous field is marked low-confidence rather than guessed**
- Thai unit variants normalise correctly to `g`/`ml`/`piece`
- A line whose arithmetic does not reconcile is flagged, not silently accepted
- Ingredient matches carry a confidence and never auto-apply below the threshold

**Associated Activities**
- Build the parser against the spike corpus
- Write the unit conversion table
- Implement fuzzy Thai ingredient matching
- Implement arithmetic reconciliation

**▶️ Claude Code Prompt**
```
Build the OCR output parser for Brew Ledger at worker/src/ocr/parse.ts.

Input: Typhoon OCR markdown/text output for one Thai supplier receipt.
Output: { vendorName, invoiceDate, lines: [{ rawText, name, qty, unit, unitCostSatang,
totalSatang, confidence }], totalSatang, confidence }

Thai receipt realities to handle:
- No standard layout. Vendor may be a header, a stamp, or absent entirely.
- Mixed Thai and Arabic numerals (๑๒๓ and 123).
- Thai date formats including Buddhist Era years (2569 = 2026). Detect BE by year > 2400
  and subtract 543.
- Inconsistent unit abbreviations. Normalise ALL of these to base units:
    kg: กก. / กิโล / กิโลกรัม / ก.ก. / kg / KG   -> multiply to grams (x1000)
    g:  ก. / กรัม / g                            -> grams
    L:  ล. / ลิตร / L / ลบ.                      -> multiply to ml (x1000)
    ml: มล. / มิลลิลิตร / ml / cc                -> ml
    piece: ชิ้น / อัน / ใบ / ถุง / แพ็ค / ลัง / โหล (x12) / กล่อง -> piece
  Put this table in one exported constant with a comment that new variants get added here,
  not inline in the parser.

CONSERVATISM RULE -- the most important behaviour in this file: when a field is ambiguous,
emit it with LOW CONFIDENCE rather than guessing a plausible value. A wrong unit price
propagates silently into cost per cup, profit per dish, and the P&L, and the merchant has no
way to notice. A flagged uncertain field costs one tap in review. Never trade the second
for the first.

Confidence scoring per field, 0..1, based on: whether the token matched a known pattern,
whether the arithmetic reconciles, and whether the unit was recognised. Anything below 0.7
must be surfaced for review in WBS 6.4.

Arithmetic validation: qty * unitCost should equal lineTotal, and the sum of line totals
should equal the stated invoice total within a small tolerance (allow rounding and a
possible VAT line). On mismatch, drop the whole invoice's confidence and flag which lines
disagree -- do not silently rewrite a value to make the sum work.

Ingredient matching: fuzzy-match each parsed line name against existing
ingredients.name for that store. Use a Thai-aware similarity (normalise whitespace, strip
tone marks for comparison, handle common abbreviations). Return a match with its score.
NEVER auto-apply a match below 0.85 -- below that, present it as a suggestion in review.

Money: parse to integer satang. Never float.

Tests: a fixture suite built from the 20-receipt spike corpus with hand-written expected
output, asserting per-field accuracy; unit normalisation for every variant in the table;
BE year conversion; arithmetic mismatch flagging; fuzzy match threshold behaviour.
```

---

### 6.4 Purchase Confirmation Screen (Manual)

| Field | Detail |
|---|---|
| **WBS Code** | 6.4 |
| **Type** | Work Package |
| **Requirement** | F23 (rescoped — see phase banner) |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | None |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Put a human between the typed number and the ledger. This screen is still non-negotiable in the architecture even with OCR deferred: nothing writes to `ingredients.current_unit_cost_satang` until a merchant explicitly confirms it, because a fat-fingered price would silently corrupt the cost of every menu item using that ingredient, and the merchant would discover it as a profit figure they cannot explain. With OCR deferred, this screen has one job it always had and one it no longer needs: it still shows a plain-language "what's about to change" summary before committing, but it no longer needs confidence-driven highlighting, since every field the merchant sees is one they typed themselves in 6.1.

**Deliverables**
- Confirmation step reached from 6.1's submit — image (if attached) beside the typed fields, editable up to the point of confirm
- Ingredient mapping with suggestions and create-new inline
- Confirm action writing costs and stock in one transaction
- A plain Thai "what's about to change" summary shown before commit

**Acceptance**
- **No confirmation, no cost write** — asserted by a test that submits a purchase and verifies `ingredients` is untouched until confirm
- The reference image (if any) is viewable zoomed beside the fields
- Confirming a 5-line bill takes under 60 seconds
- Unmapped lines record as a general expense and never force an ingredient match

**Associated Activities**
- Build the confirmation screen
- Implement inline ingredient creation
- Time a 5-line confirmation

<details>
<summary>Deferred: original OCR confidence-driven UI (restore only if 6.2/6.3 are un-deferred)</summary>

~~With OCR live, extracted fields carried a per-field confidence score (WBS 6.3). Fields below 0.7 confidence got a warning treatment (amber border, icon) and came first in tab/focus order; fields at or above 0.9 rendered plainly so the merchant wasn't asked to re-verify what the model already got right; an invoice-level arithmetic-mismatch banner named which lines disagreed. Ingredient matches auto-selected above 0.85 confidence and fell back to a suggestion dropdown below it. Restoring this means re-enabling 6.2/6.3 and reintroducing the confidence-driven layout and focus order on top of the form below.~~

</details>

**▶️ Claude Code Prompt**
```
Build the purchase confirmation screen for Brew Ledger at
apps/console/app/console/expenses/[id]/review/page.tsx.

ARCHITECTURAL RULE THIS SCREEN ENFORCES: nothing writes to
ingredients.current_unit_cost_satang without an explicit human confirm tap, even though the
values were typed by the merchant themselves in WBS 6.1 -- a fat-fingered price silently
corrupts the cost of every menu item using that ingredient, and the merchant discovers it as
a profit number they cannot explain. Write this rule as a comment at the top of the file.
OCR is deferred (see WBS Phase 6.0 banner) -- do not add confidence scoring, confidence-driven
highlighting, or arithmetic-mismatch flags here; every field on this screen was typed by the
merchant, not extracted.

1. Layout, mobile-first: the reference image (if one was attached in 6.1) on top, pinch-zoom,
   tap to expand full screen; the typed fields below, still editable. On tablet/desktop, side
   by side. If no image was attached, skip straight to the fields.

2. Fields: vendor, invoice date, line item list (name, quantity, unit, unit cost, line
   total), carried over from 6.1, still editable here.

3. Ingredient mapping per line:
   - match the typed name against existing ingredients.name for the store (exact/near-exact
     match is enough here; there is no OCR confidence score to threshold against)
   - "สร้างวัตถุดิบใหม่" inline, capturing name and base unit without leaving the screen
   - unmapped lines are allowed: they record as a general expense and do not update any
     ingredient cost. Do not force a mapping.

4. Confirm action, one transaction:
   - insert/update purchase_invoices
   - write purchase_line_items
   - update ingredients.current_unit_cost_satang for every mapped line (WBS 6.6)
   - write stock_ledger rows with reason 'purchase' (WBS 6.8)
   - enqueue a 'cost_recalc' job (WBS 6.9)
   Show the merchant a plain Thai summary of what changed BEFORE they confirm, e.g.
   "นมสด: ต้นทุนเปลี่ยนจาก 42 เป็น 45 บาท/ลิตร กระทบ 6 เมนู" -- so a wrong number is caught
   here rather than in a report next week.

5. Tests:
   - submitting from 6.1 leaves ingredients.current_unit_cost_satang UNCHANGED until confirm
     is pressed
   - unmapped lines record as expense without touching any ingredient
   - confirm writes cost, ledger, and the recalc job atomically -- a forced failure rolls
     back all three
   - timing: a 5-line bill confirms in under 60 seconds
```

---

### 6.5 Ingredient Master and Unit Conversion

| Field | Detail |
|---|---|
| **WBS Code** | 6.5 |
| **Type** | Work Package |
| **Requirement** | F25 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Manage the ingredient list and the unit conversions that make costing arithmetic correct. Everything is stored in base units — grams, millilitres, pieces — because purchases arrive in kilograms and litres while recipes are written in grams and millilitres, and mixing the two is how cost calculations quietly go wrong by a factor of a thousand. Creating ingredients must never be a precondition for selling (RL-2).

**Deliverables**
- `/console/inventory` — ingredient list with cost, stock, and last purchase
- Create/edit with base unit selection and purchase-unit conversion
- Conversion helpers used by both purchase entry and recipes
- Stock level derived from the ledger, never stored as a mutable field

**Acceptance**
- **A store with zero ingredients can sell normally (RL-2)** — asserted by an integration test
- Purchase in kg correctly yields a per-gram cost; a factor-of-1000 error is caught by test
- Displayed stock always equals the sum of the ledger, verified by a reconciliation test
- Ingredient deletion is blocked when referenced by a BOM, with a clear Thai explanation
- Base unit cannot be changed once purchases exist, to protect historical arithmetic

**Associated Activities**
- Build the list and editor
- Implement conversion helpers with exhaustive tests
- Implement ledger-derived stock display
- Add referential guards

**▶️ Claude Code Prompt**
```
Build ingredient management for Brew Ledger at
apps/console/app/console/inventory/page.tsx and the supporting logic in
packages/costing/src/units.ts.

CORE RULE: everything is stored in BASE UNITS (g, ml, piece). Purchases arrive in kg, L,
packs, dozens; recipes are written in g and ml. Mixing the two is how cost arithmetic goes
wrong by a factor of 1000 and nobody notices until the profit report looks insane.
Normalise on entry, store base units only, convert for display.

1. packages/costing/src/units.ts
     toBaseUnit(qty: number, fromUnit: string, baseUnit: BaseUnit): number
     costPerBaseUnit(totalSatang: number, qty: number, unit: string, baseUnit: BaseUnit): number
   Support: kg->g (x1000), g->g, L->ml (x1000), ml->ml, dozen->piece (x12), pack->piece
   (with a per-ingredient pack size), piece->piece.
   Throw on an incompatible pair (kg -> ml) rather than coercing. Exhaustive unit tests
   including an explicit assertion that 1 kg at 450 THB yields 45 satang per gram, so a
   factor-of-1000 regression fails loudly.

2. Ingredient list screen: name, base unit, current unit cost (per base unit, displayed in
   a human unit -- show "45 บาท/กก." not "4.5 สตางค์/กรัม"), current stock, last purchase
   date, and a low-stock indicator. Search and sort.

3. Create/edit: name, base unit, low stock threshold, optional pack size for pack-based
   items. Base unit is IMMUTABLE once any purchase_line_item or stock_ledger row references
   the ingredient -- changing it would silently rewrite the meaning of all historical
   numbers. Disable it with a Thai explanation rather than hiding it.

4. Stock display is DERIVED: select coalesce(sum(delta_base_unit),0) from stock_ledger
   where ingredient_id = $1. Never read a mutable stock column as truth. Add a reconciliation
   test asserting the displayed value always equals the ledger sum.

5. Deletion: block if referenced by bom_lines or by any ledger row. Offer "ซ่อน" (archive)
   instead, with a Thai explanation of why deletion is not possible.

6. RL-2: this entire screen is optional. Write an integration test that creates a store with
   ZERO ingredients, adds a menu item, sells it online and as a cash sale, and asserts both
   complete successfully with null cost. No screen in the app may block on the ingredient
   list being non-empty.
```

---

### 6.6 Unit Cost Update Engine

| Field | Detail |
|---|---|
| **WBS Code** | 6.6 |
| **Type** | Work Package |
| **Requirement** | F24 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | None |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Update an ingredient's current unit cost when a purchase is confirmed, and keep the history that cost drift detection reads. The costing method is a deliberate choice: this system uses **latest purchase price**, not weighted average, because the merchant's question is "what does a cup cost me to make *today*" rather than "what did my inventory cost on average". That choice must be documented where a future contributor will find it, along with its trade-off.

**Deliverables**
- Cost update applied on invoice confirmation
- `ingredient_cost_history` append-only table
- Cost method documented with its rationale and trade-off
- Drift baseline computation feeding 7.4

**Acceptance**
- Confirming a purchase updates `current_unit_cost_satang` to the latest purchase price per base unit
- Every change writes a history row with the source invoice
- **A cost change never rewrites any `unit_cost_snapshot_satang` on existing orders** — asserted by the 3.5 trigger and an explicit test
- The costing method and its trade-off are documented in code and in `/docs/db/schema.md`
- A confirmed purchase with an unmapped line changes no cost

**Associated Activities**
- Implement the update within the confirmation transaction
- Add the history table and RLS
- Write the immutability test against historical snapshots
- Document the method choice

**▶️ Claude Code Prompt**
```
Implement the unit cost update engine for Brew Ledger in packages/costing/src/cost.ts and
the supporting migration.

COSTING METHOD DECISION -- document this prominently in code and in /docs/db/schema.md:
This system uses LATEST PURCHASE PRICE, not weighted average cost, not FIFO.
Rationale: the merchant's actual question is "what does a cup cost me to make today", which
drives today's pricing decision. Weighted average answers "what did my inventory cost on
average", which is the accountant's question, not the barista's.
Trade-off to state honestly: a single unusually expensive emergency purchase (buying milk
from a 7-Eleven at 3x the supplier price because the delivery failed) will move the cost
until the next normal purchase. Mitigation: the drift alert in WBS 7.4 surfaces exactly this
so the merchant can see it and judge it, rather than the system silently smoothing it away.

1. On invoice confirmation (WBS 6.4), for each mapped line:
     newUnitCost = costPerBaseUnit(line.totalSatang, line.qty, line.unit, ingredient.baseUnit)
     update ingredients set current_unit_cost_satang = newUnitCost, updated_at = now()
     insert into ingredient_cost_history (ingredient_id, store_id, old_cost_satang,
       new_cost_satang, source_invoice_id, changed_at)
   All inside the confirmation transaction.

2. Migration for ingredient_cost_history (append-only, RLS-scoped to the store). This table
   is what the drift baseline in WBS 7.4 reads; it is also the only way to answer "why did my
   cost change" after the fact.

3. CRITICAL IMMUTABILITY TEST -- write this explicitly:
   - create a menu item with a BOM, sell it, record the order's unit_cost_snapshot_satang
   - confirm a new purchase that raises the ingredient cost by 50%
   - assert the EXISTING order's unit_cost_snapshot_satang is UNCHANGED
   - assert a NEW order of the same item gets the new higher cost
   This is the behaviour that makes historical P&L trustworthy. If it ever regresses, every
   past report silently changes and the merchant loses confidence in all of them.

4. Unmapped purchase lines change no ingredient cost. They are recorded as a general expense
   only. Test this.

5. After updating costs, enqueue a 'cost_recalc' job (WBS 6.9) for the affected menu items,
   and a 'cost_drift_check' job (WBS 7.4).
```

---

### 6.7 Suggested BOM and Optional Recipe Editor

| Field | Detail |
|---|---|
| **WBS Code** | 6.7 |
| **Type** | Work Package |
| **Requirement** | F26 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | **RL-2** |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Lower the cost of entering a recipe by offering a standard one to edit rather than a blank form to author. A merchant is far more likely to correct "18 g coffee, 150 ml milk" than to construct it from nothing. The offer must remain an offer: suggestions appear where the merchant is already looking, never as an interruption, never as a task list, and never with copy implying the merchant is behind.

**Deliverables**
- A seed library of standard Thai cafe drink recipes
- Suggestion matching on menu item name with a Thai-aware matcher
- Recipe editor pre-filled from the suggestion, fully editable
- Cost preview updating live as quantities change

**Acceptance**
- **Suggestions are offered, never demanded; dismissing one has no consequence and does not re-prompt (RL-2)**
- **No copy anywhere implies incompleteness** — asserted by the string audit from 4.4
- Accepting a suggestion and adjusting one quantity takes under 30 seconds
- The cost preview updates live and shows `—` while any referenced ingredient has no cost
- A merchant who never opens this screen is never blocked or nagged anywhere in the product

**Associated Activities**
- Build the seed recipe library
- Implement name matching
- Build the editor with live cost preview
- Run the string audit across every surface that mentions recipes

**▶️ Claude Code Prompt**
```
Build the suggested BOM and optional recipe editor for Brew Ledger.

RL-2 GOVERNS THIS ENTRY. The purpose is to lower the cost of entering a recipe, never to
increase the pressure to enter one. A merchant who ignores this screen forever must have a
completely unimpeded experience everywhere else in the product.

1. packages/costing/src/recipes/library.ts -- a seed library of standard Thai cafe drinks
   with typical quantities in base units. Cover at minimum:
     เอสเพรสโซ่ (18g bean)
     อเมริกาโน่ (18g bean, 150ml water)
     ลาเต้ (18g bean, 200ml milk)
     คาปูชิโน่ (18g bean, 150ml milk)
     มอคค่า (18g bean, 180ml milk, 30ml chocolate syrup)
     ชาไทยเย็น (20g tea, 100ml condensed/evaporated milk, 50g sugar syrup)
     มัทฉะลาเต้ (5g matcha, 200ml milk)
     โกโก้ (25g cocoa powder, 200ml milk)
   Each entry: name, aliases (hot/cold/blended variants and common spellings), and lines of
   { ingredientName, qtyBaseUnit, baseUnit }.
   Add a comment: these are STARTING POINTS to edit, not standards to comply with. Every
   shop's recipe differs and that is normal.

2. Matching: when a merchant opens the recipe block for a menu item, fuzzy-match the item
   name against the library (Thai-aware: normalise whitespace, handle ร้อน/เย็น/ปั่น
   suffixes, tolerate spelling variation). Offer the best match if the score clears a
   threshold; offer nothing if it does not. Never offer a poor match -- a wrong suggestion
   is worse than none because it teaches the merchant the feature is unreliable.

3. Presentation rules -- implement exactly:
   - the suggestion appears INSIDE the already-collapsed recipe block from WBS 4.4, where
     the merchant went looking. It never appears as a banner, a modal, a toast, a badge, a
     red dot, or an onboarding step
   - one dismissal is permanent for that menu item. Do not re-offer. Store the dismissal
   - no copy may imply the merchant is missing something, behind, or incomplete. Forbidden
     Thai phrases: ยังไม่ได้ใส่, ควรใส่, กรุณาใส่, ไม่ครบ, ยังขาด
   - the accept action is "ใช้สูตรนี้แล้วแก้ได้" -- framing it as editable, because the
     merchant's recipe is theirs

4. Editor: pre-filled lines, each with ingredient, quantity, unit; add and remove lines;
   ingredient picker with inline create (WBS 6.5). Live cost preview beneath, updating as
   quantities change. When ANY referenced ingredient has a null current cost, the preview
   shows "—" with a neutral Thai note that cost appears once a bill for that ingredient is
   recorded -- stated as information, not as a deficiency.

5. String audit test: scan every rendered string in the recipe block and its suggestion UI
   for the forbidden Thai phrases above, and FAIL the build on any hit. Extend the WBS 4.4
   audit rather than duplicating it.

6. Test: a merchant who never opens the recipe block completes the full journey -- create
   menu, publish, take an online order, take a cash sale, view the dashboard, view the P&L --
   with no prompt, badge, banner, or blocked action anywhere. Assert on the absence of the
   forbidden strings across all those screens.
```

---

### 6.8 Automatic Stock Deduction and Stock Ledger

| Field | Detail |
|---|---|
| **WBS Code** | 6.8 |
| **Type** | Work Package |
| **Requirement** | F25 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-2 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Deduct ingredients when an order is paid, through an append-only ledger. Append-only is the point: a stock number a merchant disputes must be traceable to the exact movements that produced it, and a mutable balance cannot do that. Orders whose items have no BOM deduct nothing and raise nothing — silence is the correct behaviour for an untracked item (RL-2).

**Deliverables**
- `deductStockForOrder` called inside the 5.6 payment transaction
- Append-only ledger entries with reason and source reference
- Reversal via compensating entries for cancellation
- Negative stock allowed with a warning rather than blocked

**Acceptance**
- **An order containing only items with no BOM produces zero ledger rows and zero warnings (RL-2)**
- Deduction is atomic with payment confirmation — a rollback leaves no partial deduction
- **Ledger rows are never updated or deleted; reversal is always a new compensating row**
- Stock may go negative with a merchant-visible warning; it must not block a sale
- Every ledger row traces to its order or invoice

**Associated Activities**
- Implement deduction inside the payment transaction
- Implement reversal
- Decide and document the negative-stock policy
- Write the traceability test

**▶️ Claude Code Prompt**
```
Implement automatic stock deduction for Brew Ledger in packages/costing/src/stock.ts.

1. deductStockForOrder(tx, order) -- called INSIDE the WBS 5.6 payment transaction and by
   the WBS 5.12 cash sale path.
   For each order line, for each bom_line of that menu item:
     insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, order_id)
     values (..., -(bom_line.qty_base_unit * order_line.quantity), 'sale', order.id)

2. RL-2 BEHAVIOUR: a menu item with NO bom_lines deducts nothing and raises nothing. No
   error, no warning, no log line at warn level, no badge on the order. Silence is correct
   for an untracked item. Test an order composed entirely of zero-BOM items and assert zero
   ledger rows and zero warnings anywhere.

3. APPEND-ONLY, enforced not merely intended. Add a trigger raising an exception on UPDATE
   or DELETE of stock_ledger. Reversal is ALWAYS a new compensating row with reason
   'cancellation_reversal' (WBS 5.11) or 'adjustment'. A stock number the merchant disputes
   must be traceable to the exact movements that produced it, and a mutable balance cannot
   do that.

4. NEGATIVE STOCK POLICY -- allow it, warn, never block.
   The ledger can go negative because the merchant will forget to record a purchase, and a
   system that refuses to complete a paid sale because its own stock estimate says zero is a
   system that gets deleted. Surface negative stock prominently in the inventory screen as
   "น่าจะยังไม่ได้บันทึกบิลซื้อ" -- framed as a missing record, not as the merchant doing
   something wrong. Document this decision in code with the rationale.

5. Atomicity: deduction happens in the same transaction as payment confirmation. A forced
   failure after deduction must roll back BOTH the payment status and the ledger rows. Test
   this explicitly.

6. Traceability test: for a random sample of ledger rows, assert each one resolves to either
   an order or a purchase invoice, and that summing all rows for an ingredient reproduces the
   displayed stock exactly.
```

---

### 6.9 Cost per Cup and Profit Recalculation

| Field | Detail |
|---|---|
| **WBS Code** | 6.9 |
| **Type** | Work Package |
| **Requirement** | F24 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | **RL-2** |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Compute cost per cup and margin per menu item, and handle the untracked case honestly. The rule that carries the most weight is small and easy to get wrong: an item with no BOM, or with any ingredient lacking a cost, has cost `null` — not `0`. Treating unknown cost as zero produces a 100% margin, which flatters the merchant, misinforms their pricing, and is the single most damaging wrong number this product could show.

**Deliverables**
- `costPerCup(menuItemId)` returning `number | null` with explicit semantics
- Margin and margin-percent helpers propagating `null` correctly
- Recalculation job triggered by cost changes and BOM edits
- Cached computed costs with invalidation

**Acceptance**
- **An item with no BOM returns `null`, never `0` (RL-2)** — asserted by unit test
- **An item whose BOM references any ingredient with `null` cost returns `null`, never a partial sum** — asserted by unit test
- No UI anywhere renders a `null` cost as `0`, `0.00`, or `฿0` — asserted by a UI test
- Recalculation completes within 60 seconds of a confirmed purchase for a 50-item menu
- Margin percentage is `null` whenever cost is `null`, never `100%`

**Associated Activities**
- Implement the null-propagating calculation
- Implement the recalculation job
- Add the cache and its invalidation
- Audit every UI cost rendering path

**▶️ Claude Code Prompt**
```
Implement cost per cup and profit calculation for Brew Ledger in
packages/costing/src/costPerCup.ts.

THE MOST IMPORTANT RULE IN THIS FILE, and the easiest to get wrong:
Unknown cost is NULL, never 0. Treating an unknown cost as zero produces a 100% margin,
which flatters the merchant, misinforms their pricing decisions, and is the single most
damaging wrong number this product could display. Encode it in the type system, not just in
a convention.

1. costPerCup(menuItemId): Promise<number | null>
     select bl.qty_base_unit, i.current_unit_cost_satang
       from bom_lines bl join ingredients i on i.id = bl.ingredient_id
      where bl.menu_item_id = $1
   - zero rows            -> return null   (no BOM: RL-2)
   - ANY row with null cost -> return null (partial cost is worse than no cost, because it
                                            looks complete and is not)
   - otherwise            -> return the integer satang sum
   Return type is `number | null` -- do NOT default to 0 anywhere in the signature, the
   implementation, or the caller.

2. marginSatang(price, cost): number | null   -> null if cost is null
   marginPercent(price, cost): number | null  -> null if cost is null or price is 0
   Both must propagate null. Write property-based tests asserting null in produces null out
   for every combination.

3. Recalculation job 'cost_recalc' in the worker: given an ingredient id or a menu item id,
   recompute affected items and write to a menu_item_cost_cache table
   (menu_item_id, cost_satang nullable, margin_satang nullable, computed_at).
   Triggered by: purchase confirmation (WBS 6.6), BOM edit (WBS 6.7), ingredient cost edit.
   Performance target: a 50-item menu recalculates within 60 seconds of confirmation.

4. Cache invalidation: any write to bom_lines or ingredients.current_unit_cost_satang
   invalidates the affected cache rows. Prefer a stale-marker column plus recompute over
   deleting, so a report never sees a missing row mid-recalculation.

5. UI AUDIT TEST -- required. Scan every component that renders a cost, margin, or profit
   value and assert that a null input renders an em dash "—" and never "0", "0.00", "฿0",
   "0%", or "100%". Write it as a component test over a manifest of every cost-rendering
   component, so a newly added one that is not in the manifest fails the test.

6. Unit tests: no BOM -> null; BOM with one null-cost ingredient -> null; complete BOM ->
   exact satang sum; margin null-propagation; a 3-ingredient latte at known costs produces
   the exact expected integer.
```

**Testing**
- No BOM → `null`; partial cost → `null`; complete → exact integer
- Margin and percent propagate `null`
- UI manifest test: `null` never renders as zero anywhere
- Recalculation performance on a 50-item menu

---
## Phase 7.0 — Dashboard, Alerts and Reports

> **This phase is where the merchant finally sees the value of everything built before it.** Every entry here must survive the zero-BOM case honestly: a store that has never entered a recipe must still get a working dashboard and a working P&L, with unknown costs disclosed rather than silently treated as zero (RL-2).

---

### 7.1 Dashboard Summary

| Field | Detail |
|---|---|
| **WBS Code** | 7.1 |
| **Type** | Work Package |
| **Requirement** | F14 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Build the screen the merchant opens first every morning and glances at between customers. It answers four questions in one view: how much came in today, what it cost, what is left, and how many orders are waiting. The design constraint is glanceability — this is read in three seconds while holding a portafilter, not studied. The zero-BOM case must produce a dashboard that is useful rather than broken: revenue and order count are always available, and cost-derived figures disclose their own incompleteness.

**Deliverables**
- `/console` — today's revenue, net profit, expenses, order count, upcoming slot load
- Live updates as orders are paid
- Untracked-cost disclosure line when any of today's sales lacks a cost snapshot
- Quick actions: order inbox, cash sale, scan bill

**Acceptance**
- The four headline numbers render within 1 second of page load on 4G
- **A store with zero BOM entries sees revenue and order count normally, and profit shows `—` with a plain Thai explanation rather than a wrong number (RL-2)**
- Numbers update within 5 seconds of a new paid order without a refresh
- The disclosure line states how many of today's items had no cost recorded, and is never styled as an error
- All money is rendered from integer satang with no float drift

**Associated Activities**
- Build the summary query against `daily_financials` plus today's live orders
- Implement the untracked disclosure
- Wire Realtime updates
- Test the zero-BOM store rendering

**▶️ Claude Code Prompt**
```
Build the Owner Console dashboard for Brew Ledger at apps/console/app/console/page.tsx.

Reading context: the merchant opens this while holding a portafilter and looks at it for
about three seconds. Glanceability beats completeness.

1. Four headline cards, in this priority order:
     ยอดขายวันนี้      gross revenue today (satang -> THB)
     กำไรสุทธิวันนี้     net profit today
     ค่าใช้จ่ายวันนี้     expenses today (confirmed purchase invoices + absorbed-elsewhere fees)
     ออเดอร์            count, split into waiting / preparing / ready
   Below them: the next 3 pick-up slots with their booked counts, so the merchant can see
   the coming load.

2. RL-2 ZERO-BOM BEHAVIOUR -- required. Compute net profit only from order lines that have a
   non-null unit_cost_snapshot_satang.
   - If NO line today has a cost, show กำไรสุทธิ as "—" with a one-line neutral Thai note:
     "ยังไม่ได้บันทึกต้นทุน จึงยังคำนวณกำไรไม่ได้" -- rendered as plain text, NOT as a
     warning, NOT amber, NOT with an icon. It is information, not a fault.
   - If SOME lines have costs and some do not, show the profit computed from the tracked
     lines and a disclosure beneath: "คำนวณจาก X จาก Y รายการที่มีข้อมูลต้นทุน".
     Never silently present a partial number as complete.
   Write a test that loads the dashboard for a store with zero bom_lines and asserts:
   revenue renders, order count renders, no error is thrown, and profit is "—" not "0".

3. Data source: read daily_financials for the aggregate where available (WBS 7.5 writes it
   nightly), and compute today's figures live from orders where business_date = today in the
   store timezone. Do not wait for the nightly job to show today.

4. Live update: Supabase Realtime on orders filtered by store_id; recompute the cards on
   insert/update. Target under 5 seconds from paid order to updated number.

5. Quick action row, large tap targets: ออเดอร์ / ขายหน้าร้าน / สแกนบิล linking to
   /console/orders, /console/sales/quick, /console/expenses/capture.

6. Performance: the four numbers must render within 1 second on a throttled 4G profile.
   Server-render the initial values; do not block the whole page on the slowest query.

All money formatted from integer satang at the render boundary only. Thai copy throughout.
```

---

### 7.2 AI Brief

| Field | Detail |
|---|---|
| **WBS Code** | 7.2 |
| **Type** | Work Package |
| **Requirement** | F13 |
| **Owner** | M2 (UI), M1 (generation) |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Produce the two-or-three-line summary at the top of the dashboard telling the merchant what to buy or prepare before opening. It is generated from stock levels, upcoming slot bookings, and recent usage rate — deterministic rules first, with language generation only as a presentation layer. The reason for rules-first is trust: a brief that occasionally invents a number is worse than no brief, because the merchant will act on it and then stop believing the product.

**Deliverables**
- Nightly `ai_brief` job computing the brief and storing it per store per day
- Rules engine: low stock vs upcoming bookings, unusual usage, missing recent bill
- Thai natural-language rendering of the computed facts
- Graceful empty state when there is nothing worth saying

**Acceptance**
- **Every statement in the brief traces to a computed fact — no number appears that was not derived from the database**
- A store with no ingredient tracking gets a brief based on bookings alone, not an error (RL-2)
- The brief is at most three lines and reads naturally in Thai
- When there is nothing actionable, the brief is absent rather than padded with filler
- Generation runs nightly and is regenerated on demand if stale

**Associated Activities**
- Implement the rules engine
- Implement the Thai rendering layer
- Define the "nothing to say" threshold
- Verify traceability of every generated statement

**▶️ Claude Code Prompt**
```
Build the AI Brief for Brew Ledger -- the short prep summary at the top of the dashboard.

DESIGN PRINCIPLE, non-negotiable: rules first, language second. Every number in the brief
must be computed deterministically from the database. A brief that occasionally invents a
figure is worse than no brief at all, because the merchant will act on it once and then stop
trusting every other number in the product.

1. Worker job 'ai_brief', nightly per store, plus on-demand regeneration if the stored brief
   is older than 12 hours. Compute these facts:
   a. Ingredients whose derived stock is below low_stock_threshold, ordered by how soon they
      run out given the 7-day usage rate from stock_ledger
   b. Ingredients that will not cover tomorrow's already-booked pre-orders, computed as
      sum over booked order lines of bom qty vs current stock
   c. Ingredients with no confirmed purchase in the last 30 days but ongoing usage
      (a likely missing bill, not a missing purchase)
   d. Tomorrow's total booked cups and the busiest slot
   Store the computed facts as structured JSON in a daily_briefs table alongside the
   rendered text, so the UI can show the numbers and a developer can audit the reasoning.

2. Rendering: turn the facts into at most 3 short Thai lines. Use a template-based renderer,
   not free generation. Examples of the target voice:
     "พรุ่งนี้จองแล้ว 14 แก้ว ช่วง 08:00-08:30 แน่นสุด"
     "นมสดเหลือพอราว 1 วัน ซื้อเพิ่มก่อนเปิดร้าน"
     "เมล็ดกาแฟไม่มีบิลซื้อมา 32 วันแล้ว อาจลืมบันทึก"
   If you use an LLM at all, use it ONLY to smooth phrasing of already-computed facts, pass
   the facts as structured data, and validate every number in the output appears in the input
   facts -- reject and fall back to the template on any mismatch.

3. RL-2: a store with zero ingredients gets a brief from bookings alone (fact d only). Never
   error, never prompt them to add ingredients, never show an empty warning box. Test this.

4. Empty state: if no fact clears its threshold, render NOTHING -- no card, no placeholder,
   no "ทุกอย่างเรียบร้อย". Padding a dashboard with filler trains the merchant to ignore that
   region, which destroys the value of the brief on the day it matters.

5. Test: for a seeded store with known stock and known bookings, assert the exact expected
   facts and that every numeral in the rendered Thai string appears in the facts JSON.
```

---

### 7.3 Low Stock Alerts

| Field | Detail |
|---|---|
| **WBS Code** | 7.3 |
| **Type** | Work Package |
| **Requirement** | F16 |
| **Owner** | M1 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Warn the merchant before an ingredient runs out, based on real usage rate rather than a static threshold alone. A fixed threshold is nearly useless in a cafe: 2 litres of milk is a week for one shop and two hours for another. The alert must therefore express itself in days-of-cover, and it must respect the merchant's attention by alerting once per condition rather than once per check.

**Deliverables**
- `low_stock_check` job computing days-of-cover per ingredient
- Alert records with dedupe so one condition produces one alert
- Alert surface on the dashboard and inventory screen
- Merchant-configurable threshold in days, defaulting sensibly

**Acceptance**
- **Alerts express days-of-cover, not just a quantity below a line**
- One ingredient crossing the threshold produces exactly one alert until it is resolved or restocked
- **A store with no ingredients produces no alerts and no empty alert UI (RL-2)**
- Restocking clears the alert automatically without merchant action
- Usage rate is computed from the actual ledger, ignoring the day of an unusually large adjustment

**Associated Activities**
- Implement the usage-rate and days-of-cover calculation
- Implement dedupe and auto-resolution
- Build the alert surface
- Test the noisy-alert case deliberately

**▶️ Claude Code Prompt**
```
Implement low stock alerts for Brew Ledger.

WHY DAYS-OF-COVER, NOT A QUANTITY: a fixed threshold is close to useless in a cafe. Two
litres of milk is a week for one shop and two hours for another. The only signal the merchant
can act on is "this runs out in about N days".

1. Worker job 'low_stock_check', hourly per active store.
   For each ingredient:
     currentStock   = sum(delta_base_unit) from stock_ledger
     dailyUsage     = abs(sum of 'sale' deltas over the last 14 days) / 14
                      -- exclude 'adjustment' rows so one stock-take does not distort the rate
     daysOfCover    = dailyUsage > 0 ? currentStock / dailyUsage : null
   Raise an alert when daysOfCover is not null and below the store's threshold
   (default 2 days, merchant-configurable), OR when currentStock <= low_stock_threshold and
   dailyUsage is 0 (no usage history yet, fall back to the static threshold).

2. DEDUPE -- one condition, one alert. Add an alerts table
   (store_id, type, subject_id, status, first_raised_at, resolved_at, payload).
   Do not raise a new alert while an unresolved one exists for the same
   (type, subject_id). Auto-resolve when a purchase brings daysOfCover back above the
   threshold plus a hysteresis margin, so an ingredient hovering at the line does not
   flap between raised and resolved.

3. Surfaces:
   - dashboard: a compact list of at most 3 alerts, ordered by soonest to run out
   - /console/inventory: full list with days-of-cover per ingredient
   Copy in Thai, factual and calm: "นมสด เหลือพอราว 1.5 วัน" -- not "คำเตือน!"

4. RL-2: a store with zero ingredients produces zero alerts and renders NO alert region at
   all -- not an empty state, not a prompt to add ingredients. Test this explicitly.

5. Tests:
   - seeded 14-day usage produces the expected daysOfCover
   - an adjustment row does not distort the usage rate
   - crossing the threshold raises exactly one alert; running the job 10 more times raises
     none
   - a purchase above the hysteresis margin auto-resolves it
   - a zero-ingredient store produces nothing
```

---

### 7.4 Cost Drift Alert

| Field | Detail |
|---|---|
| **WBS Code** | 7.4 |
| **Type** | Work Package |
| **Requirement** | F15 |
| **Owner** | M1 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Tell the merchant when an ingredient's cost has risen enough to matter, and translate that rise into the thing they actually care about: which drinks now make less money and how much less. This is the feature the whole costing pipeline exists to deliver — the documented failure mode in this market is a shop that keeps selling steadily while margin quietly erodes underneath, and discovers it only when the money runs out. A drift alert with no menu-impact translation is just a number; the impact line is what makes it actionable.

**Deliverables**
- `cost_drift_check` job comparing current unit cost to a trailing baseline
- Configurable threshold with a sensible default
- Impact computation: affected menu items, old margin vs new margin
- Alert surface with a plain-Thai impact statement

**Acceptance**
- **Every drift alert names the affected menu items and the margin change per item**
- Baseline is a trailing median, not the single previous purchase, so one odd purchase does not trigger constantly
- One drift condition produces one alert until acknowledged
- **A store with no BOM produces no drift alerts and no empty UI (RL-2)**
- The alert states the change in both THB per unit and percentage

**Associated Activities**
- Implement the baseline and comparison
- Implement the menu-impact computation
- Build the alert card with the impact statement
- Test the single-odd-purchase case

**▶️ Claude Code Prompt**
```
Implement the Cost Drift Alert for Brew Ledger. This is the headline feature of the whole
costing pipeline.

MARKET CONTEXT worth encoding in a comment: the documented failure mode for Thai independent
cafes is a shop that keeps selling steadily while ingredient costs creep up underneath, and
only discovers the problem when the cash runs out. Thai operators call this "ต้นทุนแฝง" and
describe the outcome as "ขายดีจนเจ๊ง". This alert exists to make that visible early.

1. Worker job 'cost_drift_check', triggered after every confirmed purchase (WBS 6.6) and
   nightly as a sweep.
   baseline = median of ingredient_cost_history.new_cost_satang over the trailing 90 days,
              excluding the current value
   drift    = (current - baseline) / baseline
   Use the MEDIAN, not the previous value: buying milk once from a convenience store at 3x
   price must not raise a drift alert every time, but a sustained supplier increase must.
   Raise when drift > threshold (default 10%, merchant-configurable).

2. IMPACT COMPUTATION -- this is what makes the alert useful rather than merely true.
   For the drifting ingredient, find every menu item whose bom_lines reference it, then for
   each compute:
     oldCostPerCup = cost per cup using the baseline unit cost
     newCostPerCup = cost per cup using the current unit cost
     oldMargin / newMargin against the current selling price
   Order affected items by absolute margin loss multiplied by units sold in the last 30 days,
   so the item that costs the merchant the most money appears first -- not merely the item
   with the largest percentage change.

3. Alert copy in Thai, factual and specific, e.g.:
     "นมสดขึ้นราคา 12% (42 -> 47 บาท/ลิตร)
      ลาเต้เย็น กำไรลดลง 5 บาท/แก้ว (ขาย 180 แก้ว/เดือน)
      คาปูชิโน่ กำไรลดลง 3.75 บาท/แก้ว"
   Include a "ดูทั้งหมด" link to the profit-per-dish report filtered to affected items.

4. Dedupe using the same alerts table as WBS 7.3, keyed (type='cost_drift', ingredient_id).
   Acknowledging dismisses until the cost moves again by more than the threshold from the
   acknowledged level -- do not re-raise for the same movement.

5. RL-2: a store with no bom_lines produces no drift alerts and renders no alert region.
   An ingredient with a cost but referenced by no menu item raises no alert either -- there
   is no impact to report. Test both.

6. Tests:
   - a single 3x outlier purchase does NOT trigger an alert when the 90-day median is stable
   - a sustained 15% increase DOES trigger
   - the impact list is correctly ordered by total money lost, not percentage
   - a zero-BOM store produces nothing
```

---

### 7.5 Daily P&L Report

| Field | Detail |
|---|---|
| **WBS Code** | 7.5 |
| **Type** | Work Package |
| **Requirement** | F27 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | **RL-2** |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Produce the daily profit and loss the merchant checks at close. It must reconcile to the cash they can count, which means cash sales are included, gateway fees are attributed by bearer, and — most importantly — items with no cost data are disclosed rather than assumed free. A P&L that silently treats untracked items as zero-cost overstates profit, and the merchant will eventually notice the discrepancy against their own bank balance and stop trusting the report entirely.

**Deliverables**
- `/console/reports/pnl` — daily revenue, COGS, gateway fees, other expenses, net profit
- Nightly `daily_aggregate` job writing `daily_financials`
- Untracked-item disclosure with count and revenue share
- Date navigation and a 7-day trend strip

**Acceptance**
- **Untracked items are disclosed with their count and revenue share; they are never counted as zero cost (RL-2)**
- Cash sales are included in revenue and stock, with no gateway fee
- An absorbed gateway fee does not reduce merchant net profit, but the amount is still shown as a line labelled as covered by Brew Ledger (4.8)
- Historical days never change when ingredient costs change afterwards — verified against the 6.6 immutability test
- The report reconciles: revenue − COGS − fees − expenses = net profit, exactly, in integer satang

**Associated Activities**
- Implement the nightly aggregate
- Implement the live view for today
- Implement the disclosure block
- Write the reconciliation test

**▶️ Claude Code Prompt**
```
Build the Daily P&L report for Brew Ledger at
apps/console/app/console/reports/pnl/page.tsx plus the nightly aggregation job.

THE RULE THAT MATTERS MOST HERE: an item with no cost snapshot is NOT free. Silently
treating untracked items as zero cost overstates profit, and the merchant will eventually
compare the report against their own bank balance, find the gap, and stop trusting every
number this product produces. Disclose instead.

1. Worker job 'daily_aggregate', nightly at 01:00 Asia/Bangkok, writing daily_financials
   per store per business_date:
     gross_revenue_satang  = sum(orders.total_satang) where status in
                             (ACCEPTED, PREPARING, READY, COLLECTED), both online and cash
     total_cogs_satang     = sum(order_items.unit_cost_snapshot_satang * quantity)
                             ONLY over lines where the snapshot is NOT NULL
     untracked_item_count  = count of order_items lines with a NULL snapshot
     untracked_revenue_satang = revenue attributable to those lines
     other_expense_satang  = sum(confirmed purchase_invoices.total_satang) for that date
     net_profit_satang     = gross_revenue - total_cogs - other_expense
   There is no gateway fee term: the MVP uses direct merchant-owned PromptPay and no
   per-transaction fee flows through this product (WBS 4.8).
   Business date is computed in the STORE timezone. Define and document the cut-off: a sale
   at 23:30 belongs to that calendar day in the store's timezone, and a shop open past
   midnight is out of MVP scope -- state this in a comment rather than leaving it ambiguous.

2. The report screen:
   - Date picker defaulting to today, with previous/next navigation
   - Line items: ยอดขาย / ต้นทุนวัตถุดิบ / ค่าธรรมเนียม / ค่าใช้จ่ายอื่น / กำไรสุทธิ
   - A 7-day sparkline of net profit
   - Today reads live from orders; past days read daily_financials

3. UNTRACKED DISCLOSURE BLOCK -- required whenever untracked_item_count > 0:
     "หมายเหตุ: 12 จาก 47 รายการยังไม่มีข้อมูลต้นทุน (คิดเป็นยอดขาย 540 บาท)
      กำไรที่แสดงจึงคำนวณจากรายการที่มีข้อมูลเท่านั้น"
   Plain text, neutral tone, always visible when applicable -- never collapsed behind a
   tooltip, never styled as an error, never a prompt to go and enter recipes.
   If EVERY line is untracked, show revenue and expenses normally and render net profit as
   "—" with this note. Do not render 0.

4. No gateway fee line. Customer money arrives by direct PromptPay transfer, so there is no
   per-transaction fee attributable to this product. If the delivered prototype's P&L screen
   still renders a fee row, remove it and update the state matrix in the same pull request
   rather than leaving a line that will always read zero.

5. RECONCILIATION TEST -- required: for a seeded day, assert
   gross_revenue - total_cogs - other_expense === net_profit exactly, in integer satang,
   with no rounding drift. Then assert the same day's figures are byte
   identical after an ingredient cost change (cross-check with WBS 6.6).
```

---

### 7.6 Profit per Dish Report

| Field | Detail |
|---|---|
| **WBS Code** | 7.6 |
| **Type** | Work Package |
| **Requirement** | F28 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | **RL-2** |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Rank menu items by **total profit contribution** — margin multiplied by units sold — rather than by units sold or by revenue. This ranking is the headline MVP KPI because it routinely contradicts the merchant's intuition: the best-selling drink is frequently not the most profitable one, and no other tool this merchant has access to will tell them that. Untracked items appear in the list with an explicit unknown rather than being hidden, so the merchant can see what they are not measuring.

**Deliverables**
- `/console/reports/profit-per-dish` — ranked table with period selector
- Columns: item, units sold, revenue, cost, margin per unit, total profit contribution
- Untracked items shown with `—` in cost columns, sorted separately
- A one-line insight highlighting the best-seller vs most-profitable divergence when it exists

**Acceptance**
- **Ranking is by total profit contribution, not units and not revenue** — asserted by a test with a deliberately divergent fixture
- **Items with no cost data appear in the list showing `—`, never `0` and never hidden (RL-2)**
- The period selector covers today, 7 days, 30 days, and a custom range
- The insight line appears only when the top seller differs from the top profit contributor
- Report loads within 2 seconds for a 50-item menu over 30 days

**Associated Activities**
- Implement the aggregation query with proper indexing
- Build the table with the untracked treatment
- Implement the divergence insight
- Test the divergence case explicitly

**▶️ Claude Code Prompt**
```
Build the Profit per Dish report for Brew Ledger at
apps/console/app/console/reports/profit-per-dish/page.tsx.

THIS IS THE HEADLINE MVP KPI. Rank by TOTAL PROFIT CONTRIBUTION -- margin per unit
multiplied by units sold -- not by units sold and not by revenue. This ranking routinely
contradicts the merchant's intuition, and that contradiction is the entire value: the
best-selling drink is frequently not the most profitable one, and nothing else this merchant
has access to will tell them so.

1. Query over order_items joined to orders for the selected period, grouped by menu item:
     unitsSold        = sum(quantity)
     revenueSatang    = sum(unit_price_snapshot_satang * quantity)
     cogsSatang       = sum(unit_cost_snapshot_satang * quantity)  -- NULL-aware
     marginPerUnit    = avg(unit_price_snapshot - unit_cost_snapshot) where cost is not null
     totalProfit      = revenueSatang - cogsSatang                 -- NULL if any line is null
   Use the SNAPSHOT columns, never current ingredient costs, so a historical period never
   changes when prices move afterwards (WBS 3.5, 6.6).

2. Table columns: เมนู | ขายได้ (แก้ว) | ยอดขาย | ต้นทุน | กำไร/แก้ว | กำไรรวม
   Default sort: กำไรรวม descending.
   Allow re-sorting by any column, but always RETURN to profit-contribution sort on load, so
   the default view is the one that teaches something.

3. RL-2 UNTRACKED TREATMENT -- required:
   - items with any null cost snapshot show "—" in ต้นทุน, กำไร/แก้ว, and กำไรรวม
   - they are NOT hidden and NOT sorted as zero. Place them in a separate section beneath
     the ranked list, headed neutrally: "ยังไม่มีข้อมูลต้นทุน (X รายการ)"
   - each row still shows units sold and revenue, which are known
   - no prompt, no nag, no call to action to add recipes. The merchant can see what is not
     measured; that is enough.

4. DIVERGENCE INSIGHT -- one line above the table, shown ONLY when the top item by units
   sold differs from the top item by profit contribution:
     "ขายดีที่สุดคือ อเมริกาโน่ (210 แก้ว) แต่กำไรรวมสูงสุดคือ ลาเต้เย็น (3,240 บาท)"
   This single sentence is the product's core insight. Do not show it when the two coincide,
   and never fabricate a comparison when cost data is missing for either item.

5. Period selector: วันนี้ / 7 วัน / 30 วัน / กำหนดเอง.

6. Performance: under 2 seconds for a 50-item menu over 30 days. Rely on the WBS 7.8 indexes;
   if the query plan needs a covering index, add it there rather than here.

7. Tests:
   - a fixture where item A sells most units but item B contributes most profit, asserting
     B ranks first by default
   - untracked items render "—" and appear in the separate section, never as 0
   - a historical period's figures are unchanged after an ingredient cost update
   - the divergence line is absent when top-seller and top-profit are the same item
```

---

### 7.7 Period Comparison and Gateway Fee Breakdown

| Field | Detail |
|---|---|
| **WBS Code** | 7.7 |
| **Type** | Work Package |
| **Requirement** | F29 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | None |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Let the merchant compare this month to last, and show plainly what payment processing costs — including what Brew Ledger is currently absorbing on their behalf. Showing the absorbed amount is a deliberate honesty decision: the merchant should understand the real cost structure during the free period so that a future change is a conversation rather than a surprise, and so the PoC's own economics are visible to both sides.

**Deliverables**
- `/console/reports/overview` — month/year comparison of revenue, COGS, fees, profit
- Gateway fee breakdown by bearer with the absorbed amount labelled
- Percentage change per metric with direction indicators
- Simple chart of monthly revenue and profit

**Acceptance**
- Comparison periods align correctly (same day count where relevant) and state the range explicitly
- **The absorbed fee total is shown and labelled as covered by Brew Ledger, never hidden**
- Percentage changes handle a zero baseline without rendering `Infinity` or `NaN`
- The chart is readable at 375 px width
- Figures reconcile against the sum of the daily P&L rows for the same range

**Associated Activities**
- Implement the comparison query
- Build the fee breakdown block
- Handle the zero-baseline and partial-month edge cases
- Reconcile against daily figures

**▶️ Claude Code Prompt**
```
Build the period comparison report for Brew Ledger at
apps/console/app/console/reports/overview/page.tsx.

1. Comparison: current month vs previous month by default, with a selector for
   เดือนนี้/เดือนที่แล้ว, ปีนี้/ปีที่แล้ว, and a custom range pair.
   Metrics: ยอดขาย, ต้นทุนวัตถุดิบ, ค่าธรรมเนียม, ค่าใช้จ่ายอื่น, กำไรสุทธิ, จำนวนออเดอร์.
   Each with an absolute value, an absolute change, and a percentage change with a direction
   arrow.
   PARTIAL PERIOD HANDLING: when the current month is incomplete, state it explicitly --
   "เทียบ 1-16 ก.ย. กับ 1-16 ส.ค." -- and compare like-for-like day ranges. Comparing 16 days
   against a full 31-day month produces a scary meaningless number.
   ZERO BASELINE: when the previous period is 0, show "—" for the percentage, never
   Infinity, NaN, or 100%.

2. NO FEE BREAKDOWN BLOCK. The MVP uses direct merchant-owned PromptPay, so there is no
   per-transaction fee attributable to this product (WBS 4.8). If the delivered prototype's
   overview screen still renders a three-line fee breakdown, remove it and update
   /docs/design/state_matrix.md in the same pull request — a block that will always read
   zero teaches the merchant to ignore that region of the screen.

3. Chart: monthly revenue and net profit as grouped bars over the last 12 months, using
   recharts. Must be readable at 375px -- rotate labels, abbreviate months, and drop
   gridlines rather than shrinking text below 11px.

4. RECONCILIATION TEST: the sum of daily_financials rows over a range must equal the
   period-comparison figures for that same range exactly, in integer satang. Any divergence
   means one of the two aggregations is wrong and the test must fail loudly.
```

---

### 7.8 Reporting Query Performance and Indexing

| Field | Detail |
|---|---|
| **WBS Code** | 7.8 |
| **Type** | Work Package |
| **Requirement** | F27, F28, F29 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | None |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Make every report fast enough to be used, on a shared-CPU free-tier database with 500 MB RAM. The constraint is real and specific: the Supabase free instance has far less memory than a typical development machine, so a query plan that is instant locally can fall over in production. Every report query must be measured with `EXPLAIN ANALYZE` against a realistically sized dataset, not merely against the seed data.

**Deliverables**
- Index set covering every report query path
- A seeded performance fixture representing 6 months of a busy pilot store
- `EXPLAIN ANALYZE` results recorded per report query
- Pre-aggregation via `daily_financials` where live queries cannot meet budget

**Acceptance**
- **Every report renders within 2 seconds at p95 against the 6-month fixture on the free-tier instance**
- No report query performs a sequential scan on `orders` or `order_items`
- Query plans are recorded in the repository, with the dataset size stated
- Adding a new report requires adding its plan to the same document

**Associated Activities**
- Build the realistic performance fixture
- Measure every report query
- Add or adjust indexes
- Record plans and budgets

**▶️ Claude Code Prompt**
```
Optimise reporting query performance for Brew Ledger against the Supabase FREE tier.

HARD CONSTRAINT: the free instance is shared CPU with 500 MB RAM. A plan that is instant on
a developer laptop can fall over there. Measure against a realistic dataset, never against
seed data.

1. Build a performance fixture at packages/db/perf-seed.ts generating 6 months of a busy
   pilot store: ~60 orders/day, 2.3 lines per order, 25 menu items, 15 ingredients,
   ~180 purchase invoices. That is roughly 11,000 orders and 25,000 order_items -- enough to
   expose a bad plan, small enough to fit the free tier.

2. For each report query (7.1 dashboard, 7.5 daily P&L, 7.6 profit per dish, 7.7 period
   comparison), run EXPLAIN (ANALYZE, BUFFERS) and record the output at
   /docs/db/query_plans.md with: the query, the plan, the row count of the fixture, and the
   measured time. State the fixture size at the top of the file so a future reader knows what
   the numbers mean.

3. Add indexes as needed. Start from these and adjust based on actual plans:
     orders (store_id, created_at desc) where status in
       ('ACCEPTED','PREPARING','READY','COLLECTED')   -- partial, the reporting hot path
     order_items (order_id) include (menu_item_id, quantity, unit_price_snapshot_satang,
                                     unit_cost_snapshot_satang)  -- covering, avoids heap hits
     order_items (store_id, menu_item_id)
     daily_financials (store_id, business_date desc)
     stock_ledger (store_id, ingredient_id, created_at desc)
     ingredient_cost_history (ingredient_id, changed_at desc)
   Justify each index with the query it serves in a SQL comment. Do not add speculative
   indexes -- every index costs write throughput and disk, and disk is capped at 500 MB.

4. TARGET: every report under 2 seconds at p95 on the fixture. If a live query cannot meet
   it, move that metric into the nightly daily_aggregate (WBS 7.5) and read the
   pre-aggregated row instead -- but keep TODAY live, because a merchant checking today's
   numbers cannot wait for tonight's job.

5. Add a CI performance smoke test: run each report query against the fixture and fail the
   build if any exceeds 3 seconds, giving headroom below the 2-second target before it
   regresses into user-visible slowness.

6. Verify no report query produces a Seq Scan on orders or order_items in its plan. Assert
   this in the test by parsing the EXPLAIN output.
```

---
## Phase 8.0 — QA, Security Hardening and Deployment

> **This phase is a gate, not a formality.** Entry 8.5 is the audit that decides whether the build ships at all. Nothing in this phase may be marked complete on the basis of a manual check where an automated one is possible.

---

### 8.1 Unit and Integration Test Suite

| Field | Detail |
|---|---|
| **WBS Code** | 8.1 |
| **Type** | Work Package |
| **Requirement** | All |
| **Owner** | M1 (backend), M2 (frontend) |
| **Surface** | Both |
| **Red Line Touch** | RL-1, RL-2, RL-3 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Consolidate the tests written across the build into one suite that runs in CI and gates merges. Coverage targets are set by risk rather than uniformly: the money path, the costing path, and the isolation boundary need near-total coverage; a settings form does not. The suite must run against a real Postgres instance rather than mocks, because the most valuable guarantees in this system — RLS, constraints, triggers, atomic updates — exist in the database and a mock proves nothing about them.

**Deliverables**
- Vitest configuration across all packages with a shared setup
- Ephemeral Postgres per CI run via the Supabase CLI local stack
- Coverage thresholds enforced per package
- A test data factory producing valid domain fixtures

**Acceptance**
- **The money path (`payments`, webhook, refund) and the costing path have ≥ 90% line coverage**
- The full suite runs in under 10 minutes in CI
- **Database-backed tests run against a real Postgres, never a mock** — RLS, triggers, and constraints cannot be verified otherwise
- A failing test blocks merge
- The factory produces valid fixtures with one call per entity

**Associated Activities**
- Consolidate existing tests
- Set up the ephemeral database in CI
- Build the factory
- Set and enforce per-package thresholds

**▶️ Claude Code Prompt**
```
Consolidate the Brew Ledger test suite.

1. Vitest at the workspace root with per-package configs. Environments: jsdom for
   apps/*, node for packages/* and worker, and a dedicated integration project that boots
   the Supabase local stack.

2. DATABASE-BACKED TESTS RUN AGAINST REAL POSTGRES. In CI, start the Supabase local stack
   (supabase start), apply migrations, seed, run, then stop. Never mock the database for
   any test asserting RLS, a trigger, a check constraint, or an atomic update -- those
   guarantees live in Postgres and a mock proves nothing about them. Add a comment saying so
   in the integration config.

3. packages/shared/src/testing/factory.ts -- a fixture factory with one call per entity:
     makeMerchant(), makeStore(), makeMenuItem({ withBom: false }), makeIngredient(),
     makeSlot(), makeOrder({ paid: true, channel: 'online' }), makePurchaseInvoice()
   Defaults must produce a VALID domain object. makeMenuItem must default to withBom:false,
   so the RL-2 zero-BOM case is the path of least resistance in every test a developer writes.

4. Coverage thresholds by risk, enforced in CI:
     packages/costing            90% lines   (cost errors are silent and compounding)
     supabase/functions/webhook* 90% lines   (money path)
     supabase/functions/public-* 85% lines   (RL-3 surface)
     packages/db                 80% lines
     apps/*                      60% lines   (UI, lower value per test)
   Fail the build below threshold.

5. Ensure these already-specified tests are wired into the suite and named consistently:
   schema introspection (3.5), RLS adversarial (3.6), serializer snapshots (3.7),
   tenant isolation (4.2), slot concurrency (5.3), webhook idempotency (5.6),
   lifecycle transitions (5.7), cost null-propagation (6.9), P&L reconciliation (7.5).

6. Target: full suite under 10 minutes in CI. Parallelise by project. If the integration
   project dominates, shard it by phase rather than trimming assertions.
```

---

### 8.2 End-to-End Test — Order to Report

| Field | Detail |
|---|---|
| **WBS Code** | 8.2 |
| **Type** | Work Package |
| **Requirement** | All |
| **Owner** | M2 |
| **Surface** | Both |
| **Red Line Touch** | RL-2 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Prove the whole product works as one thing, across both surfaces, in a browser. Two complete journeys must pass: a fully tracked store with recipes and bills, and — equally important — a zero-BOM store that never enters a recipe. The second journey is the RL-2 acceptance test at system level, and it is the journey most pilot merchants will actually walk.

**Deliverables**
- Playwright suite covering both journeys end to end
- Gateway sandbox stubbed deterministically at the network boundary
- Mobile viewport as the default projection
- CI execution on every PR with trace artefacts on failure

**Acceptance**
- **Journey A (tracked)**: publish store → customer orders → pays → merchant sees order → status to collected → bill scanned and confirmed → P&L and profit-per-dish show correct figures
- **Journey B (zero-BOM)**: publish store → customer orders → pays → merchant fulfils → dashboard and P&L render with costs as `—`, with no error, no prompt, and no blocked action anywhere (RL-2)
- Both run at 375 px viewport
- A failing E2E blocks merge and uploads a trace

**Associated Activities**
- Write both journeys
- Stub the gateway at the network layer
- Wire into CI with artefact upload
- Keep the suite under 5 minutes

**▶️ Claude Code Prompt**
```
Build the Brew Ledger end-to-end suite with Playwright at e2e/.

Default projection: Pixel 5 viewport (393x851). This product is used on a phone; a desktop
run is the exception, not the baseline.

Stub the payment gateway at the NETWORK layer with page.route, intercepting the charge
creation call and then POSTing a correctly signed webhook to the local Edge Function. Do not
stub application code -- the point is to exercise the real webhook handler including its
signature verification and idempotency.

JOURNEY A -- fully tracked store:
 1. Merchant signs in (stub the OTP in the test environment via a fixed test code)
 2. Creates a store, publishes it
 3. Adds 3 menu items WITH recipes, and 3 ingredients with costs via a confirmed bill
 4. Customer (new incognito context) opens /s/{slug}, adds 2 items with options,
    picks a slot, enters name and phone, reaches the QR screen
 5. Test fires the stubbed webhook
 6. Customer tracking page flips to ACCEPTED within 5s
 7. Merchant inbox shows the order within 10s; merchant advances PREPARING -> READY ->
    COLLECTED; the customer page follows each step
 8. Merchant captures a bill (upload a fixture image), reviews, confirms
 9. Assert: dashboard revenue matches, P&L reconciles exactly, profit-per-dish ranks by
    profit contribution, stock decreased by the recipe quantities

JOURNEY B -- zero-BOM store (this is the RL-2 system-level acceptance test):
 1. Merchant signs in, creates a store, publishes
 2. Adds 3 menu items with ONLY name and price -- the test must never open the recipe block
 3. Customer orders and pays exactly as above
 4. Merchant fulfils
 5. ASSERT, and these assertions are the point of the journey:
    - no error, no toast, no banner, no badge anywhere in the merchant flow
    - dashboard renders: revenue and order count present, profit shows "—"
    - P&L renders with the untracked disclosure block and does NOT show 0 for cost
    - profit-per-dish lists the items in the untracked section with "—"
    - a full-text scan of every merchant page visited finds none of:
      ยังไม่ได้ใส่, ควรใส่, กรุณาใส่สูตร, ไม่ครบ, ยังขาด
    - no page presented a blocked action or a required-field error related to recipes

CI: run on every PR, upload trace and video on failure, keep total runtime under 5 minutes.
```

---

### 8.3 Webhook Reliability Test Harness

| Field | Detail |
|---|---|
| **WBS Code** | 8.3 |
| **Type** | Work Package |
| **Requirement** | F05 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-1 |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Attack the payment webhook the way a real gateway does on a bad day: duplicates, retries, out-of-order events, malformed bodies, and bursts. Every one of these has a plausible real-world cause and each is capable of corrupting revenue silently. This harness is what turns "we believe it is idempotent" into evidence.

**Deliverables**
- Harness replaying captured and synthetic payloads under adverse conditions
- Scenarios: duplicate, concurrent duplicate, out-of-order, malformed, wrong signature, burst
- Assertions on final database state after each scenario
- A report of results committed for the 8.5 audit

**Acceptance**
- **Every scenario ends with exactly one order transition, one stock deduction set, one notification, and one revenue row**
- A burst of 100 webhooks across 20 orders completes with a fully correct final state
- Malformed and wrongly signed bodies are rejected and dead-lettered, never partially processed
- Results are committed as evidence and referenced in the red line register

**Associated Activities**
- Build the harness and scenario set
- Capture real sandbox payload shapes
- Run and record results
- Attach evidence to the register

**▶️ Claude Code Prompt**
```
Build the webhook reliability harness for Brew Ledger at
supabase/functions/_tests/webhook_harness.ts.

Every scenario below has a plausible real-world cause and each can silently corrupt revenue.
Run all of them against a REAL local database.

Scenarios, each asserting the FINAL DATABASE STATE, not just the HTTP response:

1. DUPLICATE: the same charge.complete delivered 5 times sequentially.
   Assert exactly 1 order transition, 1 set of stock_ledger rows, 1 push_notify job,
   1 payments row with status succeeded.

2. CONCURRENT DUPLICATE: 10 deliveries of the identical payload fired with Promise.all.
   Assert the same as above. This is the case a check-then-act implementation fails.

3. OUT OF ORDER: charge.refunded arrives BEFORE charge.complete for the same charge.
   Assert no status corruption and a coherent final state once both are processed.

4. MALFORMED BODY: truncated JSON, empty body, and a valid JSON body with unexpected shape.
   Assert 4xx and a dead_letter row for each, and that no partial processing occurred.

5. WRONG SIGNATURE: a valid payload signed with the wrong key. Assert 401, a dead-letter
   row, and zero database mutation.

6. UNKNOWN CHARGE: a well-formed event for a charge id that does not exist.
   Assert HTTP 200 (a 500 makes the gateway retry forever), a dead-letter row, no exception
   surfaced.

7. BURST: 100 webhooks across 20 distinct orders delivered in random order with random
   duplicates mixed in. Assert every one of the 20 orders ends ACCEPTED exactly once, total
   stock movement equals the expected sum, and exactly 20 notification jobs exist.

8. LATE DUPLICATE: a duplicate arriving 24 hours after the original (simulate by
   backdating). Assert it is still recognised as a duplicate -- the idempotency key must not
   be time-scoped.

Output a markdown report to /docs/audits/webhook_reliability.md with a row per scenario:
scenario | deliveries | expected final state | actual | pass/fail | run date.
This file is evidence for the WBS 8.5 audit and is referenced from the red line register.
```

---

### 8.4 Data Isolation Penetration Test (RL-3)

| Field | Detail |
|---|---|
| **WBS Code** | 8.4 |
| **Type** | Work Package |
| **Requirement** | RL-3 |
| **Owner** | M1 (author), M2 (peer review) |
| **Surface** | Both |
| **Red Line Touch** | **RL-3** |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Attack the Customer Web surface as an adversary would and prove that no merchant cost, margin, or aggregate data is reachable by any route. On this stack the attack surface is wider than on the original GCP plan, because the browser holds an `anon` key that speaks directly to Postgres through PostgREST — so the test must include direct database probing with that key, not merely HTTP responses from the app. This suite runs on every build and blocks deployment on any failure.

**Deliverables**
- Ten-class adversarial suite covering every reachable vector
- Direct PostgREST probing with the public `anon` key
- Bundle and DOM scanning against the forbidden-field list
- Machine-readable results feeding the 8.5 audit

**Acceptance**
- **All ten attack classes fail to retrieve any restricted field**
- The suite runs on every build and blocks deploy on any failure
- Results are recorded per attack class with evidence
- A deliberately planted leak is caught by the suite — the suite itself is verified

**Associated Activities**
- Implement all ten classes
- Verify the suite by planting and detecting a leak
- Wire as a deploy gate
- Record results for the audit

**▶️ Claude Code Prompt**
```
Build the RL-3 data isolation penetration suite for Brew Ledger at
e2e/isolation/rl3.spec.ts. This runs on EVERY build and blocks deployment on any failure.

STACK-SPECIFIC WARNING to encode as a comment: the Customer Web bundle ships a Supabase anon
key that speaks directly to Postgres via PostgREST. The attack surface therefore includes the
database itself, not only the app's HTTP responses. Several classes below probe PostgREST
directly with that key.

Fixture: two merchants A and B, each with a published store, menus WITH recipes and costs,
confirmed purchase bills, stock, and completed orders. The restricted values are therefore
real and present in the database -- a passing test must mean "not reachable", never "not
there".

Ten attack classes, each asserting ZERO restricted data returned:

1.  DIRECT POSTGREST TABLE READ with the anon key against every restricted table:
    ingredients, bom_lines, purchase_invoices, purchase_line_items, stock_ledger,
    daily_financials, payments, merchants, job_queue, ingredient_cost_history,
    menu_item_cost_cache, order_status_history. Assert zero rows for each, and separately
    assert with a service_role client that rows DO exist in the same fixture.
2.  POSTGREST COLUMN SELECTION: request restricted columns explicitly on permitted tables,
    e.g. select=id,cost_satang on menu_items. Assert error or omission, never a value.
3.  POSTGREST EMBEDDED RESOURCE: attempt relational embedding to reach restricted data,
    e.g. menu_items?select=*,bom_lines(*) and orders?select=*,order_items(*).
    Assert no restricted rows come back through the join.
4.  RPC PROBING: call every exposed RPC with the anon key, including public_order_status and
    public_order_lookup, and assert no returned field name matches
    /cost|margin|profit|fee|expense|stock|supplier/.
5.  URL AND ID GUESSING: fetch another store's order codes, invoice ids, and ingredient ids
    directly through every public route and RPC. Assert 404 or empty, never data.
6.  CLIENT BUNDLE SCAN: fetch every JS chunk of the built apps/shop and grep for the
    substrings in /docs/design/forbidden_fields.json plus 'service_role'. Assert zero hits.
7.  SSR PAYLOAD SCAN: parse __NEXT_DATA__ and any inline script JSON on every Customer Web
    route and assert no restricted key is present anywhere in the tree, at any depth.
8.  DOM AND ATTRIBUTE SCAN: after full hydration on every Customer Web route, scan the DOM
    including data-* attributes, aria labels, title attributes, and HTML comments for
    restricted values from the fixture (use the actual fixture numbers as needles).
9.  NETWORK CAPTURE: record every response body on a full customer journey (browse -> order
    -> pay -> track) and assert none contains a restricted field or a fixture cost value.
10. STORAGE ACCESS: attempt to read a bills-bucket object by constructed URL as anon, and
    attempt to mint a signed URL for merchant B's bill as merchant A. Assert both fail.

SELF-VERIFICATION -- required. Add a script that temporarily plants a leak (adds a cost field
to one public serializer) and asserts the suite CATCHES it, then reverts. A penetration suite
that has never caught anything is not known to work. Run it as part of the suite setup and
document the result.

Output /docs/audits/rl3_isolation.md: attack class | method | expected | actual | pass/fail |
run date. This is the evidence the WBS 8.5 audit and the red line register reference.
```

---

### 8.5 Red Line Compliance Audit

| Field | Detail |
|---|---|
| **WBS Code** | 8.5 |
| **Type** | Work Package |
| **Requirement** | RL-1, RL-2, RL-3 |
| **Owner** | M1 (audit), M2 (peer sign-off) |
| **Surface** | Both |
| **Red Line Touch** | **RL-1, RL-2, RL-3** |
| **Automation** | ▶️ Claude Code (report assembly) + human sign-off |

**Scope / Statement of Work**
Conduct the formal audit that decides whether the build may ship. It reads the register from 1.6 and requires, for every red line row, a named automated test with a passing result. Assertions of belief are not accepted. This is deliberately the last gate before deployment because the three red lines are the constraints whose violation cannot be fixed after the fact — a regulatory reclassification, a lost pilot store, or leaked merchant cost data are all irreversible in a way that a bug is not.

**Deliverables**
- `/docs/audits/red_line_audit.md` with per-red-line findings and evidence links
- Verification that every register row has a passing named test
- Structural verification of RL-1 by schema introspection
- Written sign-off from both members
- A pass/fail verdict gating deployment

**Acceptance**
- **Every register row cites a named automated test and its passing result — no row is verified by inspection alone**
- **RL-1: schema contains no balance/escrow/float/wallet/payout table, no bank-detail column, and every payment row's settlement destination is the merchant's own account**
- **RL-2: a zero-BOM store completes the full journey with no prompt, block, or nag — evidenced by the 8.2 Journey B trace**
- **RL-3: all ten 8.4 attack classes pass, and the suite is self-verified**
- Both members sign; a FAIL verdict blocks deployment with no override path

**Associated Activities**
- Assemble evidence from 8.1–8.4
- Run the structural checks
- Write findings including any exception with its justification
- Obtain both signatures

**▶️ Claude Code Prompt**
```
Assemble the Red Line Compliance Audit for Brew Ledger at
/docs/audits/red_line_audit.md.

This audit decides whether the build ships. Its standard of evidence is a NAMED AUTOMATED
TEST WITH A PASSING RESULT. Statements of belief, code review notes, and manual checks are
not evidence and must be reported as gaps.

Read /docs/red_line_register.md and, for every row, resolve its evidence link to an actual
test name and its latest result. Emit:

SECTION 1 -- RL-1: payments settle directly to the merchant.
  Run and report these structural checks:
  a. schema introspection: no table matching /balance|escrow|float|wallet|payout|
     ledger_account/  (from WBS 3.5 test)
  b. schema introspection: no column matching /bank_account|account_number|account_name|
     swift|iban|branch/  (from WBS 3.9 test)
  c. static analysis: no EMVCo payload construction outside packages/shared/src/promptpay/
     (from WBS 5.5 CI rule)
  d. data check: every payments row has a payee_alias equal to its store's promptpay_id
  e. decoded-payload evidence: a sample of generated payloads decoded, with tag 29 showing
     the merchant's own alias, plus the forbidden-payee scan result (WBS 5.5)
  f. real-device evidence: a generated QR scanned in a Thai banking app showing the merchant
     as payee
  g. WBS 4.8: no fee-bearing or fee-attribution column remains anywhere

SECTION 2 -- RL-2: no forced BOM.
  a. WBS 8.2 Journey B passed -- link the trace
  b. string audit across all merchant surfaces found none of the forbidden Thai phrases
  c. cost is null and never 0 for untracked items, per WBS 6.9 unit tests
  d. reports disclose untracked items rather than counting them as zero (WBS 7.5, 7.6)
  e. no feature gate is satisfiable only by entering a BOM (WBS 4.7 test)

SECTION 3 -- RL-3: absolute customer/merchant isolation.
  a. all ten WBS 8.4 attack classes passed -- table them individually
  b. the 8.4 suite self-verification caught a planted leak
  c. every table in public has RLS enabled (WBS 3.6 introspection test)
  d. no public serializer spreads a database row (WBS 3.7 lint rule)
  e. bundle and SSR payload scans clean (WBS 3.4 script, 8.4 classes 6 and 7)

SECTION 4 -- Gaps and exceptions.
  Any row lacking automated evidence is listed here as a GAP with an owner and a target date.
  An exception may only be recorded with a written justification and both members' initials.

SECTION 5 -- Verdict: PASS / FAIL, with sign-off lines for M1 and M2 and the audit date.
  State in bold: a FAIL verdict blocks deployment and there is no override path. A red line
  violation is not a bug to fix after launch -- regulatory reclassification, a lost pilot
  store, and leaked merchant cost data are all irreversible in a way an ordinary defect
  is not.

Do not mark anything PASS that you cannot link to a passing named test. If evidence is
missing, say so plainly in Section 4.
```

---
### 8.6 Cross-browser and Device Matrix

| Field | Detail |
|---|---|
| **WBS Code** | 8.6 |
| **Type** | Work Package |
| **Requirement** | All UI features |
| **Owner** | M2 |
| **Surface** | Both |
| **Red Line Touch** | None |
| **Automation** | 🔴 Manual (real devices) + ▶️ Claude Code (matrix + automated slice) |

**Scope / Statement of Work**
Verify both surfaces on the devices the users actually hold. Two things cannot be verified in an emulator and must be tested on real hardware: iOS Safari Web Push behaviour, which is the known weak point of the notification design, and camera capture of a real receipt, where autofocus and exposure on a low-end sensor determine whether OCR gets a usable image at all. The customer side matters more than the merchant side here, because the customer has no support channel and no reason to persist.

**Deliverables**
- A device matrix covering the realistic Thai market spread
- Automated Playwright runs across Chromium, WebKit, and Firefox projections
- Manual real-device verification of push and camera
- Recorded results with issues raised per device

**Acceptance**
- **Both critical journeys complete on real Android Chrome and real iOS Safari**
- **Web Push verified on real hardware for both grant and deny paths, with the deny path still showing new orders within 10 seconds (5.8)**
- Camera capture produces an OCR-usable image on a low-end Android
- No blocking issue remains open on any device in the matrix
- The matrix records OS and browser versions actually tested, not aspirations

**Associated Activities**
- Define the matrix from realistic market share
- Run the automated slice in CI
- Perform the manual device passes
- Record and triage findings

**🔴 [Manual Action Required] — Real-device testing**

```
⚠️  MANUAL ACTION REQUIRED — WBS 8.6
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

**ขั้นตอนที่ต้องทำเอง:**
1. **เตรียมเครื่องจริงอย่างน้อย 3 เครื่อง** (ยืมจากเพื่อนในทีม/เพื่อนร่วมชั้นได้ ไม่ต้องซื้อ):
   - Android ราคาประหยัด (เช่น Samsung A-series หรือ Redmi) + Chrome ← **สำคัญที่สุด เพราะเป็นเครื่องที่ลูกค้าร้านกาแฟส่วนใหญ่ใช้จริง**
   - iPhone รุ่นใดก็ได้ที่ยังอัปเดต iOS ได้ + Safari
   - Android หรือ iPhone รุ่นใหม่กว่า เป็นตัวเทียบ
2. **ทดสอบฝั่งลูกค้า** บนทุกเครื่อง: เปิดลิงก์ร้าน → เลือกเมนู → เลือกช่วงเวลา → ใส่ชื่อ → ถึงหน้า QR → เปิดหน้า track
   - จับเวลาว่าหน้าเมนูโหลดกี่วินาทีบนเน็ตมือถือจริง (ไม่ใช่ WiFi)
   - ดูว่าตัวอักษรไทยตัดคำถูกต้องไหม สระบน-ล่างโดนตัดหรือเปล่า
3. **ทดสอบ Web Push บนเครื่องจริง** (ข้อนี้ทดสอบใน emulator ไม่ได้เด็ดขาด):
   - **Android + Chrome**: กดอนุญาตแจ้งเตือน → ปิดแท็บ → ให้เพื่อนสั่งออเดอร์ → ต้องเด้งภายใน 10 วินาที
   - **iPhone + Safari**: ต้องกด **แชร์ → เพิ่มไปยังหน้าจอโฮม** ก่อน ถึงจะขออนุญาตได้ (ข้อจำกัดของ iOS)
   - **ทดสอบกรณีปฏิเสธด้วย**: กด "ไม่อนุญาต" แล้วเปิดแท็บ console ค้างไว้ → สั่งออเดอร์ → **ต้องเห็นออเดอร์ใหม่ภายใน 10 วินาที** ผ่านระบบ polling ถ้าไม่เห็นคือ fallback พัง ต้องแก้
4. **ทดสอบกล้องถ่ายบิลบนเครื่องราคาประหยัด**: ถ่ายบิลซื้อของจริงที่ยับ/ซีดจาง ใต้แสงหลอดฟลูออเรสเซนต์ → ดูว่ารูปที่ได้ชัดพอให้ OCR อ่านได้ไหม
   - ถ้าเบลอบ่อยบนเครื่องราคาประหยัด ให้กลับไปปรับคำแนะนำการถ่ายในข้อ 6.1
5. บันทึกผลทุกเครื่องลงในตารางใน `/docs/qa/device_matrix.md` โดยระบุ **รุ่นเครื่อง เวอร์ชัน OS และเวอร์ชันเบราว์เซอร์จริง** ที่ทดสอบ (ห้ามเขียนว่า "Android ทั่วไป")

**▶️ Claude Code Prompt**
```
Set up cross-browser testing for Brew Ledger.

1. Extend the Playwright config with projects covering: Chromium desktop, WebKit desktop,
   Firefox desktop, Pixel 5 (Chromium mobile), iPhone 13 (WebKit mobile).
   Run BOTH critical journeys from WBS 8.2 across all five projections in CI.
   Note in a comment that WebKit-in-Playwright is not Safari-on-iOS: it catches layout and
   API-shape issues but proves nothing about push delivery or camera hardware, which is why
   WBS 8.6 has a mandatory manual half.

2. Create /docs/qa/device_matrix.md with a table to be filled by the human tester:
   Device | OS version | Browser version | Customer journey | Merchant journey |
   Push granted | Push denied fallback | Camera capture usable | Thai text rendering | Notes

   Pre-populate the device rows with the realistic Thai market spread:
     Budget Android (Samsung A-series / Redmi) + Chrome    <- most important row
     iPhone (any currently-supported iOS) + Safari
     Mid/high-end Android + Chrome
     Desktop Chrome (merchant occasionally uses a laptop)

   Add an instruction block at the top stating that OS and browser VERSIONS must be recorded
   as actually observed, never as a category, because a bug report against
   "Android" is not actionable.

3. Add a visual regression check: Playwright screenshots of the Customer Web menu, checkout,
   and QR screens at 375px in both Chromium and WebKit, compared against committed baselines
   with a small pixel tolerance. Thai diacritic clipping is a rendering bug that unit tests
   cannot catch and that a screenshot diff catches immediately.

4. Add a CI job running the five-projection suite on every PR, with traces uploaded on
   failure.
```

---

### 8.7 Manual Test Plan and Bug Bash

| Field | Detail |
|---|---|
| **WBS Code** | 8.7 |
| **Type** | Work Package |
| **Requirement** | All |
| **Owner** | M2 (plan), all execute |
| **Surface** | Both |
| **Red Line Touch** | RL-2 |
| **Automation** | ▶️ Claude Code (plan generation) + 🔴 Manual (execution) |

**Scope / Statement of Work**
Run a structured manual pass over the paths automation does not reach: real money in sandbox, real photographs, real Thai text entered by a person, and the judgement calls that only a human notices — copy that feels wrong, a state that is technically correct but confusing, a flow that works but feels slow. The bug bash is deliberately scheduled after the automated suites pass, so the team's attention goes to what only humans can find.

**Deliverables**
- `/docs/qa/manual_test_plan.md` — checklist by feature with expected results
- A bug bash session with both members, timeboxed
- Issue log with severity, owner, and target fix
- Regression checklist for release

**Acceptance**
- Every MVP feature F01–F29 has at least one manual test case
- The bug bash covers both surfaces and both journeys
- Every blocking and major issue has an owner and a decision before deployment
- The plan includes the awkward cases automation skips: bad handwriting on a bill, a very long Thai menu name, a customer paying the wrong amount

**Associated Activities**
- Write the plan from the feature index
- Schedule and run the bash
- Triage and assign
- Convert repeatable findings into automated tests

**▶️ Claude Code Prompt**
```
Create /docs/qa/manual_test_plan.md for Brew Ledger.

Generate one section per MVP feature F01-F29 by reading the Requirement Index in
/docs/wbs_dictionary.md. Each case: ID | Precondition | Steps | Expected result |
Pass/Fail | Notes.

Then add a section titled "Cases automation cannot reach" containing at minimum:

  - A bill photographed with genuinely bad handwriting; verify the review screen makes
    correction fast rather than merely possible
  - A menu item with a very long Thai name (40+ characters) on the customer menu, the cart,
    the QR screen, and the merchant order card -- check truncation and diacritic clipping
  - A customer who transfers a DIFFERENT amount than the QR requested
  - A customer who pays after the QR expired
  - Two customers taking the last slot within the same second (two phones, one person
    counting down)
  - The merchant losing connectivity mid-service and regaining it
  - A bill in a currency or format the parser has never seen
  - The first bill scan of the day, verifying the Render cold-start copy is honest and not
    alarming
  - A merchant who never opens the recipe block, walking the ENTIRE product and confirming
    nothing anywhere implies they are incomplete (RL-2 judgement check -- automation checks
    strings, a human checks feel)
  - Reading the dashboard in direct sunlight on a phone at maximum brightness

Add a bug bash protocol section: 90 minutes timeboxed, both members, one takes Customer Web
and one takes Owner Console then swap after 45 minutes, all findings logged immediately
without stopping to fix. Include an issue log table: ID | Surface | Severity
(blocking/major/minor) | Description | Owner | Decision (fix now / fix later / accept) |
Target WBS entry.

Add a release regression checklist: the short list to re-run before any deployment.
```

---

### 8.8 Staging and Production Deployment Pipeline

| Field | Detail |
|---|---|
| **WBS Code** | 8.8 |
| **Type** | Work Package |
| **Requirement** | Foundation |
| **Owner** | M1 |
| **Surface** | Both |
| **Red Line Touch** | RL-1 (gateway mode), RL-3 (isolation gate) |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Define how code reaches production and what must be true before it does. The free tier shapes this: two Supabase projects means `dev` doubles as staging, so migrations must be verified there and be safe to re-run. Two gates are absolute — the 8.4 isolation suite must pass, and the gateway mode must match the environment, because a production deployment pointed at a sandbox key silently fails to take real money while appearing to work.

**Deliverables**
- Deployment workflow: migrations → Edge Functions → worker → both Vercel apps
- Pre-deploy gates: full test suite, 8.4 isolation suite, gateway mode assertion
- Migration safety rules and a rollback procedure
- Post-deploy smoke test against production
- `/docs/ops/deployment.md` runbook

**Acceptance**
- **Deployment is blocked if the 8.4 isolation suite fails (RL-3)**
- **A production deploy pointed at gateway sandbox mode is refused at startup (RL-1, 3.9)**
- Migrations are applied to `dev` and verified before production
- A post-deploy smoke test exercises a real order path and fails loudly
- Rollback is documented and has been rehearsed once

**Associated Activities**
- Build the deployment workflow with gates
- Write migration safety rules
- Implement the smoke test
- Rehearse a rollback

**▶️ Claude Code Prompt**
```
Build the deployment pipeline for Brew Ledger at .github/workflows/deploy.yml.

Environments, shaped by the free tier: brewledger-dev doubles as staging (the free plan
allows only two active Supabase projects), brewledger-prod is production.

Pipeline on push to main, in strict order, each step gating the next:
 1. Full test suite (WBS 8.1)
 2. E2E both journeys (WBS 8.2)
 3. RL-3 isolation suite (WBS 8.4)  <- HARD GATE, a failure blocks deployment entirely
 4. Bundle scan for forbidden fields and service_role (WBS 3.4 script)
 5. Apply migrations to prod via the Supabase CLI
 6. Deploy Edge Functions
 7. Render deploys the worker automatically on push; wait for its /healthz to return the
    new commit SHA before continuing
 8. Vercel deploys both apps automatically; wait for both to report ready
 9. Post-deploy smoke test (below)

MIGRATION SAFETY RULES -- document and enforce in review:
  - migrations must be additive within a release; never drop a column in the same deploy
    that stops writing it
  - every migration must be re-runnable without error (guard with IF NOT EXISTS / ON
    CONFLICT DO NOTHING)
  - a migration that rewrites existing rows must be tested against the WBS 7.8 perf fixture
    for duration, because the free instance is small and a long lock during service hours
    takes the store offline
  - always confirm the WBS 3.10 backup ran successfully within the last 24 hours before
    applying a migration; abort the deploy if not

PROMPTPAY PAYEE GATE (RL-1): before deploying, run the WBS 5.5 forbidden-payee test against
the built artefacts and fail the deploy on any hit. The equivalent of the old gateway-mode
hazard in this architecture is a payload that pays anyone other than the merchant, and it
must be impossible to ship.

POST-DEPLOY SMOKE TEST (scripts/smoke.mjs) against production:
  - GET the demo store page, assert 200 and that the menu renders
  - assert the worker /healthz returns the expected commit SHA
  - create an order on the demo store through the real API, assert it reaches
    PENDING_PAYMENT, then cancel it
  - assert the anon key cannot read the ingredients table (a live RL-3 canary)
  - generate a PromptPay payload for the demo store, decode it, and assert the payee is the
    demo store's own alias (a live RL-1 canary)
  On any failure: post to ALERT_WEBHOOK_URL and mark the deployment failed.

ROLLBACK: document in /docs/ops/deployment.md -- Vercel instant rollback to the previous
deployment, Render rollback to the previous deploy, and for the database, forward-fix only
with the restore path from WBS 3.10 as the last resort. State plainly that database
rollback is NOT a routine option on this stack, which is why migrations must be additive.
Rehearse the app-layer rollback once and record the date.
```

---

### 8.9 Pilot Onboarding Runbook and Support Playbook

| Field | Detail |
|---|---|
| **WBS Code** | 8.9 |
| **Type** | Work Package |
| **Requirement** | Project deliverable |
| **Owner** | M1 |
| **Surface** | Both |
| **Red Line Touch** | RL-1 (store eligibility) |
| **Automation** | ▶️ Claude Code |

**Scope / Statement of Work**
Write what the team does when a real cafe joins the pilot, and what it does when something breaks at 07:45 on a Tuesday. The onboarding runbook must front-load the gateway eligibility check, because discovering after installation that a store cannot be paid is the worst possible first experience. The support playbook must be written for the failure modes this stack actually has — a paused project, a cold worker, an exhausted OCR quota — in language the team can act on under pressure.

**Deliverables**
- `/docs/ops/pilot_runbook.md` — pre-screen, onboarding session script, day-1 checks
- `/docs/ops/support_playbook.md` — symptom → diagnosis → action for each known failure
- A merchant-facing quick start in Thai, one page
- Escalation path with response time expectations

**Acceptance**
- **Gateway eligibility is checked and recorded before any onboarding session is scheduled (RL-1, 4.5)**
- The onboarding session script fits the 15-minute target from 2.7
- The playbook covers every free-tier failure mode from 3.10 with a concrete action
- The merchant quick start is one page, in Thai, with no jargon
- The escalation path names who does what and by when

**Associated Activities**
- Write the runbook and playbook
- Write and review the Thai quick start with a non-technical reader
- Dry-run the onboarding script once
- Record response time expectations

**▶️ Claude Code Prompt**
```
Create the pilot operations documents for Brew Ledger.

1. /docs/ops/pilot_runbook.md

   PRE-SCREEN (before scheduling anything) -- the gateway eligibility questions from
   WBS 4.5. A store that cannot be paid must never be onboarded and then discovered.
   Record answers in /docs/ops/pilot_stores.md.

   ONBOARDING SESSION SCRIPT, timeboxed to 15 minutes on the merchant's own phone:
     0-2   what this is, in two sentences, and what it is not
     2-5   phone OTP sign-in, store profile
     5-9   add their three best-selling drinks with prices
           EXPLICIT INSTRUCTION TO THE FACILITATOR: do not mention recipes, ingredients,
           or costs during onboarding. If the merchant asks, say it is optional and can be
           done any time. RL-2 is an onboarding discipline, not only a UI rule.
     9-12  publish, print the QR, place it on the counter
     12-15 show the order inbox and the notification sound; take one test order together
   Include a "what to do if the gateway is not yet approved" branch: the store can publish
   and use cash sales immediately, and pre-order switches on when KYC clears.

   DAY-1, DAY-7, DAY-30 CHECKS: what the team verifies at each point, and the numbers to
   record for the WBS 1.7 go/no-go criteria.

2. /docs/ops/support_playbook.md -- symptom, diagnosis, action, escalation. Cover at minimum:

   "ลิงก์ร้านเปิดไม่ได้ / ขึ้นหน้าว่าง"
     -> check whether the Supabase project is PAUSED (WBS 3.10 keep-alive failure)
     -> restore from the dashboard, then verify the keep-alive workflow is running
   "สแกนบิลแล้วค้างนาน"
     -> Render worker cold start (30-60s) or OCR quota exhausted
     -> check the queue depth and ocr_usage for today; tell the merchant the honest ETA
        and point them to manual entry
   "ลูกค้าจ่ายเงินแล้วแต่ออเดอร์ไม่เข้า"
     -> check dead_letter_webhooks and the payments row; this is the highest-severity
        symptom in the product -- a customer has paid and the merchant does not know
     -> escalation: immediate, M1, whatever the hour
   "แจ้งเตือนออเดอร์ใหม่ไม่เด้ง"
     -> check push subscription validity and whether the merchant is on iOS without
        standalone mode; confirm the polling fallback is showing orders
   "ตัวเลขกำไรดูไม่ถูก"
     -> check untracked item count for that period; explain the disclosure rather than
        adjusting any number
   "ต้นทุนเปลี่ยนเองโดยไม่ได้แก้"
     -> a confirmed bill updated the ingredient cost; show ingredient_cost_history
   Add: how to read logs in Sentry by correlation id, how to check queue depth, and how to
   trigger a manual re-run of a failed job.

3. /docs/ops/merchant_quickstart_th.md -- ONE page, Thai, for the merchant to keep.
   No jargon, no English technical terms. Cover: how customers order, how to see new
   orders, how to update status, how to record a cash sale, how to scan a bill, and one
   line on where to get help. Write it so a person who has never used a business app can
   follow it alone.

4. An escalation table: severity | example | who responds | target response time |
   who is informed.
```

---

### 8.10 Handover Package and Demo

| Field | Detail |
|---|---|
| **WBS Code** | 8.10 |
| **Type** | Work Package |
| **Requirement** | Project deliverable |
| **Owner** | M1 (lead), all contribute |
| **Surface** | Both |
| **Red Line Touch** | RL-1, RL-2, RL-3 |
| **Automation** | ▶️ Claude Code (docs) + 🔴 Manual (recording) |

**Scope / Statement of Work**
Package what was built so it can be understood, judged, and continued: the running system, the documentation, the audit result, and a demonstration that shows the product doing the thing it claims. The demo must include the zero-BOM path, because that is the honest representation of what a real pilot merchant experiences and hiding it would misrepresent the product to the people evaluating it.

**Deliverables**
- Architecture and decision documentation consolidated and current
- API and schema reference generated from source
- A 3-minute demo video covering both journeys
- Credential handover checklist
- Known-issues list with severity and workaround

**Acceptance**
- A new developer can run the system locally from the README alone, verified by one member following it on a clean machine
- **The demo shows the zero-BOM journey, not only the fully configured one**
- Every architectural decision has an ADR
- The known-issues list is honest and includes the free-tier limitations verbatim from 1.7
- Credential handover is complete with no secret transmitted in plain text

**Associated Activities**
- Consolidate and refresh documentation
- Verify the clean-machine setup
- Record and edit the demo
- Complete the credential handover

**🔴 [Manual Action Required] — Demo recording and credential handover**

```
⚠️  MANUAL ACTION REQUIRED — WBS 8.10
This task cannot be automated. It requires a human to complete a signup,
dashboard configuration, identity verification, or credential generation step.
Follow the Thai instructions below, then return with the resulting values.
Do not proceed to dependent WBS entries until this is done.
```

**ขั้นตอนที่ต้องทำเอง:**
1. **อัดวิดีโอเดโม 3 นาที** — ใช้มือถือจริง 2 เครื่อง (เครื่องหนึ่งเป็นลูกค้า อีกเครื่องเป็นร้าน) อัดหน้าจอทั้งสองแล้วตัดต่อคู่กัน
   - 0:00-0:30 ปัญหา: เล่าเคสจริงว่าลูกค้าทักแชทสั่งล่วงหน้าแล้วออเดอร์ไม่เข้าระบบไหนเลย
   - 0:30-1:30 ฝั่งลูกค้า: สแกน QR → เลือกเมนู → เลือกเวลารับ → จ่ายผ่าน PromptPay → ดูสถานะ
   - 1:30-2:15 ฝั่งร้าน: ออเดอร์เด้งเข้า → กดเริ่มทำ → พร้อมรับ → สแกนบิลซื้อของ → ยืนยัน
   - 2:15-3:00 ผลลัพธ์: หน้า P&L รายวัน และหน้ากำไรต่อเมนู ชี้ให้เห็นว่าเมนูที่ขายดีที่สุดไม่ใช่เมนูที่กำไรสูงสุด
   > ⚠️ **ต้องมีช่วงที่แสดงร้านที่ไม่ได้ใส่สูตรด้วย** (สัก 15 วินาที) ให้เห็นว่าต้นทุนขึ้น "—" และระบบยังใช้งานได้ปกติ — นี่คือสิ่งที่ร้านนำร่องส่วนใหญ่จะเจอจริง การตัดออกคือการนำเสนอที่ไม่ตรงความจริง
2. **ส่งมอบ credential** — เปิดบัญชี password manager ของทีม (เช่น Bitwarden ฟรี) แล้วแชร์ vault ให้สมาชิกทุกคน
   - **ห้ามส่ง secret ผ่านแชท อีเมล หรือเอกสารที่แชร์ลิงก์เด็ดขาด**
   - รายการที่ต้องส่งมอบ: Supabase (2 โปรเจกต์), Render, Vercel (2 โปรเจกต์), GitHub, Sentry, Float16, payment gateway, Twilio, VAPID keys
   - ให้สมาชิกอีกคนล็อกอินเข้าทุกบริการหนึ่งครั้งเพื่อยืนยันว่าเข้าได้จริง แล้วติ๊กในเช็คลิสต์
3. **ทดสอบ setup บนเครื่องสะอาด** — ให้สมาชิกที่ไม่ได้เขียน README ลองทำตาม README บนเครื่องที่ยังไม่เคยลงโปรเจกต์นี้ ตั้งแต่ clone จนรันได้ จับเวลาและจดทุกจุดที่ติด แล้วแก้ README ตามนั้น

**▶️ Claude Code Prompt**
```
Assemble the Brew Ledger handover package.

1. Refresh the root README.md so a developer on a CLEAN MACHINE can go from clone to a
   running local system with no tribal knowledge. Include: prerequisites with versions,
   clone, pnpm install, supabase start, migrations, seed, env setup pointing at
   .env.example files, running each app and the worker, and running the tests.
   State the free-tier constraints up front so the reader is not surprised by a paused
   project or a cold worker.

2. Generate /docs/api/reference.md from the Edge Function sources: every endpoint, its
   scope (public vs console), auth requirement, request shape, response shape, and error
   codes. For every public endpoint, print its exact permitted field list and cross-link
   WBS 3.7 and the RL-3 rule.

3. Generate /docs/db/reference.md from the live schema: every table, column, type, index,
   RLS policy, and trigger, with the comments from the migrations included. Highlight the
   cost-snapshot design and the append-only ledger with their rationale.

4. Consolidate ADRs at /docs/adr/ -- ensure one exists for each of:
     001 infrastructure choice (already written in WBS 1.1)
     002 critical-path vs async-path workload split
     003 money as integer satang
     004 cost stored twice: current vs snapshot
     005 latest-purchase-price costing method
     006 RLS as primary RL-3 enforcement on Supabase
     007 licensed gateway rather than direct bank API for the PoC
   Each in Status / Context / Decision / Consequences form. Write any that are missing by
   reading the relevant WBS entries.

5. /docs/known_issues.md -- honest, with severity and workaround. Include verbatim the
   free-tier limitations from WBS 1.7: project pause, worker cold start, ~150 OCR
   pages/day, no vendor backups or SLA. Add every accepted issue from the WBS 8.7 bug bash.
   Do not soften anything: a pilot merchant who discovers a limitation alone loses more
   trust than one who was told.

6. /docs/handover_checklist.md -- credential handover checklist covering Supabase (2
   projects), Render, Vercel (2 projects), GitHub, Sentry, Float16, payment gateway,
   Twilio, and VAPID keys. One row per service with a "second member verified access"
   column. State that secrets move only through the team password manager, never chat or
   email.

7. /docs/demo_script.md -- the 3-minute demo script matching the manual recording steps,
   with the requirement stated in bold that the zero-BOM path must appear.
```

---

## Appendix A — Feature Coverage Map (F01–F29)

Every MVP feature maps to at least one implementing entry with exactly one accountable owner.

| ID | Feature | Implementing entries | Owner |
|---|---|---|---|
| F01 | Reach store via link or QR, no install or signup | 4.6, 5.1 | M2 |
| F02 | Menu listing with option groups | 4.4, 5.1, 5.2 | M2 |
| F03 | Pick-up time-slot selection | 5.3, 5.4 | M1 / M2 |
| F04 | PromptPay QR via licensed gateway | 4.5, 5.5 | M1 |
| F05 | Idempotent webhook payment confirmation | 5.6, 8.3 | M1 |
| F06 | Real-time / polled order status | 5.10 | M2 |
| F07 | Status lookup by phone and order code | 5.10 | M2 |
| F08 | Merchant phone OTP login | 4.1, 4.2 | M1 / M2 |
| F09 | Store profile and hours | 4.3 | M2 |
| F10 | Menu and price creation, no forced BOM | 4.4 | M2 |
| F11 | Gateway linking and KYC | 4.5 | M1 |
| F12 | Subscription tiers and fee absorption | 4.7, 4.8 | M2 / M1 |
| F13 | AI Brief | 7.2 | M2 / M1 |
| F14 | Dashboard summary | 7.1 | M2 |
| F15 | Cost Drift Alert | 7.4 | M1 |
| F16 | Low stock alert | 7.3 | M1 |
| F17 | New paid order notification | 5.8 | M2 / M1 |
| F18 | Per-slot quota and auto-close | 5.3 | M1 |
| F19 | Order status update propagation | 5.7, 5.9 | M1 / M2 |
| F20 | Cancel with automatic refund | 5.11 | M1 |
| F21 | Manual cash sale entry | 5.12 | M2 |
| F22 | Purchase entry with optional bill photo attachment | 3.8, 6.1 | M2 |
| F23 | ~~OCR extraction with confirm-or-edit~~ — **DEFERRED (2026-08-22).** 6.2/6.3 cut from the active build; 6.4 still provides the confirm-or-edit step, now on manually-typed fields. | 6.2, 6.3, 6.4 | M1 / M2 |
| F24 | Unit cost update and profit recompute | 6.6, 6.9 | M1 |
| F25 | Stock deduction with unit conversion | 6.5, 6.8 | M1 / M2 |
| F26 | Suggested BOM | 6.7 | M2 |
| F27 | Daily P&L | 7.5 | M2 |
| F28 | Profit per Dish | 7.6 | M2 |
| F29 | Period comparison and fee breakdown | 7.7 | M2 |

**Coverage check:** every feature F01–F29 has at least one implementing entry and exactly one accountable owner. Every feature is additionally mapped to a delivered prototype screen in `/docs/design/coverage.md` (2.1); the single known gap is documentation of the transaction ledger, tracked as GAP-1. No entry in this dictionary implements a feature outside F01–F29 or on the Phase 2 exclusion list.

---

## Appendix B — Red Line Enforcement Matrix

The full map from red line to enforcement point to verification evidence. This appendix is the source for the 1.6 register and the input to the 8.5 audit.

### RL-1 — Payments settle directly to the merchant

| Entry | Enforcement mechanism | Verification |
|---|---|---|
| 3.5 | Schema contains no platform balance, float, escrow, wallet, or payout table | Schema introspection test |
| 3.9 | No bank-detail column persisted; gateway mode asserted per environment at startup | Schema introspection test, startup assertion test |
| 4.5 | Only the merchant's own PromptPay alias is stored, and the merchant self-verifies it by scanning | Merchant verification record, schema review |
| 4.8 | No fee-bearing or fee-attribution column exists | Schema introspection test |
| 5.5 | Decoded payload's payee is `stores.promptpay_id`; forbidden-payee scan; payload building confined to one module | Decoded-payload tests, CI static analysis |
| 5.6 | `payee_alias` recorded on every payment row; confirmation moves no money | Integration test on payment rows |
| 5.11 | No code path moves money; the refund obligation is recorded and tracked to resolution | Pending-refund persistence test |
| 8.8 | Deploy refused if the forbidden-payee scan fails | Deploy gate |
| 8.5 | Formal audit with linked evidence | Signed audit document |

### RL-2 — No forced BOM before selling

| Entry | Enforcement mechanism | Verification |
|---|---|---|
| 3.5 | `bom_lines` optional with no NOT NULL dependency from `menu_items` | Migration and insert test |
| 4.3 | Onboarding progress excludes recipes entirely | UI test, copy audit |
| 4.4 | Only name and price required; recipe block collapsed and non-blocking | API test, UI test, string audit |
| 4.7 | No feature gate satisfiable only by entering a BOM | Feature flag test |
| 5.4, 5.12 | Cost snapshot is `null`, never `0`, when untracked | Unit test on both order paths |
| 6.5 | Ingredient creation never required to sell | Integration test on a zero-ingredient store |
| 6.7 | Suggested recipes offered, never demanded; no nagging copy | UI test, string audit |
| 6.8 | Orders without a BOM deduct nothing and raise nothing | Unit test |
| 6.9 | Cost is `null`, never `0`, when untracked | Unit test, UI manifest test |
| 7.1, 7.5, 7.6 | Untracked items excluded and disclosed, never counted as zero cost | Report reconciliation tests |
| 7.2, 7.3, 7.4 | Zero-BOM store produces no alerts and no empty alert UI | Unit tests |
| 8.2 | Journey B: full zero-BOM system run | E2E trace |
| 8.5 | Formal audit including a full zero-BOM selling run | Signed audit document |

### RL-3 — Absolute customer/merchant data isolation

| Entry | Enforcement mechanism | Verification |
|---|---|---|
| 2.2 | Per-route permitted-field allow-list and machine-readable forbidden list | Design review, CI scan input |
| 3.1 | Physical app separation with an import-boundary lint rule | CI failure on forbidden import |
| 3.2 | `service_role` client throws if imported into a browser bundle | Import-time guard, lint rule |
| 3.4 | Two separate Vercel projects; post-build bundle scan | Bundle scan script in CI |
| 3.6 | **RLS enabled on every table; four justified `anon` policies only** | Introspection test, adversarial anon suite |
| 3.7 | Allow-list public DTOs; construction never spreading entities | Lint rule, response snapshot tests |
| 3.8 | Bill images private with short-lived signed URLs only | Storage access tests |
| 3.11 | Log redaction; full-row logging prohibited | Redaction unit tests |
| 4.1, 4.2 | Disjoint auth scopes; console guarded by default | Route enumeration test, cross-tenant suite |
| 4.6 | QR encodes only the public URL, no enumerable identifier | Payload decode test |
| 5.1, 5.10 | Public responses, SSR payloads, and bundles scanned for restricted terms | Content scan in CI |
| 8.4 | **Ten-class adversarial isolation suite, self-verified, on every build** | Passing suite, blocks deploy |
| 8.8 | Deployment blocked on isolation suite failure | Deploy gate |
| 8.5 | Formal audit with per-attack evidence | Signed audit document |

---

## Appendix C — Surface Ownership Map

Which surface owns each screen, and which entry implements it. Use during bug triage to find the owner of a broken screen, and during the Phase 8 gate to confirm no screen is orphaned.

### Customer Web (`apps/shop`) — unauthenticated, Vercel project `brewledger-shop`

| Route | Screen | Entry | Owner |
|---|---|---|---|
| `/s/{slug}` | Store menu | 5.1 | M2 |
| `/s/{slug}` (sheet) | Item options | 5.2 | M2 |
| `/s/{slug}/cart` | Cart | 5.2 | M2 |
| `/s/{slug}/checkout` | Slot picker, name, phone, review | 5.3, 5.4 | M2 |
| `/s/{slug}/pay/{code}` | PromptPay QR and countdown | 5.5 | M1 |
| `/o/{code}` | Order tracking | 5.10 | M2 |
| `/track` | Lookup by phone + code | 5.10 | M2 |

### Owner Console (`apps/console`) — OTP authenticated, Vercel project `brewledger-console`

| Route | Screen | Entry | Owner |
|---|---|---|---|
| `/console/login` | Phone and OTP | 4.1 | M1 |
| `/console` | Dashboard, AI Brief, alerts | 7.1, 7.2, 7.3, 7.4 | M2 |
| `/console/orders` | Order inbox | 5.8, 5.9 | M2 |
| `/console/orders/{id}` | Order detail, status, cancel | 5.9, 5.11 | M2 / M1 |
| `/console/sales/quick` | Cash sale entry | 5.12 | M2 |
| `/console/menu` | Menu list | 4.4 | M2 |
| `/console/menu/{id}` | Item editor + optional recipe block | 4.4, 6.7 | M2 |
| `/console/expenses/capture` | Purchase entry (manual, optional photo) | 6.1 | M2 |
| `/console/expenses/{id}/review` | Purchase confirm (manual entry) | 6.4 | M2 |
| `/console/inventory` | Ingredients, stock, ledger | 6.5, 6.8 | M2 |
| `/console/reports/pnl` | Daily P&L | 7.5 | M2 |
| `/console/reports/profit-per-dish` | Profit per Dish | 7.6 | M2 |
| `/console/reports/overview` | Period comparison and fees | 7.7 | M2 |
| `/console/settings/store` | Store profile and hours | 4.3 | M2 |
| `/console/settings/payments` | Gateway linking and KYC | 4.5 | M1 |
| `/console/settings/link` | Public link and QR | 4.6 | M2 |
| `/console/settings/subscription` | Tier and fee absorption | 4.7, 4.8 | M2 |
| `/console/_ops` | Internal ops view (queue, dead letters, absorbed fees) | 3.11, 4.8 | M1 |

**Coverage check:** every route in the 2.2 route map has exactly one implementing entry and one owner. No Customer Web route reads a merchant-only column, and no Owner Console route is reachable without an authenticated merchant session.

---

## Appendix D — Manual Action Index

Every task in this dictionary that a human must perform, in dependency order. None requires a credit or debit card.

| Order | Entry | Manual action | Blocks |
|---|---|---|---|
| 1 | 3.1 | GitHub repository creation and branch protection | everything |
| 2 | 3.2 | Supabase account, two projects, credentials, CLI link | 3.5 onward |
| 3 | 3.3 | Render account and worker service | 6.x, 7.x jobs |
| 4 | 3.4 | Vercel account and two projects | all UI deployment |
| 5 | 3.8 | Storage bucket creation (`bills` private, `menu-images` public) | 6.1 |
| 6 | 3.9 | Entering secrets in Supabase and Render dashboards | 5.5 |
| 7 | 3.10 | GitHub Actions secrets, alert destination, **backup restore drill** | pilot start |
| 8 | 3.11 | Sentry account and three projects | production readiness |
| 9 | 4.1 | SMS provider account and Supabase Auth phone configuration | 4.2 onward |
| ~~10~~ | ~~4.5~~ | ~~Payment gateway sandbox + KYC submission~~ — **REMOVED.** The MVP uses merchant-owned PromptPay; there is no gateway account and no KYC. This was the project's longest external dependency and it is now gone. | — |
| 11 | 5.8 | VAPID key generation and real-device push testing | F17 acceptance |
| ~~12~~ | ~~6.2~~ | ~~Float16 account, API key, and OCR accuracy spike on real receipts~~ — **DEFERRED (2026-08-22).** 6.2/6.3 are cut from the active build; nothing in Phase 6 depends on Float16 any more. Re-add this item only if OCR is un-deferred. | — |
| ~~13~~ | ~~2.3, 2.4~~ | ~~Figma wireframes and hi-fi design~~ — **COMPLETE.** Delivered as an interactive prototype from Claude Design; see 2.1 | — |
| 13 | 2.3 | Usability testing sessions with real cafe owners (3 merchants, 5 customers) | Phase 4-7 UI entries |
| 14 | 8.6 | Real-device testing matrix | 8.5 audit |
| 15 | 8.10 | Demo recording and credential handover | project close |

> **Scheduling note.** Gateway KYC was previously the longest external dependency and blocked all of Phase 5. It is **removed** — the MVP uses merchant-owned PromptPay, which a sole proprietor can set up in under a minute with no documents and no waiting. The critical path now runs through platform provisioning only (items 1-4), all of which are same-day. Item 7's restore drill remains the one manual action that must be completed and recorded as PASS before any real merchant data exists.

---

*End of WBS Dictionary.*
