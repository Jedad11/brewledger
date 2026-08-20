-- WBS 5.3 — Time-slot Engine and Quota Enforcement.
--
-- Four pieces, each a schema-level primitive future entries call rather
-- than re-derive (the fourth, enqueue_generate_slots_job, is documented at
-- its own definition below, next to section 4):
--
-- 1. stores.default_slot_capacity — new column. Backs the console's "bulk
--    default" capacity control (WBS 5.3's own merchant capacity UI
--    deliverable) and is read by generate_pickup_slots_for_store below when
--    a new day's slots are created, so a merchant's default change actually
--    takes effect for slots that don't exist yet, not only ones already on
--    the calendar. No architect leg ran for this column (WBS 5.3 is a
--    Pattern B entry, engineer -> qa_engineer -> redline_reviewer, per
--    .claude/agents/WORKFLOW.md) -- self-designed against the Schema Rules
--    in .claude/agents/architect.md (additive, IF NOT EXISTS, a CHECK
--    constraint) because the entry cannot satisfy its own "bulk default"
--    acceptance criterion without persisting one somewhere, same posture as
--    0027's own redline-driven hotfix. Flagged here for redline_reviewer.
--
-- 2. generate_pickup_slots_for_store(store_id, interval_minutes, days_ahead)
--    — the "Slot generation" deliverable. Deliberately plain SQL/PLpgSQL,
--    NOT security definer and NOT granted to anon/authenticated: its only
--    caller is worker/src/handlers/slots.ts over the direct `pg` pool
--    connection (worker/src/db.ts), which already bypasses RLS/PostgREST
--    entirely by design (same posture as claimJob's raw SQL in
--    worker/src/queue.ts). Timezone math is done inside Postgres
--    (`timestamp ... at time zone tz`) rather than in Node, deliberately —
--    no timezone-aware npm dependency exists in worker/package.json today,
--    and Postgres's own tz database is the correct, DST-safe source of
--    truth for turning a store's local opens_at/closes_at wall-clock time
--    into the timestamptz pickup_slots.slot_start actually stores.
--    Idempotent via ON CONFLICT DO NOTHING against the pre-existing unique
--    (store_id, slot_start) constraint (0010_pickup_slots.sql) — re-running
--    for a store that already has today's slots inserts nothing new for
--    those slots. Overnight-spanning hours (closes_at < opens_at) are out
--    of scope, same documented limitation apps/shop/src/lib/storeSchedule.ts
--    already carries for the customer-facing side of the same opens_at/
--    closes_at columns.
--
-- 3. reserve_pickup_slot(slot_id) / release_pickup_slot(slot_id) — the
--    "Atomic reservation" and "Release" deliverables, as the exact single
--    conditional UPDATE from the WBS 5.3 pseudocode, each its own `language
--    sql` function so there is no read-then-write possible even by
--    accident (a `plpgsql` function invites an intermediate SELECT; `sql`
--    physically cannot smuggle one in between the UPDATE and its RETURNING).
--    Zero rows back means "did not apply" — the caller turns that into the
--    specific recoverable state the WBS prompt asks for, never a generic
--    error.
--
--    BOTH functions are service_role-only, revoked from anon AND
--    authenticated explicitly (not just left ungranted — 0021_rls.sql's own
--    `alter default privileges in schema public grant execute on functions
--    to anon, authenticated, service_role` is a standing default that would
--    otherwise hand anon EXECUTE on a newly-created function automatically,
--    the exact trap 0025_auth_attempts_atomic_check.sql's own comment
--    already documents finding once before for a different function).
--
--    reserve_pickup_slot was FIRST written granted to anon (mirroring
--    public_order_status / public_order_lookup, 0021_rls.sql SECTION 6,
--    reasoning it was "the one write a customer's own request legitimately
--    triggers"). redline_reviewer caught the real consequence: an anon
--    grant means any unauthenticated caller can enumerate a store's open
--    slot ids via the pre-existing public-slots GET endpoint and reserve
--    every one with no order ever created — and neither WBS 5.7 (expiry)
--    nor 5.11 (cancellation) exists yet to release them, so the hold is
--    permanent. That inverts this entry's own acceptance criterion (cap
--    what the system accepts) into a free way to make it accept nothing.
--    Reserving is only safe once it is one step inside a real
--    order-creation transaction that also guarantees a matching expiry —
--    WBS 5.4's own pseudocode already describes it exactly that way, "step
--    2" inside public-create-order, never a standalone public endpoint.
--    Until 5.4 exists to call it, both functions are service_role-only; the
--    SQL-level atomicity guarantee (packages/db/tests/pickup_slots.test.ts)
--    does not require a public caller to prove it. No public-reserve-slot
--    Edge Function is scaffolded for the same reason — see that decision
--    recorded in this migration's own commit history rather than a stub
--    file left half-wired.

