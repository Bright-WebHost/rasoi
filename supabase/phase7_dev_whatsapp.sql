-- Creates a purely demo-only table for the WhatsApp Simulator
CREATE TABLE IF NOT EXISTS public.dev_whatsapp_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id text NOT NULL,
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.dev_whatsapp_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dev_whatsapp_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dev_whatsapp_messages TO service_role;
