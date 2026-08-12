# WBS Dictionary
## Project: Brew Ledger — Financial infrastructure for Thai independent coffee SMEs
**Tech Stack: Next.js (React + TypeScript, responsive / mobile-first) × 2 separate surfaces + Node.js (NestJS) on Cloud Run (GCP) + PostgreSQL (Cloud SQL) via Prisma + Licensed PromptPay Payment Gateway (2C2P / Omise / Beam / Chillpay) + PaddleOCR (self-hosted on Cloud Run) + Web Push API (VAPID) with polling fallback + Firebase Auth (Phone OTP) + Google Cloud Storage**

> **Platform decision (locked).** Brew Ledger is a **web application only**. There is no native app, no Flutter build, no App Store / Play Store submission, and no PWA install requirement. Both surfaces are ordinary responsive web apps opened in a mobile browser. Any WBS entry that implies a native SDK is out of scope by definition. Two browser-native capabilities replace the native equivalents:
>
> - **Order notifications** → Web Push API (VAPID) with a **mandatory polling fallback** inside the Owner Console while the tab is open, because Safari/iOS Web Push support is materially weaker than Android Chrome.
> - **Bill camera capture** → `<input type="file" accept="image/*" capture="environment">` with a MediaDevices `getUserMedia()` path where supported.

> **Surface separation (read before starting any task).** Brew Ledger ships **two distinct front-end surfaces off two distinct API scopes**:
>
> 1. **Owner Console** — authenticated (Phone OTP), merchant-scoped, sees menu, orders, cost, profit, expenses, reports, settings.
> 2. **Customer Web** — completely unauthenticated, single-store scoped, sees menu, options, pick-up time slots, payment, and its own order status.
>
> These are **not** the same codebase route tree and **not** the same API. Every WBS entry below carries a **Surface** row in its metadata table naming which surface it belongs to. If an entry's Surface is `Customer Web`, that entry may never read, join to, serialize, or log a cost, margin, expense, stock, or store-aggregate field. This is Red Line RL-3 and it is enforced structurally, not by convention (see 3.5, 3.6, 8.4).

> Each entry covers: **Scope / Statement of Work**, **Deliverables**, **Acceptance**, **Associated Activities**, and (where technically applicable) **Schema / Pseudocode** and **Testing** blocks.

---

## 🚩 Red Lines (project-wide constraints)

These three constraints override feature convenience, schedule pressure, and demo polish. They appear in the **Acceptance** block of every entry they touch, and they are audited as a gate in 8.5. A build that ships any feature in violation of a red line is not a build that ships.

| ID | Red Line | Why it exists | Enforced structurally by |
|---|---|---|---|
| **RL-1** | Customer money must settle **directly into the merchant's own gateway account**. Funds may never pass through, rest in, or be orchestrated out of a Brew Ledger central account. | Aggregating settlement for multiple merchants risks classification as an unlicensed e-Money service under Bank of Thailand supervision (cf. the PayAll enforcement precedent). Using an already-licensed gateway removes that risk entirely for the PoC. | 4.5, 5.5, 5.11, 8.5 |
| **RL-2** | A merchant must be able to **create a menu, publish a store link, take an order, and get paid without ever entering a BOM/recipe**. Costing features degrade gracefully; they never block selling. | The target user is a one-person cafe. Every competitor's unit-costing feature is gated behind mandatory recipe entry, which is precisely why that user never adopts it. Forced BOM entry kills onboarding. | 4.4, 6.7, 6.9, 7.6, 8.5 |
| **RL-3** | Customer Web must **never** expose ingredient cost, unit cost, margin, profit, expense, stock level, or store-level sales aggregates — not in a response body, not in a debug field, not in a JS bundle, not by URL guessing, not by inspecting a network request. | The customer is a stranger with a public link. Cost and margin data is the merchant's competitive information; leaking it destroys merchant trust irrecoverably and is the single most likely way this product loses a pilot store. | 3.5, 3.6, 5.1, 5.10, 8.4, 8.5 |

---

## 📖 Term Glossary

| Term | Meaning |
|---|---|
| **Owner Console** | The authenticated merchant-facing web surface. Route tree `apps/console`, API scope `/api/console/*`. Requires an OTP session bound to exactly one `merchant_id`. |
| **Customer Web** | The unauthenticated buyer-facing web surface. Route tree `apps/shop`, API scope `/api/public/*`. Scoped to exactly one `store_slug` taken from the URL. Never issues a user account. |
| **Surface** | Which of the two front ends a WBS entry belongs to. Also the row name in each metadata table. `Shared / Backend` means the entry produces server code consumed by both, in which case the entry must state its serialization boundary. |
| **Store** | One physical cafe. In MVP a merchant owns exactly one store; the schema carries `store_id` from day one so multi-branch (Phase 2 product, not MVP) does not require a migration. |
| **Store Slug** | The public URL-safe identifier in `brewledger.app/s/{slug}`. The only thing a customer needs. Encoded into the printable store QR. |
| **Time-slot** | A bounded pick-up window (e.g. 08:00–08:15) with a fixed order capacity. Customers may only choose a slot the system has opened and that is not full. |
| **Slot Quota** | The maximum number of orders accepted in one time-slot. When `booked_count >= capacity` the slot auto-closes and disappears from Customer Web. |
| **Paid Order** | An order whose gateway webhook has confirmed settlement. **Only paid orders enter the store queue, notify the merchant, deduct stock, or appear in P&L.** An unpaid order is never work for the merchant. |
| **Cash Sale** | A walk-in sale taken at the counter and typed into the Owner Console by hand. Counts toward revenue, stock deduction, and P&L; carries no gateway fee. Without it, P&L is wrong. |
| **BOM** | Bill of Materials — the per-menu-item recipe mapping menu item → ingredient quantities. **Always optional** (RL-2). |
| **Unit Cost** | The current cost of one base unit of an ingredient (e.g. THB per gram), derived from the most recent confirmed purchase bill. Stored in satang as an integer. |
| **Cost per Cup** | `Σ (bom_line.qty_in_base_unit × ingredient.unit_cost)` for one menu item. Undefined (`null`, not zero) when the menu item has no BOM. |
| **Profit per Dish** | Selling price minus cost per cup, ranked by **total profit contribution**, not by units sold or revenue. This ranking is the headline MVP KPI. |
| **Cost Drift** | A rise in an ingredient's unit cost exceeding a configured threshold versus its trailing baseline, which mechanically reduces margin on every menu item using that ingredient. |
| **AI Brief** | The short generated shopping/prep summary shown at the top of the Owner Console dashboard on open, derived from stock levels, upcoming slot bookings, and recent usage rate. |
| **Gateway** | A Bank of Thailand-licensed payment service provider (2C2P / Omise / Beam / Chillpay). Brew Ledger integrates one behind an adapter interface; it never builds PromptPay QR itself and never holds funds (RL-1). |
| **Gateway Fee** | The ~1.5–3% per-transaction charge. During PoC, Brew Ledger absorbs it on the merchant's behalf. It is still recorded per order so P&L is truthful and so absorption can be switched off. |
| **Fee Absorption Switch** | The per-merchant boolean deciding who bears the gateway fee. Must be a runtime setting, never a hardcoded "free forever" assumption. |
| **Idempotency Key** | The unique key on an inbound gateway webhook used to guarantee a duplicate or retried callback never creates a second order, a second stock deduction, or a second P&L row. |
| **Base Unit** | The canonical measurement unit an ingredient is stored in (`g`, `ml`, `piece`). Purchases arrive in kg/L/pack and are normalized on entry. All cost math happens in base units only. |
| **Stock Ledger** | Append-only movement log for ingredients. Stock level is derived from the ledger, never overwritten in place, so any number on a report can be traced to the movement that caused it. |
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
| F04 | PromptPay QR generated via licensed gateway, settling to merchant | Customer Web |
| F05 | Idempotent webhook payment confirmation → order enters queue | Backend |
| F06 | Real-time / polled order status display | Customer Web |
| F07 | Status lookup by phone number or order code, no login | Customer Web |
| F08 | Merchant login and identity verification via phone OTP | Owner Console |
| F09 | Store name, pick-up address, open/close hours | Owner Console |
| F10 | Menu and price creation with **no forced BOM** | Owner Console |
| F11 | Payment gateway account linking and KYC eligibility check | Owner Console |
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

> **Two-developer team.** This build is staffed by two people. Ownership below is split by layer rather than by phase: **M1** owns everything below the API line (infrastructure, data, payments, OCR, security/QA gate-keeping, and project coordination), and **M2** owns everything a user touches (both front-end surfaces) plus the order/costing/reporting business logic that sits behind them. Where an entry needs both — a screen with real business logic underneath — the metadata table names both, e.g. `M2 (UI), M1 (API)`. Peer review (8.4, 8.5) is necessarily the other person, since there is no third reviewer.

| Code | Member | Role | Primary workstreams |
|---|---|---|---|
| **M1** | Jedsadapiphat Daengdeeloet | Backend Infrastructure, Payments & Project Lead | Phase 1.0 project management and red line compliance, Phase 3.0 infrastructure, gateway/webhook/payment path, OCR service, security and QA gate-keeping |
| **M2** | Woraprat Chaikeenee | Full-Stack Developer (Front-end & Business Logic) | Phase 2.0 design system, Customer Web, Owner Console front-end, data model, order loop and costing business logic, reports |

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

**Scope / Statement of Work**
Run a half-day kickoff that locks the 29 MVP features (F01–F29), the eight WBS phases, and named ownership for every leaf task. The session's second half is a walkthrough of the three red lines and the Phase 2 exclusion list, because the most expensive failure mode on this project is not slipping a date — it is quietly building an aggregator payment flow or a mandatory BOM step and discovering it at pilot time. Output is a written project plan that becomes the source of truth for the build.

**Deliverables**
- Project plan committed at `/docs/project_plan.md` — phase map, leaf task list, owner per task, dependency notes
- Signed red line acknowledgement page inside the plan, one line per member
- Locked feature list F01–F29 with the Phase 2 exclusion list restated verbatim
- Scheduled dates for the estimation workshop (1.2), gate review (1.4), and pilot readiness review (1.7)

**Acceptance**
- Every leaf task in the WBS has exactly one named owner, M1 or M2
- Both members have read and signed the red line page
- The Phase 2 exclusion list appears in the plan and no leaf task implements anything on it
- Plan is committed to git and linked from the repository README

**Associated Activities**
- Walk F01–F29 and confirm no scope additions
- Assign owners phase by phase
- Read the three red lines aloud and record objections or ambiguities as open questions
- Identify the critical path (gateway sandbox access → 5.5 → 5.6 → 5.7 → 6.x costing → 7.x reports)
- Draft and commit the plan

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

**Scope / Statement of Work**
Run a two-round Wideband Delphi estimation over every leaf task in this dictionary. Each member estimates silently, the group discusses only the outliers, then re-estimates. Tasks with unusually wide spread are flagged for splitting rather than averaged — wide spread on this project almost always means the task hides an unknown (gateway KYC turnaround, Thai-language OCR accuracy, iOS Safari Web Push behaviour).

**Deliverables**
- Estimation table at `/docs/estimates.md` with one agreed story-point figure per leaf task
- Round-1 → round-2 delta log showing convergence
- Outlier list (round-2 variance > 50%) with a decision per item: split, spike, or accept
- Three named spike tasks carried into the risk register (1.5): gateway sandbox onboarding, PaddleOCR Thai receipt accuracy, iOS Safari Web Push reliability

**Acceptance**
- Every leaf task has a final agreed estimate
- No leaf task remains with > 50% inter-estimator variance without an explicit written decision
- The three known-unknown spikes are scheduled before their dependent tasks start

**Associated Activities**
- Prepare the estimation sheet from this dictionary's leaf list
- Run round 1 (silent, independent)
- Discuss outliers only
- Run round 2
- Compute convergence, record decisions, commit

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

**Scope / Statement of Work**
Run a 15-minute standup every working day using the standard three-question format, plus one project-specific fourth question: "did anything you built yesterday touch money, cost, or the customer surface?" That fourth question exists to surface red line risk daily rather than at audit time. Notes are committed so blockers persist across days.

**Deliverables**
- One markdown file per standup at `/docs/standups/YYYY-MM-DD.md`
- Each file records the four answers per attendee plus a blockers section
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

**Scope / Statement of Work**
Hold a one-hour gate review at the close of Phases 3.0, 5.0, and 7.0. Each gate assesses completion against acceptance criteria, re-prioritises remaining work, and makes explicit cut decisions if an MVP feature is at risk. A phase does not close on "the code is written"; it closes on its entries' acceptance criteria being demonstrably met, including their red line clauses.

**Deliverables**
- Gate minutes at `/docs/gates/gate_phase_{3,5,7}.md`
- Status per workstream: on-track / at-risk / blocked
- Written cut or deferral decisions with the feature ID affected
- Updated project plan and risk register

**Acceptance**
- Each gate records a status for every entry in the closing phase
- Every deferral names the feature ID and the reason
- No phase is marked closed while any of its red line acceptance clauses is unverified
- Gate 5 specifically confirms an end-to-end paid order settled into a **merchant** sandbox account (RL-1)

**Associated Activities**
- Collect entry-level status ahead of the meeting
- Walk acceptance criteria, not commit logs
- Re-baseline the remaining plan
- Commit minutes

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

**Scope / Statement of Work**
Maintain a living risk register with probability, impact, mitigation, owner, and status. Seeded at kickoff with the risks this project actually carries rather than generic ones: gateway KYC rejection of sole-proprietor pilot stores (2C2P requires a commercial registration of at least one year), Thai-language OCR accuracy on crumpled market receipts, iOS Safari Web Push unreliability, webhook duplication under gateway retry, and regulatory reclassification risk if anyone proposes a central settlement account.

**Deliverables**
- `/docs/risk_register.md` with columns: ID, description, probability (L/M/H), impact (L/M/H), mitigation, owner, status
- Minimum seeded risks: R1 gateway KYC eligibility, R2 OCR accuracy, R3 iOS Web Push, R4 webhook duplication, R5 e-Money reclassification, R6 pilot store churn during PoC
- Mitigation for R1 written as a concrete fallback: a secondary gateway that accepts natural persons

**Acceptance**
- Every phase with an external dependency (gateway, OCR, browser API) has at least one register entry
- R5 is permanently open for the life of the project and reviewed at every gate
- Register is updated whenever a standup changes a risk's status

**Associated Activities**
- Seed the register at kickoff
- Review at each standup where status changed
- Review the full register at each gate (1.4)
- Close risks only when their mitigation has actually shipped

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

**Scope / Statement of Work**
Maintain a single register that maps each red line to every WBS entry that touches it, the enforcement mechanism used, and the verification evidence. This is the document the 8.5 audit reads from, and it is the document that makes the difference between "we believe we comply" and "here is the test that proves it". It is a living artefact updated whenever an entry touching a red line reaches done.

**Deliverables**
- `/docs/red_line_register.md` with one row per (red line × WBS entry) pair
- Columns: red line, WBS entry, enforcement mechanism, verification method, evidence link (test name, audit doc, or screenshot), status
- RL-1 rows must cite the gateway account configuration and the settlement destination proven in sandbox
- RL-3 rows must cite the automated isolation test that proves the case, not a manual check

**Acceptance**
- Every entry in this dictionary with a non-empty **Red Line Touch** row has a corresponding register row
- No RL-3 row is marked verified on the basis of manual inspection alone
- Register is reviewed at every gate (1.4) and is an input to 8.5

**Associated Activities**
- Build the initial register from this dictionary's Red Line Touch rows
- Update as entries complete
- Attach evidence links from the 8.x test suites
- Present at gates

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

**Scope / Statement of Work**
Produce the written pack required to start the 20–30 store, 3-month proof of concept: the merchant-facing onboarding guide, the pilot store eligibility checklist (including gateway KYC prerequisites), the support escalation path, and the final project report covering what was built, what was cut, and what remains unvalidated (free-to-paid conversion, CAC, OCR field accuracy, customer willingness to prepay, peak-hour slot capacity design).

**Deliverables**
- `/docs/poc_readiness.md` — pilot eligibility checklist, onboarding script, support contacts, rollback plan
- `/docs/final_report.md` (and exported PDF) — build summary, cut list, open validation questions, per-member reflection
- Merchant one-pager explaining, in Thai, that payments settle to the merchant's own account

**Acceptance**
- Eligibility checklist encodes the real gateway prerequisites and names the fallback gateway for stores that fail them
- Final report explicitly lists every deferred Phase 2 feature and every unvalidated assumption
- Report covers all eight phases

**Associated Activities**
- Outline at the Phase 5 gate
- Assign sections per member
- Draft during Phase 7
- Review and finalise alongside 8.10

---

## Phase 2.0 — Design and UX

---

### 2.1 Persona and Journey Finalization

| Field | Detail |
|---|---|
| **WBS Code** | 2.1 |
| **Type** | Work Package |
| **Requirement** | UX foundation |
| **Owner** | M1, M2 assists |
| **Surface** | Both (informs all screens) |
| **Red Line Touch** | RL-2 (journey must not require BOM) |

**Scope / Statement of Work**
Finalise two personas and their journeys. The merchant persona ("Somchai", 32, sole operator, barista + cashier + buyer + bookkeeper simultaneously) drives every Owner Console decision, and the governing constraint taken from customer discovery is that the system must **add no new work** — a full-featured POS user in the discovery interview reported no problem with their existing tool, which means feature count is not the purchase driver. The customer persona is a regular who already pre-orders by chat message and expects to keep doing something that easy. Produce as-is and to-be journeys for both.

**Deliverables**
- `/docs/personas.md` — merchant and customer persona cards: context, motivations, pain points, current workaround
- As-is journey (chat pre-order → manual note → cash/transfer → no record) as PNG
- To-be journey (link → slot → prepay → queue → pickup → automatic costing) as PNG
- Explicit "no new work" annotation on every to-be step that would otherwise add merchant effort

**Acceptance**
- The to-be merchant journey contains **zero** mandatory data-entry steps before the first sale (RL-2)
- The to-be customer journey contains zero account-creation steps
- Both journeys cover only F01–F29; no Phase 2 features appear
- Journeys are referenced by name in the usability test script (2.7)

**Associated Activities**
- Consolidate persona material from the business document
- Draw as-is from the observed chat-order behaviour
- Draw to-be against F01–F29
- Annotate every merchant-effort step and justify or remove it
- Export and commit

---

### 2.2 Information Architecture and Route Map

| Field | Detail |
|---|---|
| **WBS Code** | 2.2 |
| **Type** | Work Package |
| **Requirement** | UX foundation, RL-3 |
| **Owner** | M2 |
| **Surface** | Both |
| **Red Line Touch** | RL-3 |

**Scope / Statement of Work**
Define the complete route map for both surfaces as two separate trees with no shared authenticated layout, no shared navigation shell, and no cross-links from Customer Web into Owner Console. This document is the design-side statement of RL-3: a customer walking the URL space must have nowhere to walk to. Every Customer Web route is scoped by `store_slug` from the path; no Customer Web route accepts a `merchant_id`.

**Deliverables**
- `/docs/route_map.md` listing both trees
- Customer Web: `/s/{slug}` (menu) · `/s/{slug}/cart` · `/s/{slug}/checkout` · `/s/{slug}/pay/{orderCode}` · `/o/{orderCode}` (tracking) · `/track` (lookup by phone + code)
- Owner Console: `/console/login` · `/console` (dashboard) · `/console/orders` · `/console/menu` · `/console/expenses` · `/console/inventory` · `/console/reports` · `/console/settings/*`
- Annotated data-exposure table: for each Customer Web route, the exact fields the page is permitted to render

**Acceptance**
- No Customer Web route renders any field outside its permitted list, and the permitted lists contain no cost, margin, expense, stock, or aggregate field (RL-3)
- No Customer Web route contains a link, redirect, or fallback into `/console/*`
- Every Owner Console route requires an authenticated merchant session
- The two trees can be deployed as separate route groups without shared layout code

**Associated Activities**
- Draw both trees
- Write the per-route permitted-field table for Customer Web
- Review the table line by line against the RL-3 wording
- Hand the table to 3.5 as the serializer specification

---

### 2.3 Lo-fi Wireframes

| Field | Detail |
|---|---|
| **WBS Code** | 2.3 |
| **Type** | Work Package |
| **Requirement** | UX foundation |
| **Owner** | M2 |
| **Surface** | Both |
| **Red Line Touch** | RL-2, RL-3 |

**Scope / Statement of Work**
Produce lo-fi wireframes locking structure before visual design, mobile viewport first (360–430 px) because both surfaces are used almost exclusively on a phone browser. Cover every MVP screen across both surfaces. Lo-fi is deliberate: the purpose is to settle flow and hierarchy, especially the merchant order-inbox layout, which must be legible at arm's length while the merchant's hands are busy.

**Deliverables**
- Wireframes at `/docs/wireframes/` covering Customer Web: store menu, item options sheet, cart, slot picker, checkout, PromptPay QR page, order tracking, lookup
- Owner Console: OTP login, store setup, menu builder, order inbox, order detail, bill capture, OCR review, inventory, dashboard, daily P&L, profit per dish, comparison, settings, subscription
- One paragraph of structural notes per screen

**Acceptance**
- Every MVP screen across both surfaces is covered
- The menu builder wireframe shows the recipe section as a clearly optional, collapsed, skippable block (RL-2)
- No Customer Web wireframe contains a cost, margin, stock, or sales-total element (RL-3)
- Order inbox is legible in a single glance: new order count, slot time, item list, one primary action

**Associated Activities**
- Sketch both trees screen by screen
- Review against F01–F29 for coverage
- Review Customer Web screens against the 2.2 permitted-field table
- Export and commit

---

### 2.4 Hi-fi Prototype

| Field | Detail |
|---|---|
| **WBS Code** | 2.4 |
| **Type** | Work Package |
| **Requirement** | UX foundation, design handoff |
| **Owner** | M2 |
| **Surface** | Both |
| **Red Line Touch** | RL-2, RL-3 |

