-- Persist YCloud message status callbacks and make order creation atomic and retry-safe.
-- Apply to the Rasoi Supabase project only.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ycloud_message_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id text NOT NULL UNIQUE,
  provider_message_id text,
  whatsapp_message_id text,
  external_id text,
  status text CHECK (status IS NULL OR status IN ('accepted','failed','sent','delivered','read')),
  recipient_phone text,
  sender_phone text,
  error_code text,
  error_message text,
  event_created_at timestamptz,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ycloud_message_status_events_message_idx
  ON public.ycloud_message_status_events(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ycloud_message_status_events_external_idx
  ON public.ycloud_message_status_events(external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.ycloud_message_status_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ycloud_message_status_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ycloud_message_status_events TO service_role;

-- Close the check-then-insert race in inbound_bundle().
CREATE UNIQUE INDEX IF NOT EXISTS messages_ycloud_inbound_message_id_unique_idx
  ON public.messages(message_id)
  WHERE direction = 'inbound' AND message_id IS NOT NULL AND message_id <> '';

CREATE OR REPLACE FUNCTION public.inbound_bundle(
  p_phone text,
  p_channel_user_id text DEFAULT NULL,
  p_message_id text DEFAULT '',
  p_message_type text DEFAULT 'text',
  p_content text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_context jsonb;
  v_cart jsonb;
  v_menu jsonb;
  v_last jsonb;
  v_popular text;
  v_message_row_id uuid;
  v_today_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
BEGIN
  IF coalesce(p_message_id, '') <> '' AND EXISTS (SELECT 1 FROM messages WHERE message_id = p_message_id AND direction = 'inbound') THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  INSERT INTO messages (phone, direction, content, sender, message_type, message_id, ai_intent)
  VALUES (p_phone, 'inbound', coalesce(p_content, ''), 'customer', coalesce(nullif(p_message_type, ''), 'text'), coalesce(p_message_id, ''), '')
  ON CONFLICT (message_id) WHERE direction = 'inbound' AND message_id IS NOT NULL AND message_id <> '' DO NOTHING
  RETURNING id INTO v_message_row_id;

  IF v_message_row_id IS NULL THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  v_context := public.chat_context(p_phone, NULL);

  SELECT items INTO v_cart FROM ai_carts WHERE channel_user_id = p_channel_user_id;

  WITH sold AS (
    SELECT lower(trim(coalesce(li->>'item_name', li->>'name'))) AS name, sum(coalesce((li->>'quantity')::int, 1)) AS qty
      FROM orders o CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.items_json) = 'array' THEN o.items_json ELSE '[]'::jsonb END) li
     WHERE o.created_at > now() - interval '30 days' AND o.status NOT IN ('cancelled', 'draft')
     GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'name', m.item_name, 'category', m.category, 'available', m.available, 'price', m.price,
           'sold_30d', coalesce(s.qty, 0)) ORDER BY m.category, m.item_name), '[]'::jsonb)
    INTO v_menu
    FROM menu_items m LEFT JOIN sold s ON s.name = lower(trim(m.item_name));

  SELECT jsonb_build_object('order_number', o.order_number, 'items', o.items_json, 'created_at', o.created_at)
    INTO v_last
    FROM orders o
   WHERE o.customer_phone = normalize_phone(p_phone)
     AND o.status NOT IN ('cancelled', 'draft')
     AND jsonb_typeof(o.items_json) = 'array'
     AND jsonb_array_length(o.items_json) > 0
   ORDER BY o.created_at DESC
   LIMIT 1;

  SELECT m.item_name INTO v_popular
    FROM orders o
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.items_json) = 'array' THEN o.items_json ELSE '[]'::jsonb END) li
    JOIN menu_items m ON lower(trim(m.item_name)) = lower(trim(coalesce(li->>'item_name', li->>'name'))) AND m.available
   WHERE o.created_at >= v_today_start AND o.status NOT IN ('cancelled', 'draft')
   GROUP BY m.item_name
  HAVING count(DISTINCT o.id) >= 2
   ORDER BY count(DISTINCT o.id) DESC, m.item_name
   LIMIT 1;

  RETURN coalesce(v_context, '{}'::jsonb)
    || jsonb_build_object(
         'duplicate', false,
         'pending_cart_items', coalesce(v_cart, '[]'::jsonb),
         'menu_detail', v_menu,
         'last_order', v_last,
         'popular_today', v_popular
       );
END;
$$;

