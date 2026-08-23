-- WBS 5.12 — Manual Cash Sale Entry.
--
-- Most of a Thai indie cafe's revenue arrives as cash at the counter, not as
-- a pre-order. Without this pair of functions, `orders` only ever gains rows
-- through checkout_create_order (0029, channel='online',
-- status='PENDING_PAYMENT'), so P&L reports would show the merchant a
-- profit figure they know is false for every day they actually opened the
-- till. This migration adds NO new columns — orders.channel already allows
-- 'cash' and orders.pickup_slot_id was already nullable (0011).
--
-- Two `security definer` plpgsql functions, same atomicity/ownership/grant
-- posture as console_confirm_payment/console_reject_payment (0031) and
-- console_advance_order (0040): one implicit Postgres transaction per call,
-- ownership resolved via auth_store_ids() (the same helper RLS itself is
-- built on, 0021_rls.sql SECTION 2) as a SEPARATE check before any mutation
-- rather than folded into a WHERE clause, granted to `authenticated` only.
--
-- console_create_cash_sale mirrors checkout_create_order (0029) for cart
-- revalidation (identical diff vocabulary: item_removed/item_unavailable/
-- price_changed/option_removed/option_price_changed), the NULL-guarded
-- per-line cost snapshot (RL-2 — an item with no bom_lines snapshots
-- unit_cost_snapshot_satang = NULL, never 0; see that migration's own
-- header comment for why a bare `sum()` would be wrong here), and the
-- order-code generation loop (28-char alphabet, generate -> INSERT -> catch
-- unique_violation -> retry, bounded at 20 attempts) verbatim. It does NOT
-- call checkout_create_order itself — the two diverge too much (no slug, no
-- slot, no customer input, a different starting status) to share a call
-- site without smuggling a slot/PENDING_PAYMENT code path behind a set of
-- booleans, which would make the online path harder to read for a feature
-- only the cash path needs. Genuine differences from 0029, all deliberate:
--   * store resolved from the merchant's own ownership (stores.merchant_id,
--     re-checked against auth_store_ids()), never a public slug — there is
--     no anonymous customer here.
--   * no pickup_slot_id, no slot reservation — a cash sale has no pickup.
--   * status starts at ACCEPTED, not PENDING_PAYMENT — the money is already
--     in the till, there is nothing to wait for.
--   * customer_name is unconditionally 'หน้าร้าน' — this function's
--     signature carries no customer-name parameter at all (the quick-sale
--     screen has no such field, matching WBS 5.12's own screen spec), so
--     "defaults to 'หน้าร้าน' when not supplied" is true trivially.
--   * no payments row and no QR — WBS 5.12 Scope: "no gateway, no QR — the
--     money is already in the till".
--   * the transition_order (0032) stock-deduction insert for
--     PENDING_PAYMENT -> ACCEPTED is replicated here by hand (same
--     -(bl.qty_base_unit * oi.quantity) shape, reason 'sale') because this
--     function does not call transition_order — transition_order requires
--     an EXISTING orders row to load `for update`, and a fresh INSERT is
--     not a "transition" (checkout_create_order doesn't call it either, for
--     the identical reason).
--   * deliberately NO job_queue 'push_notify'/'merchant_new_order' row: that
--     notification exists to tell the merchant a CUSTOMER just placed an
--     order online. The merchant is standing at the register creating this
--     order themselves; notifying them of their own tap is noise, not a
--     signal, and would make every cash sale also buzz the merchant's own
--     phone mid-transaction.
--
-- console_undo_cash_sale is deliberately thin: it does NOT reimplement
-- cancellation. It re-validates the 2-minute/channel/status window itself
-- (server-side timestamp, never a client-computed "still in window"
-- boolean — a merchant's phone clock is not a security boundary), then
-- calls transition_order(order_id, 'CANCELLED', p_merchant_id, 'merchant')
-- to get the guarded state-machine write, the compensating stock_ledger
-- 'cancellation_reversal' rows, and the order_status_history row for free —
-- WBS 5.7's existing machinery, not duplicated here.
--
-- RL-1 refund_status nuance (the one genuinely new rule in this migration):
-- transition_order's own ACCEPTED -> CANCELLED branch sets
-- orders.refund_status = 'pending' unconditionally, because for the online
-- path that transition means real money already sitting in the merchant's
-- bank account that is now owed back to a customer (WBS 5.11's future
-- "รอคืนเงิน" list). A cash-sale undo inside the 2-minute window is the
-- merchant correcting their own register mistake in the same physical
-- interaction — there is no customer, no bank transfer, nothing to track.
-- Immediately after the transition_order call, in the SAME transaction,
-- this function overrides refund_status back to NULL. Left as 'pending' it
-- would make every voided cash-sale typo permanently and wrongly appear on
-- WBS 5.11's pending-refund list once that list is built. This mirrors WBS
-- 5.11's own documented rule for a PENDING_PAYMENT cancellation ("no refund
-- is owed; set refund_status = null", see 0032's header comment / GAP-9),
-- extended here to this one additional case for the identical reason. This
-- override is scoped ONLY to this call path — transition_order's own
-- general ACCEPTED -> CANCELLED behavior for every other caller (WBS 5.11's
-- not-yet-built cancel-with-reason flow) is untouched.
create or replace function console_create_cash_sale(
  p_merchant_id uuid,
  p_cart_lines  jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;

  v_diffs jsonb := '[]'::jsonb;
  v_resolved_lines jsonb := '[]'::jsonb;

  v_rec record;
  v_line jsonb;
  v_line_index integer;
  v_menu_item_id uuid;
  v_quantity integer;
  v_claimed_unit_price integer;
  v_item_row menu_items%rowtype;

  v_group_row menu_option_groups%rowtype;
  v_selected_count integer;

  v_opt jsonb;
  v_opt_group_id uuid;
  v_opt_option_id uuid;
  v_opt_claimed_delta integer;
  v_opt_claimed_name text;
  v_opt_real_name text;
  v_opt_real_price integer;
  v_opt_real_group_id uuid;
  v_opt_real_group_name text;
  v_line_options jsonb;

  v_rl jsonb;
  v_rl_menu_item_id uuid;
  v_rl_quantity integer;
  v_rl_unit_price integer;
  v_options_delta_sum integer;
  v_any_null boolean;
  v_line_count integer;
  v_raw_sum numeric;
  v_line_cost_satang integer;
  v_final_lines jsonb := '[]'::jsonb;
  v_total_satang integer := 0;
  v_total_cost_satang integer := 0;
  v_total_cups integer := 0;

  v_alphabet text := '346789ABCDEFGHJKLMNPQRTUVWXY'; -- excludes 0/1/2/5, I/O/S/Z (ambiguous in Thai handwriting on a cup) — same alphabet as checkout_create_order (0029), copied verbatim, not re-derived
  v_alphabet_len integer := 28;
  v_order_code text;
  v_attempts integer := 0;
  v_i integer;
  v_order_id uuid;
  v_created_at timestamptz;

  v_fl jsonb;
  v_order_item_id uuid;
  v_opt2 jsonb;
  v_items_response jsonb := '[]'::jsonb;
begin
  -------------------------------------------------------------------------
  -- Store resolution + ownership check, split into two steps (not one
  -- WHERE clause) — same reasoning 0031's own header comment gives for
  -- console_confirm_payment: this lets a cross-tenant/spoofed p_merchant_id
  -- (FORBIDDEN) be distinguished from a merchant with genuinely no store
  -- yet (NOT_FOUND), which a single merged condition could not do. The
  -- REAL authorization check is auth_store_ids() (driven by auth.uid() —
  -- the caller's own verified JWT identity), not p_merchant_id itself;
  -- p_merchant_id only selects WHICH of the caller's stores this is, same
  -- posture as WBS 4.2's "never trust a client-supplied store_id" rule
  -- applied one level up (never trust a client-supplied merchant_id for
  -- authorization either — only for lookup, then re-verified).
  -------------------------------------------------------------------------
  select id into v_store_id
    from stores
   where merchant_id = p_merchant_id
   order by created_at desc
   limit 1;

  if v_store_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_store_id not in (select auth_store_ids()) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if p_cart_lines is null or jsonb_typeof(p_cart_lines) <> 'array' or jsonb_array_length(p_cart_lines) = 0 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'cart is empty');
  end if;

  -------------------------------------------------------------------------
  -- Cart revalidation against live rows — identical diff vocabulary and
  -- logic to checkout_create_order (0029) step 1, copied rather than
  -- factored into a shared function: the two callers diverge immediately
  -- after (no slot step here), and a shared helper would need to return
  -- through the exact same "diffs vs resolved_lines" two-output shape
  -- anyway, buying no real simplification. Any diff -> single error
  -- response, nothing written — same as 0029.
  -------------------------------------------------------------------------
  for v_rec in
    select elem, ord - 1 as idx from jsonb_array_elements(p_cart_lines) with ordinality as t(elem, ord)
  loop
    v_line := v_rec.elem;
    v_line_index := v_rec.idx;
    v_menu_item_id := (v_line->>'menuItemId')::uuid;
    v_quantity := (v_line->>'quantity')::integer;
    v_claimed_unit_price := (v_line->>'unitPriceSatang')::integer;

    if v_quantity is null or v_quantity <= 0 then
      return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'invalid quantity');
    end if;

    select * into v_item_row from menu_items where id = v_menu_item_id and store_id = v_store_id;

    if not found or v_item_row.availability = 'hidden' then
      v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
        'lineIndex', v_line_index, 'kind', 'item_removed',
        'menuItemId', v_menu_item_id, 'nameSnapshot', v_line->>'nameSnapshot'
      ));
      continue;
    end if;

    for v_group_row in select * from menu_option_groups where menu_item_id = v_item_row.id loop
      select count(*) into v_selected_count
        from jsonb_array_elements(coalesce(v_line->'options', '[]'::jsonb)) as opt
       where (opt->>'groupId')::uuid = v_group_row.id;

      if v_selected_count < v_group_row.min_select or v_selected_count > v_group_row.max_select then
        return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'option selection out of range');
      end if;
    end loop;

    if v_item_row.availability = 'out_of_stock' then
      v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
        'lineIndex', v_line_index, 'kind', 'item_unavailable',
        'menuItemId', v_menu_item_id, 'nameSnapshot', v_item_row.name
      ));
    end if;

    if v_item_row.price_satang <> v_claimed_unit_price then
      v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
        'lineIndex', v_line_index, 'kind', 'price_changed',
        'menuItemId', v_menu_item_id, 'nameSnapshot', v_item_row.name,
        'oldSatang', v_claimed_unit_price, 'newSatang', v_item_row.price_satang
      ));
    end if;

    v_line_options := '[]'::jsonb;
    for v_opt in select * from jsonb_array_elements(coalesce(v_line->'options', '[]'::jsonb)) loop
      v_opt_group_id := (v_opt->>'groupId')::uuid;
      v_opt_option_id := (v_opt->>'optionId')::uuid;
      v_opt_claimed_delta := (v_opt->>'deltaSatang')::integer;
      v_opt_claimed_name := v_opt->>'name';

      select mo.name, mo.price_delta_satang, mog.id, mog.name
        into v_opt_real_name, v_opt_real_price, v_opt_real_group_id, v_opt_real_group_name
        from menu_options mo
        join menu_option_groups mog on mog.id = mo.option_group_id
       where mo.id = v_opt_option_id and mog.menu_item_id = v_item_row.id;

      if not found then
        v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
          'lineIndex', v_line_index, 'kind', 'option_removed',
          'menuItemId', v_menu_item_id, 'groupId', v_opt_group_id,
          'optionId', v_opt_option_id, 'name', v_opt_claimed_name
        ));
        continue;
      end if;

      if v_opt_real_price <> v_opt_claimed_delta then
        v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
          'lineIndex', v_line_index, 'kind', 'option_price_changed',
          'menuItemId', v_menu_item_id, 'groupId', v_opt_real_group_id,
          'optionId', v_opt_option_id, 'name', v_opt_real_name,
          'oldSatang', v_opt_claimed_delta, 'newSatang', v_opt_real_price
        ));
      end if;

      v_line_options := v_line_options || jsonb_build_array(jsonb_build_object(
        'menu_option_id', v_opt_option_id,
        'option_group_name_snapshot', v_opt_real_group_name,
        'option_name_snapshot', v_opt_real_name,
        'price_delta_snapshot_satang', v_opt_real_price
      ));
    end loop;

    v_resolved_lines := v_resolved_lines || jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_item_row.id,
      'name_snapshot', v_item_row.name,
      'quantity', v_quantity,
      'unit_price_snapshot_satang', v_item_row.price_satang,
      'options', v_line_options
    ));
  end loop;

  if jsonb_array_length(v_diffs) > 0 then
    return jsonb_build_object('ok', false, 'code', 'PRICE_MISMATCH', 'diffs', v_diffs);
  end if;

  -------------------------------------------------------------------------
  -- Cost snapshot + total, per resolved line — identical NULL-guarded logic
  -- to checkout_create_order (0029) step 3. See that migration's own header
  -- comment for why a bare `sum()` (Postgres skips NULL terms rather than
  -- propagating NULL through the whole aggregate) would silently produce a
  -- "partial sum treated as complete" here, exactly the RL-2 violation this
  -- schema exists to prevent. bool_or(...is null) -> any_null or zero
  -- bom_lines -> NULL, never a partial number; the running total then rides
  -- SQL's own NULL-propagation (NULL * x = NULL, NULL + x = NULL) so one
  -- untracked line NULLs the whole order's cost snapshot for free.
  -------------------------------------------------------------------------
  for v_rl in select * from jsonb_array_elements(v_resolved_lines) loop
    v_rl_menu_item_id := (v_rl->>'menu_item_id')::uuid;
    v_rl_quantity := (v_rl->>'quantity')::integer;
    v_rl_unit_price := (v_rl->>'unit_price_snapshot_satang')::integer;
    v_total_cups := v_total_cups + v_rl_quantity;

    select coalesce(sum((opt->>'price_delta_snapshot_satang')::integer), 0) into v_options_delta_sum
      from jsonb_array_elements(coalesce(v_rl->'options', '[]'::jsonb)) as opt;

    v_total_satang := v_total_satang + (v_rl_unit_price + v_options_delta_sum) * v_rl_quantity;

    select
      bool_or(i.current_unit_cost_satang is null),
      count(*),
      sum(bl.qty_base_unit * i.current_unit_cost_satang)
      into v_any_null, v_line_count, v_raw_sum
      from bom_lines bl join ingredients i on i.id = bl.ingredient_id
     where bl.menu_item_id = v_rl_menu_item_id;

    v_line_cost_satang := case
      when v_line_count = 0 or v_any_null then null
      else round(v_raw_sum)::integer
    end;

    v_total_cost_satang := v_total_cost_satang + (v_line_cost_satang * v_rl_quantity);

    v_final_lines := v_final_lines || jsonb_build_array(
      v_rl || jsonb_build_object('unit_cost_snapshot_satang', v_line_cost_satang)
    );
  end loop;

  -------------------------------------------------------------------------
  -- Order code generation — copied verbatim from checkout_create_order
  -- (0029) step 4, same alphabet, same generate -> INSERT -> catch
  -- unique_violation -> retry loop bounded at 20 attempts, for the same
  -- TOCTOU reason given there (a pre-check SELECT then INSERT is a real
  -- race under concurrency; the real unique constraint, orders.order_code,
  -- is what's actually caught, at INSERT time).
  --
  -- subtotal_satang = total_satang: same placeholder reasoning as 0029 —
  -- no discount/fee/promo mechanism exists in this schema and RL-1
  -- forbids a platform fee outright, so there is nothing legitimate to
  -- subtract yet.
  -------------------------------------------------------------------------
  loop
    v_attempts := v_attempts + 1;
    v_order_code := '';
    for v_i in 1..6 loop
      v_order_code := v_order_code || substr(v_alphabet, (floor(random() * v_alphabet_len) + 1)::integer, 1);
    end loop;

    begin
      insert into orders (
        store_id, order_code, customer_name, pickup_slot_id,
        channel, status, subtotal_satang, total_satang, total_cost_snapshot_satang
      ) values (
        v_store_id, v_order_code, 'หน้าร้าน', null,
        'cash', 'ACCEPTED', v_total_satang, v_total_satang, v_total_cost_satang
      )
      returning id, created_at into v_order_id, v_created_at;
      exit;
    exception when unique_violation then
      if v_attempts >= 20 then
        raise exception 'console_create_cash_sale: order_code space exhausted after % attempts', v_attempts;
      end if;
    end;
  end loop;

  -------------------------------------------------------------------------
  -- order_items + order_item_options — identical shape to
  -- checkout_create_order (0029) step 5.
  -------------------------------------------------------------------------
  for v_fl in select * from jsonb_array_elements(v_final_lines) loop
    insert into order_items (
      order_id, store_id, menu_item_id, item_name_snapshot, quantity,
      unit_price_snapshot_satang, unit_cost_snapshot_satang, options_snapshot
    ) values (
      v_order_id, v_store_id, (v_fl->>'menu_item_id')::uuid, v_fl->>'name_snapshot',
      (v_fl->>'quantity')::integer, (v_fl->>'unit_price_snapshot_satang')::integer,
      (v_fl->>'unit_cost_snapshot_satang')::integer, coalesce(v_fl->'options', '[]'::jsonb)
    )
    returning id into v_order_item_id;

    for v_opt2 in select * from jsonb_array_elements(coalesce(v_fl->'options', '[]'::jsonb)) loop
      insert into order_item_options (
        order_item_id, menu_option_id, option_group_name_snapshot, option_name_snapshot, price_delta_snapshot_satang
      ) values (
        v_order_item_id, (v_opt2->>'menu_option_id')::uuid, v_opt2->>'option_group_name_snapshot',
        v_opt2->>'option_name_snapshot', (v_opt2->>'price_delta_snapshot_satang')::integer
      );
    end loop;

    v_items_response := v_items_response || jsonb_build_array(jsonb_build_object(
      'name', v_fl->>'name_snapshot',
      'quantity', (v_fl->>'quantity')::integer
    ));
  end loop;

  -------------------------------------------------------------------------
  -- Stock deduction — same shape as transition_order's (0032)
  -- PENDING_PAYMENT -> ACCEPTED branch, replicated by hand here since this
  -- function does not call transition_order (see header comment: a fresh
  -- INSERT is not a "transition", transition_order requires an existing row
  -- to lock `for update`). reason='sale', identical to the online path —
  -- WBS 5.12's own acceptance criterion: "stock deducts identically to the
  -- online path".
  -------------------------------------------------------------------------
  insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, order_id)
  select v_store_id, bl.ingredient_id, -(bl.qty_base_unit * oi.quantity), 'sale', v_order_id
    from order_items oi
    join bom_lines bl on bl.menu_item_id = oi.menu_item_id
   where oi.order_id = v_order_id;

  -- Deliberately NO job_queue 'push_notify' row here — see this migration's
  -- header comment. The merchant is the one creating this order; notifying
  -- them of their own register tap is noise, not signal.

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', v_order_id,
      'order_code', v_order_code,
      'total_satang', v_total_satang,
      'cups', v_total_cups,
      'created_at', v_created_at,
      'items', v_items_response
    )
  );
