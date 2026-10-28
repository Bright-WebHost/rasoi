-- ============================================================
-- PABBAS - Phase 11: scheduled pickup + smarter WhatsApp replies
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================

-- 1. "Schedule later" pickup time chosen on the website (was silently dropped before)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;

-- 2. inbound_bundle(): same as phase 10, plus
--    - menu_detail: every menu item with category + availability (for "sold out, try X instead")
--    - last_order:  the customer's latest real order (for the "Same as last time?" button)
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
BEGIN
  IF coalesce(p_message_id, '') <> '' AND EXISTS (SELECT 1 FROM messages WHERE message_id = p_message_id) THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  INSERT INTO messages (phone, direction, content, sender, message_type, message_id, ai_intent)
  VALUES (p_phone, 'inbound', coalesce(p_content, ''), 'customer', coalesce(nullif(p_message_type, ''), 'text'), coalesce(p_message_id, ''), '');

  v_context := public.chat_context(p_phone, NULL);

  SELECT items INTO v_cart FROM ai_carts WHERE channel_user_id = p_channel_user_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('name', item_name, 'category', category, 'available', available, 'price', price) ORDER BY category, item_name), '[]'::jsonb)
    INTO v_menu FROM menu_items;

  SELECT jsonb_build_object('order_number', o.order_number, 'items', o.items_json, 'created_at', o.created_at)
    INTO v_last
    FROM orders o
   WHERE o.customer_phone = normalize_phone(p_phone)
     AND o.status NOT IN ('cancelled', 'draft')
     AND jsonb_typeof(o.items_json) = 'array'
     AND jsonb_array_length(o.items_json) > 0
   ORDER BY o.created_at DESC
   LIMIT 1;

  RETURN coalesce(v_context, '{}'::jsonb)
    || jsonb_build_object(
         'duplicate', false,
         'pending_cart_items', coalesce(v_cart, '[]'::jsonb),
         'menu_detail', v_menu,
         'last_order', v_last
       );
END;
$$;

REVOKE ALL ON FUNCTION public.inbound_bundle(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inbound_bundle(text, text, text, text, text) TO service_role;
