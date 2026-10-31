-- Allow guests to order from public menu links without signing in.
-- Keep customer creation inside the atomic order transaction and identify web
-- guests by phone under the pwa channel.
BEGIN;

DO $migration$
DECLARE
  function_definition text;
  customer_session_guard text := 'IF p_source = ''pwa'' AND v_customer_id IS NULL THEN RAISE EXCEPTION ''Customer session required''; END IF;';
  guest_channel_clause text := 'VALUES (''whatsapp'', v_channel_user_id, v_phone,';
  pwa_guest_channel_clause text := 'VALUES (p_source, v_channel_user_id, v_phone,';
BEGIN
  SELECT pg_get_functiondef(
    'public.create_customer_order_atomic(uuid,text,text,text,text,text,text,timestamptz,text,text,jsonb,text,integer,text,text)'::regprocedure
  )
  INTO function_definition;

  IF function_definition IS NULL THEN
    RAISE EXCEPTION 'create_customer_order_atomic was not found';
  END IF;

  IF position(customer_session_guard IN function_definition) = 0 THEN
    IF position(pwa_guest_channel_clause IN function_definition) > 0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Expected customer-session guard was not found in create_customer_order_atomic';
  END IF;
  IF position(guest_channel_clause IN function_definition) = 0 THEN
    RAISE EXCEPTION 'Expected guest customer insert was not found in create_customer_order_atomic';
  END IF;

  function_definition := replace(function_definition, customer_session_guard, '');
  function_definition := replace(function_definition, guest_channel_clause, pwa_guest_channel_clause);
  EXECUTE function_definition;
END;
$migration$;

COMMIT;
