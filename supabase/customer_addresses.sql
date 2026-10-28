-- ============================================================
-- PABBAS — Phase 3: Customer Profile & Repeat Memory
-- Creates the customer_addresses table.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.customer_addresses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES public.app_customers(id),
  label text,
  address text NOT NULL,
  landmark text,
  pincode text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES & CONSTRAINTS
-- ============================================================

-- Fast lookup by customer_id
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_id
ON public.customer_addresses (customer_id);

-- Partial unique index to enforce a maximum of ONE default address per customer
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_addresses_one_default
ON public.customer_addresses (customer_id)
WHERE is_default = true;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;

-- Deny all access to anonymous and authenticated users since our 
-- architecture uses server-side service_role for secure database interactions.
-- By default, when RLS is enabled and no policies exist, access is denied.

-- Explicitly revoke permissions from anon and authenticated roles
REVOKE ALL ON public.customer_addresses FROM anon, authenticated;
GRANT ALL ON public.customer_addresses TO service_role;

-- ============================================================
-- ATOMIC RPCs FOR CONCURRENCY
-- ============================================================

-- RPC: create_customer_address
CREATE OR REPLACE FUNCTION public.create_customer_address(
  p_customer_id uuid,
  p_address text,
  p_landmark text,
  p_pincode text,
  p_label text,
  p_is_default boolean
) RETURNS public.customer_addresses
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_wants_default boolean;
  v_new_address public.customer_addresses;
BEGIN
  -- Transaction-level advisory lock per customer to serialize concurrent address operations for the SAME customer
  PERFORM pg_advisory_xact_lock(hashtext(p_customer_id::text));

  SELECT count(*) INTO v_count FROM public.customer_addresses WHERE customer_id = p_customer_id;
  
  IF v_count = 0 THEN
    v_wants_default := true;
  ELSE
    v_wants_default := COALESCE(p_is_default, false);
  END IF;

  IF v_wants_default THEN
    UPDATE public.customer_addresses
    SET is_default = false
    WHERE customer_id = p_customer_id AND is_default = true;
  END IF;

  INSERT INTO public.customer_addresses (customer_id, address, landmark, pincode, label, is_default)
  VALUES (p_customer_id, p_address, p_landmark, p_pincode, p_label, v_wants_default)
  RETURNING * INTO v_new_address;

  RETURN v_new_address;
END;
$$;

-- RPC: update_customer_address
CREATE OR REPLACE FUNCTION public.update_customer_address(
  p_customer_id uuid,
  p_address_id uuid,
  p_address text,
  p_landmark text,
  p_pincode text,
  p_label text,
  p_is_default boolean
) RETURNS public.customer_addresses
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing public.customer_addresses;
  v_updated public.customer_addresses;
BEGIN
  -- Transaction-level advisory lock per customer to serialize concurrent address operations for the SAME customer
  PERFORM pg_advisory_xact_lock(hashtext(p_customer_id::text));

  -- Verify and lock the specific address
  SELECT * INTO v_existing
  FROM public.customer_addresses
  WHERE id = p_address_id AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Address not found or unauthorized';
  END IF;

  IF p_is_default AND NOT v_existing.is_default THEN
    UPDATE public.customer_addresses
    SET is_default = false
    WHERE customer_id = p_customer_id AND is_default = true;
  END IF;

  UPDATE public.customer_addresses
  SET
    address = COALESCE(p_address, address),
    landmark = p_landmark,
    pincode = p_pincode,
    label = p_label,
    is_default = COALESCE(p_is_default, is_default),
    updated_at = now()
  WHERE id = p_address_id AND customer_id = p_customer_id
  RETURNING * INTO v_updated;

  RETURN v_updated;
END;
$$;

-- RPC: delete_customer_address
CREATE OR REPLACE FUNCTION public.delete_customer_address(
  p_customer_id uuid,
  p_address_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing public.customer_addresses;
  v_next_id uuid;
BEGIN
  -- Transaction-level advisory lock per customer to serialize concurrent address operations for the SAME customer
  PERFORM pg_advisory_xact_lock(hashtext(p_customer_id::text));

  -- Verify and lock
  SELECT * INTO v_existing
  FROM public.customer_addresses
  WHERE id = p_address_id AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Address not found or unauthorized';
  END IF;

  DELETE FROM public.customer_addresses
  WHERE id = p_address_id AND customer_id = p_customer_id;

  IF v_existing.is_default THEN
    SELECT id INTO v_next_id
    FROM public.customer_addresses
    WHERE customer_id = p_customer_id
    ORDER BY updated_at DESC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_next_id IS NOT NULL THEN
      UPDATE public.customer_addresses
      SET is_default = true, updated_at = now()
      WHERE id = v_next_id;
    END IF;
  END IF;

  RETURN true;
END;
$$;

-- Revoke execute from public/anon/authenticated with explicit function argument signatures
REVOKE EXECUTE ON FUNCTION public.create_customer_address(uuid, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_customer_address(uuid, uuid, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_customer_address(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Grant execute to service_role with explicit function argument signatures
GRANT EXECUTE ON FUNCTION public.create_customer_address(uuid, text, text, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_customer_address(uuid, uuid, text, text, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_customer_address(uuid, uuid) TO service_role;


