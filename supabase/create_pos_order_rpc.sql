-- Create atomic RPC for POS order creation
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
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_number text;
  v_order_id uuid;
  v_item jsonb;
BEGIN
  -- Validate payload
  IF p_items_json IS NULL OR jsonb_array_length(p_items_json) = 0 THEN
    RAISE EXCEPTION 'Cart cannot be empty';
  END IF;

  -- Generate order number using the existing mechanism
  SELECT public.next_order_number('pos') INTO v_order_number;

  -- Insert order
  INSERT INTO public.orders (
    order_number,
    customer_phone,
    customer_name,
    items,
    total,
    status,
    order_type,
    source,
    address,
    landmark,
    pincode,
    table_number,
    items_json
  ) VALUES (
    v_order_number,
    p_customer_phone,
    p_customer_name,
    p_items_summary,
    p_total,
    'preparing',
    p_order_type,
    'pos',
    p_address,
    p_landmark,
    p_pincode,
    p_table_number,
    p_items_json
  ) RETURNING id INTO v_order_id;

  -- Insert order items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items_json) LOOP
    INSERT INTO public.order_items (
      order_id,
      menu_item_id,
      item_name,
      quantity,
      unit_price,
      size,
      notes
    ) VALUES (
      v_order_id,
      (v_item->>'menu_item_id')::uuid,
      v_item->>'item_name',
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      NULL,
      NULL
    );
  END LOOP;

  -- Return the created order info
  RETURN jsonb_build_object(
    'id', v_order_id,
    'order_number', v_order_number
  );
END;
$$;