alter table stores
  add column if not exists default_slot_capacity integer not null default 3;

alter table stores drop constraint if exists stores_default_slot_capacity_positive;
alter table stores
  add constraint stores_default_slot_capacity_positive check (default_slot_capacity > 0);

create or replace function generate_pickup_slots_for_store(
  p_store_id uuid,
  p_interval_minutes integer default 15,
  p_days_ahead integer default 7
) returns integer
language plpgsql
set search_path = public
as $$
declare
  v_store stores%rowtype;
  v_day date;
  v_last_day date;
  v_opens_ts timestamptz;
  v_closes_ts timestamptz;
  v_slot_start timestamptz;
  v_step interval;
  v_inserted integer := 0;
begin
  select * into v_store from stores where id = p_store_id;
  if not found or v_store.opens_at is null or v_store.closes_at is null then
    return 0;
  end if;
  if p_interval_minutes <= 0 then
    raise exception 'generate_pickup_slots_for_store: interval_minutes must be positive, got %', p_interval_minutes;
  end if;

  v_step := (p_interval_minutes || ' minutes')::interval;
  v_day := current_date;
  v_last_day := current_date + greatest(p_days_ahead, 1) - 1;

  while v_day <= v_last_day loop
    -- opens_at/closes_at are bare `time` values with no zone of their own
    -- (0003_stores.sql) -- interpreting "day + local wall-clock time" AS a
    -- moment in the store's own IANA zone is exactly what `AT TIME ZONE`
    -- does here, DST included.
    v_opens_ts := (v_day::timestamp + v_store.opens_at) at time zone v_store.timezone;
    v_closes_ts := (v_day::timestamp + v_store.closes_at) at time zone v_store.timezone;

    if v_closes_ts > v_opens_ts then
      v_slot_start := v_opens_ts;
      while v_slot_start + v_step <= v_closes_ts loop
        insert into pickup_slots (store_id, slot_start, slot_end, capacity)
        values (p_store_id, v_slot_start, v_slot_start + v_step, v_store.default_slot_capacity)
        on conflict (store_id, slot_start) do nothing;
        if found then
          v_inserted := v_inserted + 1;
        end if;
        v_slot_start := v_slot_start + v_step;
      end loop;
    end if;

    v_day := v_day + 1;
  end loop;

  return v_inserted;
end;
$$;

-- The exact WBS 5.3 pseudocode UPDATE, verbatim: never read-then-write.
-- `language sql` (not plpgsql) so no statement can be inserted between the
-- UPDATE and its RETURNING even by a future careless edit.
create or replace function reserve_pickup_slot(p_slot_id uuid)
returns table (id uuid, booked_count integer, capacity integer)
language sql
security definer
set search_path = public
as $$
  update pickup_slots
     set booked_count = booked_count + 1,
         is_open = case when booked_count + 1 >= capacity then false else is_open end
   where id = p_slot_id
     and is_open = true
     and booked_count < capacity
     and slot_start > now()
  returning id, booked_count, capacity;
