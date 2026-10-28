-- ============================================================
-- PABBAS — Phase 7B: Transactional Outbox & Order Event System
-- 
-- 1. Creates public.order_events table.
-- 2. Modifies create_customer_order to atomically insert canonical
--    'order.created' event in the same transaction.
-- 3. Implements atomic event lifecycle RPCs:
--    - claim_order_event(p_event_id)
--    - complete_order_event(p_event_id)
--    - fail_order_event(p_event_id, p_error)
-- ============================================================

-- 1. Create order_events table
CREATE TABLE IF NOT EXISTS public.order_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  event_type text NOT NULL DEFAULT 'order.created',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  payload jsonb NOT NULL,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 5,
  next_retry_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_order_events_order_event_type UNIQUE (order_id, event_type)
);

-- Indexes for pending/retry sweep and order lookups
CREATE INDEX IF NOT EXISTS idx_order_events_pending_retry 
ON public.order_events(status, next_retry_at, created_at) 
WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_order_events_order_id 
ON public.order_events(order_id);

-- Row Level Security & Permissions
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.order_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.order_events TO service_role;

-- ============================================================
-- 2. Update create_customer_order to emit atomic order.created event
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_customer_order(
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
  p_table_id uuid DEFAULT NULL,
  p_party_size integer DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing_order_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_subtotal_paise integer := 0;
  v_delivery_fee_paise integer := 0;
  v_total_paise integer := 0;
  v_item jsonb;
  v_menu_item_id uuid;
  v_variant_id uuid;
  v_qty integer;
  v_menu_name text;
  v_variant_name text;
  v_unit_price_paise integer;
  v_line_total_paise integer;
  v_item_active boolean;
  v_table_capacity integer;
  v_table_number text;
  v_res_id uuid;
  v_res_time timestamptz;
  v_end_time timestamptz;
  v_overlap_count integer;
  v_items_payload jsonb := '[]'::jsonb;
  v_event_id uuid;
  v_event_payload jsonb;
  v_result jsonb;
BEGIN
  -- 1. Transaction Lock per Customer (Serializes checkout requests for the same customer first)
  PERFORM pg_advisory_xact_lock(hashtext(p_customer_id::text));

  -- 2. Idempotency check: if order already exists with this idempotency key and customer, return it directly
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT id INTO v_existing_order_id
    FROM public.orders
    WHERE idempotency_key = trim(p_idempotency_key) AND customer_id = p_customer_id;

    IF v_existing_order_id IS NOT NULL THEN
      SELECT jsonb_build_object(
        'order_id', o.id,
        'order_number', o.order_number,
        'order_type', o.order_type,
        'order_status', o.order_status,
        'subtotal_paise', o.subtotal_paise,
        'delivery_fee_paise', o.delivery_fee_paise,
        'total_paise', o.total_paise,
        'is_duplicate', true,
        'event_id', NULL,
        'event_payload', NULL
      ) INTO v_result
      FROM public.orders o
      WHERE o.id = v_existing_order_id;
      RETURN v_result;
    END IF;
  END IF;

  -- 3. Validate Scheduled Time (Rejects times > 5 minutes in the past; preserves ASAP orders where scheduled_time is NULL)
  IF p_scheduled_time IS NOT NULL AND p_scheduled_time < (now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'Scheduled time cannot be in the past';
  END IF;

  -- 4. Validate Cart JSON
  IF p_cart_items IS NULL OR jsonb_array_length(p_cart_items) = 0 THEN
    RAISE EXCEPTION 'Cart cannot be empty';
  END IF;

  -- 5. If Dine-in, lock table and validate capacity & availability
  IF p_order_type = 'dine-in' THEN
    IF p_table_id IS NULL THEN
      RAISE EXCEPTION 'Table selection is required for dine-in orders';
    END IF;

    -- Transaction Advisory Lock on Table ID to prevent concurrent double-booking
    PERFORM pg_advisory_xact_lock(hashtext(p_table_id::text));

    SELECT table_number, capacity INTO v_table_number, v_table_capacity
    FROM public.restaurant_tables
    WHERE id = p_table_id AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected table is invalid or inactive';
    END IF;

    IF COALESCE(p_party_size, 1) > v_table_capacity THEN
      RAISE EXCEPTION 'Party size (%) exceeds table capacity (%)', p_party_size, v_table_capacity;
    END IF;

    v_res_time := COALESCE(p_scheduled_time, now());
    v_end_time := v_res_time + interval '90 minutes';

    SELECT count(*) INTO v_overlap_count
    FROM public.table_reservations
    WHERE table_id = p_table_id
      AND status IN ('reserved', 'seated')
      AND reservation_time < v_end_time
      AND end_time > v_res_time;

    IF v_overlap_count > 0 THEN
      RAISE EXCEPTION 'Table is no longer available for the selected time window';
    END IF;
  END IF;

  -- 6. Calculate line totals and subtotal server-side in PAISE
  v_subtotal_paise := 0;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart_items) LOOP
    v_menu_item_id := (v_item->>'menu_item_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    IF (v_item->>'variant_id') IS NOT NULL AND (v_item->>'variant_id') <> '' THEN
      v_variant_id := (v_item->>'variant_id')::uuid;
    ELSE
      v_variant_id := NULL;
    END IF;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid item quantity';
    END IF;

    -- Fetch authoritative menu item price
    SELECT name, price_paise, is_active INTO v_menu_name, v_unit_price_paise, v_item_active
    FROM public.menu_items
    WHERE id = v_menu_item_id;

    IF NOT FOUND OR NOT v_item_active THEN
      RAISE EXCEPTION 'Menu item is no longer available';
    END IF;

    v_variant_name := NULL;
    IF v_variant_id IS NOT NULL THEN
      SELECT name, price_paise, is_active INTO v_variant_name, v_unit_price_paise, v_item_active
      FROM public.menu_item_variants
      WHERE id = v_variant_id AND menu_item_id = v_menu_item_id;

      IF NOT FOUND OR NOT v_item_active THEN
        RAISE EXCEPTION 'Selected item variant is no longer available';
      END IF;
    END IF;

    v_line_total_paise := v_unit_price_paise * v_qty;
    v_subtotal_paise := v_subtotal_paise + v_line_total_paise;
  END LOOP;

  -- 7. Delivery Fee Calculation (Server-side)
  IF p_order_type = 'delivery' THEN
    IF p_delivery_address IS NULL OR trim(p_delivery_address) = '' THEN
      RAISE EXCEPTION 'Delivery address is required for delivery orders';
    END IF;
    v_delivery_fee_paise := 3500; -- ₹35 flat delivery fee (3500 paise)
  ELSE
    v_delivery_fee_paise := 0;
  END IF;

  v_total_paise := v_subtotal_paise + v_delivery_fee_paise;

  -- 8. Generate Collision-Safe Order Number (e.g. PAB-20260908-1001)
  v_order_number := 'PAB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 4, '0');

  -- 9. Insert Order
  INSERT INTO public.orders (
    order_number,
    customer_id,
    order_type,
    order_status,
    payment_status,
    payment_method,
    subtotal_paise,
    delivery_fee_paise,
    discount_paise,
    total_paise,
    customer_name_snapshot,
    customer_phone_snapshot,
    delivery_address_snapshot,
    landmark_snapshot,
    pincode_snapshot,
    table_id,
    scheduled_time,
    idempotency_key
  ) VALUES (
    v_order_number,
    p_customer_id,
    p_order_type,
    'confirmed',
    'pending',
    COALESCE(p_payment_method, 'upi'),
    v_subtotal_paise,
    v_delivery_fee_paise,
    0,
    v_total_paise,
    p_customer_name,
    p_customer_phone,
    p_delivery_address,
    p_landmark,
    p_pincode,
    p_table_id,
    p_scheduled_time,
    NULLIF(trim(p_idempotency_key), '')
  ) RETURNING id INTO v_order_id;

  -- 10. Insert Order Items and build authoritative item list
  v_items_payload := '[]'::jsonb;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart_items) LOOP
    v_menu_item_id := (v_item->>'menu_item_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    IF (v_item->>'variant_id') IS NOT NULL AND (v_item->>'variant_id') <> '' THEN
      v_variant_id := (v_item->>'variant_id')::uuid;
    ELSE
      v_variant_id := NULL;
    END IF;

    SELECT name, price_paise INTO v_menu_name, v_unit_price_paise FROM public.menu_items WHERE id = v_menu_item_id;

    v_variant_name := NULL;
    IF v_variant_id IS NOT NULL THEN
      SELECT name, price_paise INTO v_variant_name, v_unit_price_paise FROM public.menu_item_variants WHERE id = v_variant_id;
    END IF;

    v_line_total_paise := v_unit_price_paise * v_qty;

    INSERT INTO public.order_items (
      order_id,
      menu_item_id,
      variant_id,
      item_name_snapshot,
      variant_name_snapshot,
      unit_price_paise_snapshot,
      quantity,
      line_total_paise
    ) VALUES (
      v_order_id,
      v_menu_item_id,
      v_variant_id,
      v_menu_name,
      v_variant_name,
      v_unit_price_paise,
      v_qty,
      v_line_total_paise
    );

    v_items_payload := v_items_payload || jsonb_build_array(
      jsonb_build_object(
        'name', v_menu_name,
        'variant_name', v_variant_name,
        'quantity', v_qty,
        'unit_price_paise', v_unit_price_paise,
        'line_total_paise', v_line_total_paise
      )
    );
  END LOOP;

  -- 11. If Dine-in, create table reservation linked to order
  IF p_order_type = 'dine-in' THEN
    INSERT INTO public.table_reservations (
      table_id,
      customer_id,
      order_id,
      reservation_time,
      end_time,
      status,
      party_size
    ) VALUES (
      p_table_id,
      p_customer_id,
      v_order_id,
      v_res_time,
      v_end_time,
      'reserved',
      COALESCE(p_party_size, 1)
    ) RETURNING id INTO v_res_id;

    UPDATE public.orders SET table_reservation_id = v_res_id WHERE id = v_order_id;
  END IF;

  -- 12. Assemble Canonical Event Payload and Insert Outbox Event Atomically
  v_event_id := gen_random_uuid();

  v_event_payload := jsonb_build_object(
    'event_id', v_event_id,
    'event_type', 'order.created',
    'created_at', now(),
    'order', jsonb_build_object(
      'id', v_order_id,
      'order_number', v_order_number,
      'order_type', p_order_type,
      'order_status', 'confirmed',
      'payment_method', COALESCE(p_payment_method, 'upi'),
      'payment_status', 'pending',
      'scheduled_time', p_scheduled_time
    ),
    'customer', jsonb_build_object(
      'id', p_customer_id,
      'name', p_customer_name,
      'phone', p_customer_phone
    ),
    'fulfillment', jsonb_build_object(
      'table_number', CASE WHEN p_order_type = 'dine-in' THEN v_table_number ELSE NULL END,
      'party_size', CASE WHEN p_order_type = 'dine-in' THEN COALESCE(p_party_size, 1) ELSE NULL END,
      'delivery_address', CASE WHEN p_order_type = 'delivery' THEN p_delivery_address ELSE NULL END,
      'landmark', p_landmark,
      'pincode', p_pincode
    ),
    'pricing', jsonb_build_object(
      'subtotal_paise', v_subtotal_paise,
      'delivery_fee_paise', v_delivery_fee_paise,
      'total_paise', v_total_paise
    ),
    'items', v_items_payload
  );

  INSERT INTO public.order_events (
    id,
    order_id,
    event_type,
    status,
    payload
  ) VALUES (
    v_event_id,
    v_order_id,
    'order.created',
    'pending',
    v_event_payload
  );

  -- 13. Return JSON result
  SELECT jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'order_type', p_order_type,
    'order_status', 'confirmed',
    'subtotal_paise', v_subtotal_paise,
    'delivery_fee_paise', v_delivery_fee_paise,
    'total_paise', v_total_paise,
    'is_duplicate', false,
    'event_id', v_event_id,
    'event_payload', v_event_payload
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_customer_order(uuid, text, text, text, text, text, text, timestamptz, text, text, jsonb, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_order(uuid, text, text, text, text, text, text, timestamptz, text, text, jsonb, uuid, integer) TO service_role;

-- ============================================================
-- 3. Event Lifecycle RPCs (claim, complete, fail)
-- ============================================================

-- A. claim_order_event: Atomically claims an event for processing
CREATE OR REPLACE FUNCTION public.claim_order_event(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_claimed public.order_events%ROWTYPE;
BEGIN
  -- Atomically transition status from pending/failed to processing
  -- Only claims if next_retry_at is NULL or in the past
  UPDATE public.order_events
  SET status = 'processing',
      updated_at = now()
  WHERE id = p_event_id
    AND status IN ('pending', 'failed')
    AND (next_retry_at IS NULL OR next_retry_at <= now())
  RETURNING * INTO v_claimed;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_claimed.id,
    'order_id', v_claimed.order_id,
    'event_type', v_claimed.event_type,
    'status', v_claimed.status,
    'payload', v_claimed.payload,
    'retry_count', v_claimed.retry_count,
    'max_retries', v_claimed.max_retries
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_order_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_event(uuid) TO service_role;

-- B. complete_order_event: Marks a processing event as completed
CREATE OR REPLACE FUNCTION public.complete_order_event(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_completed public.order_events%ROWTYPE;
BEGIN
  UPDATE public.order_events
  SET status = 'completed',
      updated_at = now()
  WHERE id = p_event_id
    AND status = 'processing'
  RETURNING * INTO v_completed;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_completed.id,
    'status', v_completed.status,
    'updated_at', v_completed.updated_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_order_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_order_event(uuid) TO service_role;

-- C. fail_order_event: Handles failure with exponential backoff & dead_letter
CREATE OR REPLACE FUNCTION public.fail_order_event(
  p_event_id uuid,
  p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_event public.order_events%ROWTYPE;
  v_new_retry_count integer;
  v_new_status text;
  v_next_retry timestamptz;
BEGIN
  SELECT * INTO v_event
  FROM public.order_events
  WHERE id = p_event_id AND status = 'processing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_new_retry_count := v_event.retry_count + 1;

  IF v_new_retry_count >= v_event.max_retries THEN
    v_new_status := 'dead_letter';
    v_next_retry := NULL;
  ELSE
    v_new_status := 'failed';
    -- Exponential backoff: 30s * 2^(retry_count) -> 30s, 60s, 120s, 240s...
    v_next_retry := now() + (interval '30 seconds' * power(2, v_new_retry_count - 1));
  END IF;

  UPDATE public.order_events
  SET status = v_new_status,
      retry_count = v_new_retry_count,
      next_retry_at = v_next_retry,
      last_error = p_error,
      updated_at = now()
  WHERE id = p_event_id
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'id', v_event.id,
    'status', v_event.status,
    'retry_count', v_event.retry_count,
    'max_retries', v_event.max_retries,
    'next_retry_at', v_event.next_retry_at,
    'last_error', v_event.last_error
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fail_order_event(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_order_event(uuid, text) TO service_role;
