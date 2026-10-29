-- Lease-based claims for forwarding ycloud_event_inbox rows to n8n.
-- Requires 20261028_ycloud_event_inbox.sql. Functions only; no data changes.
BEGIN;

-- Claims due rows with SKIP LOCKED so concurrent workers never share a row.
-- A claim is a lease: if the worker dies, the row becomes due again after
-- p_lease_seconds. attempts doubles as the fencing token for finish_ycloud_event.
CREATE OR REPLACE FUNCTION public.claim_ycloud_events(p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 120)
RETURNS SETOF public.ycloud_event_inbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ycloud_event_inbox i
     SET status = 'processing',
         attempts = i.attempts + 1,
         updated_at = now(),
         next_attempt_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 900)))
   WHERE i.id IN (
     SELECT id FROM public.ycloud_event_inbox
      WHERE status IN ('pending', 'retryable', 'processing')
        AND next_attempt_at <= now()
      ORDER BY next_attempt_at, received_at
      LIMIT greatest(1, least(p_limit, 50))
      FOR UPDATE SKIP LOCKED)
  RETURNING i.*;
$$;

-- Records the outcome of one attempt. Ignored (returns NULL) when the lease was
-- lost to another worker, so a stale worker cannot overwrite a newer attempt.
CREATE OR REPLACE FUNCTION public.finish_ycloud_event(p_id uuid, p_attempt integer, p_ok boolean, p_error_code text DEFAULT NULL, p_max_attempts integer DEFAULT 8)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ycloud_event_inbox
     SET status = CASE WHEN p_ok THEN 'processed'
                       WHEN attempts >= p_max_attempts THEN 'failed'
                       ELSE 'retryable' END,
         processed_at = CASE WHEN p_ok THEN now() END,
         last_error_code = CASE WHEN p_ok THEN NULL ELSE left(p_error_code, 64) END,
         next_attempt_at = CASE WHEN p_ok THEN next_attempt_at
                                ELSE now() + make_interval(secs => least(3600, 30 * power(2, attempts - 1)::integer)) END,
         updated_at = now()
   WHERE id = p_id AND status = 'processing' AND attempts = p_attempt
  RETURNING status;
$$;

REVOKE ALL ON FUNCTION public.claim_ycloud_events(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_ycloud_event(uuid, integer, boolean, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ycloud_events(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_ycloud_event(uuid, integer, boolean, text, integer) TO service_role;

COMMIT;
