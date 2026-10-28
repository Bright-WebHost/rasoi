-- ============================================================
-- PABBAS — Phase 7D: Reconciliation Workflow & Event Leases
-- 
-- 1. Adds locked_until to order_events to implement leases.
-- 2. Updates claim_order_event to enforce 5-minute atomic leases.
-- 3. Updates complete/fail RPCs to clear the lease.
-- 4. Adds poll_order_events RPC for background reconciler.
-- ============================================================

-- 1. Add lease column
ALTER TABLE public.order_events ADD COLUMN IF NOT EXISTS locked_until timestamptz;

-- 2. Update claim_order_event to set lease and recover stale events
CREATE OR REPLACE FUNCTION public.claim_order_event(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_claimed public.order_events%ROWTYPE;
BEGIN
  -- Atomically claim event and set a 5-minute lease.
  -- Eligibility:
  -- - pending/failed where next_retry_at is due
  -- - processing where locked_until is NULL (legacy stale) or expired (lease timed out)
  UPDATE public.order_events
  SET status = 'processing',
      updated_at = now(),
      locked_until = now() + interval '5 minutes'
  WHERE id = p_event_id
    AND (
      (status IN ('pending', 'failed') AND (next_retry_at IS NULL OR next_retry_at <= now()))
      OR
      (status = 'processing' AND (locked_until IS NULL OR locked_until <= now()))
    )
  RETURNING * INTO v_claimed;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_claimed.id,
    'order_id', v_claimed.order_id,
    'event_type', v_claimed.event_type,
    'status', v_claimed.status,
    'payload', v_claimed.payload,
    'retry_count', v_claimed.retry_count,
    'max_retries', v_claimed.max_retries,
    'locked_until', v_claimed.locked_until
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_order_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_event(uuid) TO service_role;


-- 3. Update complete_order_event to clear lease
CREATE OR REPLACE FUNCTION public.complete_order_event(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_completed public.order_events%ROWTYPE;
BEGIN
  UPDATE public.order_events
  SET status = 'completed',
      updated_at = now(),
      locked_until = NULL
  WHERE id = p_event_id
    AND status = 'processing'
  RETURNING * INTO v_completed;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_completed.id,
    'status', v_completed.status,
    'updated_at', v_completed.updated_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_order_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_order_event(uuid) TO service_role;


-- 4. Update fail_order_event to clear lease
CREATE OR REPLACE FUNCTION public.fail_order_event(
  p_event_id uuid,
  p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_event public.order_events%ROWTYPE;
  v_new_retry_count integer;
  v_new_status text;
  v_next_retry timestamptz;
BEGIN
  SELECT * INTO v_event
  FROM public.order_events
  WHERE id = p_event_id AND status = 'processing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_new_retry_count := v_event.retry_count + 1;

  IF v_new_retry_count >= v_event.max_retries THEN
    v_new_status := 'dead_letter';
    v_next_retry := NULL;
  ELSE
    v_new_status := 'failed';
    -- Exponential backoff: 30s * 2^(retry_count-1)
    v_next_retry := now() + (interval '30 seconds' * power(2, v_new_retry_count - 1));
  END IF;

  UPDATE public.order_events
  SET status = v_new_status,
      retry_count = v_new_retry_count,
      next_retry_at = v_next_retry,
      last_error = p_error,
      updated_at = now(),
      locked_until = NULL
  WHERE id = p_event_id
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'id', v_event.id,
    'status', v_event.status,
    'retry_count', v_event.retry_count,
    'max_retries', v_event.max_retries,
    'next_retry_at', v_event.next_retry_at,
    'last_error', v_event.last_error
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fail_order_event(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_order_event(uuid, text) TO service_role;


-- 5. Add poll_order_events for Reconciler
CREATE OR REPLACE FUNCTION public.poll_order_events(
  p_limit integer DEFAULT 50
) RETURNS TABLE (event_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT id FROM public.order_events
  WHERE (
    (status IN ('pending', 'failed') AND (next_retry_at IS NULL OR next_retry_at <= now()))
    OR
    (status = 'processing' AND (locked_until IS NULL OR locked_until <= now()))
  )
  ORDER BY created_at ASC
  LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.poll_order_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.poll_order_events(integer) TO service_role;