**Scope / Statement of Work**
Build the clickable hi-fi prototype for every MVP screen using the design tokens from 2.5. The prototype is the visual contract the front-end implementation is measured against — spacing, type scale, component composition, copy, and empty states are taken from it rather than re-invented per screen. Both flows must be walkable end to end: customer link → paid → tracked, and merchant login → order → status → bill scan → report.

**Deliverables**
- Clickable prototype covering every screen listed in 2.3
- Exported screens at `/docs/screenshots/`
- Component inventory mapping each reusable component to the WBS entry that implements it
- Thai-primary copy on every screen, with the English string keys noted for i18n

**Acceptance**
- Both end-to-end flows are walkable with no dead ends
- Customer Web screens contain no cost/margin/stock/aggregate element (RL-3)
- The menu builder prototype allows reaching "menu published" without opening the recipe block (RL-2)
- Every empty state and every error state is designed, not left blank — including gateway timeout, slot full, and OCR low-confidence
- Layouts hold at 360 px width without horizontal scroll

**Associated Activities**
- Build screens using 2.5 tokens
- Wire both navigation flows
- Design error and empty states explicitly
- Review each Customer Web screen against the 2.2 permitted-field table
- Export and hand off

---

### 2.5 Design System and Style Guide

| Field | Detail |
|---|---|
| **WBS Code** | 2.5 |
| **Type** | Work Package |
| **Requirement** | Design tokens |
| **Owner** | M2 |
| **Surface** | Both |
| **Red Line Touch** | RL-3 (documented exclusion list) |

**Scope / Statement of Work**
Maintain the style guide as the single source of design truth: colour, type scale, spacing, component variants, iconography, and Thai typography rules. Thai script needs explicit line-height and font-stack decisions — default Latin line heights clip Thai vowel and tone marks, which is a visible quality failure on the merchant's own screen. Include a "never displayed on Customer Web" section mirroring RL-3 so the constraint travels with the design tokens.

**Deliverables**
- `/docs/style_guide.md` — colour palette (with semantic tokens for profit-positive / profit-negative / alert), type scale, spacing scale, radius and elevation
- Thai typography section: font stack (Noto Sans Thai or equivalent), minimum line-height 1.6 for Thai body text, tone-mark clipping check
- Component library: card, stat card, pill, primary/secondary/destructive button, input, bottom sheet, slot chip, order row, alert banner, empty state
- Explicit "never displayed on Customer Web" list: unit cost, cost per cup, margin %, net profit, expense, stock level, daily/total sales, order counts across other customers, merchant phone number
- Number formatting rules: THB with thousands separator, two decimals for money display, integers stored as satang

**Acceptance**
- Thai body text renders without tone-mark clipping at every type-scale step
- Semantic colour tokens exist so profit-negative states are never conveyed by colour alone (accessibility)
- The "never displayed on Customer Web" list matches RL-3 clause for clause
- Every component used in 2.4 exists in the guide

**Associated Activities**
- Define tokens and commit
- Test Thai rendering across Chrome Android, Safari iOS, and desktop Chrome
- Build the component sheet
- Reconcile the exclusion list against RL-3 wording

---

### 2.6 Customer Web Zero-Friction Flow Design

| Field | Detail |
|---|---|
| **WBS Code** | 2.6 |
| **Type** | Work Package |
| **Requirement** | F01, F02, F03, RL-3 |
| **Owner** | M2 |
| **Surface** | Customer Web |
| **Red Line Touch** | RL-3 |

**Scope / Statement of Work**
Design the customer flow to the standard the product actually competes against: sending a chat message. Every screen between opening the link and confirming payment is a place the customer leaves. Target is menu → options → slot → pay in four taps and one field (phone number). No account, no email, no address, no marketing consent, no cookie wall beyond what is legally required, and no interstitial before the menu renders.

**Deliverables**
- Flow specification at `/docs/customer_flow.md` with a tap-count budget per step
- Designed states for: store closed, all slots full, slot filled while in cart, payment timeout, payment failed, order already collected
- Phone number as the single required field, with the reason shown inline ("used only to look up your order")
- Order code format specification: short, human-readable, unambiguous (no `0`/`O`, no `1`/`I`)

**Acceptance**
- Happy path is achievable in ≤ 4 taps plus one phone-number entry
- No screen requests an account, password, email, or address
- The store menu is the first paint on `/s/{slug}` — no splash, no modal, no consent interstitial before content
- No screen in the flow displays any RL-3 restricted field
- Every failure state named above has a designed screen with a recovery action

**Associated Activities**
- Storyboard the flow and count taps
- Design each failure state
- Define the order code alphabet and length
- Validate the flow against the customer persona from 2.1

---

### 2.7 Usability Testing — 15-Minute Onboarding Target

| Field | Detail |
|---|---|
| **WBS Code** | 2.7 |
| **Type** | Work Package |
| **Requirement** | UX validation, RL-2 |
| **Owner** | M1, M2 assists |
| **Surface** | Both |
| **Red Line Touch** | RL-2 |

**Scope / Statement of Work**
Run moderated usability sessions with at least three real independent cafe owners and three ordinary customers against the hi-fi prototype. The merchant sessions test one specific claim: a store can go from nothing to a published, orderable menu **within 15 minutes and without support**. The customer sessions test whether prepaying a stranger's coffee link feels safe enough to complete.

**Deliverables**
- Test script at `/docs/usability_script.md` — merchant track and customer track
- Per-participant findings at `/docs/usability_findings_*.md`
- Timed result per merchant participant: minutes from first screen to published menu
- Consolidated prioritised action list feeding Phase 4 and 5 implementation

**Acceptance**
- At least 3 merchant and 3 customer participants completed
- At least 2 of 3 merchants reach a published menu unaided within 15 minutes
- Zero merchant participants believe a recipe must be entered before selling (RL-2 comprehension check — asked directly)
- Customer participants can state, unprompted, who receives their money
- Action list reviewed at the Phase 3 gate

**Associated Activities**
- Write both tracks of the script
- Recruit participants (independent cafes, not franchise)
- Run and time sessions
- Write up same-day
- Prioritise fixes before Phase 4 build starts

---

## Phase 3.0 — Backend Foundation and Infrastructure

---

### 3.1 Repository, Monorepo Layout and CI

| Field | Detail |
|---|---|
| **WBS Code** | 3.1 |
| **Type** | Work Package |
| **Requirement** | Infrastructure |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-3 (physical separation of surfaces) |

**Scope / Statement of Work**
Create the monorepo with the two front-end surfaces as **separate applications**, not as two route groups inside one Next.js app. Physical separation is the cheapest and most durable RL-3 enforcement available: a Customer Web bundle that cannot import Owner Console modules cannot leak Owner Console data, and a lint rule can prove it. Add CI running typecheck, lint, unit tests, and the import-boundary check on every pull request.

**Deliverables**
- Monorepo at repo root using pnpm workspaces:
  - `apps/shop` — Customer Web (Next.js)
  - `apps/console` — Owner Console (Next.js)
  - `apps/api` — NestJS backend
  - `packages/shared` — types and utilities safe for both surfaces (money formatting, order status enum, order code alphabet)
  - `packages/db` — Prisma schema and client
- ESLint boundary rule: `apps/shop` may import only from `packages/shared`; importing from `apps/console`, `packages/db`, or any module under a `console/` path fails the build
- GitHub Actions workflow: install → typecheck → lint (incl. boundary rule) → unit test → build both apps
- `README.md` with clone-to-run instructions

**Acceptance**
- `pnpm build` succeeds for all workspaces from a clean clone
- A deliberate import of `packages/db` from `apps/shop` **fails CI** (verified by a throwaway commit on a branch)
- CI runs on every pull request and blocks merge on failure
- No secrets present in the repository or in git history

**Associated Activities**
- Initialise pnpm workspace and the four packages
- Configure shared TypeScript config
- Write the ESLint boundary rule and prove it fails
- Write the CI workflow
- Write the README

**Testing**
- CI test: branch with a forbidden cross-app import fails lint
- CI test: clean clone builds all four workspaces
- Secret scan over full history passes

---

### 3.2 GCP Project, Cloud Run Environments and Networking

| Field | Detail |
|---|---|
| **WBS Code** | 3.2 |
| **Type** | Work Package |
| **Requirement** | Infrastructure |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | None |

**Scope / Statement of Work**
Provision two GCP environments (`brewledger-dev`, `brewledger-prod`) with Cloud Run services for the API, the OCR worker, and both web apps, plus Cloud SQL for PostgreSQL, Cloud Storage for bill images, and Secret Manager. Cloud Run is chosen over Cloud Functions because the OCR path and the report queries both exceed comfortable function timeouts and benefit from a warm container. Region `asia-southeast1` for latency to Thai users.

**Deliverables**
- Two GCP projects with billing configured and budget alerts at 50% / 80% / 100% of the monthly infrastructure estimate
- Cloud Run services: `api`, `ocr-worker`, `shop-web`, `console-web`
- Cloud SQL PostgreSQL instance (private IP, automated daily backups, point-in-time recovery enabled)
- Cloud Storage buckets: `bo-bills-{env}` (private, uniform access), `bo-menu-images-{env}` (public read)
- Serverless VPC connector for Cloud Run → Cloud SQL private IP
- Custom domains: `brewledger.app` (shop) and `console.brewledger.app` (console), TLS enforced

**Acceptance**
- Both environments deploy independently; a dev deploy can never write to prod data
- Cloud SQL is not reachable from the public internet
- Cold-start time for `api` is measured and recorded; if above 3 s, minimum instances set to 1 on prod
- Bill image bucket denies all unauthenticated reads
- Budget alerts fire to a real inbox

**Associated Activities**
- Create projects, enable APIs, set budgets
- Provision Cloud SQL with private IP and backups
- Create buckets and IAM bindings
- Configure the VPC connector
- Map domains and verify TLS
- Record cold-start measurements in the README

---

### 3.3 Core Data Model — PostgreSQL Schema

| Field | Detail |
|---|---|
| **WBS Code** | 3.3 |
| **Type** | Work Package |
| **Requirement** | All data-touching entries |
| **Owner** | M2 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-1, RL-2, RL-3 |

**Scope / Statement of Work**
Define the full relational schema. Three structural decisions carry red lines into the database itself: (1) settlement destination is a **merchant-owned** gateway account reference on the merchant row, and there is no Brew Ledger ledger or float table anywhere in the schema, because a schema with no central balance cannot accidentally become an aggregator (RL-1); (2) `bom_lines` is a separate optional table with no NOT NULL dependency from `menu_items`, so a menu item is fully valid with zero recipe rows (RL-2); (3) all cost, expense, stock, and margin columns live on tables that the public API layer has no read path to (RL-3). Money is stored as integer satang throughout.

**Deliverables**
- Complete schema in `packages/db/prisma/schema.prisma`
- Entity relationship diagram at `/docs/erd.png`
- Data dictionary at `/docs/data_dictionary.md` marking every column as `PUBLIC_SAFE` or `MERCHANT_ONLY`
- Indexes on all foreign keys plus the query paths named in Phase 7

**Acceptance**
- A `menu_items` row can be inserted, published, and ordered with zero `bom_lines` rows (RL-2)
- No table stores a Brew Ledger-held balance, float, wallet, or pooled settlement account (RL-1)
- Every column touching cost, expense, stock, margin, or store-level aggregation is marked `MERCHANT_ONLY` in the data dictionary (RL-3)
- All money columns are `Int` (satang); no `Float`, `Double`, or `Decimal` in the money path
- Every foreign key has an index

**Associated Activities**
- Model entities from F01–F29
- Write the Prisma schema
- Classify every column PUBLIC_SAFE / MERCHANT_ONLY
- Generate the ERD
- Review the classification with M1 against RL-3

**Schema (core tables, abridged Prisma)**
```prisma
model Merchant {
  id                String   @id @default(cuid())
  phone             String   @unique          // OTP identity
  displayName       String
  tier              Tier     @default(FREE)   // FREE | STARTER | GROWTH | SCALE
  absorbGatewayFee  Boolean  @default(true)   // runtime switch, never hardcoded
  gatewayProvider   String?                   // '2c2p' | 'omise' | ...
  gatewayMerchantId String?                   // MERCHANT-owned account ref (RL-1)
  gatewayKycStatus  KycStatus @default(NOT_STARTED)
  createdAt         DateTime @default(now())
  stores            Store[]
  staff             StaffUser[]
}

model Store {
  id            String   @id @default(cuid())
  merchantId    String
  slug          String   @unique              // public URL key, /s/{slug}
  name          String
  pickupAddress String
  timezone      String   @default("Asia/Bangkok")
  openTime      String                        // "07:00"
  closeTime     String                        // "17:00"
  isAcceptingOrders Boolean @default(false)
  merchant      Merchant @relation(fields: [merchantId], references: [id])
  @@index([merchantId])
}

model MenuItem {
  id           String   @id @default(cuid())
  storeId      String
  name         String
  priceSatang  Int                            // integer money only
  category     String?
  imageUrl     String?
  isActive     Boolean  @default(true)
  optionGroups OptionGroup[]
  bomLines     BomLine[]                      // OPTIONAL — zero rows is valid (RL-2)
  @@index([storeId, isActive])
}

model OptionGroup {
  id          String  @id @default(cuid())
  menuItemId  String
  name        String                          // "Temperature", "Sweetness"
  isRequired  Boolean @default(false)
  minSelect   Int     @default(0)
  maxSelect   Int     @default(1)
  options     Option[]
}

model Option {
  id             String @id @default(cuid())
  optionGroupId  String
  name           String                       // "Hot", "Iced", "50% sweet"
  priceDeltaSatang Int  @default(0)
}

model TimeSlot {
  id          String   @id @default(cuid())
  storeId     String
  slotStart   DateTime
  slotEnd     DateTime
  capacity    Int
  bookedCount Int      @default(0)            // guarded by 5.3 transaction
  @@unique([storeId, slotStart])
  @@index([storeId, slotStart])
}

model Order {
  id              String       @id @default(cuid())
  storeId         String
  publicCode      String       @unique        // customer-facing, ambiguity-free alphabet
  customerPhone   String                      // only PII collected
  timeSlotId      String?
  channel         Channel      @default(ONLINE) // ONLINE | CASH
  status          OrderStatus  @default(PENDING_PAYMENT)
  subtotalSatang  Int
  totalSatang     Int
  gatewayFeeSatang Int         @default(0)    // recorded even while absorbed
  feeBorneBy      FeeBearer    @default(PLATFORM) // PLATFORM | MERCHANT
  createdAt       DateTime     @default(now())
  paidAt          DateTime?
  items           OrderItem[]
  payment         Payment?
  @@index([storeId, status, createdAt])
  @@index([customerPhone])
}

model OrderItem {
  id                String @id @default(cuid())
  orderId           String
  menuItemId        String
  nameSnapshot      String                    // menu can change later
  qty               Int
  unitPriceSatang   Int
  optionsJson       Json
  unitCostSatang    Int?                      // MERCHANT_ONLY, null when no BOM (RL-2)
}

model Payment {
  id               String   @id @default(cuid())
  orderId          String   @unique
  provider         String
  providerChargeId String   @unique           // gateway charge reference
  amountSatang     Int
  feeSatang        Int
  status           PaymentStatus              // PENDING | PAID | FAILED | REFUNDED
  idempotencyKey   String   @unique           // duplicate webhook guard (5.6)
  rawPayload       Json
  settledToMerchantAccount String              // proof of RL-1 destination
  createdAt        DateTime @default(now())
}
```

**Schema (costing and inventory tables — MERCHANT_ONLY)**
```prisma
model Ingredient {
  id             String @id @default(cuid())
  storeId        String
  name           String
  baseUnit       BaseUnit                     // G | ML | PIECE
  unitCostSatang Int    @default(0)           // cost per ONE base unit
  reorderPoint   Float  @default(0)           // in base units
  @@index([storeId])
}

model BomLine {
  id           String  @id @default(cuid())
  menuItemId   String
  ingredientId String
  qtyBaseUnit  Float                          // always normalized to base unit
  isSuggested  Boolean @default(false)        // seeded template, merchant may edit (F26)
  @@unique([menuItemId, ingredientId])
}

model StockLedger {
  id           String   @id @default(cuid())
  storeId      String
  ingredientId String
  deltaBaseUnit Float                         // negative = consumption
  reason       LedgerReason                   // PURCHASE | SALE | CANCEL_REVERSAL | ADJUSTMENT
  refType      String?                        // 'order' | 'expense'
  refId        String?
  createdAt    DateTime @default(now())
  @@index([storeId, ingredientId, createdAt])
}

model CostHistory {
  id             String   @id @default(cuid())
  ingredientId   String
  unitCostSatang Int
  sourceExpenseId String?
  effectiveAt    DateTime @default(now())
  @@index([ingredientId, effectiveAt])
}

model Expense {
  id           String   @id @default(cuid())
  storeId      String
  source       ExpenseSource                  // OCR | MANUAL
  vendor       String?
  totalSatang  Int
  occurredAt   DateTime
  imageUrl     String?                        // private bucket
  ocrStatus    OcrStatus @default(NONE)       // NONE | PENDING | PARSED | CONFIRMED | FAILED
  lines        ExpenseLine[]
  @@index([storeId, occurredAt])
}

model ExpenseLine {
  id             String  @id @default(cuid())
  expenseId      String
  rawText        String                       // exactly what OCR read
  ingredientId   String?                      // null until merchant maps it
  qty            Float?
  unit           String?                      // as printed on the bill: "kg", "ลัง"
  amountSatang   Int?
  confidence     Float?                       // OCR confidence, drives review UI
  isConfirmed    Boolean @default(false)      // merchant confirmation gate
}
```

**Testing**
- Migration test: schema applies cleanly to an empty database
- Unit test: creating a `MenuItem` with zero `BomLine` rows succeeds and the item is orderable (RL-2)
- Unit test: no table in the generated schema contains a platform balance/float column (assert over introspected column names, RL-1)
- Unit test: every column in the data dictionary is classified, and the classification file has no `UNCLASSIFIED` entries

---

### 3.4 Prisma Client, Migrations and Seed Data

| Field | Detail |
|---|---|
| **WBS Code** | 3.4 |
| **Type** | Work Package |
| **Requirement** | All data-touching entries |
| **Owner** | M2 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | None |

**Scope / Statement of Work**
Set up Prisma migrations as the only path that changes database structure, and build a seed script producing a realistic demo store: one merchant, one store, eight menu items with option groups, six ingredients, BOM on only four of the eight items (so the null-cost path is exercised by default), a week of time slots, and thirty historical orders spread across days. Realistic seed data is what makes the Phase 7 report work testable at all.

**Deliverables**
- `packages/db/prisma/migrations/` with the initial migration
- `packages/db/seed.ts` producing the demo store described above
- `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:reset` scripts
- Migration policy in the README: no manual DDL, ever

**Acceptance**
- `pnpm db:reset && pnpm db:seed` produces a working demo store in under 30 seconds
- Exactly 4 of 8 seeded menu items have BOM rows, so `null` cost per cup is present in every dev database
- Seeded orders span at least 14 days so month-over-month report queries return non-trivial results
- Migrations run identically against dev and prod

**Associated Activities**
- Configure Prisma against Cloud SQL
- Generate the initial migration
- Write the seed script with deliberate null-cost coverage
- Document the migration policy

**Testing**
- CI test: migrations apply to a fresh Postgres container
- Unit test: seed script is idempotent when re-run after reset
- Unit test: seeded data includes at least one menu item with `unitCostSatang == null` on its order items

---

### 3.5 API Surface Separation and Public Serializer

| Field | Detail |
|---|---|
| **WBS Code** | 3.5 |
| **Type** | Work Package |
| **Requirement** | RL-3, F01, F02, F06 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | **RL-3 (primary enforcement)** |

**Scope / Statement of Work**
Build the API as two mounted scopes with different middleware, different DTOs, and different database access paths. `/api/console/*` requires a merchant session and may read anything scoped to that merchant. `/api/public/*` accepts no session, resolves its store from the URL slug, and reads through **explicit allow-list serializers** — never through raw entity serialization. Allow-listing rather than blocking is the point: a new cost column added in six months is invisible to the public API by default, whereas a deny-list would silently leak it.

**Deliverables**
- `apps/api/src/public/` module — no import of any merchant service, enforced by the 3.1 boundary lint
- `apps/api/src/console/` module — guarded by the session guard from 4.2
- Public DTOs implemented as explicit field maps: `PublicMenuItemDto`, `PublicOptionDto`, `PublicSlotDto`, `PublicOrderStatusDto`
- A shared `toPublicDto()` helper that constructs output field by field and throws on any unmapped field rather than passing it through
- Response-shape snapshot tests for every public endpoint

**Acceptance**
- `PublicMenuItemDto` exposes exactly: id, name, priceSatang, imageUrl, optionGroups. Nothing else (RL-3)
- `PublicOrderStatusDto` exposes exactly: publicCode, status, slotStart, slotEnd, item names and quantities, total paid. It exposes no unit cost, no margin, no other order, no store aggregate (RL-3)
- Adding a new column to `MenuItem` does **not** change any public response (proved by snapshot test)
- No handler under `/api/public/*` can reach a repository method that selects a `MERCHANT_ONLY` column — verified by the boundary lint and by 8.4
- Every `/api/public/*` route resolves its store from the path slug and ignores any client-supplied merchant or store identifier

**Associated Activities**
- Scaffold the two API modules
- Implement allow-list DTOs and the strict mapper
- Wire the store-slug resolver middleware for the public scope
- Write snapshot tests for every public response shape
- Add a new dummy cost column and confirm no public snapshot changes, then revert

