-- Enforce current pause and order-type settings for website and WhatsApp orders.
BEGIN;

CREATE OR REPLACE FUNCTION public.reject_unavailable_customer_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_orders_paused text;
  v_enabled_types text;
BEGIN
  IF lower(coalesce(NEW.source, '')) NOT IN ('pwa', 'whatsapp') THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_orders_paused
    FROM public.settings
   WHERE key = 'orders_paused'
   FOR SHARE;
  IF lower(coalesce(v_orders_paused, 'true')) = 'true' THEN
    RAISE EXCEPTION 'Orders are paused. Please try again later'
      USING ERRCODE = 'P0001';
  END IF;

  v_type := CASE lower(btrim(coalesce(NEW.order_type, '')))
    WHEN 'pickup' THEN 'takeaway'
    WHEN 'takeaway' THEN 'takeaway'
    WHEN 'delivery' THEN 'delivery'
    WHEN 'dine-in' THEN 'dine-in'
    WHEN 'dinein' THEN 'dine-in'
    ELSE NULL
  END;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Invalid customer order type'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT value INTO v_enabled_types
    FROM public.settings
   WHERE key = 'order_types'
   FOR SHARE;
  IF NOT (v_type = ANY(regexp_split_to_array(lower(coalesce(v_enabled_types, '')), '\s*,\s*'))) THEN
    RAISE EXCEPTION '% orders are not available right now', v_type
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_unavailable_customer_order ON public.orders;
CREATE TRIGGER reject_unavailable_customer_order
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_unavailable_customer_order();

COMMIT;
