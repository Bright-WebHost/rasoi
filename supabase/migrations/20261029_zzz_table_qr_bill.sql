BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS whatsapp_bill_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_bill_error text;

COMMIT;
