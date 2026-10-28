-- 1. Create the riders table
CREATE TABLE IF NOT EXISTS public.riders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    whatsapp_number TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    deliveries_count INTEGER DEFAULT 0,
    cash_collected NUMERIC DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Add rider columns to the orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS rider_id UUID REFERENCES public.riders(id),
ADD COLUMN IF NOT EXISTS rider_name TEXT,
ADD COLUMN IF NOT EXISTS rider_phone TEXT;

-- 3. Update existing RPCs if they are strictly checking columns.
-- (No immediate changes required for insert/update RPCs if they use row mapping,
-- but if we have specific views, they might need updates later.)
