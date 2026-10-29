-- Durable, race-safe inbox for verified YCloud webhook deliveries.
-- Apply to Rasoi only. Existing application messages are left unchanged.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ycloud_event_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  provider_message_id text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','processed','retryable','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS ycloud_event_inbox_retry_idx
  ON public.ycloud_event_inbox(next_attempt_at, received_at)
  WHERE status IN ('pending','retryable');
CREATE INDEX IF NOT EXISTS ycloud_event_inbox_message_idx
  ON public.ycloud_event_inbox(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
-- Prevent the same WhatsApp inbound message being accepted under a second
-- webhook event id while allowing status events to reference that same message.
CREATE UNIQUE INDEX IF NOT EXISTS ycloud_event_inbox_inbound_message_unique_idx
  ON public.ycloud_event_inbox(provider_message_id)
  WHERE event_type = 'whatsapp.inbound_message.received'
    AND provider_message_id IS NOT NULL;

ALTER TABLE public.ycloud_event_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ycloud_event_inbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ycloud_event_inbox TO service_role;

COMMIT;