**Pseudocode (strict public mapper)**
```typescript
// Throws at construction time if a field is added to the entity but not
// deliberately classified. Fail loudly in dev, never leak silently in prod.
export function toPublicMenuItem(item: MenuItem): PublicMenuItemDto {
  const ALLOWED = ['id', 'name', 'priceSatang', 'imageUrl', 'optionGroups'] as const;
  const FORBIDDEN = ['unitCostSatang', 'bomLines', 'marginPct', 'storeId', 'costPerCup'];

  for (const key of FORBIDDEN) {
    if (key in item) {
      // Present on the entity is fine; present in output is not.
      // We never spread. We construct.
    }
  }

  return {
    id: item.id,
    name: item.name,
    priceSatang: item.priceSatang,
    imageUrl: item.imageUrl,
    optionGroups: item.optionGroups.map(toPublicOptionGroup),
  };
  // NOTE: never `return { ...item }`. Spreading an entity into a public
  // response is the single most likely way RL-3 gets violated.
}
```

**Testing**
- Snapshot test: every `/api/public/*` response shape is locked; any added key fails CI
- Unit test: `toPublicMenuItem()` output has exactly 5 keys
- Unit test: a `MenuItem` entity carrying `unitCostSatang` produces a DTO with no such key
- Integration test: `GET /api/public/stores/{slug}/menu` response body, searched for the strings `cost`, `margin`, `profit`, `stock`, contains none of them
- Integration test: a client-supplied `?merchantId=` or `?storeId=` parameter on a public route is ignored

---

### 3.6 Merchant Tenant Scoping Guard

| Field | Detail |
|---|---|
| **WBS Code** | 3.6 |
| **Type** | Work Package |
| **Requirement** | RL-3, data security |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-3 |

**Scope / Statement of Work**
Guarantee that a merchant session can only ever read or write rows belonging to its own merchant, including through nested relations. Implement as a Prisma client extension that injects the `merchantId` / `storeId` filter into every query for tenant-scoped models, so scoping is a property of the data layer rather than something each of the fifty-odd handlers has to remember. Queries against tenant-scoped models without a tenant context throw.

**Deliverables**
- `packages/db/src/tenantClient.ts` — Prisma extension injecting the tenant predicate
- Tenant context propagated per request via AsyncLocalStorage
- Explicit list of tenant-scoped models; a model absent from the list must be justified in a comment
- An escape hatch (`systemClient`) usable only by the webhook handler and background jobs, with call sites enumerated in the file header

**Acceptance**
- A query on a tenant-scoped model without a tenant context throws rather than returning unfiltered rows
- Merchant A cannot read merchant B's orders, menu, ingredients, expenses, or reports through any Owner Console endpoint
- The `systemClient` escape hatch has fewer than five call sites, each named in the file header
- Cross-tenant access attempts are logged with the attempted resource and the session merchant

**Associated Activities**
- Implement the Prisma extension and AsyncLocalStorage context
- Enumerate tenant-scoped models
- Refactor any handler that filters manually to rely on the extension
- Add cross-tenant logging

**Testing**
- Unit test: query without tenant context throws
- Integration test: merchant A requesting order `id` belonging to merchant B receives 404 (not 403 — do not confirm existence)
- Integration test: merchant A cannot reach B's ingredients through a nested include on a shared relation
- Integration test: attempted cross-tenant access writes a warning log line

---

### 3.7 Object Storage for Bill Images

| Field | Detail |
|---|---|
| **WBS Code** | 3.7 |
| **Type** | Work Package |
| **Requirement** | F22 prerequisite |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-3 |

**Scope / Statement of Work**
Configure private storage for purchase bill images, which are among the most sensitive artefacts in the system — a bill photo reveals supplier, quantity, and price in one image. Uploads use short-lived signed URLs issued only to an authenticated merchant session; reads use short-lived signed GET URLs. Objects are never publicly readable and paths are non-guessable.

**Deliverables**
- Bucket `bo-bills-{env}` with uniform bucket-level access and all public access blocked
- Signed upload URL endpoint `POST /api/console/expenses/upload-url` — 5-minute expiry, max 8 MB, image content types only
- Object path convention `bills/{storeId}/{expenseId}/{uuid}.jpg`
- Signed read URLs with 10-minute expiry, issued only for the requesting merchant's own objects
- Client-side downscale to max 1600 px longest edge, JPEG quality 80, before upload

**Acceptance**
- Direct unauthenticated GET on a known object URL is denied
- A merchant cannot obtain a signed read URL for another merchant's bill object
- Upload of a non-image content type or an object above 8 MB is rejected
- Signed URLs expire and stop working after their TTL

**Associated Activities**
- Create bucket and IAM bindings
- Implement signed URL endpoints behind the merchant session guard
- Implement client-side downscale
- Verify expiry behaviour manually and in test

**Testing**
- Integration test: anonymous GET on an object path → 403
- Integration test: merchant A requesting a signed URL for merchant B's object → 404
- Integration test: 12 MB upload rejected
- Integration test: signed URL used after expiry → 403

---

### 3.8 Configuration, Secrets and Gateway Credential Handling

| Field | Detail |
|---|---|
| **WBS Code** | 3.8 |
| **Type** | Work Package |
| **Requirement** | Infrastructure, RL-1 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-1 |

**Scope / Statement of Work**
Centralise configuration with runtime schema validation so the service refuses to start with a missing or malformed setting rather than failing at the first payment. Gateway API keys, the webhook signing secret, the database URL, the VAPID key pair, and the OTP provider key live in Secret Manager and are mounted at runtime. Include an explicit startup assertion that the configured gateway is running in the expected mode (sandbox in dev, live in prod) — a live-key-in-dev accident on a payments product is expensive.

**Deliverables**
- `apps/api/src/config/` with Zod-validated environment schema
- Secret Manager entries: `DATABASE_URL`, `GATEWAY_API_KEY`, `GATEWAY_WEBHOOK_SECRET`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `OTP_PROVIDER_KEY`
- Startup assertions: all required config present; gateway mode matches environment; webhook secret is non-empty in every environment
- `.env.example` documenting every variable with no real values
- Documented key rotation procedure

**Acceptance**
- Service refuses to boot with any required secret missing, and the error names the missing key
- A live gateway key in the dev environment fails startup
- No secret value appears in logs, error responses, or the git history
- Rotating the webhook secret is documented and does not require a code change

**Associated Activities**
- Write the config schema and startup assertions
- Create Secret Manager entries and IAM bindings for the Cloud Run service accounts
- Write `.env.example` and the rotation runbook
- Add a log-redaction filter for secret-shaped strings

**Testing**
- Unit test: config parse fails with a named error when a required key is absent
- Unit test: gateway mode mismatch throws at startup
- CI test: secret scan over the repository and history passes

---

### 3.9 Observability, Logging and Error Tracking

| Field | Detail |
|---|---|
| **WBS Code** | 3.9 |
| **Type** | Work Package |
| **Requirement** | Operability |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-3 (log redaction) |

**Scope / Statement of Work**
Implement structured JSON logging with request correlation IDs, plus error tracking and alerting on the paths where silence is dangerous: webhook failures, refund failures, OCR job failures, and any cross-tenant access attempt. Logging carries an RL-3 obligation of its own — a debug log that dumps a full order entity into a shared log stream is a leak of cost data, so entity dumping is prohibited and redaction is applied at the logger.

**Deliverables**
- Structured logger with correlation ID propagation across HTTP and background jobs
- Error tracking integration (Sentry or Cloud Error Reporting) on both API and both web apps
- Alert policies: webhook handler error rate > 1% over 5 minutes; any refund failure; OCR job failure rate > 20%; any cross-tenant access attempt
- Log redaction list: phone numbers (partial mask), gateway keys, signed URLs, full entity dumps
- Uptime check on the public store route

**Acceptance**
- Every request is traceable end to end by correlation ID
- Logs contain no full customer phone number and no gateway credential
- A simulated refund failure fires an alert to a real channel
- No log line contains a serialized order or ingredient entity

**Associated Activities**
- Configure the logger and correlation middleware
- Wire error tracking to both web apps and the API
- Define alert policies and test one end to end
- Implement and unit-test the redaction filter

**Testing**
- Unit test: redaction masks a Thai mobile number to its last four digits
- Unit test: logging an object containing `unitCostSatang` is rejected or redacted
- Integration test: a forced webhook error produces an alert

---

## Phase 4.0 — Authentication, Onboarding and Merchant Settings

> **Phase goal (from the business case):** a cafe owner goes from zero to a published, orderable menu **within 15 minutes, unaided**. Every entry in this phase is measured against that number, and any step that cannot justify its seconds is cut.

---

### 4.1 Phone OTP Authentication

| Field | Detail |
|---|---|
| **WBS Code** | 4.1 |
| **Type** | Work Package |
| **Requirement** | F08 |
| **Owner** | M1 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-3 (console-only auth) |

**Scope / Statement of Work**
Implement merchant sign-up and sign-in with a Thai mobile number and a one-time password via Firebase Auth phone provider. There is no password, no email, and no username, because the target user will not maintain credentials for a tool they use between customers. Phone number is the merchant identity. Rate limiting and attempt lockout are mandatory — an unthrottled OTP endpoint is both an SMS-cost attack surface and an account-takeover surface.

**Deliverables**
- `/console/login` screen: phone entry → 6-digit OTP entry → session
- Firebase Auth phone provider configured with reCAPTCHA verification for web
- Backend endpoint exchanging a verified Firebase ID token for a Brew Ledger merchant session
- First successful verification for an unknown phone creates a `Merchant` row and routes to store setup (4.3)
- Rate limits: 3 OTP sends per phone per 15 minutes, 5 verification attempts per code, 30-minute lockout after exhaustion
- Thai-language copy for every state including expiry and lockout

**Acceptance**
- A new phone number completes sign-up and lands on store setup with no other data required
- A returning phone number signs in and lands on the dashboard
- The 4th OTP request within 15 minutes is refused with a clear message and a countdown
- An expired or wrong code returns a specific error, and neither error reveals whether the phone is registered
- **No OTP or session issued by this entry grants any access to `/api/public/*` or vice versa** — the two scopes share no token (RL-3)

**Associated Activities**
- Configure Firebase Auth phone provider and authorised domains
- Build the two-step login UI with paste-friendly OTP input
- Implement the token exchange endpoint
- Implement rate limiting (Redis or Cloud Memorystore, or a Postgres counter table for PoC scale)
- Write Thai copy for all states

**Pseudocode (token exchange)**
```typescript
async function exchangeIdToken(idToken: string): Promise<SessionResponse> {
  const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
  if (!decoded.phone_number) throw new UnauthorizedException('PHONE_REQUIRED');

  const phone = normalizeThaiPhone(decoded.phone_number); // +66xxxxxxxxx canonical

  let merchant = await systemClient.merchant.findUnique({ where: { phone } });
  let isNew = false;
  if (!merchant) {
    merchant = await systemClient.merchant.create({
      data: { phone, displayName: '', tier: 'FREE', absorbGatewayFee: true },
    });
    isNew = true;
  }

  const session = await issueSession({
    merchantId: merchant.id,
    scope: 'CONSOLE',            // never 'PUBLIC'; the scopes are disjoint (RL-3)
    ttlDays: 30,
  });

  return { token: session.token, isNew, nextStep: isNew ? 'STORE_SETUP' : 'DASHBOARD' };
}
```

**Testing**
- Integration test: new phone → merchant row created, `nextStep = STORE_SETUP`
- Integration test: existing phone → no duplicate merchant row
- Integration test: 4th send within 15 minutes → 429
- Integration test: 6th wrong code → lockout
- Unit test: `normalizeThaiPhone('0812345678')` and `('+66812345678')` produce the same value
- Security test: a console session token presented to a `/api/public/*` route confers nothing

---

### 4.2 Merchant Session, Roles and Route Guards

| Field | Detail |
|---|---|
| **WBS Code** | 4.2 |
| **Type** | Work Package |
| **Requirement** | F08, RL-3 |
| **Owner** | M1 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-3 |

**Scope / Statement of Work**
Implement session issuance, validation, refresh, and revocation, plus the two-role model: `OWNER` (full access including cost, reports, settings, payouts) and `STAFF` (orders and status updates only — no cost, no reports, no settings). The staff role exists because the merchant may hand a phone to a part-time helper during rush, and that helper should not see the margin on every cup.

**Deliverables**
- Session table with token hash, merchant ID, role, expiry, revoked flag
- `MerchantSessionGuard` applied to every `/api/console/*` route by default (opt-out must be explicit and justified)
- Role guard: `@Roles('OWNER')` on cost, report, settings, subscription, and payout routes
- Next.js middleware in `apps/console` redirecting unauthenticated requests to `/console/login`
- Logout and "sign out all devices"

**Acceptance**
- Every `/api/console/*` route is guarded; a test enumerates routes and fails if any is unguarded
- A `STAFF` session receives 403 on every cost, report, settings, and subscription route
- A `STAFF` session's dashboard response contains no profit, cost, or expense figure
- Revoked and expired sessions are rejected immediately
- Session tokens are stored hashed, never in plaintext

**Associated Activities**
- Implement session issuance and validation
- Implement the default-on guard and the route enumeration test
- Implement role guards and the staff-safe dashboard response
- Build the console middleware and logout

**Testing**
- Unit test: route enumeration finds zero unguarded console routes
- Integration test: STAFF session → 403 on `/api/console/reports/pnl`
- Integration test: STAFF dashboard payload contains no `profit`, `cost`, or `expense` key
- Integration test: revoked token → 401 on the next request
- Integration test: expired token → 401

---

### 4.3 Store Profile Setup

| Field | Detail |
|---|---|
| **WBS Code** | 4.3 |
| **Type** | Work Package |
| **Requirement** | F09 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2 |

**Scope / Statement of Work**
Build the first-run store setup: store name, pick-up address, and opening hours. Three fields, one screen, no wizard with six steps. The slug is generated automatically from the store name with a collision suffix and is editable once. On save, the store exists and the public link is live — though the store starts with `isAcceptingOrders = false` until the merchant has at least one menu item and a linked gateway.

**Deliverables**
- `/console/settings/store` (also the first-run screen)
- Fields: store name (required, 1–60 chars), pick-up address (required, free text), open time, close time, per-weekday override toggle
- Auto-generated slug with availability check and a one-time edit
- Save creates the `Store` row and shows the public URL with a copy button

**Acceptance**
- Setup completes in under 2 minutes for a typical user (measured in 2.7)
- No recipe, ingredient, BOM, tax ID, or bank field appears anywhere on this screen (RL-2)
- Slug is unique, URL-safe, and lowercase
- The public URL is displayed and copyable immediately after save
- Closing hours earlier than opening hours is rejected with an inline message

**Associated Activities**
- Build the form with inline validation
- Implement slug generation and the availability endpoint
- Implement weekday overrides
- Show the public URL with copy-to-clipboard

**Testing**
- Unit test: slug generation from Thai store names produces a valid ASCII slug
- Unit test: colliding names produce `-2`, `-3` suffixes
- Integration test: save creates a `Store` with `isAcceptingOrders = false`
- Widget test: close-before-open shows a validation error

---

### 4.4 Menu and Price Builder (No BOM Required)

| Field | Detail |
|---|---|
| **WBS Code** | 4.4 |
| **Type** | Work Package |
| **Requirement** | F10, F02 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | **RL-2 (primary enforcement)** |

**Scope / Statement of Work**
Build the menu builder. A menu item requires exactly two things: a name and a price. Option groups (temperature, sweetness) are offered as one-tap presets rather than a form to author from scratch. The recipe section is a **collapsed, clearly optional block** labelled to explain the trade-off honestly — add it and you get cost per cup; skip it and everything else still works. This is the single most important screen for RL-2, because the competitive analysis says this is exactly where every other product forces the merchant to stop and do data entry they will not do.

**Deliverables**
- `/console/menu` — list with add, edit, duplicate, activate/deactivate, reorder
- `/console/menu/{id}` — editor: name (required), price (required), category (optional), photo (optional), option groups (optional presets), recipe block (optional, collapsed by default)
- One-tap option presets: "Hot / Iced" and "0% / 50% / 100% sweet" with sensible price deltas the merchant can adjust
- Recipe block copy stating plainly that it is optional and what it unlocks
- Bulk "add 5 common drinks" starter template for empty menus

**Acceptance**
- A menu item saves and becomes orderable with **only** a name and a price — no recipe, no ingredient, no category, no photo (RL-2)
- The recipe block is collapsed on first open and never blocks save
- No validation error, warning banner, nag, or disabled control anywhere on this screen references a missing recipe (RL-2)
- Publishing the menu with zero BOM rows across all items produces a fully functional store
- A merchant can go from empty menu to 5 published items in under 5 minutes (measured in 2.7)
- Deactivating an item hides it from Customer Web but preserves it on historical orders

**Associated Activities**
- Build the menu list and editor
- Implement option group presets
- Implement the collapsed optional recipe block calling into 6.7
- Build the starter template
- Walk every error and empty state to confirm none mentions a missing recipe

**Pseudocode (create menu item — note what is *not* required)**
```typescript
async function createMenuItem(storeId: string, input: CreateMenuItemInput) {
  // RL-2: name and price are the ONLY required fields.
  // BOM, category, image, and options are all optional and always remain so.
  assert(input.name?.trim().length > 0, 'NAME_REQUIRED');
  assert(Number.isInteger(input.priceSatang) && input.priceSatang > 0, 'PRICE_REQUIRED');

  return tenantClient.menuItem.create({
    data: {
      storeId,
      name: input.name.trim(),
      priceSatang: input.priceSatang,
      category: input.category ?? null,
      imageUrl: input.imageUrl ?? null,
      isActive: true,
      optionGroups: input.optionGroups
        ? { create: input.optionGroups.map(toOptionGroupCreate) }
        : undefined,
      // bomLines intentionally absent. An item with zero BOM lines is a
      // first-class, fully sellable item. Cost per cup is simply null for it.
    },
  });
}
```

**Testing**
- Integration test: POST with only name and price → 201, item is orderable
- Integration test: publishing a store whose items all have zero BOM rows → store fully functional end to end (RL-2)
- UI test: recipe block is collapsed on first render
- UI test: save button is enabled with an empty recipe block
- Static test: grep of this screen's copy strings finds no blocking language about recipes
- Integration test: deactivated item disappears from the public menu but still resolves on a historical order

---

### 4.5 Payment Gateway Onboarding and KYC Linkage

| Field | Detail |
|---|---|
| **WBS Code** | 4.5 |
| **Type** | Work Package |
| **Requirement** | F11 |
| **Owner** | M1 |
| **Surface** | Owner Console |
| **Red Line Touch** | **RL-1 (primary enforcement)** |

**Scope / Statement of Work**
Build the flow that links the merchant's **own** account at a licensed payment gateway, so that every baht a customer pays settles into an account the merchant owns and Brew Ledger never holds. Brew Ledger stores only a reference to the merchant's gateway account; it never stores a bank account number, never becomes the account holder, and never creates a pooled or intermediary account. The screen also runs an eligibility pre-check, because the primary gateway requires a commercial registration at least one year old — a condition most one-person cafes fail — and steering an ineligible store to a gateway that accepts natural persons must happen before onboarding, not after rejection.

**Deliverables**
- `/console/settings/payments` — status, eligibility pre-check, connect flow, verification state
- Eligibility questionnaire: registration type (natural person / juristic person), registration age, business category
- Routing logic: ineligible for the primary gateway → recommend the alternate gateway that supports natural persons, with the required documents listed
- Gateway adapter interface (`createQr`, `getCharge`, `refund`, `verifyWebhook`) with at least one concrete implementation, so a second gateway is an added file rather than a rewrite
- Storage of `gatewayProvider`, `gatewayMerchantId`, `gatewayKycStatus` only
- Merchant-facing explainer, in Thai, stating that funds settle directly to the merchant's account

**Acceptance**
- **Settlement destination is the merchant's own gateway account, verified against the gateway's account API and recorded on every payment (RL-1)**
- **No Brew Ledger-held account, wallet, float, pooled balance, or intermediary settlement step exists in the flow or in the schema (RL-1)**
- No bank account number, ID card number, or full KYC document is stored in the Brew Ledger database — documents go to the gateway directly
- A merchant failing the primary gateway's eligibility criteria is shown the alternate path before starting, not after rejection
- Order acceptance cannot be enabled until `gatewayKycStatus = VERIFIED`
- The Thai explainer text is present on the screen and repeats the direct-settlement fact

**Associated Activities**
- Select the primary gateway and obtain sandbox credentials (spike from 1.2)
- Build the adapter interface and the primary implementation
- Build the eligibility questionnaire and routing
- Build the connect and status UI
- Write the Thai explainer
- Record the RL-1 evidence in the 1.6 register

**Schema (merchant gateway linkage — note what is absent)**
```typescript
// Stored on Merchant:
{
  gatewayProvider:   '2c2p' | 'omise' | 'beam' | 'chillpay';
  gatewayMerchantId: string;   // the MERCHANT's account at the gateway
  gatewayKycStatus:  'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
}
// Deliberately NOT stored anywhere in this system (RL-1):
//   - bank account numbers
//   - a Brew Ledger pooled/escrow/float account reference
//   - any balance owed to a merchant
//   - any payout schedule from Brew Ledger to a merchant
// If a future feature requires any of the four lines above, it is a
// regulatory change, not a product change. Escalate; do not implement.
```

**Testing**
- Integration test (sandbox): a completed charge settles to the merchant sandbox account, and the settlement destination on the `Payment` row equals the merchant's `gatewayMerchantId` (RL-1)
- Static test: schema introspection finds no platform balance, float, escrow, or payout table (RL-1)
- Integration test: `isAcceptingOrders` cannot be set true while `gatewayKycStatus != VERIFIED`
- Unit test: eligibility routing returns the alternate gateway for a natural person with under one year of registration
- Security test: no KYC document bytes are persisted by the Brew Ledger API

---

### 4.6 Store QR and Public Link Generation

| Field | Detail |
|---|---|
| **WBS Code** | 4.6 |
| **Type** | Work Package |
| **Requirement** | F01 |
| **Owner** | M2 |
| **Surface** | Owner Console (generates), Customer Web (target) |
| **Red Line Touch** | RL-3 |

