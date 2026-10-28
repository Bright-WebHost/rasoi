-- ============================================================
-- PABBAS - Phase 10: one round trip per inbound WhatsApp message
-- Idempotent. Run in the Supabase SQL editor.
--
-- The n8n "WhatsApp AI Order Bridge" used to make four sequential calls
-- (duplicate check, save message, chat_context, pending cart), ~0.3-0.9s
-- each from the n8n server. inbound_bundle() does all four in one call.
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
BEGIN
  -- 1. Duplicate webhook delivery? (same check the "Look Up Message ID" node did)
  IF coalesce(p_message_id, '') <> '' AND EXISTS (SELECT 1 FROM messages WHERE message_id = p_message_id) THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  -- 2. Save the inbound message (same row the "Save Inbound Message" node inserted;
  --    existing triggers still normalise the phone and touch chat_sessions)
  INSERT INTO messages (phone, direction, content, sender, message_type, message_id, ai_intent)
  VALUES (p_phone, 'inbound', coalesce(p_content, ''), 'customer', coalesce(nullif(p_message_type, ''), 'text'), coalesce(p_message_id, ''), '');

  -- 3. Chat context (unchanged function, so the AI sees exactly what it saw before)
  v_context := public.chat_context(p_phone, NULL);

  -- 4. Pending AI cart
  SELECT items INTO v_cart FROM ai_carts WHERE channel_user_id = p_channel_user_id;

  RETURN coalesce(v_context, '{}'::jsonb)
    || jsonb_build_object('duplicate', false, 'pending_cart_items', coalesce(v_cart, '[]'::jsonb));
END;
$$;

-- Only the server-side n8n workflow (service role) may call it.
REVOKE ALL ON FUNCTION public.inbound_bundle(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inbound_bundle(text, text, text, text, text) TO service_role;
