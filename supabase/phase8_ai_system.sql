-- ============================================================
-- Rasoi - AI Assistant Backend System
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

-- Populate restaurant_info only with confirmed Rasoi facts before enabling AI.