**Scope / Statement of Work**
Generate the store's shareable link and a printable QR code encoding `https://brewledger.app/s/{slug}`. Provide a print-ready A5 PDF the merchant can put on the counter, and short share text suitable for pasting into a LINE or Facebook conversation — which is where the existing pre-order behaviour actually happens, so the share affordance matters more than the QR.

**Deliverables**
- `/console/settings/link` — link display, copy button, QR preview, download PNG, download printable A5 PDF
- QR generated client-side with error correction level M and a quiet zone
- Pre-written Thai share text with the store name and link interpolated
- The QR encodes only the public URL — no merchant ID, no token, no query parameters

**Acceptance**
- The QR resolves to the public store page on both Android Chrome and iOS Safari camera apps
- The encoded URL contains no identifier other than the public slug (RL-3)
- The printable PDF is legible when scanned from 30 cm at A5 size
- The share text is one tap to copy

**Associated Activities**
- Implement QR generation and PNG export
- Build the A5 print layout
- Write the Thai share text
- Test scanning on both platforms at print size

**Testing**
- Unit test: encoded payload equals `https://{host}/s/{slug}` exactly
- Manual test: scan the printed A5 on iOS and Android
- Integration test: the public page renders for a slug reached only via the QR URL

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

**Scope / Statement of Work**
Implement the four-tier model (Free / Starter 499 / Growth 999 / Scale 1,999 THB per month) as a server-side capability check, never a client-side hide. During PoC no tier is charged, but the gating mechanism must exist and be correct from day one, because retrofitting entitlement checks into an already-shipped product is where paid-feature leaks come from. Critically, the **Free tier must remain a complete working product**: ordering, payment, and order management are never gated, since the entire acquisition strategy depends on a store being able to run for free.

**Deliverables**
- `Tier` enum and per-tier capability map in `packages/shared/entitlements.ts`
- Server-side `requireCapability()` guard used by gated routes
- `/console/settings/subscription` — current tier, capability comparison, upgrade request (records intent during PoC; no charging)
- Upgrade prompts that state what the capability does rather than merely that it is locked

**Acceptance**
- Ordering, payment, order status management, and cash sale entry are available on **Free** and are never gated
- Gated capabilities are refused server-side; hiding a control in the UI alone fails this entry
- No gate is tied to whether a BOM exists (RL-2)
- Tier changes take effect on the next request without redeploy
- Capability map is a single file; no capability check is inlined elsewhere

**Associated Activities**
- Define the capability map from the four tiers
- Implement the server-side guard
- Apply guards to gated routes
- Build the subscription screen and upgrade-intent recording

**Schema (capability map)**
```typescript
export const CAPABILITIES = {
  FREE:    ['ORDERING', 'PAYMENT', 'ORDER_MGMT', 'CASH_SALE', 'BASIC_SALES_SUMMARY'],
  STARTER: [...FREE_CAPS, 'AUTO_UNIT_COSTING', 'OCR_BILLS', 'COST_DRIFT_ALERT',
            'LOW_STOCK_ALERT', 'PROFIT_PER_DISH', 'DAILY_PNL'],
  GROWTH:  [...STARTER_CAPS, 'AI_BRIEF', 'PERIOD_COMPARISON'],
  SCALE:   [...GROWTH_CAPS, 'PRIORITY_SUPPORT'],
  // Phase 2 capabilities (CASH_FLOW_FORECAST, AI_CHATBOT, TAX_SUITE,
  // MULTI_BRANCH) are intentionally absent — the map must not imply
  // features that do not exist in MVP.
} as const;
```

**Testing**
- Unit test: FREE includes every capability required to take and fulfil a paid order
- Integration test: a FREE merchant calling a STARTER-gated endpoint receives 402/403, regardless of UI state
- Integration test: raising a merchant's tier immediately unlocks the endpoint
- Unit test: no capability string in the map references a Phase 2 feature

---

### 4.8 Gateway Fee Absorption Switch

| Field | Detail |
|---|---|
| **WBS Code** | 4.8 |
| **Type** | Work Package |
| **Requirement** | F12, F29 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-1 |

**Scope / Statement of Work**
Implement the per-merchant switch determining who bears the gateway fee. During the three-month PoC, Brew Ledger absorbs it so the merchant experiences the product as free; after the PoC, absorption must be switchable off per merchant without a code change or migration. The fee is **recorded on every order regardless of who bears it**, so P&L is truthful from day one and the merchant is never surprised later by a cost they had never seen quantified.

**Deliverables**
- `Merchant.absorbGatewayFee` boolean with an admin-settable path and a documented default of `true` for PoC
- Every `Order` records `gatewayFeeSatang` and `feeBorneBy` (`PLATFORM` | `MERCHANT`) at payment confirmation time
- Reports (7.5, 7.7) display the fee line in both cases, labelled as absorbed when applicable
- Platform-side absorbed-fee total exposed to the project team for PoC budget tracking
- Documented switch-off procedure in `/docs/poc_readiness.md`

**Acceptance**
- Flipping the switch changes only the fee attribution on **subsequent** orders; historical orders retain their original attribution
- `gatewayFeeSatang` is populated on every online order even when absorbed
- Nothing in the code assumes fees are free permanently — a test asserts the absorbed path is a runtime branch, not a constant
- Net profit in P&L subtracts the fee only when `feeBorneBy = MERCHANT`, and shows it as an informational line otherwise
- **The fee is a gateway charge against the merchant's own gateway account; Brew Ledger reimbursement, where applicable, is an off-platform arrangement and creates no in-product balance (RL-1)**

**Associated Activities**
- Add the switch and the order-level attribution fields
- Wire attribution into the payment confirmation path (5.6)
- Update the P&L and comparison report calculations
- Document the switch-off procedure

**Testing**
- Unit test: `feeBorneBy = PLATFORM` → net profit unchanged by the fee, fee still shown
- Unit test: `feeBorneBy = MERCHANT` → net profit reduced by exactly the fee
- Integration test: flipping the switch does not mutate historical orders
- Static test: no hardcoded zero-fee constant exists in the P&L calculation path

---

## Phase 5.0 — Order Loop: Pre-order, Payment and Fulfilment

> **Phase goal:** a customer completes order → pay → track entirely on Customer Web without ever touching the Owner Console, and a merchant sees and manages the whole thing entirely from the Owner Console without ever touching Customer Web. The two halves meet only at the database, through the API boundary defined in 3.5.

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

**Scope / Statement of Work**
Build `/s/{slug}` — the page a customer lands on from a QR scan or a chat link. It renders the store name, open status, and the active menu with prices. No install prompt, no account, no consent interstitial before content. The page is server-rendered for first-paint speed on a mid-range Android phone over mobile data, because this page competes with the effort of typing a message in LINE.

**Deliverables**
- `apps/shop` route `/s/{slug}` with SSR and cache headers appropriate to menu volatility
- Store header: name, open/closed state, pick-up address, next available slot summary
- Menu list grouped by category when present, flat when not
- Closed-store and no-menu states with clear copy
- 404 page for an unknown slug that reveals nothing about whether the slug ever existed

**Acceptance**
- **The response body contains no cost, margin, profit, expense, stock, or store-aggregate field — asserted by an automated content scan, not by inspection (RL-3)**
- **No API call made by this page requires or accepts authentication, and none accepts a merchant or store ID from the client (RL-3)**
- First contentful paint under 2.5 s on a throttled 4G profile
- The page renders with no menu photos present (photos are optional)
- Store closed and empty menu both render a designed state, never a blank page
- Nothing on the page links to `/console/*`

**Associated Activities**
- Build the SSR route and store resolver
- Build menu list and item cards
- Implement closed / empty / 404 states
- Run a Lighthouse mobile pass and fix regressions
- Add the RL-3 content scan to CI

**Testing**
- Integration test: response body scanned for `cost`, `margin`, `profit`, `stock`, `expense`, `netProfit` → zero matches (RL-3)
- Integration test: the page's JS bundle is scanned for the same tokens → zero matches (RL-3)
- Integration test: unknown slug → 404 with a generic body
- Integration test: inactive menu items are absent from the response
- Performance test: FCP under 2.5 s on a simulated 4G profile

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

**Scope / Statement of Work**
Build the item options bottom sheet (temperature, sweetness, and any merchant-defined groups) and the cart. Cart state lives in the browser (session storage) rather than the server, so browsing creates no rows and no cleanup burden. Prices are always recomputed server-side at checkout; the client-side total is a display convenience and is never trusted.

**Deliverables**
- Options bottom sheet honouring `isRequired`, `minSelect`, `maxSelect` per group
- Quantity stepper and per-line notes (optional, length-capped)
- Cart page with line edit and remove
- Client-side total display with server recomputation at checkout
- Cart persisted across reload within the session, cleared on successful order

**Acceptance**
- A required option group blocks add-to-cart until satisfied, with an inline message
- Option price deltas are applied correctly to the line total
- The server recomputes the total at checkout and rejects any client-supplied total
- Cart survives an accidental reload
- No cart or option response contains an RL-3 restricted field

**Associated Activities**
- Build the options sheet with selection rules
- Build cart state and persistence
- Implement server-side price recomputation
- Handle a menu item deactivated while it sits in a cart

**Testing**
- Unit test: option selection rules enforced for min/max and required
- Unit test: line total equals base price plus deltas times quantity
- Integration test: a tampered client total is ignored; the server total governs
- Integration test: an item deactivated after being added to the cart is rejected at checkout with a clear message

---

### 5.3 Time-slot Engine and Quota Enforcement

| Field | Detail |
|---|---|
| **WBS Code** | 5.3 |
| **Type** | Work Package |
| **Requirement** | F03, F18 |
| **Owner** | M2 |
| **Surface** | Shared / Backend (Customer picks, Owner configures) |
| **Red Line Touch** | RL-3 |

**Scope / Statement of Work**
Generate bookable pick-up slots from the store's opening hours and a merchant-set slot length and capacity, and enforce the quota under concurrency. Capacity exists to protect the walk-in queue: a validated open question from discovery is whether pre-orders damage the counter experience at peak, so the merchant must be able to cap pre-orders per window. The reservation must be race-safe — two customers taking the last place in the same slot is the exact failure that makes a merchant distrust the system.

**Deliverables**
- Slot generation job producing slots for a rolling horizon (default 3 days) from opening hours, slot length, and capacity
- Owner Console controls: slot length (10/15/30 min), capacity per slot, per-slot manual close, and a "stop taking pre-orders now" master switch
- Public endpoint returning only slots that are open, in the future, and not full
- Atomic reservation: conditional increment of `bookedCount` inside the order-creation transaction
- Automatic release of the reservation when an order expires unpaid (5.4) or is cancelled (5.11)

**Acceptance**
- **Concurrent reservation of the final place in a slot results in exactly one success and one clean, user-friendly failure (F18)**
- A full slot is absent from the public slot list within one refresh
- Slots in the past or outside opening hours are never offered
- An unpaid order that expires releases its place, and the slot becomes bookable again
- The public slot response contains only slot start, slot end, and availability — no counts of other customers' orders, no capacity internals (RL-3)

**Associated Activities**
- Implement slot generation and the rolling horizon job
- Build the merchant slot configuration UI
- Implement the atomic reservation with a conditional update
- Implement reservation release on expiry and cancellation
- Write the concurrency test

**Pseudocode (race-safe reservation)**
```typescript
async function reserveSlot(tx: Prisma.TransactionClient, slotId: string) {
  // Conditional update: succeeds only while capacity remains.
  // Row count, not a prior read, is the source of truth — a read-then-write
  // here is precisely the race that oversells the last place.
  const updated = await tx.$executeRaw`
    UPDATE "TimeSlot"
       SET "bookedCount" = "bookedCount" + 1
     WHERE id = ${slotId}
       AND "bookedCount" < capacity
       AND "slotStart" > NOW()
  `;
  if (updated === 0) throw new ConflictException('SLOT_FULL');
}

async function releaseSlot(tx: Prisma.TransactionClient, slotId: string) {
  await tx.$executeRaw`
    UPDATE "TimeSlot"
       SET "bookedCount" = GREATEST("bookedCount" - 1, 0)
     WHERE id = ${slotId}
  `;
}
```

**Testing**
- Concurrency test: 20 parallel reservations against a slot with capacity 1 → exactly 1 success, 19 `SLOT_FULL`
- Unit test: slot generation respects opening hours, slot length, and weekday overrides
- Integration test: a full slot disappears from the public list
- Integration test: unpaid expiry releases the place and the slot reopens
- Integration test: the public slot payload has exactly three keys

---

### 5.4 Checkout and Order Draft Creation

| Field | Detail |
|---|---|
| **WBS Code** | 5.4 |
| **Type** | Work Package |
| **Requirement** | F03, F04, F07 |
| **Owner** | M2 |
| **Surface** | Customer Web |
| **Red Line Touch** | RL-3 |

**Scope / Statement of Work**
Build checkout: choose slot, enter phone number, review, and create the order in `PENDING_PAYMENT`. The phone number is the only personal data collected, and it is collected for exactly one purpose — letting the customer find their own order later without an account. The draft order holds the slot reservation for a bounded window; if payment does not confirm within that window, the order expires and the place returns to the pool.

**Deliverables**
- `/s/{slug}/checkout` — slot picker, phone field with Thai mobile validation, order review, submit
- Server-side total recomputation from current menu prices
- Order creation transaction: reserve slot (5.3) → create `Order` + `OrderItem` rows → generate `publicCode`
- 10-minute payment expiry with a visible countdown, and a background job expiring stale drafts
- Inline purpose statement for the phone field

**Acceptance**
- Order is created in `PENDING_PAYMENT`, and **an unpaid order is invisible to the merchant queue and absent from every report (F05)**
- `publicCode` is unique and uses the ambiguity-free alphabet from 2.6
- Slot reservation and order creation succeed or fail together — no order without a reservation and no reservation without an order
- Expiry releases the slot and marks the order `EXPIRED`
- Only the phone number is collected; no name, email, or address field exists
- The checkout response contains no RL-3 restricted field

**Associated Activities**
- Build the checkout screen and slot picker
- Implement Thai mobile validation and normalisation
- Implement the creation transaction
- Implement the expiry job and the countdown UI
- Handle a price changed between cart and checkout with an explicit re-confirm

**Testing**
- Integration test: successful checkout creates one order, one reservation, and N order items atomically
- Integration test: a forced failure mid-transaction leaves no order and no reservation
- Unit test: `publicCode` alphabet excludes `0`, `O`, `1`, `I`
- Integration test: expiry after 10 minutes releases the slot and sets `EXPIRED`
- Integration test: an unpaid order does not appear in `/api/console/orders`
- Unit test: Thai mobile validation accepts `08x`, `09x`, `06x` and rejects malformed input

---

### 5.5 PromptPay QR Generation via Licensed Gateway

| Field | Detail |
|---|---|
| **WBS Code** | 5.5 |
| **Type** | Work Package |
| **Requirement** | F04 |
| **Owner** | M1 |
| **Surface** | Customer Web (display), Backend (creation) |
| **Red Line Touch** | **RL-1 (primary enforcement)** |

**Scope / Statement of Work**
Generate the PromptPay payment QR for an order by calling the licensed gateway's charge API with the **merchant's own** gateway account as the payee. Brew Ledger does not construct EMVCo PromptPay payloads itself, does not hold a Biller ID on behalf of merchants, and does not appear anywhere in the settlement chain. The charge is created server-side from the order's server-computed total; the client never supplies an amount.

**Deliverables**
- `POST /api/public/orders/{publicCode}/charge` creating a gateway charge scoped to the store's merchant gateway account
- `/s/{slug}/pay/{publicCode}` — QR display, amount, countdown, "I have paid" hint, and status polling
- `Payment` row recording provider, charge ID, amount, fee, and `settledToMerchantAccount`
- Gateway adapter method `createQr()` behind the 4.5 interface
- Error states: gateway unavailable, charge creation failed, order already paid, order expired

**Acceptance**
- **The charge names the merchant's gateway account as payee, and `settledToMerchantAccount` equals `Merchant.gatewayMerchantId` on every payment row (RL-1)**
- **Funds never route through a Brew Ledger account at any point in the flow; there is no intermediary charge, transfer, or payout step (RL-1)**
- **Brew Ledger does not generate PromptPay QR payloads itself and holds no Biller ID for merchant payments (RL-1)**
- The charge amount equals the server-computed order total; a client-supplied amount is ignored
- Creating a charge for an already-paid or expired order is refused idempotently
- Gateway failure produces a designed error state with a retry, not a blank screen

**Associated Activities**
- Implement `createQr()` in the gateway adapter
- Build the payment page with QR, amount, and countdown
- Implement status polling against a public status endpoint
- Implement every named error state
- Record the RL-1 sandbox evidence in the 1.6 register

**Pseudocode (charge creation)**
```typescript
async function createCharge(publicCode: string) {
  const order = await publicRepo.findPayableOrder(publicCode); // PENDING_PAYMENT only
  const merchant = await systemClient.merchant.findFirstOrThrow({
    where: { stores: { some: { id: order.storeId } } },
  });

  // RL-1: the payee is the MERCHANT's gateway account. There is no Brew Ledger
  // account in this call, and there is no code path that introduces one.
  assert(merchant.gatewayKycStatus === 'VERIFIED', 'GATEWAY_NOT_READY');
  assert(merchant.gatewayMerchantId, 'GATEWAY_ACCOUNT_MISSING');

  const charge = await gateway.createQr({
    payeeAccountId: merchant.gatewayMerchantId,   // merchant, always
    amountSatang:   order.totalSatang,            // server-computed, never client-supplied
    reference:      order.publicCode,
    metadata:       { orderId: order.id, storeId: order.storeId },
  });

  await systemClient.payment.upsert({
    where:  { orderId: order.id },
    create: {
      orderId: order.id,
      provider: merchant.gatewayProvider!,
      providerChargeId: charge.id,
      amountSatang: order.totalSatang,
      feeSatang: charge.estimatedFeeSatang,
      status: 'PENDING',
      idempotencyKey: `charge:${order.id}`,
      settledToMerchantAccount: merchant.gatewayMerchantId!,   // RL-1 evidence
      rawPayload: charge.raw,
    },
    update: {},   // idempotent: re-requesting returns the existing charge
  });

  return { qrImage: charge.qrImage, expiresAt: charge.expiresAt };
}
```

**Testing**
- Integration test (sandbox): payee on the created charge equals the merchant's gateway account ID (RL-1)
- Integration test (sandbox): completed sandbox payment settles to the merchant sandbox account (RL-1)
- Static test: no code path constructs an EMVCo PromptPay payload locally (RL-1)
- Static test: no Brew Ledger account identifier appears in any charge creation call (RL-1)
- Integration test: a client-supplied amount parameter is ignored
- Integration test: second charge request for the same order returns the same charge, not a new one
- Integration test: charge on an expired order → 409

---

### 5.6 Payment Webhook Handler (Idempotent)

| Field | Detail |
|---|---|
| **WBS Code** | 5.6 |
| **Type** | Work Package |
| **Requirement** | F05 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-1 |

**Scope / Statement of Work**
Receive, verify, and process gateway payment webhooks. This handler is the single point where an order becomes real: it flips the order to `ACCEPTED`, records the fee, deducts stock, and triggers the merchant notification. Gateways retry, duplicate, and reorder callbacks as a matter of normal operation, so idempotency is not a refinement here — a duplicate callback that double-deducts stock and double-counts revenue silently corrupts every downstream report. Signature verification is mandatory; an unverified webhook endpoint on a payments product is an open door.

**Deliverables**
- `POST /api/webhooks/{provider}` — signature verification, idempotent processing, fast acknowledgement
- Unique constraint on `Payment.idempotencyKey` as the database-level duplicate guard
- Processing transaction: verify → mark paid → set `paidAt`, `gatewayFeeSatang`, `feeBorneBy` → status `ACCEPTED` → deduct stock (6.8) → enqueue notification (5.8)
- Dead-letter table for webhooks that fail verification or processing, with an admin-visible list
- Ack-fast pattern: acknowledge within the gateway's timeout, process the heavy work in the same transaction only if it fits, otherwise enqueue

**Acceptance**
- **A duplicate or retried webhook for the same charge produces no second status transition, no second stock deduction, no second notification, and no second revenue row (F05)**
- Webhooks failing signature verification are rejected with 401 and recorded in the dead-letter table
- **Payment confirmation to order-in-queue completes within 5 seconds end to end**
- Out-of-order callbacks (refund arriving before payment) are handled without corrupting status
- A webhook for an unknown charge reference is recorded, not silently dropped
- The fee is recorded on every confirmation regardless of `absorbGatewayFee` (4.8)

**Associated Activities**
- Implement signature verification per the gateway's specification
- Implement the idempotent transaction with the unique-key guard
- Implement the dead-letter table and its admin view
- Build a replay harness that re-sends captured payloads
- Measure and record end-to-end confirmation latency

**Pseudocode (idempotent processing)**
```typescript
async function handleWebhook(provider: string, rawBody: Buffer, signature: string) {
  if (!gateway.verifyWebhook(rawBody, signature)) {
    await deadLetter.record(provider, rawBody, 'BAD_SIGNATURE');
    throw new UnauthorizedException();
  }

  const evt = gateway.parseEvent(rawBody);
  const key = `${provider}:${evt.chargeId}:${evt.type}`;   // stable across retries

  try {
    await systemClient.$transaction(async (tx) => {
      // Insert-first: the unique constraint is the guard. If a concurrent
      // duplicate is already processing, this throws and we exit cleanly.
      await tx.webhookEvent.create({ data: { idempotencyKey: key, payload: evt.raw } });

      const payment = await tx.payment.findUnique({
        where: { providerChargeId: evt.chargeId },
        include: { order: { include: { items: true } } },
      });
      if (!payment) { await deadLetter.record(provider, rawBody, 'UNKNOWN_CHARGE'); return; }

      if (evt.type === 'charge.complete' && payment.order.status === 'PENDING_PAYMENT') {
        const merchant = await tx.merchant.findFirstOrThrow({
          where: { stores: { some: { id: payment.order.storeId } } },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'PAID', feeSatang: evt.feeSatang },
        });
        await tx.order.update({
          where: { id: payment.orderId },
          data: {
            status: 'ACCEPTED',
            paidAt: new Date(),
            gatewayFeeSatang: evt.feeSatang,               // recorded even when absorbed
            feeBorneBy: merchant.absorbGatewayFee ? 'PLATFORM' : 'MERCHANT',
          },
        });
        await deductStockForOrder(tx, payment.order);       // 6.8 — inside the same tx
        await enqueueMerchantNotification(tx, payment.order); // 5.8
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) return;   // duplicate delivery: already handled, ack quietly
    throw e;
  }
}
```

