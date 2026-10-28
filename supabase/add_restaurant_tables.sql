-- Create restaurant tables
CREATE TABLE IF NOT EXISTS public.restaurant_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_number TEXT UNIQUE NOT NULL,
    qr_code_url TEXT,
    is_active BOOLEAN DEFAULT false,
    current_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;

-- Create policies for restaurant_tables
CREATE POLICY "Enable read access for all users" ON public.restaurant_tables
    FOR SELECT
    USING (true);

CREATE POLICY "Enable all access for authenticated users" ON public.restaurant_tables
    FOR ALL
    USING (auth.role() = 'authenticated');

-- We also need to ensure the orders table can accept table_number for dine-in if it doesn't already have it.
-- We can add table_number to orders if missing, although the pos logic might already use it.
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='table_number') THEN
        ALTER TABLE public.orders ADD COLUMN table_number TEXT;
    END IF;
END $$;
