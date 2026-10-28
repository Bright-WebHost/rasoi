-- ============================================================
-- PABBAS - Phase 13: record whether a delivered order was paid
-- Idempotent. Run in the Supabase SQL editor BEFORE deploying.
--
-- payment_status:
--   collected  - rider tapped "Collected": rider has the cash (owes it to the shop)
--   unpaid     - rider tapped "Unpaid": customer didn't pay the rider; shop follows up
--   paid_later - staff marked an unpaid order as paid (cash/UPI received by the shop)
-- ============================================================
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_status_check') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_payment_status_check CHECK (payment_status IS NULL OR payment_status IN ('collected', 'unpaid', 'paid_later'));
  END IF;
END $$;
