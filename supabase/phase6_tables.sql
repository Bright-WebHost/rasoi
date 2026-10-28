-- ============================================================
-- PABBAS — Phase 6: Live Dine-in Table System
-- Creates restaurant_tables and table_reservations.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.restaurant_tables (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  table_number text NOT NULL UNIQUE,
  capacity integer NOT NULL CHECK (capacity > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.table_reservations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  table_id uuid NOT NULL REFERENCES public.restaurant_tables(id),
  customer_id uuid NOT NULL REFERENCES public.app_customers(id),
  order_id uuid, -- FK added after orders table is created
  reservation_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'seated', 'completed', 'cancelled')),
  party_size integer NOT NULL CHECK (party_size > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_restaurant_tables_active ON public.restaurant_tables(is_active);
CREATE INDEX IF NOT EXISTS idx_table_reservations_table_id ON public.table_reservations(table_id);
CREATE INDEX IF NOT EXISTS idx_table_reservations_customer_id ON public.table_reservations(customer_id);

-- RLS & Permissions
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read active tables" ON public.restaurant_tables FOR SELECT USING (is_active = true);

REVOKE ALL ON public.restaurant_tables FROM anon, authenticated;
REVOKE ALL ON public.table_reservations FROM anon, authenticated;

GRANT SELECT ON public.restaurant_tables TO anon, authenticated;

GRANT ALL ON public.restaurant_tables TO service_role;
GRANT ALL ON public.table_reservations TO service_role;

-- Seed 20 restaurant tables with realistic capacities
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.restaurant_tables LIMIT 1) THEN
    INSERT INTO public.restaurant_tables (table_number, capacity) VALUES
    ('Table 1', 2), ('Table 2', 2), ('Table 3', 2), ('Table 4', 2),
    ('Table 5', 4), ('Table 6', 4), ('Table 7', 4), ('Table 8', 4),
    ('Table 9', 4), ('Table 10', 4), ('Table 11', 4), ('Table 12', 4),
    ('Table 13', 6), ('Table 14', 6), ('Table 15', 6), ('Table 16', 6),
    ('Table 17', 8), ('Table 18', 8), ('Table 19', 10), ('Table 20', 12);
  END IF;
END $$;