REVOKE ALL ON FUNCTION public.inbound_bundle(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inbound_bundle(text, text, text, text, text) TO service_role;

-- Interactive feedback requests are free-form WhatsApp messages. Restrict them
-- to orders whose customer has messaged Rasoi within the 24-hour service window.
CREATE OR REPLACE VIEW public.pending_ratings AS
SELECT o.*
FROM public.orders o
WHERE o.status = 'delivered'
  AND o.updated_at BETWEEN now() - interval '1 day' AND now() - interval '30 minutes'
  AND EXISTS (
    SELECT 1
      FROM public.messages m
     WHERE m.phone = public.normalize_phone(o.customer_phone)
       AND m.direction = 'inbound'
       AND m.created_at >= now() - interval '24 hours'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.reviews r WHERE r.order_number = o.order_number
  );

-- One RPC commits the order and its items together. The advisory lock plus the
-- unique index makes repeat webhook/API requests with the same key return one order.
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_idx
  ON public.orders(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_customer_order_atomic(
  p_customer_id uuid,
  p_order_type text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_landmark text,
  p_pincode text,
  p_scheduled_time timestamptz,
  p_payment_method text,
  p_idempotency_key text,
  p_cart_items jsonb,
  p_table_number text,
  p_party_size integer,
  p_source text,
  p_channel_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_item jsonb;
  v_item_id uuid;
  v_variant_id uuid;
  v_quantity integer;
  v_item_name text;
  v_price numeric;
  v_subtotal numeric := 0;
  v_fee numeric := 0;
  v_total numeric;
  v_table_number text;
  v_table_id uuid;
  v_summary text := '';
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_order public.orders;
  v_existing_name text;
  v_existing_phone text;
  v_customer_id uuid := p_customer_id;
  v_phone text;
  v_channel_user_id text;
  v_setting text;
BEGIN
  IF p_source NOT IN ('whatsapp', 'pwa') THEN RAISE EXCEPTION 'Invalid order source'; END IF;
  IF p_source = 'whatsapp' AND coalesce(btrim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'An idempotency key is required for WhatsApp orders';
  END IF;

  IF coalesce(btrim(p_idempotency_key), '') <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
    SELECT * INTO v_order FROM public.orders WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN jsonb_build_object('order', to_jsonb(v_order), 'duplicate', true); END IF;
  END IF;

  v_type := CASE lower(btrim(p_order_type))
    WHEN 'pickup' THEN 'takeaway'
    WHEN 'takeaway' THEN 'takeaway'
    WHEN 'delivery' THEN 'delivery'
    WHEN 'dine-in' THEN 'dine-in'
    WHEN 'dinein' THEN 'dine-in'
    ELSE NULL
  END;
  IF v_type IS NULL THEN RAISE EXCEPTION 'Invalid order type'; END IF;
  IF NOT public.is_open(now()) THEN RAISE EXCEPTION 'Orders are paused or the restaurant is closed'; END IF;

  SELECT value INTO v_setting FROM public.settings WHERE key = 'order_types';
  IF v_type = 'delivery' AND position('delivery' IN lower(coalesce(v_setting, ''))) = 0 THEN RAISE EXCEPTION 'Delivery orders are not available'; END IF;
  IF v_type = 'takeaway' AND position('takeaway' IN lower(coalesce(v_setting, ''))) = 0 AND position('pickup' IN lower(coalesce(v_setting, ''))) = 0 THEN RAISE EXCEPTION 'Takeaway orders are not available'; END IF;
  IF v_type = 'dine-in' AND position('dine' IN lower(coalesce(v_setting, ''))) = 0 THEN RAISE EXCEPTION 'Dine-in orders are not available'; END IF;

  IF p_cart_items IS NULL OR jsonb_typeof(p_cart_items) <> 'array' OR jsonb_array_length(p_cart_items) = 0 THEN RAISE EXCEPTION 'Cart cannot be empty'; END IF;
  IF p_source = 'pwa' AND v_customer_id IS NULL THEN RAISE EXCEPTION 'Customer session required'; END IF;

  IF v_customer_id IS NOT NULL THEN
    SELECT name, phone INTO v_existing_name, v_existing_phone FROM public.app_customers WHERE id = v_customer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
  END IF;
  v_phone := public.normalize_phone(coalesce(nullif(btrim(p_customer_phone), ''), v_existing_phone));
  IF v_phone = '' THEN RAISE EXCEPTION 'Customer phone is required'; END IF;

  IF v_customer_id IS NULL THEN
    v_channel_user_id := coalesce(nullif(btrim(p_channel_user_id), ''), v_phone);
    INSERT INTO public.app_customers(channel, channel_user_id, phone, name)
    VALUES ('whatsapp', v_channel_user_id, v_phone, coalesce(nullif(btrim(p_customer_name), ''), 'WhatsApp Customer'))
    ON CONFLICT (channel, channel_user_id) DO UPDATE
      SET phone = EXCLUDED.phone,
          name = coalesce(nullif(EXCLUDED.name, ''), public.app_customers.name),
          updated_at = now()
    RETURNING id INTO v_customer_id;
  END IF;

  IF v_type = 'delivery' AND coalesce(btrim(p_delivery_address), '') = '' THEN RAISE EXCEPTION 'Delivery address required'; END IF;
  IF v_type = 'delivery' AND EXISTS (SELECT 1 FROM public.delivery_pincodes WHERE active)
     AND NOT EXISTS (SELECT 1 FROM public.delivery_pincodes WHERE active AND pincode = btrim(coalesce(p_pincode, ''))) THEN
    RAISE EXCEPTION 'Pincode not serviceable';
  END IF;
  IF v_type = 'dine-in' THEN
    SELECT id, table_number INTO v_table_id, v_table_number
      FROM public.restaurant_tables
     WHERE (table_number = btrim(coalesce(p_table_number, '')) OR id::text = btrim(coalesce(p_table_number, '')))
       AND NOT is_active AND current_order_id IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Table unavailable'; END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart_items) LOOP
    v_item_id := coalesce(nullif(v_item->>'menu_item_id', ''), nullif(v_item->>'menuItemId', ''))::uuid;
    v_variant_id := coalesce(nullif(v_item->>'variant_id', ''), nullif(v_item->>'variantId', ''))::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity IS NULL OR v_quantity < 1 OR v_quantity > 20 THEN RAISE EXCEPTION 'Invalid item quantity'; END IF;

    SELECT item_name, price INTO v_item_name, v_price
      FROM public.menu_items WHERE id = v_item_id AND available;
    IF NOT FOUND THEN RAISE EXCEPTION 'Menu item unavailable'; END IF;
    IF v_variant_id IS NOT NULL THEN
      SELECT coalesce(nullif(price, 0), v_price), name INTO v_price, v_item_name
        FROM public.menu_item_variants WHERE id = v_variant_id AND menu_item_id = v_item_id AND is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'Variant unavailable'; END IF;
    END IF;

    v_subtotal := v_subtotal + v_price * v_quantity;
    v_line := jsonb_build_object('menu_item_id', v_item_id, 'item_name', v_item_name, 'quantity', v_quantity,
      'unit_price', v_price, 'variant_id', v_variant_id, 'round', 1);
    v_lines := v_lines || jsonb_build_array(v_line);
    v_summary := concat_ws(', ', nullif(v_summary, ''), v_item_name || ' x ' || v_quantity);
  END LOOP;

  SELECT value INTO v_setting FROM public.settings WHERE key = 'min_order';
  IF v_subtotal < coalesce(nullif(v_setting, '')::numeric, 0) THEN RAISE EXCEPTION 'Below minimum order'; END IF;
  IF v_type = 'delivery' THEN
    SELECT value INTO v_setting FROM public.settings WHERE key = 'delivery_fee';
    v_fee := coalesce(nullif(v_setting, '')::numeric, 0);
    SELECT value INTO v_setting FROM public.settings WHERE key = 'free_delivery_above';
    IF coalesce(nullif(v_setting, '')::numeric, 0) > 0 AND v_subtotal >= v_setting::numeric THEN v_fee := 0; END IF;
  END IF;
  v_total := round(v_subtotal + v_fee, 2);

  INSERT INTO public.orders(order_number, customer_id, customer_phone, customer_name, items, total, total_amount,
    status, order_type, source, address, delivery_address, landmark, pincode, table_number, scheduled_for,
    payment_method, delivery_fee, idempotency_key, party_size, items_json)
  VALUES (public.next_order_number(p_source), v_customer_id, v_phone,
    coalesce(nullif(btrim(p_customer_name), ''), v_existing_name, 'WhatsApp Customer'), v_summary, v_total, v_total,
    'new', v_type, p_source, CASE WHEN v_type = 'delivery' THEN btrim(p_delivery_address) END,
    CASE WHEN v_type = 'delivery' THEN btrim(p_delivery_address) END, nullif(btrim(p_landmark), ''),
    CASE WHEN v_type = 'delivery' THEN nullif(btrim(p_pincode), '') END, v_table_number, p_scheduled_time,
    coalesce(nullif(btrim(p_payment_method), ''), 'cash'), v_fee, nullif(btrim(p_idempotency_key), ''),
    greatest(1, coalesce(p_party_size, 1)), v_lines)
  RETURNING * INTO v_order;

  INSERT INTO public.order_items(order_id, menu_item_id, item_name, quantity, unit_price, variant_id)
  SELECT v_order.id, (line->>'menu_item_id')::uuid, line->>'item_name', (line->>'quantity')::integer,
         (line->>'unit_price')::numeric, nullif(line->>'variant_id', '')::uuid
    FROM jsonb_array_elements(v_lines) AS line;

  IF v_type = 'dine-in' THEN
    UPDATE public.restaurant_tables SET is_active = true, current_order_id = v_order.id WHERE id = v_table_id;
  END IF;

  RETURN jsonb_build_object('order', to_jsonb(v_order), 'duplicate', false);
EXCEPTION WHEN unique_violation THEN
  IF coalesce(btrim(p_idempotency_key), '') <> '' THEN
    SELECT * INTO v_order FROM public.orders WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN jsonb_build_object('order', to_jsonb(v_order), 'duplicate', true); END IF;
  END IF;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_order_atomic(uuid, text, text, text, text, text, text, timestamptz, text, text, jsonb, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_order_atomic(uuid, text, text, text, text, text, text, timestamptz, text, text, jsonb, text, integer, text, text) TO service_role;

COMMIT;
