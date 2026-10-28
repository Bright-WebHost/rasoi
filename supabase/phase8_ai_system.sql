-- ============================================================
-- PABBAS - AI Assistant Backend System
-- Phase 8: Carts & Business Information
-- ============================================================

-- 1. Business Info (RAG) Table
CREATE TABLE IF NOT EXISTS public.restaurant_info (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  info_key text UNIQUE NOT NULL,
  info_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS for restaurant_info
ALTER TABLE public.restaurant_info ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access for restaurant_info"
  ON public.restaurant_info FOR SELECT
  USING (true);

-- 2. AI Carts Table (Secure Cart tied to WhatsApp channel_user_id)
CREATE TABLE IF NOT EXISTS public.ai_carts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_user_id text UNIQUE NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS for ai_carts
ALTER TABLE public.ai_carts ENABLE ROW LEVEL SECURITY;

-- Carts can only be modified by the admin/service role (via our API endpoints)
-- No public policies needed because our API uses the service_role key.

-- 3. Seed some default Pabbas info
INSERT INTO public.restaurant_info (info_key, info_value) VALUES
('address', '[PENDING BUSINESS CONFIRMATION]'),
('opening_hours', '[PENDING BUSINESS CONFIRMATION]'),
('delivery_areas', '[PENDING BUSINESS CONFIRMATION]'),
('delivery_time', '[PENDING BUSINESS CONFIRMATION]'),
('delivery_charges', 'There is a flat delivery fee of Rs 35 for all delivery orders.'),
('payment_methods', 'We accept UPI, cash, and online payments.'),
('cancellation_rules', 'Orders cannot be modified or cancelled once they enter the "preparing" state.')
ON CONFLICT (info_key) DO UPDATE SET info_value = EXCLUDED.info_value;
