-- ============================================================
-- PABBAS - Phase 12: data for WhatsApp nudges
-- Idempotent. Run in the Supabase SQL editor.
--
-- inbound_bundle() additionally returns:
--   menu_detail[].id, .sold_30d  → one-tap add-on suggestion ("Goes great with…")
--   popular_today                → "🔥 Most ordered today" (real orders only,
--                                  shown only when an item is in 2+ orders today)
-- ============================================================

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
  v_today_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
BEGIN
  IF coalesce(p_message_id, '') <> '' AND EXISTS (SELECT 1 FROM messages WHERE message_id = p_message_id) THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  INSERT INTO messages (phone, direction, content, sender, message_type, message_id, ai_intent)
  VALUES (p_phone, 'inbound', coalesce(p_content, ''), 'customer', coalesce(nullif(p_message_type, ''), 'text'), coalesce(p_message_id, ''), '');

  v_context := public.chat_context(p_phone, NULL);

  SELECT items INTO v_cart FROM ai_carts WHERE channel_user_id = p_channel_user_id;

  -- Quantity sold per item name in the last 30 days (from items_json)
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

  -- Today's most ordered available item (by number of orders containing it), 2+ orders only
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
