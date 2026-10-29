BEGIN;

-- The order dashboard uses orders.items_json, while order_items is also kept
-- in sync for receipts and other staff tooling.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS notes text;

-- Keep the existing order validation and creation path, then persist each
-- submitted item note in the same transaction as the order.
CREATE OR REPLACE FUNCTION public.create_customer_order_with_notes_atomic(
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
  v_result jsonb;
  v_order_id uuid;
  v_order_items jsonb;
BEGIN
  v_result := public.create_customer_order_atomic(
    p_customer_id,
    p_order_type,
    p_customer_name,
    p_customer_phone,
    p_delivery_address,
    p_landmark,
    p_pincode,
    p_scheduled_time,
    p_payment_method,
    p_idempotency_key,
    p_cart_items,
    p_table_number,
    p_party_size,
    p_source,
    p_channel_user_id
  );

  -- A duplicate idempotency key already has its notes from the original commit.
  IF coalesce((v_result->>'duplicate')::boolean, false) THEN
    RETURN v_result;
  END IF;

  v_order_id := nullif(v_result #>> '{order,id}', '')::uuid;
  IF v_order_id IS NULL THEN
    RETURN v_result;
  END IF;

  SELECT coalesce(
    jsonb_agg(
      CASE
        WHEN nullif(
          left(btrim(coalesce(nullif(request_line.item->>'special_note', ''), request_line.item->>'notes', '')), 300),
          ''
        ) IS NULL THEN order_line.item
        ELSE order_line.item || jsonb_build_object(
          'notes', left(btrim(coalesce(nullif(request_line.item->>'special_note', ''), request_line.item->>'notes', '')), 300)
        )
      END
      ORDER BY order_line.ordinality
    ),
    '[]'::jsonb
  )
  INTO v_order_items
  FROM jsonb_array_elements(coalesce(v_result #> '{order,items_json}', '[]'::jsonb))
    WITH ORDINALITY AS order_line(item, ordinality)
  LEFT JOIN jsonb_array_elements(coalesce(p_cart_items, '[]'::jsonb))
    WITH ORDINALITY AS request_line(item, ordinality)
    ON request_line.ordinality = order_line.ordinality;

  UPDATE public.orders
     SET items_json = v_order_items
   WHERE id = v_order_id;

  WITH cart_notes AS (
    SELECT
      nullif(item.value->>'menu_item_id', '')::uuid AS menu_item_id,
      nullif(coalesce(nullif(item.value->>'variant_id', ''), nullif(item.value->>'variantId', '')), '')::uuid AS variant_id,
      nullif(left(btrim(coalesce(nullif(item.value->>'special_note', ''), item.value->>'notes', '')), 300), '') AS notes
    FROM jsonb_array_elements(coalesce(p_cart_items, '[]'::jsonb)) AS item(value)
  )
  UPDATE public.order_items AS ordered_item
     SET notes = coalesce(cart_notes.notes, '')
    FROM cart_notes
   WHERE ordered_item.order_id = v_order_id
     AND ordered_item.menu_item_id = cart_notes.menu_item_id
     AND ordered_item.variant_id IS NOT DISTINCT FROM cart_notes.variant_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_order_with_notes_atomic(uuid, text, text, text, text, text, text, timestamptz, text, text, jsonb, text, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_order_with_notes_atomic(uuid, text, text, text, text, text, text, timestamptz, text, text, jsonb, text, integer, text, text)
  TO service_role;

COMMIT;