**Testing**
- Integration test: the same webhook delivered 5 times produces exactly 1 status transition, 1 stock deduction set, 1 notification
- Integration test: 10 concurrent deliveries of the same payload produce exactly one processed result
- Integration test: bad signature → 401 and a dead-letter row
- Integration test: refund callback arriving before the payment callback does not corrupt order status
- Integration test: unknown charge reference → dead-letter row, no exception surfaced to the gateway
- Performance test: payment confirmed to order visible in the console queue in under 5 s (p95)
- Replay test: a captured production-shape payload set replays cleanly against a fresh database

---

### 5.7 Order Status Lifecycle

| Field | Detail |
|---|---|
| **WBS Code** | 5.7 |
| **Type** | Work Package |
| **Requirement** | F19 |
| **Owner** | M2 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-3 |

**Scope / Statement of Work**
Define and enforce the order state machine as server-side transition rules rather than as UI conventions. The forward path is `PENDING_PAYMENT → ACCEPTED → PREPARING → READY → COLLECTED`, with `CANCELLED` and `REFUNDED` as merchant-driven terminal branches and `EXPIRED` as the unpaid terminal state. Illegal transitions are rejected, and every transition is recorded with actor and timestamp so a disputed order can be reconstructed.

**Deliverables**
- `packages/shared/orderStatus.ts` — enum and the allowed-transition map, imported by both the API and both web apps
- Transition service validating every change and writing an `OrderStatusEvent` audit row
- Customer-facing status labels in Thai for each state
- Cash-channel orders start directly at `COLLECTED` (5.12)

**Acceptance**
- Illegal transitions (e.g. `COLLECTED → PREPARING`, `PENDING_PAYMENT → READY`) are rejected server-side with a specific error
- Every transition writes an audit row with actor, from-state, to-state, and timestamp
- `PENDING_PAYMENT` and `EXPIRED` orders never appear in the merchant queue or in P&L
- The transition map is defined once and imported everywhere; no surface reimplements it
- Customer-visible status text exposes state only, never internal reasons or merchant notes (RL-3)

**Associated Activities**
- Define the enum and transition map
- Implement the transition service and audit rows
- Refactor all status writes to route through the service
- Write Thai status labels

**Schema (transition map)**
```typescript
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ['ACCEPTED', 'EXPIRED', 'CANCELLED'],
  ACCEPTED:        ['PREPARING', 'CANCELLED'],
  PREPARING:       ['READY', 'CANCELLED'],
  READY:           ['COLLECTED', 'CANCELLED'],
  COLLECTED:       [],            // terminal
  CANCELLED:       ['REFUNDED'],  // refund follows cancellation
  REFUNDED:        [],            // terminal
  EXPIRED:         [],            // terminal
};
```

**Testing**
- Unit test: every illegal pair in the matrix is rejected
- Unit test: every legal pair is accepted
- Integration test: each transition writes exactly one audit row
- Integration test: a cash order is created directly in `COLLECTED`

---

### 5.8 Owner Order Inbox and Web Push Notification

| Field | Detail |
|---|---|
| **WBS Code** | 5.8 |
| **Type** | Work Package |
| **Requirement** | F17 |
| **Owner** | M1 (push), M2 (UI) |
| **Surface** | Owner Console |
| **Red Line Touch** | None |

**Scope / Statement of Work**
Notify the merchant the moment a **paid** order arrives, and present the order inbox as the console's working screen. Web Push via VAPID is the primary channel, but browser push on this stack is not dependable enough to be the only channel — iOS Safari support is materially weaker than Android Chrome, requires the site to be added to the Home Screen, and can be revoked silently. A polling fallback while the console tab is open is therefore mandatory, not optional, and the UI must never depend on a push having been received.

**Deliverables**
- Service worker in `apps/console` handling `push` and `notificationclick`
- VAPID key pair in Secret Manager; `PushSubscription` rows per merchant device
- Permission request placed **after** the first order is received rather than on first load, so the ask has context
- Polling fallback: 10-second interval on `/console/orders` while the tab is visible, paused when hidden
- Order inbox: new-order badge, audible chime, slot time, item lines with options, one primary action per state
- Browser support notice for merchants on unsupported browsers, with the polling behaviour explained

**Acceptance**
- A paid order appears in the inbox within 10 seconds even with push permission denied or unsupported
- Push notification, when granted, fires within 5 seconds of payment confirmation
- Notifications fire **only** for paid orders — never for `PENDING_PAYMENT`
- Clicking the notification opens the order detail directly
- Polling pauses when the tab is hidden and resumes on focus without a duplicate fetch storm
- The inbox is legible and actionable one-handed at 360 px width

**Associated Activities**
- Generate VAPID keys and implement subscription storage
- Write the service worker and test on Android Chrome and iOS Safari (Home Screen)
- Implement the visibility-aware polling hook
- Build the inbox UI with badge and chime
- Document per-browser support in the merchant help page

**Testing**
- Integration test: push denied → order still appears within 10 s via polling
- Integration test: push granted → notification delivered within 5 s
- Integration test: `PENDING_PAYMENT` order triggers no notification
- Manual test matrix: Android Chrome, iOS Safari (Home Screen), iOS Safari (tab), desktop Chrome
- Unit test: polling hook stops on `visibilitychange` to hidden
- Integration test: a duplicate webhook produces exactly one notification

---

### 5.9 Order Status Update (Merchant Actions)

| Field | Detail |
|---|---|
| **WBS Code** | 5.9 |
| **Type** | Work Package |
| **Requirement** | F19 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-3 |

**Scope / Statement of Work**
Give the merchant one-tap forward progression through the order states, designed for a person holding a milk jug. Each order row shows exactly one primary action reflecting its current state. Actions are optimistic in the UI with server reconciliation, and every update propagates to the customer's tracking page (5.10) on their next poll.

**Deliverables**
- `PATCH /api/console/orders/{id}/status` routing through the 5.7 transition service
- Order inbox rows with a single state-appropriate primary button (Start → Ready → Collected)
- Order detail view: items, options, slot, customer phone (masked with reveal), payment state, status timeline
- Optimistic UI with rollback and a clear error toast on server rejection
- Bulk "mark all ready" for a completed slot

**Acceptance**
- Each state shows exactly one primary action; no ambiguity about the next tap
- A rejected transition rolls the UI back and explains why
- Status changes are visible on the customer tracking page within 10 seconds
- A `STAFF` role can change status but sees no cost or profit figure on the order detail (RL-3)
- The customer phone number is masked by default and revealing it is logged

**Associated Activities**
- Build the status endpoint on top of the transition service
- Build inbox rows and detail view
- Implement optimistic update with rollback
- Implement bulk slot completion
- Add reveal logging for phone numbers

**Testing**
- Integration test: `ACCEPTED → PREPARING → READY → COLLECTED` succeeds in sequence
- Integration test: skipping a state is rejected and the UI rolls back
- Integration test: STAFF session order detail response contains no cost or profit field (RL-3)
- End-to-end test: a status change is reflected on the customer tracking page within 10 s
- Integration test: bulk mark-ready transitions only eligible orders

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

**Scope / Statement of Work**
Let a customer watch their own order without an account. Two entry points: the direct link `/o/{publicCode}` handed out at checkout, and `/track` where the customer enters phone number plus order code. Requiring both factors on the lookup route matters — a bare sequential code would let anyone enumerate other people's orders, which is both a privacy failure and an RL-3-adjacent leak of the store's order volume.

**Deliverables**
- `/o/{publicCode}` — status timeline, items, slot time, pick-up address, total paid
- `/track` — phone plus code lookup with rate limiting (10 attempts per phone per hour)
- Polling every 10 seconds while the page is visible, with a manual refresh control
- Terminal states: collected, cancelled with refund status, expired
- Store contact affordance for problems

**Acceptance**
- **The response exposes only this order: its code, status, slot, item names and quantities, and total paid. It exposes no unit cost, no margin, no other order, no order count, no store revenue, and no merchant data beyond the public store name and pick-up address (RL-3)**
- **The lookup route requires both phone number and code; a code alone returns nothing (RL-3)**
- Enumeration of adjacent codes yields no data
- Status updates appear within 10 seconds of the merchant's change
- No authentication is required at any point
- The page works after a full browser restart with only the link

**Associated Activities**
- Build both routes and the status timeline
- Implement the two-factor lookup and its rate limit
- Implement visibility-aware polling
- Design all terminal states
- Add the lookup route to the 8.4 isolation test suite

**Testing**
- Integration test: tracking response body scanned for `cost`, `margin`, `profit`, `stock`, `revenue` → zero matches (RL-3)
- Integration test: `/track` with a valid code and a wrong phone → not found (RL-3)
- Integration test: 11 lookup attempts in an hour → rate limited
- Integration test: sequential code enumeration returns no data for codes not paired with the correct phone
- End-to-end test: merchant marks ready → customer page reflects it within 10 s
- Integration test: the page's JS bundle contains no console API endpoint string

---

### 5.11 Order Cancellation and Automatic Refund

| Field | Detail |
|---|---|
| **WBS Code** | 5.11 |
| **Type** | Work Package |
| **Requirement** | F20 |
| **Owner** | M1 |
| **Surface** | Owner Console (action), Customer Web (visibility) |
| **Red Line Touch** | **RL-1** |

**Scope / Statement of Work**
Let the merchant cancel or reject a paid order — the realistic case is running out of an ingredient mid-morning — and refund the customer automatically through the gateway. The refund is issued by the gateway against the original charge and returns funds from the merchant's account to the customer; Brew Ledger neither holds nor moves the money. Cancellation also reverses the stock deduction and releases the slot, otherwise inventory and capacity silently drift wrong.

**Deliverables**
- `POST /api/console/orders/{id}/cancel` with a reason (out of stock / cannot make in time / other)
- Gateway `refund()` call against the original charge, full amount
- Compensating `StockLedger` entries with reason `CANCEL_REVERSAL`
- Slot release via 5.3
- Customer-visible refund state on the tracking page with expected timing
- Refund failure path: order marked `CANCELLED` with refund `FAILED`, alert raised (3.9), and a manual resolution note for the merchant

**Acceptance**
- **The refund is issued through the licensed gateway against the original charge; Brew Ledger initiates no transfer, holds no funds, and settles nothing itself (RL-1)**
- Cancellation reverses exactly the stock deducted for that order — no more, no less
- The slot place is released and becomes bookable again
- The customer sees the cancellation and the refund status without an account
- A failed refund never leaves the system silently inconsistent: it alerts and is visible to the merchant
- Cancelling an already-cancelled order is idempotent

**Associated Activities**
- Implement the cancel endpoint and the gateway refund call
- Implement compensating ledger entries and slot release
- Build the cancel UI with reason capture
- Build the customer-side refund state
- Implement the refund-failure alert path

**Pseudocode (cancel with refund)**
```typescript
async function cancelOrder(orderId: string, reason: CancelReason) {
  await tenantClient.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId }, include: { items: true, payment: true },
    });
    assertTransitionAllowed(order.status, 'CANCELLED');   // 5.7

    await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
    await reverseStockForOrder(tx, order);                // compensating ledger, 6.8
    if (order.timeSlotId) await releaseSlot(tx, order.timeSlotId);  // 5.3

    if (order.payment?.status === 'PAID') {
      // RL-1: the gateway refunds from the MERCHANT's account to the customer.
      // Brew Ledger issues no transfer and holds no float at any point.
      const result = await gateway.refund({
        chargeId: order.payment.providerChargeId,
        amountSatang: order.payment.amountSatang,
        idempotencyKey: `refund:${order.id}`,
      });
      await tx.payment.update({
        where: { id: order.payment.id },
        data: { status: result.ok ? 'REFUNDED' : 'REFUND_FAILED' },
      });
      if (!result.ok) await alerts.raise('REFUND_FAILED', { orderId });
      if (result.ok) await tx.order.update({
        where: { id: orderId }, data: { status: 'REFUNDED' },
      });
    }
  });
}
```

**Testing**
- Integration test (sandbox): cancellation of a paid order produces a gateway refund against the original charge (RL-1)
- Static test: no code path in the cancel flow references a Brew Ledger-held account or initiates a transfer (RL-1)
- Integration test: stock ledger net effect of order-then-cancel is exactly zero
- Integration test: the slot place is released and rebookable
- Integration test: repeated cancel calls produce one refund (idempotency key)
- Integration test: simulated refund failure sets `REFUND_FAILED` and raises an alert
- End-to-end test: the customer tracking page shows cancellation and refund state

---

### 5.12 Manual Cash Sale Entry

| Field | Detail |
|---|---|
| **WBS Code** | 5.12 |
| **Type** | Work Package |
| **Requirement** | F21 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-3 |

**Scope / Statement of Work**
Let the merchant record walk-in cash sales, which for most pilot stores will be the majority of revenue. Without this the P&L is not merely incomplete, it is misleading — costs from OCR bills would be counted in full against only the online slice of revenue, making every store look unprofitable. Entry must be fast enough to do between customers: tap items, tap quantity, save. Cash sales deduct stock and count in reports exactly like online orders, but carry no gateway fee and are created directly as `COLLECTED`.

**Deliverables**
- `/console/sales/quick` — menu grid, quantity steppers, running total, save
- Cash orders created with `channel = CASH`, `status = COLLECTED`, `gatewayFeeSatang = 0`
- Same stock deduction path as paid online orders (6.8)
- Edit and delete for cash sales within the same business day, with compensating ledger entries
- Optional backdating within the last 7 days for catch-up entry

**Acceptance**
- A 3-item cash sale is recorded in under 15 seconds
- Cash sales appear in daily P&L, profit per dish, and dashboard totals alongside online orders
- Cash sales carry zero gateway fee and are excluded from gateway fee breakdowns
- Stock is deducted identically to online orders
- Deleting a cash sale reverses its stock effect exactly
- Cash sale data is never exposed on Customer Web in any form (RL-3)

**Associated Activities**
- Build the quick-entry grid optimised for repeat taps
- Implement cash order creation reusing the order model
- Wire the shared stock deduction path
- Implement same-day edit/delete with compensating entries
- Implement backdating with a bounded window

**Testing**
- Integration test: cash sale creates an order with `channel = CASH`, `status = COLLECTED`, zero fee
- Integration test: cash sale deducts stock identically to a paid online order
- Integration test: daily P&L includes cash revenue
- Integration test: deleting a cash sale nets its stock ledger effect to zero
- Integration test: gateway fee breakdown excludes cash orders
- Usability test: 3-item entry completed in under 15 s

---

## Phase 6.0 — OCR, Inventory and Unit Costing

> **Phase goal:** ingredient costs update themselves from real purchase bills, so cost per cup is a live number rather than a figure typed once at setup and never touched again. This phase is the product's actual differentiator; it is also, per RL-2, entirely optional to the merchant. A store that never scans a bill must remain fully functional.

---

### 6.1 Bill Capture in the Browser

| Field | Detail |
|---|---|
| **WBS Code** | 6.1 |
| **Type** | Work Package |
| **Requirement** | F22 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-3 |

**Scope / Statement of Work**
Capture bill photographs from the phone browser with no native app. Primary path is `<input type="file" accept="image/*" capture="environment">`, which opens the camera on both Android Chrome and iOS Safari and is far more reliable across browsers than a custom `getUserMedia()` viewfinder; the MediaDevices path is offered as a progressive enhancement where supported, giving a live preview with framing guides. Images are downscaled and compressed client-side before upload because market receipts photographed at full sensor resolution are 6–10 MB and the merchant is on mobile data.

**Deliverables**
- `/console/expenses/capture` — capture or choose from gallery, preview, retake, upload
- File input path as default; MediaDevices viewfinder with framing guides where `getUserMedia` is available and permitted
- Client-side processing: EXIF orientation correction, downscale to 1600 px longest edge, JPEG quality 80
- Upload via the signed URL flow from 3.7 with a progress indicator
- Multi-image support for long receipts (up to 3 images per expense)
- Blur and low-light warning before upload, since a re-shoot at the counter is cheaper than a failed OCR pass

**Acceptance**
- Capture works on Android Chrome and iOS Safari without an app install
- A 10 MB camera photo is uploaded as under 800 KB after client-side processing
- Rotated photos are corrected before upload (EXIF handled)
- Permission denial falls back to gallery selection with a clear explanation
- The bill image is written to the private bucket and is never publicly readable (RL-3)
- Upload survives a slow connection with visible progress and a retry

**Associated Activities**
- Build the capture screen with both paths
- Implement EXIF-aware downscale and compression
- Wire signed URL upload with progress
- Implement the blur/low-light heuristic
- Test on the device matrix from 8.6

**Testing**
- Manual test matrix: Android Chrome, iOS Safari, desktop Chrome file picker
- Unit test: EXIF orientation 6 input produces an upright output
- Unit test: 4000×3000 input resizes to 1600 px longest edge
- Integration test: uploaded object is not publicly readable
- Integration test: permission denial path reaches gallery selection

---

### 6.2 PaddleOCR Service Deployment

| Field | Detail |
|---|---|
| **WBS Code** | 6.2 |
| **Type** | Work Package |
| **Requirement** | F23 |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | None |

**Scope / Statement of Work**
Deploy PaddleOCR as a self-hosted Cloud Run service with Thai and English recognition enabled in the same pass, because a Thai supplier receipt routinely mixes Thai item names with Latin-digit prices and English abbreviations. Self-hosting is chosen over a paid OCR API to keep per-scan marginal cost at zero, which matters directly for the unit economics of a 499 THB tier. Processing is asynchronous: the merchant should not watch a spinner.

**Deliverables**
- `ocr-worker` Cloud Run service with a pinned PaddleOCR image, Thai + English models baked into the image (no cold-download)
- `POST /ocr/parse` accepting a signed image URL and returning text blocks with bounding boxes and confidences
- Async job flow: expense created → job enqueued → worker processes → result written → console notified
- Pre-processing pipeline: greyscale, deskew, adaptive contrast, optional perspective correction
- Resource sizing (2 vCPU / 2 GB) with concurrency and a maximum instance cap to bound cost
- Timeout and retry policy with a permanent-failure state that routes the merchant to manual entry

**Acceptance**
- Cold start under 15 s and warm response under 8 s for a single-page receipt
- Both Thai and English text are recognised in the same image in one pass
- OCR failure never blocks expense creation — the merchant can always complete the expense manually
- Maximum instance cap prevents unbounded cost under a burst
- The worker reads images only via short-lived signed URLs and retains no copy

**Associated Activities**
- Build and pin the container image with models included
- Implement the parse endpoint and pre-processing
- Implement the async job queue and retry policy
- Benchmark on a sample set of real Thai receipts (spike from 1.2)
- Record accuracy findings for the 1.7 validation section

**Testing**
- Integration test: mixed Thai/English receipt returns text blocks in both scripts
- Performance test: warm response under 8 s at p95 on the sample set
- Integration test: worker failure marks the job `FAILED` and the expense remains manually completable
- Load test: 20 concurrent jobs stay within the instance cap
- Benchmark: measured field-level accuracy on ≥ 30 real receipts, recorded as a baseline

---

### 6.3 OCR Parsing and Line-item Extraction

| Field | Detail |
|---|---|
| **WBS Code** | 6.3 |
| **Type** | Work Package |
| **Requirement** | F23 |
| **Owner** | M2 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | None |

**Scope / Statement of Work**
Turn raw OCR text blocks into structured expense lines: item name, quantity, unit, and amount, plus a document-level total and date. Thai receipts vary enormously — printed till rolls, handwritten market slips, wholesaler invoices — so the parser is layered: geometric row grouping by vertical position, then pattern extraction for quantity/unit/price, then a total reconciliation check. Every extracted field carries a confidence that drives the review UI in 6.4; the parser is explicitly not trusted, and low confidence is surfaced rather than hidden.

**Deliverables**
- `packages/ocr-parse` — row grouping, field extraction, and confidence scoring
- Thai and English unit vocabulary: กก./กิโล/kg, ก./กรัม/g, ล./ลิตร/L, มล./ml, ขวด, ลัง, แพ็ค, ถุง, ใบ, ชิ้น
- Number normalisation: Thai digits (๐–๙), thousands separators, decimal comma/point variants
- Total reconciliation: sum of line amounts vs printed total, mismatch flagged rather than silently corrected
- Fuzzy matching of extracted names against the store's existing ingredients, with a suggested mapping above a similarity threshold
- Persisted `ExpenseLine` rows with `rawText` retained verbatim alongside the parsed values

**Acceptance**
- `rawText` is always preserved, so a merchant correction can be compared against what was actually read
- Every parsed field carries a confidence value used by 6.4
- A line-sum vs printed-total mismatch is flagged for review, never auto-adjusted
- Thai digits and Thai unit words parse correctly
- Fuzzy matching suggests an existing ingredient only above the configured threshold; below it, the line is left unmapped rather than guessed
- Parser failure yields empty lines with the raw text intact, not an exception

**Associated Activities**
- Implement row grouping by bounding-box geometry
- Build the unit vocabulary and number normaliser
- Implement field extraction and confidence scoring
- Implement total reconciliation and fuzzy ingredient matching
- Build a fixture set from real receipts and iterate

