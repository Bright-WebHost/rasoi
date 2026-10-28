-- ============================================================
-- PABBAS - Phase 9: Restaurant Settings
-- Idempotent. Run once in the Supabase SQL editor BEFORE deploying
-- the Settings feature (the app writes orders.delivery_fee).
-- ============================================================
BEGIN;

-- 1. Orders: delivery fee charged + when the bill was printed
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_fee numeric NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS printed_at timestamptz;

-- 2. Server-only settings (undo passcode hash). Never readable from the browser.
CREATE TABLE IF NOT EXISTS public.settings_private (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.settings_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.settings_private FROM anon, authenticated;
GRANT ALL ON public.settings_private TO service_role;
DROP POLICY IF EXISTS p_settings_private_service_all ON public.settings_private;
CREATE POLICY p_settings_private_service_all ON public.settings_private
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Settings, pincodes and staff are written only by the server (service role,
--    after an admin check). Drop every browser-side write policy on them.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('settings', 'delivery_pincodes', 'staff_members')
      AND cmd <> 'SELECT'
      AND NOT ('service_role' = ANY (roles))
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

REVOKE INSERT, UPDATE, DELETE ON public.settings, public.delivery_pincodes, public.staff_members FROM anon, authenticated;
GRANT SELECT ON public.settings, public.delivery_pincodes, public.staff_members TO authenticated;
GRANT ALL ON public.settings, public.delivery_pincodes, public.staff_members TO service_role;

DROP POLICY IF EXISTS "Staff can read settings" ON public.settings;
CREATE POLICY "Staff can read settings" ON public.settings FOR SELECT TO authenticated USING (public.is_staff());
DROP POLICY IF EXISTS "Staff can read delivery_pincodes" ON public.delivery_pincodes;
CREATE POLICY "Staff can read delivery_pincodes" ON public.delivery_pincodes FOR SELECT TO authenticated USING (public.is_staff());
DROP POLICY IF EXISTS "Staff can read staff_members" ON public.staff_members;
CREATE POLICY "Staff can read staff_members" ON public.staff_members FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS p_settings_service_all ON public.settings;
CREATE POLICY p_settings_service_all ON public.settings FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS p_delivery_pincodes_service_all ON public.delivery_pincodes;
CREATE POLICY p_delivery_pincodes_service_all ON public.delivery_pincodes FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS p_staff_members_service_all ON public.staff_members;
CREATE POLICY p_staff_members_service_all ON public.staff_members FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. is_open(): honours "Pause orders", supports overnight hours (e.g. 18:00-02:00),
--    and treats blank hours as always open.
CREATE OR REPLACE FUNCTION public.is_open(p_at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_open text;
  v_close text;
  v_now time;
BEGIN
  IF (SELECT value FROM settings WHERE key = 'orders_paused') = 'true' THEN
    RETURN false;
  END IF;

  SELECT nullif(value, '') INTO v_open FROM settings WHERE key = 'open_time';
  SELECT nullif(value, '') INTO v_close FROM settings WHERE key = 'close_time';
  IF v_open IS NULL OR v_close IS NULL THEN
    RETURN true;
  END IF;

  v_now := (p_at AT TIME ZONE 'Asia/Kolkata')::time;
  IF v_open::time <= v_close::time THEN
    RETURN v_now >= v_open::time AND v_now < v_close::time;
  END IF;
  RETURN v_now >= v_open::time OR v_now < v_close::time;
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_open(timestamptz) TO anon, authenticated, service_role;

-- 5. Defaults. Existing values are never overwritten.
--    Hours match what is_open() already assumed (07:00-23:30) so nothing changes
--    until an admin edits them in Settings.
INSERT INTO public.settings (key, value) VALUES
  ('restaurant_name', 'Pabbas'),
  ('tagline', 'Delicious desserts since 1969'),
  ('address', 'Lalbagh, Mangaluru'),
  ('phone', ''),
  ('city', 'Mangaluru'),
  ('logo_url', ''),
  ('gst_percent', '5'),
  ('gstin', ''),
  ('open_time', '07:00'),
  ('close_time', '23:30'),
  ('hours', '7:00 AM to 11:30 PM, every day'),
  ('orders_paused', 'false'),
  ('order_types', 'Delivery, Takeaway, Dine-in'),
  ('min_order', '0'),
  ('delivery_fee', '35'),
  ('free_delivery_above', '0'),
  ('delivery_note', ''),
  ('payment_methods', 'Cash on delivery or at the counter. UPI coming soon.'),
  ('auto_print', 'false'),
  ('unknown_policy', 'If you do not know something, say you will check with the team and offer to take the order anyway. Never invent facts.'),
  ('google_review_url', '')
ON CONFLICT (key) DO NOTHING;

COMMIT;