end;
$$;

revoke all on function console_create_cash_sale(uuid, jsonb) from public;
revoke execute on function console_create_cash_sale(uuid, jsonb) from anon, service_role;
grant execute on function console_create_cash_sale(uuid, jsonb) to authenticated;

-- console_undo_cash_sale — see this migration's header comment for the
-- refund_status override reasoning (RL-1, load-bearing, not polish).
create or replace function console_undo_cash_sale(
  p_merchant_id uuid,
  p_order_id    uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_channel text;
  v_status text;
  v_created_at timestamptz;
  v_order orders%rowtype;
begin
  -- FOR UPDATE here (not only inside the nested transition_order call
  -- below) closes a real TOCTOU race: without this function's OWN lock, the
  -- eligibility checks below (channel/status/2-minute window) could pass
  -- against a snapshot that is stale by the time transition_order takes
  -- ITS OWN row lock a few statements later — e.g. the order moves
  -- ACCEPTED -> PREPARING between this function's read and its call to
  -- transition_order, which would still legally permit PREPARING ->
  -- CANCELLED and silently "undo" an order that has already started being
  -- made. Taking the lock here first closes that window; Postgres row locks
  -- are reentrant within one transaction, so transition_order's own
  -- `for update` on the same row a few lines down is a no-op, not a
  -- self-deadlock.
  select store_id, channel, status, created_at
    into v_store_id, v_channel, v_status, v_created_at
    from orders
   where id = p_order_id
   for update;

  if v_store_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_store_id not in (select auth_store_ids()) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if v_channel <> 'cash' or v_status <> 'ACCEPTED' or v_created_at < now() - interval '2 minutes' then
    return jsonb_build_object(
      'ok', false, 'code', 'UNDO_NOT_AVAILABLE',
      'message', 'undo window has passed or this order is not an undoable cash sale — cancel it from the order detail screen instead'
    );
  end if;

  -- WBS 5.7's transition_order (0032) — the ONLY permitted way to change
  -- orders.status. Applies the guarded ACCEPTED -> CANCELLED side effects
  -- for free: the compensating stock_ledger 'cancellation_reversal' rows
  -- (reversing exactly this order's own 'sale' rows) and the
  -- order_status_history row. Also sets refund_status = 'pending' as its
  -- generic behavior for this pair, which the next statement overrides.
  v_order := transition_order(p_order_id, 'CANCELLED', p_merchant_id, 'merchant');

  -- RL-1 override, scoped to only this call path — see this migration's
  -- header comment. A cash-sale undo inside the 2-minute window is the
  -- merchant correcting their own register mistake; the cash never left
  -- the till in a way that needs tracking, so there is no refund obligation
  -- to record. Same rule 0032/GAP-9 already apply to a PENDING_PAYMENT
  -- cancellation, extended here for the identical reason.
  update orders set refund_status = null where id = p_order_id;

  return jsonb_build_object('ok', true, 'order', jsonb_build_object('id', v_order.id, 'status', 'CANCELLED'));
end;
$$;

revoke all on function console_undo_cash_sale(uuid, uuid) from public;
revoke execute on function console_undo_cash_sale(uuid, uuid) from anon, service_role;
grant execute on function console_undo_cash_sale(uuid, uuid) to authenticated;