**Pseudocode (line extraction)**
```typescript
function extractLines(blocks: OcrBlock[]): ParsedLine[] {
  const rows = groupByVerticalProximity(blocks, { tolerancePx: 12 });

  return rows.map((row) => {
    const text = row.map(b => b.text).join(' ');
    // Rightmost numeric token on a receipt row is almost always the amount.
    const amount = parseThaiNumber(lastNumericToken(row));
    // Quantity + unit typically precede the name or sit just after it.
    const qtyUnit = matchQuantityUnit(text);   // "2 กก.", "500 g", "3 ขวด"

    return {
      rawText: text,                                   // never discarded
      qty: qtyUnit?.qty ?? null,
      unit: qtyUnit?.unit ?? null,
      amountSatang: amount != null ? Math.round(amount * 100) : null,
      confidence: Math.min(...row.map(b => b.confidence)),
      suggestedIngredientId: fuzzyMatchIngredient(stripQtyUnit(text), { minScore: 0.82 }),
    };
  }).filter(line => line.amountSatang != null || line.rawText.trim().length > 0);
}
```

**Testing**
- Unit test: Thai digits `๑๐๐` parse to 100
- Unit test: `2 กก.` yields qty 2, unit kg; `500 ก.` yields qty 500, unit g
- Unit test: thousands separators and both decimal conventions parse correctly
- Unit test: line sum mismatching the printed total sets the reconciliation flag
- Unit test: fuzzy match below threshold returns null rather than a wrong ingredient
- Fixture test: ≥ 30 real receipts parse without exception, with per-field accuracy recorded

---

### 6.4 OCR Review and Confirmation Screen

| Field | Detail |
|---|---|
| **WBS Code** | 6.4 |
| **Type** | Work Package |
| **Requirement** | F23 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2 |

**Scope / Statement of Work**
Present the parsed bill for the merchant to confirm or correct **before anything is written to costs or stock**. This confirmation gate is non-negotiable: OCR on a crumpled market slip will sometimes read 350 as 3.50, and an unconfirmed write of that number would silently corrupt the cost per cup on every menu item using that ingredient and then trigger a false cost drift alert. The screen shows the bill image beside the extracted lines, highlights low-confidence fields, and makes correcting a field faster than retyping the row.

**Deliverables**
- `/console/expenses/{id}/review` — split view of bill image and editable line list
- Low-confidence fields visually flagged and focused first
- Per-line ingredient mapping: link to existing ingredient, create new, or mark as non-inventory expense (gas, ice, rent)
- Unit selector per line with automatic base-unit conversion preview (6.5)
- Add-line and delete-line for what OCR missed or invented
- Total reconciliation banner when line sum and printed total disagree
- Single explicit "Confirm and update costs" action; nothing writes before it

**Acceptance**
- **No unit cost, stock movement, or profit recalculation occurs before the merchant presses confirm**
- Low-confidence fields are visibly distinguished from high-confidence ones
- A line can be mapped to a new ingredient without leaving the screen
- Non-inventory lines are recordable as expenses without any ingredient mapping (RL-2 — expense tracking must not require an inventory model)
- Reconciliation mismatch is shown and can be overridden with an explicit acknowledgement
- Abandoning the screen leaves the expense in `PARSED` and loses no correction already made

**Associated Activities**
- Build the split review layout for a phone viewport
- Implement inline editing with confidence highlighting
- Build ingredient mapping including inline creation
- Implement the confirm transaction calling 6.6 and 6.8
- Implement draft persistence of partial corrections

**Testing**
- Integration test: nothing is written to `Ingredient`, `CostHistory`, or `StockLedger` until confirm
- Widget test: fields below the confidence threshold render flagged
- Integration test: confirming with a corrected amount uses the corrected value, not the OCR value
- Integration test: a non-inventory line saves as an expense with no ingredient link
- Integration test: leaving and returning preserves partial edits

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

**Scope / Statement of Work**
Maintain the ingredient list and the conversion layer that makes costing arithmetic possible at all. Purchases arrive in kilograms, litres, bottles, and crates; recipes are written in grams and millilitres; both must resolve to one base unit per ingredient or every cost figure downstream is wrong. Pack-based units (a crate of 24 bottles) require a merchant-defined pack size, which the system asks for once, at the moment it is first needed, rather than demanding it up front.

**Deliverables**
- `/console/inventory` — ingredient list with name, base unit, current unit cost, current stock, reorder point
- Base units: `G`, `ML`, `PIECE`
- Conversion table for standard units: kg→g ×1000, L→ml ×1000, and identity conversions
- Pack definitions per ingredient (e.g. 1 ลัง = 24 ขวด, 1 ขวด = 1000 ml), prompted on first use of a pack unit
- Ingredient create/edit/archive, with archive preserving history
- Rejection of impossible conversions (volume unit against a mass-based ingredient) with an explanatory message

**Acceptance**
- Every ingredient has exactly one base unit and all stored quantities are in it
- kg→g and L→ml conversions are exact
- A pack unit without a defined pack size prompts once and then converts thereafter
- Incompatible conversions are refused, never silently coerced
- **Creating an ingredient is never required to sell; the inventory list may remain empty and the store still functions (RL-2)**
- Archiving preserves historical ledger and cost rows

**Associated Activities**
- Build the ingredient list and editor
- Implement the conversion table and pack definitions
- Implement the first-use pack size prompt
- Wire conversion into the OCR confirm path and the BOM editor
- Implement archive semantics

**Pseudocode (conversion)**
```typescript
const TO_BASE: Record<string, { base: BaseUnit; factor: number }> = {
  kg: { base: 'G',  factor: 1000 },  g:  { base: 'G',  factor: 1 },
  l:  { base: 'ML', factor: 1000 },  ml: { base: 'ML', factor: 1 },
};

function toBaseUnit(qty: number, unit: string, ing: Ingredient, packs: PackDef[]): number {
  const u = normalizeUnit(unit);                     // "กก." -> "kg", "ล." -> "l"

  const std = TO_BASE[u];
  if (std) {
    if (std.base !== ing.baseUnit) {
      throw new BadRequestException(`INCOMPATIBLE_UNIT: ${u} -> ${ing.baseUnit}`);
    }
    return qty * std.factor;
  }

  const pack = packs.find(p => p.ingredientId === ing.id && p.unit === u);
  if (!pack) throw new PackSizeRequiredException(u);  // ask once, then remember
  return qty * pack.qtyInBaseUnit;
}
```

**Testing**
- Unit test: 2 kg → 2000 g
- Unit test: 1.5 L → 1500 ml
- Unit test: ml against a `G`-based ingredient throws `INCOMPATIBLE_UNIT`
- Unit test: undefined pack unit throws `PackSizeRequiredException`, and defining it makes the conversion succeed
- Unit test: Thai unit abbreviations normalise correctly
- Integration test: a store with zero ingredients takes and fulfils an order successfully (RL-2)

---

### 6.6 Unit Cost Update Engine

| Field | Detail |
|---|---|
| **WBS Code** | 6.6 |
| **Type** | Work Package |
| **Requirement** | F24 |
| **Owner** | M2 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-2, RL-3 |

**Scope / Statement of Work**
On confirmation of an expense, recompute each mapped ingredient's cost per base unit and append a `CostHistory` row. This is the mechanism the whole product rests on: competing systems deduct stock automatically but leave the *price* frozen at whatever was typed during setup, so their margin figures rot quietly. The new unit cost is taken from the most recent confirmed purchase, with the history retained so drift detection (7.4) has a baseline and so any reported margin can be traced to the bill that produced it.

**Deliverables**
- `updateUnitCosts(expenseId)` running inside the 6.4 confirm transaction
- Cost per base unit = line amount ÷ quantity converted to base units
- Append-only `CostHistory` with `effectiveAt` and `sourceExpenseId`
- Sanity guard: a new unit cost more than 3× or under one third of the current value is flagged for explicit confirmation rather than applied silently
- Downstream trigger of cost-per-cup recomputation (6.9) and drift evaluation (7.4)

**Acceptance**
- Confirming a bill updates the unit cost of every mapped ingredient in that bill
- Cost history is append-only; prior values are never overwritten
- Unmapped and non-inventory lines update no ingredient cost
- An implausible jump is surfaced for confirmation instead of applied silently
- **Ingredients with no BOM reference still update their cost; nothing errors because a recipe is missing (RL-2)**
- **No unit cost value is ever reachable from any Customer Web endpoint (RL-3)**

**Associated Activities**
- Implement the cost computation and history append
- Implement the sanity guard and its confirmation path
- Wire the downstream recomputation and drift triggers
- Handle zero-quantity and zero-amount lines defensively

**Pseudocode**
```typescript
async function updateUnitCosts(tx: Prisma.TransactionClient, expenseId: string) {
  const lines = await tx.expenseLine.findMany({
    where: { expenseId, isConfirmed: true, ingredientId: { not: null } },
  });

  for (const line of lines) {
    if (!line.qty || !line.amountSatang || line.qty <= 0) continue;  // never divide by zero

    const ing = await tx.ingredient.findUniqueOrThrow({ where: { id: line.ingredientId! } });
    const qtyBase = toBaseUnit(line.qty, line.unit!, ing, await packsFor(tx, ing.id));
    const newUnitCost = Math.round(line.amountSatang / qtyBase);      // satang per base unit

    if (ing.unitCostSatang > 0) {
      const ratio = newUnitCost / ing.unitCostSatang;
      if (ratio > 3 || ratio < 1 / 3) {
        await flagForConfirmation(tx, line.id, newUnitCost, ratio);   // do not apply silently
        continue;
      }
    }

    await tx.ingredient.update({
      where: { id: ing.id }, data: { unitCostSatang: newUnitCost },
    });
    await tx.costHistory.create({
      data: { ingredientId: ing.id, unitCostSatang: newUnitCost, sourceExpenseId: expenseId },
    });
  }
}
```

**Testing**
- Unit test: 2 kg of coffee beans at 700 THB → 35 satang per gram
- Unit test: cost history row is appended and the previous row is unchanged
- Unit test: a 5× jump is flagged rather than applied
- Unit test: zero quantity is skipped without an exception
- Integration test: confirming a bill updates every mapped ingredient in one transaction
- Integration test: an ingredient used in no recipe still receives its cost update (RL-2)

---

### 6.7 Suggested BOM and Optional Recipe Editor

| Field | Detail |
|---|---|
| **WBS Code** | 6.7 |
| **Type** | Work Package |
| **Requirement** | F26 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | **RL-2 (primary enforcement)** |

**Scope / Statement of Work**
Offer a standard recipe the merchant adjusts rather than a blank form they must author. For recognised drink names (latte, americano, cappuccino, Thai tea, matcha latte, and similar), propose a starting BOM with typical quantities and let the merchant tweak the two or three numbers they care about. The framing matters as much as the mechanism: the recipe is an optional accelerator that unlocks cost per cup, never a gate in front of selling, and no screen may imply otherwise.

**Deliverables**
- Seed template library of ~15 common Thai cafe drinks with typical ingredient quantities
- Recipe block inside the menu item editor (4.4), collapsed by default
- "Use suggested recipe" action pre-filling lines the merchant can edit or delete
- Per-line ingredient picker with inline creation and unit selection converting to base units
- Live cost-per-cup and margin preview updating as the merchant edits
- Explicit empty state stating plainly that the item sells fine without a recipe, and naming exactly what a recipe adds

**Acceptance**
- **The recipe editor is reachable only by deliberate expansion; it never opens automatically and never blocks any save (RL-2)**
- **No error, warning, badge, banner, or disabled control anywhere in the console pressures the merchant to complete a recipe (RL-2)**
- Applying a suggested recipe creates any missing ingredients with sensible base units
- Cost-per-cup preview updates within 500 ms of an edit
- Deleting every recipe line returns the item to `null` cost per cup without error
- Suggested quantities are visibly marked as suggestions, not measurements of this store's actual recipe

**Associated Activities**
- Build the template library
- Build the recipe block and line editor
- Implement suggestion application with ingredient auto-creation
- Implement the live preview
- Audit every console string for pressuring language about recipes

**Testing**
- UI test: recipe block starts collapsed and save works while it is untouched
- Integration test: applying a suggested recipe creates missing ingredients and BOM lines
- Integration test: deleting all BOM lines sets cost per cup to `null` with no error
- Static test: console copy strings contain no blocking or nagging recipe language (RL-2)
- Unit test: each template's quantities convert cleanly to base units

---

### 6.8 Automatic Stock Deduction and Stock Ledger

| Field | Detail |
|---|---|
| **WBS Code** | 6.8 |
| **Type** | Work Package |
| **Requirement** | F25 |
| **Owner** | M2 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-2, RL-3 |

**Scope / Statement of Work**
Deduct ingredients automatically when an order is paid (5.6) or a cash sale is recorded (5.12), by walking each order line's BOM and writing negative ledger entries in base units. Stock level is always derived from the append-only ledger, never stored as a mutable number, so every figure on the inventory screen can be traced to the movements that produced it and a cancellation can be reversed exactly. Order lines whose menu item has no BOM simply produce no movement — silently and correctly.

**Deliverables**
- `deductStockForOrder(tx, order)` called inside the payment confirmation transaction
- `reverseStockForOrder(tx, order)` for cancellations, writing compensating entries rather than deleting rows
- Purchase entries written on expense confirmation (6.4)
- Manual adjustment entry with a required reason (waste, spillage, stock count correction)
- Derived stock level query with an optional materialised snapshot if the ledger scan proves slow
- Ledger view per ingredient in the console showing every movement with its source order or expense

**Acceptance**
- A paid order deducts exactly `Σ (bom_line.qtyBaseUnit × orderItem.qty)` per ingredient
- **An order line whose menu item has no BOM deducts nothing and raises no error or warning (RL-2)**
- Order-then-cancel nets to exactly zero across the ledger
- The ledger is append-only; no code path updates or deletes a ledger row
- Stock may go negative and is displayed as such rather than clamped, because a clamped figure hides a real recipe or entry error
- **No stock quantity is reachable from any Customer Web endpoint (RL-3)**

**Associated Activities**
- Implement deduction and reversal helpers
- Wire into the payment, cash sale, cancellation, and expense paths
- Build the manual adjustment entry
- Build the per-ingredient ledger view
- Benchmark the derived stock query and add a snapshot if needed

**Pseudocode**
```typescript
async function deductStockForOrder(tx: Prisma.TransactionClient, order: OrderWithItems) {
  for (const line of order.items) {
    const bom = await tx.bomLine.findMany({ where: { menuItemId: line.menuItemId } });

    // RL-2: no BOM is a normal, supported state. Nothing to deduct; move on.
    if (bom.length === 0) continue;

    for (const b of bom) {
      await tx.stockLedger.create({
        data: {
          storeId: order.storeId,
          ingredientId: b.ingredientId,
          deltaBaseUnit: -(b.qtyBaseUnit * line.qty),
          reason: 'SALE',
          refType: 'order',
          refId: order.id,
        },
      });
    }
  }
}
```

**Testing**
- Unit test: 2 lattes at 18 g beans each deduct 36 g
- Unit test: a menu item with no BOM deducts nothing and throws nothing (RL-2)
- Integration test: order then cancel nets the ledger to zero for every affected ingredient
- Integration test: a duplicate webhook produces exactly one deduction set (with 5.6)
- Integration test: cash sale deducts identically to an online order
- Unit test: derived stock equals the sum of ledger deltas
- Performance test: derived stock for 50 ingredients across 10,000 ledger rows resolves under 300 ms

---

### 6.9 Cost per Cup and Profit Recalculation

| Field | Detail |
|---|---|
| **WBS Code** | 6.9 |
| **Type** | Work Package |
| **Requirement** | F24, F28 |
| **Owner** | M2 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | **RL-2, RL-3** |

**Scope / Statement of Work**
Compute cost per cup and gross margin per menu item from current ingredient unit costs, and snapshot the cost onto each order line at sale time so historical profit reflects the cost that actually applied that day rather than today's price. Menu items without a BOM return `null`, not zero — the distinction is the whole of RL-2 expressed in arithmetic, because a zero would present a 100% margin and silently poison every report the merchant is meant to trust.

**Deliverables**
- `costPerCup(menuItemId): number | null` — sum over BOM lines of quantity times current unit cost
- Cost snapshot written to `OrderItem.unitCostSatang` at payment confirmation and at cash sale creation
- Recalculation trigger on unit cost change (6.6) and on BOM change (6.7)
- Console display convention for `null`: an explicit "cost not tracked" state with a one-tap route into the optional recipe editor, never a zero and never an error
- Margin computation `(price − cost) ÷ price`, defined only where cost is non-null

**Acceptance**
- **A menu item with no BOM returns `null` cost and `null` margin, is displayed as "not tracked", and is never rendered as zero cost or 100% margin (RL-2)**
- Historical orders retain their snapshot cost when ingredient prices later change
- Changing an ingredient's unit cost updates the current cost per cup of every menu item using it
- Partial BOM (some ingredients mapped, some not) is treated as tracked with an explicit incompleteness note, not silently understated
- **Cost per cup and margin are never reachable from any Customer Web endpoint (RL-3)**

**Associated Activities**
- Implement the calculation and the null semantics
- Implement snapshotting on both sale paths
- Wire recalculation triggers
- Build the "not tracked" display state and its route into the recipe editor
- Audit every report for null-safe handling

**Pseudocode**
```typescript
async function costPerCup(menuItemId: string): Promise<number | null> {
  const bom = await tenantClient.bomLine.findMany({
    where: { menuItemId }, include: { ingredient: true },
  });

  // RL-2: no recipe means the cost is UNKNOWN, not zero.
  // Returning 0 here would render a 100% margin and quietly corrupt every
  // report the merchant is supposed to be able to trust.
  if (bom.length === 0) return null;

  return bom.reduce(
    (sum, line) => sum + Math.round(line.qtyBaseUnit * line.ingredient.unitCostSatang),
    0,
  );
}

function marginPct(priceSatang: number, costSatang: number | null): number | null {
  if (costSatang == null || priceSatang <= 0) return null;
  return (priceSatang - costSatang) / priceSatang;
}
```

**Testing**
- Unit test: item with no BOM → `costPerCup` is `null` and `marginPct` is `null` (RL-2)
- Unit test: latte at 18 g beans (35 satang/g) plus 150 ml milk (4 satang/ml) → 630 + 600 = 1230 satang
- Integration test: an ingredient price change updates current cost per cup but not historical snapshots
- Integration test: order line cost snapshot is written at payment confirmation
- UI test: a null-cost item renders "not tracked", never 0.00 or 100%
- Unit test: every report function handles a null cost without throwing

---

## Phase 7.0 — Dashboard, Alerts and Reports

> **Phase goal and MVP KPI:** a merchant who has used the product for one week opens it and sees a **correct Profit per Dish ranking**. That single screen is the stated success criterion of the MVP. Everything else in this phase supports it or supports the daily habit that keeps the merchant coming back to it.

---

### 7.1 Dashboard Summary

| Field | Detail |
|---|---|
| **WBS Code** | 7.1 |
| **Type** | Work Package |
| **Requirement** | F14 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2, RL-3 |

**Scope / Statement of Work**
Build the console landing screen: today's sales, net profit, expenses, and order count, plus best sellers and today's alerts. This is the screen the merchant opens between customers, so it must answer "how is today going" in one glance without scrolling and load fast enough that they do not put the phone down. Load target is 2 seconds, which constrains the query design rather than being an aspiration bolted on afterwards.

**Deliverables**
- `/console` dashboard with four headline metric cards: today's sales, net profit, expenses, order count
- Best sellers list for today (top 4 by quantity)
- Alerts strip surfacing 7.3 and 7.4 items
- 7-day revenue mini chart
- Quick actions: record cash sale (5.12), scan bill (6.1), open/close store
- Comparison against yesterday on each metric card

**Acceptance**
- **Dashboard loads in ≤ 2 seconds on a mid-range phone over 4G**
- Figures include both online and cash orders
- Net profit is computed only from orders with a known cost; items with untracked cost are excluded and the exclusion is stated on the card, never silently averaged in as zero (RL-2)
- Gateway fee is shown as an informational line when absorbed and as a deduction when borne by the merchant (4.8)
- A `STAFF` session sees no profit, cost, or expense figure (RL-3, 4.2)
- Zero-activity days render a designed empty state, not zeros with no explanation

**Associated Activities**
- Design and implement the four aggregate queries with covering indexes
- Build metric cards, best sellers, and the mini chart
- Wire the alerts strip
- Implement the untracked-cost exclusion note
- Benchmark and tune until under the 2 s budget

**Pseudocode (today aggregate)**
```sql
-- Single round trip, index-backed on (storeId, status, createdAt).
SELECT
  COALESCE(SUM(o."totalSatang"), 0)                                    AS revenue,
  COALESCE(SUM(o."gatewayFeeSatang") FILTER (
    WHERE o."feeBorneBy" = 'MERCHANT'), 0)                             AS merchant_borne_fee,
  COALESCE(SUM(o."gatewayFeeSatang") FILTER (
    WHERE o."feeBorneBy" = 'PLATFORM'), 0)                             AS absorbed_fee,
  COUNT(*)                                                             AS order_count,
  -- RL-2: lines with NULL cost are EXCLUDED from cost, never coerced to 0.
  COALESCE(SUM(oi."unitCostSatang" * oi.qty) FILTER (
    WHERE oi."unitCostSatang" IS NOT NULL), 0)                         AS known_cogs,
  COUNT(*) FILTER (WHERE oi."unitCostSatang" IS NULL)                  AS untracked_lines
FROM "Order" o
JOIN "OrderItem" oi ON oi."orderId" = o.id
WHERE o."storeId" = $1
  AND o.status IN ('ACCEPTED','PREPARING','READY','COLLECTED')
  AND o."createdAt" >= $2 AND o."createdAt" < $3;
```

