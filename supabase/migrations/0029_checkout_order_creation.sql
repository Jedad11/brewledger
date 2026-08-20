-- WBS 5.4 — Checkout and Order Draft Creation.
--
-- One `security definer` plpgsql function, `checkout_create_order`, is the
-- entire transaction. Edge Functions only ever get supabase-js/PostgREST
-- round trips, which cannot be composed into one ACID unit — the only place
-- true atomicity exists is inside a single Postgres statement, so every
-- write below (slot reservation, order insert, order_items insert,
-- order_item_options insert) commits or rolls back together automatically,
-- same move 0028 made for reserve_pickup_slot itself. The Edge Function
-- (supabase/functions/public-create-order/index.ts) is a thin wrapper with
-- no business logic of its own.
--
-- Naming: NOT `public_create_order` — `public_*` is reserved in this
-- codebase for anon-grantable RPCs (public_order_status, public_order_lookup,
-- both 0021_rls.sql SECTION 6). This function is service_role-only, same
-- posture as reserve_pickup_slot/release_pickup_slot below, which it calls
-- directly. The Edge Function directory is still named
-- `public-create-order` per the WBS's literal deliverable path — a Deno
-- directory name, unrelated to this Postgres naming convention.
--
-- p_cart_lines carries `nameSnapshot` (per line) and `name` (per option) in
-- addition to the WBS pseudocode's bare menuItemId/optionId/deltaSatang —
-- deliberately wider than the WBS's own literal shape. Those two fields are
-- never used for pricing or for what gets written to order_items (that
-- always comes from a fresh DB row, see below); they exist ONLY so a 409
-- PRICE_MISMATCH diff can name a REMOVED item/option in the customer's own
-- language when there is, by definition, no live DB row left to read a name
-- from. Dropping them (the WBS's literal shape) would make `item_removed`/
-- `option_removed` diffs unrenderable. This is CartLine/CartOptionSelection's
-- own existing shape (apps/shop/src/lib/cart.ts) verbatim — the Edge
-- Function passes the client's cart straight through with no reshaping.
create or replace function checkout_create_order(
  p_store_slug     text,
  p_cart_lines     jsonb,
  p_pickup_slot_id uuid,
  p_customer_name  text,
  p_customer_phone text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_customer_phone text;
  v_phone_digits text;

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

  v_slot_store_id uuid;
  v_slot_start timestamptz;
  v_reservation record;
  v_fresh_slots jsonb;
  v_expires_at timestamptz;

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

  v_alphabet text := '346789ABCDEFGHJKLMNPQRTUVWXY'; -- excludes 0/1/2/5, I/O/S/Z (ambiguous in Thai handwriting on a cup)
  v_alphabet_len integer := 28;
  v_order_code text;
  v_attempts integer := 0;
  v_i integer;
  v_order_id uuid;

  v_fl jsonb;
  v_order_item_id uuid;
  v_opt2 jsonb;
  v_resp_options jsonb;
  v_items_response jsonb := '[]'::jsonb;
begin
  -------------------------------------------------------------------------
  -- Store + basic input validation.
  -------------------------------------------------------------------------
  select id into v_store_id from stores where slug = p_store_slug and is_published = true;
  if v_store_id is null then
    return jsonb_build_object('ok', false, 'code', 'STORE_NOT_FOUND');
  end if;

  if p_customer_name is null or length(trim(p_customer_name)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'customer name is required');
  end if;

  if p_pickup_slot_id is null then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'pickup slot is required');
  end if;

  if p_cart_lines is null or jsonb_typeof(p_cart_lines) <> 'array' or jsonb_array_length(p_cart_lines) = 0 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'cart is empty');
  end if;

  -- Loose, NEVER-blocking phone normalisation (WBS 5.4: "never block an
  -- order because a phone looks unusual"). Deliberately inline here, not a
  -- packages/shared module — apps/console's normalizeThaiPhone
  -- (apps/console/src/lib/phone.ts) is kept out of packages/shared on
  -- purpose (RL-3 boundary) and has stricter REJECTING semantics anyway,
  -- the wrong behaviour for checkout. Recognisable Thai mobile shapes
  -- (0XXXXXXXXX, 66XXXXXXXXX, +66XXXXXXXXX) normalise to +66XXXXXXXXX;
  -- anything else is stored as the raw trimmed input, never refused.
  v_customer_phone := nullif(trim(p_customer_phone), '');
  if v_customer_phone is not null then
    v_phone_digits := regexp_replace(v_customer_phone, '[^0-9]', '', 'g');
    if v_phone_digits ~ '^0[0-9]{9}$' then
      v_customer_phone := '+66' || substr(v_phone_digits, 2);
    elsif v_phone_digits ~ '^66[0-9]{9}$' then
      v_customer_phone := '+' || v_phone_digits;
    end if;
  end if;

  -------------------------------------------------------------------------
  -- Step 1: server-side cart revalidation against live rows (never the
  -- client-fetched PublicMenuResponse, never apps/shop's own
  -- cartValidation.ts — that is browser code and not Deno-importable from
  -- an Edge Function). Mismatch `kind`s mirror CartDiffReason 1:1 so the
  -- existing cart-page diff UI can render a checkout-time diff unchanged.
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
      continue; -- nothing else to check against an item that no longer exists to the customer
    end if;

    -- Option-group cardinality — malformed input (400), not a price/
    -- availability mismatch (409). Checked against every submitted
    -- selection whose claimed groupId matches, valid optionId or not (an
    -- invalid one still separately surfaces as an option_removed diff
    -- below). Flagged for redline_reviewer: the WBS's own acceptance text
    -- says "re-validate... prices and availability" and does not literally
    -- mention option-group min/max — implemented anyway because an order
    -- that violates a merchant-defined required-choice group (e.g. "pick a
    -- size") is exactly the kind of malformed order this endpoint should
    -- never create, and `isGroupSatisfied` (apps/shop/src/lib/
    -- optionSelection.ts) already enforces the identical minSelect rule
    -- client-side — this is closing the same gap server-side, not a new
    -- rule invented here.
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
  -- Step 2: slot reservation. reserve_pickup_slot(uuid) has NO store
  -- parameter and does no store-membership check of its own (0028) — this
  -- is the required check that closes that gap: without it a customer could
  -- pass a slot_id belonging to an entirely different store. Because this
  -- function is security definer, the nested call to reserve_pickup_slot
  -- below runs under the function owner's privileges, so its own
  -- anon/authenticated revoke does not block this internal call — same
  -- reuse 0028's own header comment anticipates ("never its own public
  -- endpoint", "step 2 inside public-create-order").
  -------------------------------------------------------------------------
  select store_id, slot_start into v_slot_store_id, v_slot_start
    from pickup_slots where id = p_pickup_slot_id;

  if v_slot_store_id is null or v_slot_store_id <> v_store_id then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'slot does not belong to this store');
  end if;

  select * into v_reservation from reserve_pickup_slot(p_pickup_slot_id);
  if not found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'slot_start', slot_start, 'slot_end', slot_end,
      'capacity', capacity, 'booked_count', booked_count
    ) order by slot_start), '[]'::jsonb) into v_fresh_slots
      from pickup_slots
     where store_id = v_store_id and is_open = true and booked_count < capacity and slot_start > now();

    return jsonb_build_object('ok', false, 'code', 'SLOT_FULL', 'slots', v_fresh_slots);
  end if;

  -- Everything from here on either fully commits or fully rolls back
  -- (including the reservation just above) via Postgres's own implicit
  -- transaction for this one top-level call — no explicit
  -- SAVEPOINT/ROLLBACK needed. Controlled RETURNs are done; from here a
  -- genuine failure RAISEs naturally and is not caught.
  v_expires_at := now() + interval '15 minutes';

  -------------------------------------------------------------------------
  -- Step 3: cost snapshot, per resolved line, combined with the order
  -- total computation in one pass.
  --
  -- CORRECTION to the WBS dictionary's own literal pasted query (flagged
  -- for redline_reviewer — cite WBS 3.5): the dictionary's query is a bare
  -- `sum(bl.qty_base_unit * i.current_unit_cost_satang)` with no NULL
  -- guard. Postgres's sum() aggregate SKIPS NULL terms rather than making
  -- the whole result NULL, so a menu item with 3 bom_lines where only 1
  -- ingredient has a NULL current_unit_cost_satang would silently return
  -- the sum of the other 2 under the dictionary's literal query — exactly
  -- the "partial sum treated as complete" the WBS's own prose explicitly
  -- forbids. `bool_or(i.current_unit_cost_satang is null)` below is what
  -- actually implements the WBS's stated rule: any_null or zero bom_lines
  -- -> NULL, never a partial number.
  --
  -- The order-level total uses SQL's own NULL-propagation (NULL + x = NULL,
  -- NULL * x = NULL) rather than a second boolean flag: once any line's
  -- cost is NULL, `v_line_cost_satang * v_rl_quantity` is NULL and every
  -- subsequent `v_total_cost_satang + NULL` stays NULL for the rest of the
  -- loop for free. Do not "simplify" this back into a bare running sum —
  -- that would silently reintroduce the exact bug above at the order level.
  -- NOTE: this also corrects the WBS dictionary's own total-computation
  -- pseudocode, which adds `v_line_cost_satang` (a PER-UNIT cost) to the
  -- running total with no quantity multiplication — taken literally, a
  -- 3-cup line would underscore total COGS by 3x. `unit_cost_snapshot_satang`
  -- on `order_items` is deliberately per-unit (parallel to
  -- `unit_price_snapshot_satang`); the ORDER-level total must multiply each
  -- line's per-unit cost by its quantity, which is what the loop below does.
  -------------------------------------------------------------------------
  for v_rl in select * from jsonb_array_elements(v_resolved_lines) loop
    v_rl_menu_item_id := (v_rl->>'menu_item_id')::uuid;
    v_rl_quantity := (v_rl->>'quantity')::integer;
    v_rl_unit_price := (v_rl->>'unit_price_snapshot_satang')::integer;

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
  -- Step 4: order code generation — 6 chars from the 28-char alphabet
  -- above, generate -> INSERT -> catch unique_violation -> retry, bounded
  -- at 20 attempts. Deliberately NOT a pre-check SELECT then INSERT (a real
  -- TOCTOU race under concurrency) — the real unique constraint
  -- (orders.order_code, 0011) is what's caught, at INSERT time. The
  -- begin/exception/end block below is plpgsql's implicit-savepoint
  -- mechanism: catching unique_violation there rolls back only the failed
  -- INSERT attempt itself, never the slot reservation from step 2.
  --
  -- subtotal_satang == total_satang below: flagged for redline_reviewer.
  -- No discount/fee/promo mechanism exists anywhere in this schema yet
  -- (RL-1 forbids a platform fee outright, and no merchant-discount feature
  -- has been built) — `orders.subtotal_satang` is `not null` and there is
  -- nothing legitimate to subtract from `total_satang` yet, so it is
  -- written as a placeholder equal to the total rather than left
  -- unpopulated. A future entry that adds a real discount/fee concept
  -- should make this a genuine subtotal-before-that-adjustment, not
  -- redefine this column.
  -------------------------------------------------------------------------
  loop
    v_attempts := v_attempts + 1;
    v_order_code := '';
    for v_i in 1..6 loop
      v_order_code := v_order_code || substr(v_alphabet, (floor(random() * v_alphabet_len) + 1)::integer, 1);
    end loop;

    begin
      insert into orders (
        store_id, order_code, customer_name, customer_phone, pickup_slot_id,
        channel, status, subtotal_satang, total_satang, total_cost_snapshot_satang, expires_at
      ) values (
        v_store_id, v_order_code, trim(p_customer_name), v_customer_phone, p_pickup_slot_id,
        'online', 'PENDING_PAYMENT', v_total_satang, v_total_satang, v_total_cost_satang, v_expires_at
      )
      returning id into v_order_id;
      exit;
    exception when unique_violation then
      if v_attempts >= 20 then
        raise exception 'checkout_create_order: order_code space exhausted after % attempts', v_attempts;
      end if;
    end;
  end loop;

  -------------------------------------------------------------------------
  -- Step 5: order_items + order_item_options. Response items carry NO cost
  -- field of any kind (RL-3) — built from v_final_lines' name/quantity/
  -- price/options only, never unit_cost_snapshot_satang.
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

    v_resp_options := '[]'::jsonb;
    for v_opt2 in select * from jsonb_array_elements(coalesce(v_fl->'options', '[]'::jsonb)) loop
      insert into order_item_options (
        order_item_id, menu_option_id, option_group_name_snapshot, option_name_snapshot, price_delta_snapshot_satang
      ) values (
        v_order_item_id, (v_opt2->>'menu_option_id')::uuid, v_opt2->>'option_group_name_snapshot',
        v_opt2->>'option_name_snapshot', (v_opt2->>'price_delta_snapshot_satang')::integer
      );

      v_resp_options := v_resp_options || jsonb_build_array(jsonb_build_object(
        'name', v_opt2->>'option_name_snapshot',
        'price_delta_satang', (v_opt2->>'price_delta_snapshot_satang')::integer
      ));
    end loop;

    v_items_response := v_items_response || jsonb_build_array(jsonb_build_object(
      'name', v_fl->>'name_snapshot',
      'quantity', (v_fl->>'quantity')::integer,
      'unit_price_satang', (v_fl->>'unit_price_snapshot_satang')::integer,
      'options', v_resp_options
    ));
  end loop;

  -- Step 6: response — orderCode, totalSatang, pickupAt, expiresAt, and
  -- line items with name/quantity/unit price only. NO cost field, no
  -- snapshot, no fee, no margin (RL-3) — run through the WBS 3.7 public
  -- serializer (toPublicOrderCreated) and its .strict() Zod schema on the
  -- Edge Function side.
  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'order_code', v_order_code,
      'total_satang', v_total_satang,
      'pickup_at', v_slot_start,
      'expires_at', v_expires_at,
      'items', v_items_response
    )
  );
end;
$$;

-- service_role-only, same posture as reserve_pickup_slot/release_pickup_slot
-- (0028) — never anon/authenticated. 0021_rls.sql's own
-- `alter default privileges in schema public grant execute on functions to
-- anon, authenticated, service_role` would otherwise hand anon EXECUTE on
-- this automatically (the trap 0025_auth_attempts_atomic_check.sql's own
-- comment documents finding once before), so the explicit revoke is not
-- optional even though this function was never granted to anon in the
-- first place.
revoke all on function checkout_create_order(text, jsonb, uuid, text, text) from public;
revoke execute on function checkout_create_order(text, jsonb, uuid, text, text) from anon, authenticated;
grant execute on function checkout_create_order(text, jsonb, uuid, text, text) to service_role;
