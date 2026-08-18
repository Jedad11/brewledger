-- WBS 3.5 seed data: one demo merchant, one published store ('demo-cafe'),
-- 4 menu items (one with zero bom_lines, proving RL-2), 3 costed ingredients,
-- today's 07:00-10:00 pickup slots at 15-minute intervals (capacity 3), and
-- one confirmed purchase invoice.
do $$
declare
  v_auth_user_id uuid := gen_random_uuid();
  v_merchant_id uuid;
  v_store_id uuid;
  v_category_id uuid;
  v_milk_id uuid;
  v_beans_id uuid;
  v_sugar_id uuid;
  v_latte_id uuid;
  v_americano_id uuid;
  v_cappuccino_id uuid;
  v_cookie_id uuid;
  v_invoice_id uuid;
  v_slot_start timestamptz;
  v_bangkok_day timestamp := current_date::timestamp;
begin
  -- confirmation_token/recovery_token/email_change_token_new default to NULL
  -- when omitted, but GoTrue's Go client scans them into non-nullable string
  -- fields -- a NULL here makes auth.getUser() 500 for this user via any
  -- console-* Edge Function's auth guard. Set to '' explicitly (a known
  -- gotcha when inserting into auth.users directly via SQL instead of
  -- through the Auth API). Found by WBS 3.7 qa_engineer's auth guard tests.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, phone, phone_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_auth_user_id, 'authenticated', 'authenticated',
    'demo-merchant@brewledger.app', crypt('brewledger-demo', gen_salt('bf')),
    now(), '+66811111111', now(),
    '', '', '',
    '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now()
  );

  insert into merchants (id, auth_user_id, phone, subscription_tier)
  values (gen_random_uuid(), v_auth_user_id, '+66811111111', 'free')
  returning id into v_merchant_id;

  insert into stores (
    id, merchant_id, slug, name, pickup_address, timezone,
    opens_at, closes_at, promptpay_id, promptpay_type, promptpay_verified_at, is_published
  ) values (
    gen_random_uuid(), v_merchant_id, 'demo-cafe', 'Demo Cafe', '123 Sukhumvit Rd, Bangkok', 'Asia/Bangkok',
    time '07:00', time '18:00', '0811111111', 'msisdn', now(), true
  ) returning id into v_store_id;

  insert into menu_categories (id, store_id, name, sort_order)
  values (gen_random_uuid(), v_store_id, 'Coffee', 0)
  returning id into v_category_id;

  insert into ingredients (id, store_id, name, base_unit, current_unit_cost_satang, current_stock_base_unit, low_stock_threshold)
  values
    (gen_random_uuid(), v_store_id, 'Milk', 'ml', 50, 5000, 1000)
  returning id into v_milk_id;

  insert into ingredients (id, store_id, name, base_unit, current_unit_cost_satang, current_stock_base_unit, low_stock_threshold)
  values
    (gen_random_uuid(), v_store_id, 'Coffee Beans', 'g', 200, 3000, 500)
  returning id into v_beans_id;

  insert into ingredients (id, store_id, name, base_unit, current_unit_cost_satang, current_stock_base_unit, low_stock_threshold)
  values
    (gen_random_uuid(), v_store_id, 'Sugar', 'g', 20, 2000, 300)
  returning id into v_sugar_id;

  insert into menu_items (id, store_id, category_id, name, description, price_satang, availability, sort_order)
  values (gen_random_uuid(), v_store_id, v_category_id, 'Latte', 'Espresso with steamed milk', 6500, 'available', 0)
  returning id into v_latte_id;

  insert into menu_items (id, store_id, category_id, name, description, price_satang, availability, sort_order)
  values (gen_random_uuid(), v_store_id, v_category_id, 'Americano', 'Espresso with hot water', 5500, 'available', 1)
  returning id into v_americano_id;

  insert into menu_items (id, store_id, category_id, name, description, price_satang, availability, sort_order)
  values (gen_random_uuid(), v_store_id, v_category_id, 'Cappuccino', 'Espresso with foamed milk', 6500, 'available', 2)
  returning id into v_cappuccino_id;

  -- RL-2: sellable with zero bom_lines — cost resolves to null, never 0.
  insert into menu_items (id, store_id, category_id, name, description, price_satang, availability, sort_order)
  values (gen_random_uuid(), v_store_id, v_category_id, 'Butter Cookie', 'Baked in-house', 4500, 'available', 3)
  returning id into v_cookie_id;

  insert into bom_lines (id, store_id, menu_item_id, ingredient_id, qty_base_unit) values
    (gen_random_uuid(), v_store_id, v_latte_id, v_milk_id, 150),
    (gen_random_uuid(), v_store_id, v_latte_id, v_beans_id, 18),
    (gen_random_uuid(), v_store_id, v_americano_id, v_beans_id, 18),
    (gen_random_uuid(), v_store_id, v_cappuccino_id, v_milk_id, 100),
    (gen_random_uuid(), v_store_id, v_cappuccino_id, v_beans_id, 18);

  insert into purchase_invoices (
    id, store_id, image_path, vendor_name, invoice_date, total_satang,
    ocr_status, review_status, raw_ocr_output
  ) values (
    gen_random_uuid(), v_store_id, 'seed/demo-invoice.jpg', 'Bangkok Wholesale Supply', current_date, 62000,
    'processed', 'confirmed', '{"note":"seed data, not real OCR output"}'::jsonb
  ) returning id into v_invoice_id;

  insert into purchase_line_items (id, invoice_id, store_id, ingredient_id, raw_text, qty_base_unit, unit_cost_satang, total_satang, mapping_confidence)
  values
    (gen_random_uuid(), v_invoice_id, v_store_id, v_milk_id, 'Fresh Milk 5L', 5000, 50, 250000, 0.95),
    (gen_random_uuid(), v_invoice_id, v_store_id, v_beans_id, 'Arabica Beans 3kg', 3000, 200, 600000, 0.92),
    (gen_random_uuid(), v_invoice_id, v_store_id, v_sugar_id, 'Sugar 2kg', 2000, 20, 40000, 0.90);

  insert into stock_ledger (id, store_id, ingredient_id, delta_base_unit, reason, purchase_invoice_id)
  values
    (gen_random_uuid(), v_store_id, v_milk_id, 5000, 'purchase', v_invoice_id),
    (gen_random_uuid(), v_store_id, v_beans_id, 3000, 'purchase', v_invoice_id),
    (gen_random_uuid(), v_store_id, v_sugar_id, 2000, 'purchase', v_invoice_id);

  for v_slot_start in
    select generate_series(
      (v_bangkok_day + time '07:00') at time zone 'Asia/Bangkok',
      (v_bangkok_day + time '10:00') at time zone 'Asia/Bangkok' - interval '15 minutes',
      interval '15 minutes'
    )
  loop
    insert into pickup_slots (id, store_id, slot_start, slot_end, capacity, booked_count, is_open)
    values (gen_random_uuid(), v_store_id, v_slot_start, v_slot_start + interval '15 minutes', 3, 0, true)
    on conflict (store_id, slot_start) do nothing;
  end loop;
end $$;