**Testing**
- Performance test: dashboard endpoint p95 under 800 ms server-side; full page under 2 s on a throttled 4G profile
- Integration test: totals include both cash and online orders
- Integration test: an order line with null cost is excluded from COGS and increments `untracked_lines`
- Integration test: STAFF session response contains no profit or cost key (RL-3)
- Integration test: a day with no orders renders the empty state

---

### 7.2 AI Brief

| Field | Detail |
|---|---|
| **WBS Code** | 7.2 |
| **Type** | Work Package |
| **Requirement** | F13 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2, RL-3 |

**Scope / Statement of Work**
Generate the short morning brief at the top of the dashboard: what to buy or prepare before opening, based on derived stock levels, consumption rate over the trailing period, and orders already booked into today's slots. The brief is deterministic first and generative second — the underlying numbers are computed by the reporting layer, and language generation only phrases them. That ordering matters because a hallucinated quantity in a shopping list destroys trust in one morning, and because a store with no recipes must still get something useful rather than an empty box.

**Deliverables**
- Deterministic brief generator producing structured items: ingredient, projected shortfall, coverage in days, driving reason
- Projection from trailing 7-day consumption plus quantities already committed to today's booked slots
- Optional natural-language phrasing layer in Thai over the structured output
- Brief card on the dashboard with a one-tap route to the inventory screen
- Fallback content for stores with no BOM: booked orders by slot and their totals, which requires no costing at all (RL-2)
- Regeneration on first open each day and on demand

**Acceptance**
- Every number in the brief is traceable to a query result; the language layer introduces no figure of its own
- Projection accounts for orders already booked into today's remaining slots
- **A store with no recipes and no ingredients receives a useful brief rather than an empty or error state (RL-2)**
- The brief never references another store's data (RL-3)
- Generation completes within the dashboard's 2 s budget or degrades to the structured list without blocking paint

**Associated Activities**
- Implement consumption rate and shortfall projection
- Implement the booked-order commitment calculation
- Build the phrasing layer with strict input binding
- Build the card and the no-BOM fallback
- Cache per store per day with manual regeneration

**Testing**
- Unit test: shortfall projection with 7 days of consumption and 12 booked cups produces the expected quantity
- Unit test: the phrasing layer emits no number absent from its structured input
- Integration test: a store with zero ingredients receives the fallback brief with no error (RL-2)
- Integration test: brief generation is scoped to the requesting merchant only
- Performance test: cached brief adds under 200 ms to dashboard load

---

### 7.3 Low Stock Alerts

| Field | Detail |
|---|---|
| **WBS Code** | 7.3 |
| **Type** | Work Package |
| **Requirement** | F16 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2 |

**Scope / Statement of Work**
Warn when an ingredient is projected to run out, using real consumption rate rather than a static minimum quantity. A fixed reorder point is nearly useless for a cafe whose weekday and weekend volumes differ by a factor of three; days-of-cover derived from the trailing consumption rate is what the merchant can act on. Alerts are deduplicated per ingredient per day so the strip stays readable.

**Deliverables**
- Daily evaluation job computing days of cover per ingredient from trailing 14-day consumption
- Alert rows generated when days of cover falls below the ingredient's threshold (default 3 days, per-ingredient override)
- Alerts strip on the dashboard and a full alerts list with acknowledge and snooze
- Deduplication: one open alert per ingredient at a time
- Included in the AI Brief (7.2)

**Acceptance**
- Alerts are based on measured consumption, not a static quantity floor
- One open alert per ingredient at most, regardless of evaluation frequency
- Acknowledging an alert closes it, and it does not reappear until conditions change
- **Stores with no recipes generate no low stock alerts and see no error, empty-state nag, or prompt to add recipes (RL-2)**
- Ingredients with fewer than 7 days of consumption history are marked as low-confidence rather than alerted on aggressively

**Associated Activities**
- Implement the consumption rate and days-of-cover calculation
- Implement the evaluation job and deduplication
- Build the alerts strip and full list with acknowledge/snooze
- Implement per-ingredient thresholds

**Testing**
- Unit test: 500 g stock at 100 g/day → 5 days cover → no alert at a 3-day threshold
- Unit test: 200 g stock at 100 g/day → 2 days cover → alert raised
- Integration test: repeated evaluations produce one open alert, not many
- Integration test: a store with no BOM produces zero alerts and no error (RL-2)
- Unit test: fewer than 7 days of history yields a low-confidence flag

---

### 7.4 Cost Drift Alert

| Field | Detail |
|---|---|
| **WBS Code** | 7.4 |
| **Type** | Work Package |
| **Requirement** | F15 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2, RL-3 |

**Scope / Statement of Work**
Detect when an ingredient's unit cost rises beyond a threshold against its trailing baseline, and tell the merchant specifically which menu items are affected and what their margin is now — not merely that a price went up. This is the retention mechanic of the paid tier: a bean price rise that quietly turns a signature drink from a 60% margin to a 35% margin is exactly the invisible loss the target user cannot currently see, and naming the affected drinks and their new margins is the difference between an interesting notification and an actionable one.

**Deliverables**
- Drift evaluation on every unit cost update (6.6), comparing against the trailing 30-day median from `CostHistory`
- Configurable threshold, default +15%
- Impact analysis per alert: affected menu items, old margin, new margin, per-cup profit change
- Suggested price adjustment restoring the prior margin, presented as information rather than an automatic change
- Alert detail screen and dashboard strip entry

**Acceptance**
- An ingredient cost rise above threshold generates exactly one alert naming every affected menu item
- Old and new margin are both shown per affected item, computed from real BOM quantities
- No price is ever changed automatically; the suggestion is advisory only
- **Menu items without a BOM are unaffected and are never listed in an alert, and their absence produces no prompt to add recipes (RL-2)**
- **Alert content is never reachable from any Customer Web endpoint (RL-3)**
- A cost decrease below the negative threshold is optionally surfaced as good news, never as a warning

**Associated Activities**
- Implement baseline computation from cost history
- Implement threshold evaluation and impact analysis
- Build the alert detail screen
- Implement the suggested price calculation
- Wire into the alerts strip and AI Brief

**Pseudocode**
```typescript
async function evaluateCostDrift(ingredientId: string, newCost: number) {
  const baseline = await trailingMedianUnitCost(ingredientId, { days: 30 });
  if (!baseline) return;                              // insufficient history

  const drift = (newCost - baseline) / baseline;
  if (drift < DRIFT_THRESHOLD) return;                // default 0.15

  const affected = await tenantClient.bomLine.findMany({
    where: { ingredientId }, include: { menuItem: true },
  });
  // RL-2: items with no BOM simply do not appear here. That is correct and silent.

  const impacts = [];
  for (const line of affected) {
    const oldCost = await costPerCupWith(line.menuItemId, ingredientId, baseline);
    const newCostPerCup = await costPerCup(line.menuItemId);
    if (oldCost == null || newCostPerCup == null) continue;
    impacts.push({
      menuItemId: line.menuItemId,
      name: line.menuItem.name,
      oldMargin: marginPct(line.menuItem.priceSatang, oldCost),
      newMargin: marginPct(line.menuItem.priceSatang, newCostPerCup),
      profitDeltaSatang: newCostPerCup - oldCost,
      suggestedPriceSatang: priceForMargin(newCostPerCup, marginPct(line.menuItem.priceSatang, oldCost)!),
    });
  }

  if (impacts.length) await alerts.raise('COST_DRIFT', { ingredientId, drift, impacts });
}
```

**Testing**
- Unit test: a 20% rise against a 30-day median baseline raises an alert; a 10% rise does not
- Unit test: impact analysis lists every menu item using the ingredient with correct old and new margins
- Unit test: items with no BOM are absent from the impact list and generate no prompt (RL-2)
- Integration test: no menu price is mutated by an alert
- Unit test: insufficient cost history produces no alert rather than a false positive

---

### 7.5 Daily P&L Report

| Field | Detail |
|---|---|
| **WBS Code** | 7.5 |
| **Type** | Work Package |
| **Requirement** | F27 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-2, RL-3 |

**Scope / Statement of Work**
Produce the daily profit and loss view: revenue (online plus cash), ingredient cost of goods sold, other expenses from the OCR path, gateway fees, and net profit, with a day list for navigation. Honesty about incompleteness is a design requirement here — where cost is untracked for some items, the report says so on its face rather than presenting a confident net profit built partly on zeros.

**Deliverables**
- `/console/reports/pnl` — day selector, revenue breakdown by channel, COGS, expenses by category, gateway fee line, net profit with margin percentage
- Previous-day list with net profit per day
- Untracked-cost disclosure showing the count and revenue share of items with no cost basis
- Non-inventory expenses (gas, ice, rent) allocated to their day
- Drill-down from any line to its underlying orders or expenses

**Acceptance**
- Revenue includes both online and cash channels, separately identified
- **Order lines with null cost are excluded from COGS and disclosed as untracked; they are never treated as zero cost (RL-2)**
- Gateway fee appears as an informational line when absorbed and a deduction when merchant-borne (4.8)
- Net profit equals revenue − known COGS − expenses − merchant-borne fees, exactly
- Every figure drills down to its source rows
- **No P&L figure is reachable from any Customer Web endpoint (RL-3)**

**Associated Activities**
- Implement the daily aggregation query
- Build the report UI with the day list
- Implement the untracked disclosure
- Implement drill-downs
- Reconcile against a hand-computed fixture day

**Testing**
- Unit test: hand-computed fixture day reconciles to the report exactly
- Unit test: null-cost lines are excluded from COGS and counted in the disclosure (RL-2)
- Unit test: absorbed fees do not reduce net profit; merchant-borne fees do
- Integration test: cash sales appear in revenue
- Integration test: drill-down from COGS returns the contributing order lines
- Performance test: 90-day range loads under 2 s

---

### 7.6 Profit per Dish Report

| Field | Detail |
|---|---|
| **WBS Code** | 7.6 |
| **Type** | Work Package |
| **Requirement** | F28 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | **RL-2, RL-3** |

**Scope / Statement of Work**
Rank menu items by **total profit contribution** — unit margin times quantity sold — rather than by units sold or by revenue. This ranking is the MVP's headline KPI and the specific insight the target user cannot get today: the best-selling drink is frequently not the most profitable one, and a merchant working alone has no way to discover that. Items whose cost is untracked are listed in a clearly separated section with an explicit invitation, never mixed into the ranking as if they had zero cost and infinite margin.

**Deliverables**
- `/console/reports/profit-per-dish` — ranked list with period selector (today / 7 days / 30 days / custom)
- Per item: quantity sold, revenue, unit cost, unit margin, margin percentage, total profit contribution
- Default sort by total profit contribution, with sortable alternatives
- Separate "cost not tracked" section listing items outside the ranking with quantity and revenue only
- Insight callouts: highest volume but low margin; low volume but high margin
- Empty state for a store with no tracked costs, explaining what a recipe adds and linking to 6.7

**Acceptance**
- **Ranking is by total profit contribution by default, not by units sold or revenue (F28)**
- **Items with null cost are excluded from the ranking and shown separately; they never appear as zero cost or 100% margin (RL-2)**
- **The untracked section is informative, never a blocking gate or a nag; the report is fully usable with a partially tracked menu (RL-2)**
- A one-week-old store with tracked costs shows a correct ranking — the stated MVP success criterion
- **No profit-per-dish figure is reachable from any Customer Web endpoint (RL-3)**
- Correct figures across a partially tracked menu, verified against a hand-computed fixture

**Associated Activities**
- Implement the ranking query using order-line cost snapshots
- Build the report UI, sorting, and period selector
- Build the untracked section and empty state
- Implement insight callouts
- Reconcile against a hand-computed fixture

**Pseudocode**
```sql
-- Uses the per-line cost SNAPSHOT so historical profit reflects the cost that
-- actually applied at sale time, not today's ingredient price.
SELECT
  mi.id,
  mi.name,
  SUM(oi.qty)                                             AS qty_sold,
  SUM(oi.qty * oi."unitPriceSatang")                      AS revenue,
  AVG(oi."unitCostSatang")                                AS avg_unit_cost,
  SUM(oi.qty * (oi."unitPriceSatang" - oi."unitCostSatang")) AS total_profit
FROM "OrderItem" oi
JOIN "Order" o     ON o.id = oi."orderId"
JOIN "MenuItem" mi ON mi.id = oi."menuItemId"
WHERE o."storeId" = $1
  AND o.status IN ('ACCEPTED','PREPARING','READY','COLLECTED')
  AND o."createdAt" BETWEEN $2 AND $3
  AND oi."unitCostSatang" IS NOT NULL     -- RL-2: untracked items are reported
                                          -- separately, never ranked as zero cost
GROUP BY mi.id, mi.name
ORDER BY total_profit DESC;               -- profit contribution, not volume
```

**Testing**
- Unit test: a high-volume low-margin item ranks below a low-volume high-margin item when total profit is lower
- Unit test: null-cost items are absent from the ranking and present in the untracked section (RL-2)
- Unit test: hand-computed fixture reconciles exactly
- Integration test: the report renders correctly with a menu where only half the items have recipes (RL-2)
- Integration test: cash sales are included in the ranking
- Acceptance test: a simulated one-week-old store produces a correct ranking (MVP KPI)

---

### 7.7 Period Comparison and Gateway Fee Breakdown

| Field | Detail |
|---|---|
| **WBS Code** | 7.7 |
| **Type** | Work Package |
| **Requirement** | F29 |
| **Owner** | M2 |
| **Surface** | Owner Console |
| **Red Line Touch** | RL-3 |

**Scope / Statement of Work**
Provide monthly and yearly comparison charts of revenue, cost, and profit, with the gateway fee broken out explicitly. Transparency about the fee is deliberate commercial policy: the merchant should see, throughout the PoC, precisely what is being absorbed on their behalf, so that switching absorption off later is a conversation about a known number rather than an unpleasant surprise.

**Deliverables**
- `/console/reports/overview` — month and year toggles, revenue/profit/cost bar chart, period-over-period deltas
- Gateway fee breakdown: total fees, percentage of revenue, absorbed versus merchant-borne split
- Headline cards: total revenue, net profit, total cost, order count for the selected period
- Comparison against the previous equivalent period with percentage deltas
- Charts rendered accessibly with values available as text, not colour alone

**Acceptance**
- Monthly and yearly aggregations are correct against fixture data
- The gateway fee line is always visible, including when fully absorbed
- Period-over-period deltas are correct including across month and year boundaries
- Charts render legibly at 360 px width
- Untracked-cost items are handled consistently with 7.5 and 7.6 (RL-2)
- **No comparison figure is reachable from any Customer Web endpoint (RL-3)**

**Associated Activities**
- Implement monthly and yearly aggregation queries with covering indexes
- Build charts and headline cards
- Implement fee breakdown and delta calculations
- Verify boundary handling across months and years

**Testing**
- Unit test: monthly aggregation over a 90-day fixture matches hand-computed totals
- Unit test: year-boundary comparison (January versus prior December) is correct
- Integration test: fee breakdown separates absorbed and merchant-borne correctly
- Widget test: charts render without overflow at 360 px
- Performance test: yearly view loads under 2 s

---

### 7.8 Reporting Query Performance and Indexing

| Field | Detail |
|---|---|
| **WBS Code** | 7.8 |
| **Type** | Work Package |
| **Requirement** | F14, F27, F28, F29 |
| **Owner** | M2 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | None |

**Scope / Statement of Work**
Make the reporting layer meet its 2-second budget under realistic pilot data volumes rather than under seed data. Generate a synthetic load equivalent to 30 stores over 3 months at 15 orders per store per day — roughly 40,000 orders and 100,000 order lines — and tune indexes and queries against it. Reporting slowness is not cosmetic on this product: a merchant checking between customers who waits five seconds simply stops checking, and the habit loop the retention model depends on never forms.

**Deliverables**
- Synthetic data generator at `/scripts/generate_load_data.ts`
- Query plan analysis (`EXPLAIN ANALYZE`) for every report query, recorded in `/docs/query_plans.md`
- Covering indexes for the identified access paths
- Optional daily rollup table if any query cannot meet budget with indexing alone, with a documented rebuild path
- Performance budget documented per endpoint and asserted in CI

**Acceptance**
- Every report endpoint responds within its budget at pilot-scale volume: dashboard 800 ms, daily P&L 1.2 s, profit per dish 1.2 s, yearly comparison 1.5 s (p95, server-side)
- No report query performs a sequential scan on `Order` or `OrderItem` at pilot volume
- Query plans are recorded for future comparison
- Any rollup table has a documented and tested rebuild procedure
- Performance assertions run in CI and fail the build on regression

**Associated Activities**
- Build the synthetic data generator
- Profile every report query and record plans
- Add indexes and re-measure
- Introduce rollups only where indexing is insufficient
- Add performance assertions to CI

**Testing**
- Performance test: each endpoint meets its p95 budget at 40,000 orders
- Query plan test: no sequential scan on the two large tables
- Regression test: CI fails if any endpoint exceeds its budget by more than 20%
- Integration test: rollup rebuild reproduces the same figures as direct aggregation

---

## Phase 8.0 — QA, Security Hardening and Deployment

> Unit tests for parsing, conversion, costing, and state transitions are folded into the entries that own that code (5.7, 6.3, 6.5, 6.6, 6.9). This phase covers only cross-cutting verification, the red line audits, and the path to production.

---

### 8.1 Unit and Integration Test Suite

| Field | Detail |
|---|---|
| **WBS Code** | 8.1 |
| **Type** | Work Package |
| **Requirement** | Quality baseline |
| **Owner** | M2 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | None |

**Scope / Statement of Work**
Consolidate the test suite and enforce coverage where correctness is expensive to get wrong: money arithmetic, unit conversion, state transitions, and the webhook path. Coverage percentage is a weak signal in general, so the gate is set on specific modules rather than globally — a project-wide 80% number would happily be satisfied while leaving the payment path untested.

**Deliverables**
- Test infrastructure: containerised Postgres for integration tests, a gateway mock implementing the adapter interface, and shared fixtures
- Coverage gates: ≥ 90% on `packages/shared` money and conversion utilities, the costing engine, the transition service, and the webhook handler
- Fixture library: a seeded store, a partially tracked menu, a set of parsed receipts, and a set of gateway payloads
- CI running the full suite on every pull request in under 10 minutes

**Acceptance**
- Coverage gates met on the four critical modules and enforced in CI
- The full suite runs in under 10 minutes and is deterministic across runs
- Integration tests run against real Postgres, not a mock
- The gateway mock covers success, failure, duplicate, out-of-order, and timeout cases

**Associated Activities**
- Set up the container-backed test harness and the gateway mock
- Build the fixture library
- Backfill tests to reach the module gates
- Wire coverage reporting and gates into CI
- Remove or fix flaky tests rather than retrying them

**Testing**
- CI test: suite passes from a clean clone
- CI test: dropping coverage on a gated module below its threshold fails the build
- Determinism test: the suite passes 10 consecutive runs without flake

---

### 8.2 End-to-End Test — Order to Report

| Field | Detail |
|---|---|
| **WBS Code** | 8.2 |
| **Type** | Work Package |
| **Requirement** | End-to-end verification |
| **Owner** | M1 |
| **Surface** | Both |
| **Red Line Touch** | RL-1, RL-2, RL-3 |

**Scope / Statement of Work**
Write the end-to-end test that walks the entire product across both surfaces: merchant signs up, sets up a store, publishes a menu with only some items given recipes, links a sandbox gateway account; customer opens the public link, orders, picks a slot, pays in the sandbox; the webhook confirms; the merchant is notified and progresses the order; the merchant scans a bill; and the reports show correct P&L and a correct Profit per Dish ranking with the untracked items separated. The deliberate mixed-tracking menu means the RL-2 path is exercised on every run rather than only in a dedicated test.

**Deliverables**
- Playwright suite at `e2e/full_flow.spec.ts` driving both surfaces in separate browser contexts
- Gateway sandbox integration with a scripted webhook callback
- Assertions at every stage, including the final report figures against a hand-computed expectation
- CI hook running the suite nightly and before any production deploy

**Acceptance**
- The test drives Customer Web and Owner Console in separate contexts with no shared session, proving the two-surface separation end to end (RL-3)
- Payment settles to the merchant sandbox account (RL-1)
- The menu under test has recipes on only some items, and the run completes with correct reports (RL-2)
- Final assertions cover: order status progression, stock deduction, unit cost update, daily P&L, and Profit per Dish ranking
- Runtime under 5 minutes and deterministic

**Associated Activities**
- Build the Playwright harness with two contexts
- Script the sandbox payment and webhook
- Write stage assertions and the hand-computed expected figures
- Wire into CI as a pre-deploy gate

**Testing (self)**
- The suite is the test; a green run before every production deploy is the gate

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

**Scope / Statement of Work**
Build a harness that attacks the webhook path the way a real gateway will: retries, duplicates, bursts, out-of-order events, malformed bodies, bad signatures, and delayed deliveries. This path is where a payments product quietly breaks, and where a defect is invisible until a merchant's report is already wrong.

**Deliverables**
- `scripts/webhook_harness.ts` with scenarios: duplicate ×5, concurrent burst ×10, out-of-order refund-before-charge, malformed JSON, bad signature, 30-second delayed delivery, unknown charge reference
- Assertion helpers verifying database state after each scenario
- Scenario report output listing pass/fail per case
- Included in CI as a pre-deploy gate

**Acceptance**
- Every scenario produces exactly one logical effect or a clean rejection — never partial state
- Duplicate delivery leaves exactly one status transition, one stock deduction set, and one notification
- Bad signature is rejected and dead-lettered
- Out-of-order events do not corrupt order status
- The harness runs in CI and fails the build on any scenario failure

**Associated Activities**
- Build the harness and scenario definitions
- Implement state assertion helpers
- Wire into CI
- Run against staging with the real gateway sandbox before production

**Testing**
- All seven scenarios pass locally, in CI, and against staging with the gateway sandbox

---

### 8.4 Data Isolation Penetration Test (RL-3)

