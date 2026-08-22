-- WBS 5.10 — fix: public_order_lookup(p_phone, p_order_code) compared
-- p_phone against orders.customer_phone with a bare `=`, but
-- checkout_create_order (0029) normalises whatever a customer typed at
-- checkout (0812345678, 081-234-5678, 66812345678, ...) into +66XXXXXXXXX
-- before writing customer_phone. A customer re-typing their own number in
-- any human-typed shape on `/track` could never match their own order —
-- confirmed live against a real seeded order before this fix: '081-234-5678'
-- and '0812345678' both returned zero rows against a row whose
-- customer_phone was '+66812345678', while '+66812345678' matched. This is
-- not new scope, it's this RPC's one stated job (matching a customer's
-- phone to their order) not actually working for realistic input.
--
-- Same normalisation rule as 0029's inline block, byte-for-byte, so a phone
-- typed at checkout and the same phone re-typed at /track always agree:
-- recognisable Thai mobile shapes (0XXXXXXXXX, 66XXXXXXXXX, +66XXXXXXXXX)
-- normalise to +66XXXXXXXXX; anything else compares as the raw trimmed
-- input, matching 0029's own "never block, never guess" fallback for
-- unrecognised shapes.
create or replace function public_order_lookup(p_phone text, p_order_code text)
returns table (
  order_code text,
  status text,
  pickup_at timestamptz,
  item_name text,
  quantity integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_digits text;
begin
  v_phone := nullif(trim(p_phone), '');
  if v_phone is not null then
    v_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
    if v_digits ~ '^0[0-9]{9}$' then
      v_phone := '+66' || substr(v_digits, 2);
    elsif v_digits ~ '^66[0-9]{9}$' then
      v_phone := '+' || v_digits;
    end if;
  end if;

  return query
    select
      o.order_code,
      o.status,
      ps.slot_start as pickup_at,
      oi.item_name_snapshot as item_name,
      oi.quantity
    from orders o
    join order_items oi on oi.order_id = o.id
    left join pickup_slots ps on ps.id = o.pickup_slot_id
    where o.order_code = p_order_code
      and o.customer_phone = v_phone;
end;
$$;

revoke all on function public_order_lookup(text, text) from public;
grant execute on function public_order_lookup(text, text) to anon;
