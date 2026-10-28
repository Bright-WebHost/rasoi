-- ============================================================
-- PABBAS — WhatsApp-linked Ordering Sessions
-- Phase 2: Development WhatsApp → Secure Browser Session
--
-- Safe/non-destructive migration.
-- Does NOT DROP, TRUNCATE, or DELETE existing data.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1. CUSTOMER IDENTITY
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_customers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,

  channel text NOT NULL,

  channel_user_id text NOT NULL,

  phone text,

  name text,

  created_at timestamptz NOT NULL DEFAULT now(),

  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_customers_channel_user_unique
    UNIQUE (channel, channel_user_id)
);


-- ============================================================
-- 2. ORDERING SESSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ordering_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,

  channel text NOT NULL DEFAULT 'whatsapp',

  channel_user_id text NOT NULL,

  token_hash text NOT NULL,

  status text NOT NULL DEFAULT 'pending',

  expires_at timestamptz NOT NULL,

  used_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ordering_sessions_status_check
    CHECK (status IN ('pending', 'consumed', 'expired'))
);


-- ============================================================
-- 3. ADD CUSTOMER REFERENCE
-- ============================================================

ALTER TABLE public.ordering_sessions
ADD COLUMN IF NOT EXISTS customer_id uuid
REFERENCES public.app_customers(id);


-- ============================================================
-- 4. HANDLE EXISTING ORPHANED DEVELOPMENT SESSIONS
--
-- If old ordering_sessions rows exist without customer_id,
-- associate them with a dedicated migration customer.
--
-- No existing rows are deleted.
-- ============================================================

DO $$
DECLARE
  fallback_customer_id uuid;
BEGIN

  IF EXISTS (
    SELECT 1
    FROM public.ordering_sessions
    WHERE customer_id IS NULL
  ) THEN

    INSERT INTO public.app_customers (
      channel,
      channel_user_id,
      name
    )
    VALUES (
      'system',
      'legacy_migration_user',
      'Legacy Migration User'
    )
    ON CONFLICT (channel, channel_user_id)
    DO UPDATE
      SET name = EXCLUDED.name,
          updated_at = now()
    RETURNING id INTO fallback_customer_id;


    UPDATE public.ordering_sessions
    SET customer_id = fallback_customer_id
    WHERE customer_id IS NULL;

  END IF;

END $$;


-- ============================================================
-- 5. ENFORCE CUSTOMER ID
-- ============================================================

ALTER TABLE public.ordering_sessions
ALTER COLUMN customer_id SET NOT NULL;


-- ============================================================
-- 6. INDEXES
-- ============================================================

-- Token hashes must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_ordering_sessions_token_hash_unique
ON public.ordering_sessions (token_hash);


-- Fast lookup for pending/active sessions.
CREATE INDEX IF NOT EXISTS
  idx_ordering_sessions_expires_at
ON public.ordering_sessions (expires_at)
WHERE status = 'pending';


-- Fast lookup by customer.
CREATE INDEX IF NOT EXISTS
  idx_ordering_sessions_customer_id
ON public.ordering_sessions (customer_id);


-- ============================================================
-- 7. ATOMIC TOKEN CONSUMPTION RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.consume_ordering_token(
  p_token_hash text
)
RETURNS SETOF public.ordering_sessions

LANGUAGE sql

SECURITY DEFINER

SET search_path = public

AS $$
  UPDATE public.ordering_sessions

  SET
    status = 'consumed',
    used_at = now()

  WHERE token_hash = p_token_hash

    AND status = 'pending'

    AND expires_at > now()

  RETURNING *;
$$;


-- ============================================================
-- 8. LOCK DOWN RPC EXECUTION
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.consume_ordering_token(text)
FROM PUBLIC;

REVOKE EXECUTE
ON FUNCTION public.consume_ordering_token(text)
FROM anon;

REVOKE EXECUTE
ON FUNCTION public.consume_ordering_token(text)
FROM authenticated;

GRANT EXECUTE
ON FUNCTION public.consume_ordering_token(text)
TO service_role;


-- ============================================================
-- 9. ENABLE ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.app_customers
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ordering_sessions
ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- END
-- ============================================================