$$;

-- redline_reviewer finding, CRITICAL (this migration's own review): granting
-- this to anon, as first written, let ANY unauthenticated caller enumerate a
-- store's open slot ids via the pre-existing public-slots GET endpoint and
-- POST each one to a reservation call with no order ever created and no
-- release path anywhere in the codebase (WBS 5.7/5.11 don't exist yet) --
-- exhausting a store's entire pickup capacity for free, in reverse of the
-- exact acceptance criterion this entry exists to satisfy. Reserving is only
-- ever safe once it is one step inside a real order-creation transaction
-- that also guarantees a matching expiry (WBS 5.4's own pseudocode already
-- describes it exactly this way -- "step 2" inside public-create-order, never
-- its own public endpoint). Until 5.4 exists to call it, this function is
-- service_role-only, same posture as release_pickup_slot immediately below --
-- the SQL-level atomicity guarantee (packages/db/tests/pickup_slots.test.ts)
-- does not require a public HTTP caller to be proven.
revoke all on function reserve_pickup_slot(uuid) from public;
revoke execute on function reserve_pickup_slot(uuid) from anon, authenticated;
grant execute on function reserve_pickup_slot(uuid) to service_role;

-- Mirrored conditional update for release, per the WBS 5.3 prompt's own
-- wording ("the mirrored conditional update"). `booked_count - 1` can never
-- put a row below zero (guarded by `booked_count > 0`) and, given the
-- pre-existing `check (booked_count <= capacity)`, a decrement can never
-- leave `is_open` incorrectly false -- the `case` still mirrors the
-- reservation function's own shape rather than assuming that invariant.
create or replace function release_pickup_slot(p_slot_id uuid)
returns table (id uuid, booked_count integer, capacity integer)
language sql
security definer
set search_path = public
as $$
  update pickup_slots
     set booked_count = booked_count - 1,
         is_open = case when booked_count - 1 < capacity then true else is_open end
   where id = p_slot_id
     and booked_count > 0
  returning id, booked_count, capacity;
$$;

revoke all on function release_pickup_slot(uuid) from public;
revoke execute on function release_pickup_slot(uuid) from anon, authenticated;
grant execute on function release_pickup_slot(uuid) to service_role;

-- 4. enqueue_generate_slots_job(store_id) — lets the console's own
--    authenticated merchant session (apps/console/src/lib/supabase/server.ts,
--    RLS-scoped, never service_role) trigger the "on demand when store
--    hours change" path from the WBS 5.3 prompt after saveStoreProfile
--    (settings/store/actions.ts). job_queue has RLS enabled with
--    deliberately ZERO policies for any role (docs/db/rls_design.md §2.2,
--    reaffirmed in this file's own SECTION-1 comment above) -- an ordinary
--    authenticated INSERT would be silently rejected by RLS, and the
--    documented sanctioned bypass for a RLS-closed table is a narrow
--    security-definer RPC (the exact pattern public_order_status /
--    public_order_lookup already use for `orders`), not a table policy.
--    Ownership is checked with the SAME auth_store_ids() the RLS layer
--    itself is built on (0021_rls.sql SECTION 2) -- not a second hand-rolled
--    check that could drift from it -- so a merchant can only ever enqueue
--    generation for a store they own.
create or replace function enqueue_generate_slots_job(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_store_id not in (select auth_store_ids()) then
    raise exception 'enqueue_generate_slots_job: store % not owned by the caller', p_store_id;
  end if;

  insert into job_queue (store_id, job_type, payload)
  values (p_store_id, 'generate_slots', '{}'::jsonb);
end;
$$;

revoke all on function enqueue_generate_slots_job(uuid) from public;
revoke execute on function enqueue_generate_slots_job(uuid) from anon;
grant execute on function enqueue_generate_slots_job(uuid) to authenticated;
