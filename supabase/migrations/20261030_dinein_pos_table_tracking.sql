BEGIN;

ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Correct legacy POS rows where a table number was saved but order_type was not.
UPDATE public.orders
SET order_type = 'dine-in'
WHERE nullif(btrim(table_number), '') IS NOT NULL
  AND order_type IS DISTINCT FROM 'dine-in';

-- Restore table metadata from active dine-in orders left by earlier POS sessions.
WITH ranked_active_orders AS (
  SELECT
    o.id,
    o.table_number,
    row_number() OVER (
      PARTITION BY o.table_number
      ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC
    ) AS table_rank
  FROM public.orders AS o
  WHERE (o.order_type = 'dine-in' OR nullif(btrim(o.table_number), '') IS NOT NULL)
    AND o.status IN ('new', 'preparing', 'ready_for_pickup')
    AND nullif(btrim(o.table_number), '') IS NOT NULL
)
UPDATE public.restaurant_tables AS t
SET is_active = false,
    current_order_id = NULL,
    updated_at = now()
WHERE NOT EXISTS (
  SELECT 1
  FROM ranked_active_orders AS active_order
  WHERE active_order.table_number = t.table_number
)
AND (t.is_active OR t.current_order_id IS NOT NULL);

WITH ranked_active_orders AS (
  SELECT
    o.id,
    o.table_number,
    row_number() OVER (
      PARTITION BY o.table_number
      ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC
    ) AS table_rank
  FROM public.orders AS o
  WHERE (o.order_type = 'dine-in' OR nullif(btrim(o.table_number), '') IS NOT NULL)
    AND o.status IN ('new', 'preparing', 'ready_for_pickup')
    AND nullif(btrim(o.table_number), '') IS NOT NULL
)
UPDATE public.restaurant_tables AS t
SET is_active = true,
    current_order_id = active_order.id,
    updated_at = now()
FROM ranked_active_orders AS active_order
WHERE active_order.table_rank = 1
  AND active_order.table_number = t.table_number;

-- POS-created dine-in orders must claim their table in the same transaction,
-- so Table + Round and Close & Pay refer to the right open order.
CREATE OR REPLACE FUNCTION public.create_pos_order(
  p_customer_name text,
  p_customer_phone text,
  p_order_type text,
  p_table_number text,
  p_address text,
  p_landmark text,
  p_pincode text,
  p_total numeric,
  p_items_summary text,
  p_items_json jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_number text;
  v_order_id uuid;
  v_item jsonb;
  v_table_number text := NULL;
BEGIN
  IF p_order_type IS NULL OR p_order_type NOT IN ('takeaway', 'delivery', 'dine-in') THEN
    RAISE EXCEPTION 'Invalid POS order type';
  END IF;

  IF p_items_json IS NULL
    OR jsonb_typeof(p_items_json) <> 'array'
    OR jsonb_array_length(p_items_json) = 0 THEN
    RAISE EXCEPTION 'Cart cannot be empty';
  END IF;

  IF p_order_type = 'dine-in' THEN
    SELECT t.table_number
      INTO v_table_number
      FROM public.restaurant_tables AS t
     WHERE t.table_number = btrim(coalesce(p_table_number, ''))
       AND NOT t.is_active
       AND t.current_order_id IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.orders AS active_order
          WHERE active_order.table_number = t.table_number
            AND active_order.status IN ('new', 'preparing', 'ready_for_pickup')
       )
     FOR UPDATE OF t;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Table unavailable';
    END IF;
  END IF;

  v_order_number := public.next_order_number('pos');

  INSERT INTO public.orders (
    order_number,
    customer_phone,
    customer_name,
    items,
    total,
    total_amount,
    status,
    order_type,
    source,
    address,
    delivery_address,
    landmark,
    pincode,
    table_number,
    items_json
  ) VALUES (
    v_order_number,
    public.normalize_phone(p_customer_phone),
    p_customer_name,
    p_items_summary,
    p_total,
    p_total,
    'preparing',
    p_order_type,
    'pos',
    CASE WHEN p_order_type = 'delivery' THEN p_address ELSE NULL END,
    CASE WHEN p_order_type = 'delivery' THEN p_address ELSE NULL END,
    p_landmark,
    p_pincode,
    v_table_number,
    p_items_json
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items_json) LOOP
    INSERT INTO public.order_items (
      order_id,
      menu_item_id,
      item_name,
      quantity,
      unit_price,
      variant_name
    ) VALUES (
      v_order_id,
      NULLIF(v_item->>'menu_item_id', '')::uuid,
      coalesce(v_item->>'item_name', 'Item'),
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      v_item->>'variant_name'
    );
  END LOOP;

  IF p_order_type = 'dine-in' THEN
    UPDATE public.restaurant_tables
       SET is_active = true,
           current_order_id = v_order_id,
           updated_at = now()
     WHERE table_number = v_table_number;
  END IF;

  RETURN jsonb_build_object('id', v_order_id, 'order_number', v_order_number);
END;
$$;

REVOKE ALL ON FUNCTION public.create_pos_order(text, text, text, text, text, text, text, numeric, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pos_order(text, text, text, text, text, text, text, numeric, text, jsonb)
  TO service_role;

COMMIT;
