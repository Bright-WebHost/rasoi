-- Block WhatsApp messages and order creation for contacts disabled in Contacts.
BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.reject_blocked_whatsapp_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_blocked boolean;
BEGIN
  IF lower(coalesce(NEW.source, '')) = 'whatsapp' THEN
    SELECT c.is_blocked INTO v_is_blocked
      FROM public.customers c
     WHERE c.phone = public.normalize_phone(NEW.customer_phone)
     FOR SHARE;

    IF coalesce(v_is_blocked, false) THEN
      RAISE EXCEPTION 'WhatsApp ordering is disabled for this contact'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_blocked_whatsapp_order ON public.orders;
CREATE TRIGGER reject_blocked_whatsapp_order
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_blocked_whatsapp_order();

COMMIT;