| Field | Detail |
|---|---|
| **WBS Code** | 8.4 |
| **Type** | Work Package |
| **Requirement** | **RL-3** |
| **Owner** | M1, M2 reviews |
| **Surface** | Both |
| **Red Line Touch** | **RL-3 (verification)** |

**Scope / Statement of Work**
Attempt, deliberately and systematically, to reach merchant cost, profit, expense, stock, or sales data from the customer side. Assume an attacker who has a valid store link, can read the JavaScript bundle, can watch every network request, and will edit any parameter they find. This entry is not a code review — it is an adversarial exercise whose output is either a passing suite or a defect, and it runs on every build so that a future feature cannot reopen a closed hole.

**Deliverables**
- Automated isolation suite at `e2e/isolation.spec.ts` covering every attack below
- Attack matrix, documented and executed:
  1. Every `/api/public/*` response scanned for restricted terms (`cost`, `margin`, `profit`, `stock`, `expense`, `revenue`, `netProfit`, `unitCost`)
  2. Customer Web JS bundles scanned for the same terms and for console API paths
  3. `/api/console/*` called with no token, an expired token, a customer-context token, and a forged token
  4. Slug, order code, and ID enumeration across menu, slot, order, and tracking endpoints
  5. Parameter injection: `?includeCost=true`, `?fields=*`, `?select=unitCostSatang`, `?merchantId=`, GraphQL-style field expansion
  6. HTTP method tampering on public routes (PUT/PATCH/DELETE)
  7. Cross-tenant access: merchant A attempting every merchant B resource
  8. Cache and CDN inspection for merchant data cached on a public route
  9. Error message probing: verbose stack traces or entity dumps in 4xx/5xx bodies
  10. Order tracking with a valid code and a mismatched phone number
- Findings report at `/docs/isolation_test_report.md` with evidence per attack

**Acceptance**
- **All ten attack classes fail to yield any restricted data (RL-3)**
- No public response, bundle, cache entry, or error body contains a restricted term
- Console endpoints reject every unauthenticated and cross-tenant attempt, returning 404 rather than 403 where existence would otherwise be confirmed
- Parameter injection is ignored, never honoured
- The suite runs on every build; a failure blocks deployment
- The report is signed off by M1 and recorded in the 1.6 register

**Associated Activities**
- Write the automated suite for all ten classes
- Run a manual adversarial session with fresh eyes beyond the automated cases
- Fix every finding and re-run
- Write and sign off the report
- Wire the suite into the deploy gate

**Pseudocode (restricted-term scan)**
```typescript
const FORBIDDEN = [
  'cost', 'margin', 'profit', 'expense', 'stock', 'revenue',
  'netProfit', 'unitCost', 'costPerCup', 'bom', 'ingredient',
];

for (const route of PUBLIC_ROUTES) {
  const res  = await fetch(route);
  const body = (await res.text()).toLowerCase();
  for (const term of FORBIDDEN) {
    expect(body).not.toContain(term);   // RL-3: zero tolerance, every build
  }
}

for (const bundle of await listShopBundles()) {
  const js = (await fetchText(bundle)).toLowerCase();
  for (const term of FORBIDDEN) expect(js).not.toContain(term);
  expect(js).not.toContain('/api/console');
}
```

**Testing**
- The suite is the test; it runs on every build and blocks deploy on failure
- Manual adversarial session repeated once before pilot launch

---

### 8.5 Red Line Compliance Audit

| Field | Detail |
|---|---|
| **WBS Code** | 8.5 |
| **Type** | Work Package |
| **Requirement** | **RL-1, RL-2, RL-3** |
| **Owner** | M1 |
| **Surface** | Both |
| **Red Line Touch** | **RL-1, RL-2, RL-3 (final gate)** |

**Scope / Statement of Work**
Conduct the formal audit that closes out all three red lines before the pilot begins. Each red line is verified against evidence — a test name, a sandbox transaction record, a schema introspection result — rather than against an assurance. This is the final gate: a failing red line blocks the pilot regardless of how complete the rest of the product is, because a store cannot be onboarded onto a payment flow that has not been proven to settle to the store.

**Deliverables**
- `/docs/red_line_audit.md` with a verdict and evidence per red line
- **RL-1 evidence:** sandbox transaction records showing settlement to the merchant account; schema introspection showing no platform balance, float, escrow, or payout table; a static-analysis result showing no local PromptPay payload construction; the refund path traced end to end
- **RL-2 evidence:** a recorded run of a store created, published, and selling with zero BOM rows; a full-console string audit finding no blocking or nagging recipe language; a Profit per Dish report rendered correctly against a half-tracked menu
- **RL-3 evidence:** the passing 8.4 suite with per-attack results; the API surface diagram; the public DTO allow-lists; the bundle scan output
- Sign-off from both members

**Acceptance**
- Each red line carries an explicit PASS with linked evidence
- Every row in the 1.6 register is closed or has a documented, accepted exception
- **Any FAIL blocks pilot launch — no exceptions, no conditional launches**
- The audit is repeated if any red-line-touching entry changes after sign-off

**Associated Activities**
- Collect evidence from the 8.1–8.4 suites and the gateway sandbox
- Run the schema and static analyses
- Run the console string audit for RL-2
- Walk the 1.6 register row by row
- Write the audit, obtain sign-off, and file it with 1.7

---

### 8.6 Cross-browser and Device Matrix

| Field | Detail |
|---|---|
| **WBS Code** | 8.6 |
| **Type** | Work Package |
| **Requirement** | Platform coverage |
| **Owner** | M2 |
| **Surface** | Both |
| **Red Line Touch** | None |

**Scope / Statement of Work**
Verify both surfaces across the browsers the target users actually have, with particular attention to the three places a web-only product is most fragile: Web Push on iOS Safari, camera capture across browsers, and Thai text rendering. Web-only was chosen deliberately to avoid app store friction, and this entry is where that decision is paid for honestly rather than discovered by a pilot merchant.

**Deliverables**
- `/docs/browser_matrix.md` covering Android Chrome (current and current−2), iOS Safari (current and current−1), Samsung Internet, desktop Chrome, and desktop Safari
- Per-browser results for: order flow, payment QR display, order tracking, OTP login, order inbox, Web Push, camera capture, report charts, Thai rendering
- Documented iOS Web Push behaviour, including the Home Screen requirement, and the merchant-facing guidance derived from it
- Known-limitations list published in the merchant help page

**Acceptance**
- The full customer order flow works on every listed browser
- The full merchant flow works on every listed browser, with push degradation documented and polling verified as the fallback
- Camera capture works on Android Chrome and iOS Safari via the file input path
- Thai text renders without tone-mark clipping on every listed browser
- Layouts hold at 360 px with no horizontal scroll

**Associated Activities**
- Assemble the device set (including at least one mid-range Android and one older iPhone)
- Execute the matrix and record results
- File and fix defects, then re-test
- Publish the known-limitations list

**Testing**
- Matrix executed and recorded; every cell is pass or a documented, accepted limitation
- Push behaviour re-verified on iOS after any service worker change

---

### 8.7 Manual Test Plan and Bug Bash

| Field | Detail |
|---|---|
| **WBS Code** | 8.7 |
| **Type** | Work Package |
| **Requirement** | Pre-pilot verification |
| **Owner** | M1 |
| **Surface** | Both |
| **Red Line Touch** | RL-1, RL-2, RL-3 |

**Scope / Statement of Work**
Write a manual test plan covering all 29 MVP features plus the edge cases automation does not reach — permission denials, slow and dropped networks, a phone locking mid-payment, a bill photographed in poor light, a slot filling while the customer is at checkout — then run a team-wide bug bash against staging with realistic data. Each member takes a different role so blind spots do not overlap.

**Deliverables**
- `/docs/manual_test_plan.md` with at least one case per feature F01–F29 plus targeted edge cases
- Bug bash session against staging, minimum three hours, both members
- Bug log with severity, owner, and resolution
- Severity 1 and 2 fixed before pilot; severity 3 documented as known issues in 1.7

**Acceptance**
- Every feature F01–F29 has at least one manual test case with an unambiguous expected result
- Both members participated for the full session in different roles
- Every severity 1 and 2 bug is closed before pilot launch
- Red line cases are included in the plan and passed

**Associated Activities**
- Write the plan feature by feature
- Add edge cases from the risk register
- Seed staging with realistic data
- Assign roles and run the session
- Triage, fix, and re-verify

---

### 8.8 Staging and Production Deployment Pipeline

| Field | Detail |
|---|---|
| **WBS Code** | 8.8 |
| **Type** | Work Package |
| **Requirement** | Deployment |
| **Owner** | M1 |
| **Surface** | Shared / Backend |
| **Red Line Touch** | RL-1 (gateway mode), RL-3 (isolation gate) |

**Scope / Statement of Work**
Build the deploy pipeline with gates that make a red line regression undeployable rather than merely detectable. Staging deploys automatically from `main`; production requires a manual promotion and a green gate set. Migrations run as a separate step with an explicit rollback plan, since a schema change that fails halfway through on a payments product during trading hours is the worst available outcome.

**Deliverables**
- GitHub Actions pipeline: build → test → **isolation suite (8.4)** → **webhook harness (8.3)** → deploy staging → smoke test → manual approval → migrate → deploy production
- Cloud Run revision-based deploys with instant rollback to the previous revision
- Separate migration job with a documented rollback procedure per migration
- Smoke tests post-deploy: public store page renders, OTP send succeeds, webhook endpoint responds, dashboard loads
- Startup assertion that production runs live gateway mode and staging runs sandbox (3.8)

**Acceptance**
- **A failing isolation suite blocks the deploy (RL-3)**
- **A failing webhook harness blocks the deploy (F05, RL-1)**
- Production deploys require explicit human approval
- Rollback to the previous revision completes in under 5 minutes and is rehearsed at least once
- Staging can never issue a live gateway charge (3.8 assertion verified)
- Migrations run separately from application deploys with a rollback documented

**Associated Activities**
- Build the pipeline with all gates
- Configure Cloud Run revisions and traffic management
- Write smoke tests and the rollback runbook
- Rehearse a rollback on staging
- Verify the gateway mode assertion in both environments

**Testing**
- Pipeline test: a deliberately failing isolation test blocks deployment
- Pipeline test: a deliberately failing webhook scenario blocks deployment
- Rollback test: rehearsed rollback restores the previous revision within 5 minutes
- Smoke test: all four post-deploy checks pass against staging and production

---

### 8.9 Pilot Onboarding Runbook and Support Playbook

| Field | Detail |
|---|---|
| **WBS Code** | 8.9 |
| **Type** | Work Package |
| **Requirement** | PoC readiness |
| **Owner** | M1 |
| **Surface** | Both |
| **Red Line Touch** | RL-1, RL-2 |

**Scope / Statement of Work**
Produce the operational material for onboarding 20–30 pilot stores: a step-by-step runbook the team follows on site, a Thai-language merchant guide, and a support playbook for the problems that will actually arrive. The gateway KYC step is the known bottleneck — the primary gateway's one-year commercial registration requirement excludes many sole operators, and the runbook must route those stores to the alternate gateway before a visit rather than after a rejection.

**Deliverables**
- `/docs/onboarding_runbook.md` — pre-visit eligibility check, on-site setup sequence with time targets, first-order verification, day-2 follow-up
- Thai merchant guide covering: how customers order, where the money goes, how to scan bills, how to read Profit per Dish
- Support playbook: gateway KYC rejection, push notifications not arriving, OCR misreading a bill, customer paid but order missing, refund not received, forgotten OTP number
- Escalation path with response time targets and named owners
- PoC metric collection plan: activation rate, orders per store per day, OCR accuracy, and free-to-paid intent

**Acceptance**
- The runbook brings a store from nothing to first live order in under 30 minutes on site
- Eligibility is checked before a visit is scheduled, and the alternate gateway path is documented (RL-1)
- **The merchant guide states plainly that recipes are optional and what they add (RL-2)**
- **The merchant guide states plainly that payments go directly to the merchant's own account (RL-1)**
- Every playbook scenario has a first response and an escalation owner
- The metric collection plan names how each PoC metric is captured

**Associated Activities**
- Write the runbook and rehearse it against a test store
- Write the Thai merchant guide
- Write the support playbook from the risk register and the bug bash findings
- Define metric collection and instrument what is missing
- Brief the whole team before the first onboarding

---

### 8.10 Handover Package and Demo

| Field | Detail |
|---|---|
| **WBS Code** | 8.10 |
| **Type** | Work Package |
| **Requirement** | Project deliverable |
| **Owner** | M1 (coordinates), all contribute |
| **Surface** | Both |
| **Red Line Touch** | RL-1, RL-2, RL-3 |

**Scope / Statement of Work**
Assemble the final handover: a clean repository, complete documentation, a recorded demo covering both surfaces, and the live demo script. The demo must show the customer and merchant halves side by side, because the two-surface separation is both the architectural core of the product and the thing an audience most easily misunderstands as a single app.

**Deliverables**
- Repository: clean main branch, no secrets in history, README enabling a fresh-machine setup, architecture overview, API documentation
- `/docs/architecture.md` with the surface separation diagram and the red line enforcement points marked
- Demo video (5–7 minutes) walking: store setup → publish menu (no recipe) → customer orders and pays → merchant notified → status progression → bill scan → Profit per Dish
- Live demo script with a pre-seeded demo store and a rehearsed fallback to the video
- Final report from 1.7 and the red line audit from 8.5 attached

**Acceptance**
- A developer outside the team can clone, follow the README, and run the stack locally in under 45 minutes
- No secrets in the repository or its history
- The demo shows both surfaces on separate screens or devices, making the separation visible
- The demo explicitly shows a menu item selling with no recipe (RL-2) and states where the money settles (RL-1)
- The video covers every beat of the live script so the fallback is a true substitute

**Associated Activities**
- Clean the repository and audit history for secrets
- Write the architecture overview and API documentation
- Pre-seed the demo store with realistic data
- Record the video and rehearse the live demo
- Assemble and file the package

---

## Appendix A — Requirement Coverage Map

Reverse lookup from feature ID to the entries that implement it. Used at the Phase 7 gate to confirm nothing is orphaned, and during triage to find an owner quickly.

| Feature | Description | Implementing Entries | Owner |
|---|---|---|---|
| F01 | Store access via link / QR, no install, no signup | 4.6, 5.1 | M2 |
| F02 | Menu with option groups | 4.4, 5.1, 5.2 | M2 |
| F03 | Time-slot selection | 5.3, 5.4 | M2 |
| F04 | PromptPay QR via licensed gateway | 4.5, 5.5 | M1 |
| F05 | Idempotent webhook confirmation | 5.6, 8.3 | M1 |
| F06 | Real-time / polled order status | 5.7, 5.10 | M2 |
| F07 | Status lookup by phone + code | 5.4, 5.10 | M2 |
| F08 | Phone OTP login | 4.1, 4.2 | M1 |
| F09 | Store profile and hours | 4.3 | M2 |
| F10 | Menu and price, no forced BOM | 4.4 | M2 |
| F11 | Gateway account linking and KYC | 4.5 | M1 |
| F12 | Subscription tiers and gating | 4.7, 4.8 | M2 |
| F13 | AI Brief | 7.2 | M2 |
| F14 | Dashboard daily summary | 7.1, 7.8 | M2 |
| F15 | Cost Drift Alert | 7.4 | M2 |
| F16 | Low stock alert | 7.3 | M2 |
| F17 | New order notification | 5.8 | M1 |
| F18 | Slot quota and auto close | 5.3 | M2 |
| F19 | Order status update | 5.7, 5.9 | M2 |
| F20 | Cancel / reject with auto refund | 5.11 | M1 |
| F21 | Manual cash sale | 5.12 | M2 |
| F22 | Bill capture in browser | 6.1, 3.7 | M2 |
| F23 | OCR extraction with confirm step | 6.2, 6.3, 6.4 | M1 / M2 |
| F24 | Unit cost update and profit recompute | 6.6, 6.9 | M2 |
| F25 | Stock deduction with unit conversion | 6.5, 6.8 | M2 |
| F26 | Suggested BOM | 6.7 | M2 |
| F27 | Daily P&L | 7.5 | M2 |
| F28 | Profit per Dish | 7.6 | M2 |
| F29 | Period comparison with fee breakdown | 7.7, 4.8 | M2 |

**Coverage check:** every feature F01–F29 has at least one implementing entry and exactly one accountable owner. No entry in this dictionary implements a feature outside F01–F29 or on the Phase 2 exclusion list.

---

## Appendix B — Red Line Enforcement Matrix

The full map from red line to enforcement point to verification evidence. This appendix is the source for the 1.6 register and the input to the 8.5 audit.

### RL-1 — Payments settle directly to the merchant

| Entry | Enforcement mechanism | Verification |
|---|---|---|
| 3.3 | Schema contains no platform balance, float, escrow, or payout table | Schema introspection test |
| 3.8 | Gateway mode asserted per environment at startup | Startup assertion test |
| 4.5 | Only a merchant-owned gateway account reference is stored; no bank details persisted | Sandbox account verification, schema review |
| 5.5 | Charge payee is `Merchant.gatewayMerchantId`; no local QR construction | Sandbox charge inspection, static analysis |
| 5.6 | Settlement destination recorded on every payment row | Integration test on payment rows |
| 5.11 | Refund issued by the gateway against the original charge | Sandbox refund trace |
| 4.8 | Fee attribution recorded; absorption creates no in-product balance | Unit tests on fee attribution |
| 8.5 | Formal audit with linked evidence | Signed audit document |

### RL-2 — No forced BOM before selling

| Entry | Enforcement mechanism | Verification |
|---|---|---|
| 3.3 | `bom_lines` is an optional table with no NOT NULL dependency from `menu_items` | Migration and insert test |
| 4.4 | Only name and price required; recipe block collapsed and non-blocking | API test, UI test, copy audit |
| 6.5 | Ingredient creation never required to sell | Integration test on a zero-ingredient store |
| 6.7 | Suggested recipes offered, never demanded; no nagging copy | UI test, string audit |
| 6.8 | Orders without a BOM deduct nothing and raise nothing | Unit test |
| 6.9 | Cost is `null`, never `0`, when untracked | Unit test, UI test |
| 7.1, 7.5, 7.6 | Untracked items excluded and disclosed, never counted as zero cost | Report reconciliation tests |
| 8.5 | Formal audit including a full zero-BOM selling run | Signed audit document |

### RL-3 — Absolute customer/merchant data isolation

| Entry | Enforcement mechanism | Verification |
|---|---|---|
| 2.2 | Per-route permitted-field table for Customer Web | Design review |
| 3.1 | Physical app separation with an import-boundary lint rule | CI failure on forbidden import |
| 3.5 | Allow-list public DTOs; construction never spreading entities | Response snapshot tests |
| 3.6 | Tenant scoping enforced in the data layer | Cross-tenant integration tests |
| 3.7 | Bill images private with short-lived signed URLs only | Access tests |
| 3.9 | Log redaction; entity dumps prohibited | Redaction unit tests |
| 4.1, 4.2 | Disjoint auth scopes; console guarded by default | Route enumeration test |
| 5.1, 5.10 | Public responses and bundles scanned for restricted terms | Content scan in CI |
| 8.4 | Ten-class adversarial isolation suite on every build | Passing suite, blocks deploy |
| 8.5 | Formal audit with per-attack evidence | Signed audit document |

---

## Appendix C — Surface Ownership Map

Which surface owns each screen, and which entry implements it. Use during bug triage to find the owner of a broken screen, and during the Phase 5 gate to confirm no screen is orphaned.

### Customer Web (`apps/shop`) — unauthenticated

| Route | Screen | Entry | Owner |
|---|---|---|---|
| `/s/{slug}` | Store menu | 5.1 | M2 |
| `/s/{slug}` (sheet) | Item options | 5.2 | M2 |
| `/s/{slug}/cart` | Cart | 5.2 | M2 |
| `/s/{slug}/checkout` | Slot picker, phone, review | 5.3, 5.4 | M2 |
| `/s/{slug}/pay/{code}` | PromptPay QR and countdown | 5.5 | M1 |
| `/o/{code}` | Order tracking | 5.10 | M2 |
| `/track` | Lookup by phone + code | 5.10 | M2 |

### Owner Console (`apps/console`) — OTP authenticated

| Route | Screen | Entry | Owner |
|---|---|---|---|
| `/console/login` | Phone and OTP | 4.1 | M1 |
| `/console` | Dashboard, AI Brief, alerts | 7.1, 7.2, 7.3, 7.4 | M2 |
| `/console/orders` | Order inbox | 5.8, 5.9 | M2 |
| `/console/orders/{id}` | Order detail, status, cancel | 5.9, 5.11 | M2 / M1 |
| `/console/sales/quick` | Cash sale entry | 5.12 | M2 |
| `/console/menu` | Menu list | 4.4 | M2 |
| `/console/menu/{id}` | Item editor + optional recipe block | 4.4, 6.7 | M2 |
| `/console/expenses/capture` | Bill capture | 6.1 | M2 |
| `/console/expenses/{id}/review` | OCR review and confirm | 6.4 | M2 |
| `/console/inventory` | Ingredients, stock, ledger | 6.5, 6.8 | M2 |
| `/console/reports/pnl` | Daily P&L | 7.5 | M2 |
| `/console/reports/profit-per-dish` | Profit per Dish | 7.6 | M2 |
| `/console/reports/overview` | Period comparison and fees | 7.7 | M2 |
| `/console/settings/store` | Store profile and hours | 4.3 | M2 |
| `/console/settings/payments` | Gateway linking and KYC | 4.5 | M1 |
| `/console/settings/link` | Public link and QR | 4.6 | M2 |
| `/console/settings/subscription` | Tier and fee absorption | 4.7, 4.8 | M2 |

**Coverage check:** every route in the 2.2 route map has exactly one implementing entry and one owner. No Customer Web route reads a `MERCHANT_ONLY` column, and no Owner Console route is reachable without an authenticated merchant session.
