-- Add cash collection tracking to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS collected_amount numeric DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_collected boolean DEFAULT false;

-- Add pending cash tracking to riders
ALTER TABLE riders ADD COLUMN IF NOT EXISTS pending_cash numeric DEFAULT 0;
