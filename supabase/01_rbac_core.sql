-- Phase 1: RBAC Core Migration (Idempotent)
BEGIN;

-- 1. Add `role` and `is_active` to `staff_members` idempotently
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'staff_members' AND column_name = 'role') THEN
        ALTER TABLE staff_members ADD COLUMN role TEXT DEFAULT 'kitchen';
        -- Set existing rows to admin if role didn't exist
        UPDATE staff_members SET role = 'admin';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'staff_members' AND column_name = 'is_active') THEN
        ALTER TABLE staff_members ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
END $$;

-- Enforce valid roles
ALTER TABLE staff_members DROP CONSTRAINT IF EXISTS staff_members_role_check;
ALTER TABLE staff_members ADD CONSTRAINT staff_members_role_check CHECK (role IN ('admin', 'counter', 'waiter', 'kitchen'));

-- 2. Create `order_status_log` table
CREATE TABLE IF NOT EXISTS order_status_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    order_number TEXT NOT NULL,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor_email TEXT,
    actor_role TEXT,
    detail TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Service-role only for order_status_log
ALTER TABLE order_status_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role can do everything on order_status_log" ON order_status_log;
CREATE POLICY "Service role can do everything on order_status_log" ON order_status_log 
    FOR ALL 
    USING (true)
    WITH CHECK (true);
REVOKE ALL ON order_status_log FROM authenticated, anon;
GRANT ALL ON order_status_log TO service_role;

-- 3. Replace staff_check() to return role
DROP FUNCTION IF EXISTS staff_check();
CREATE OR REPLACE FUNCTION staff_check()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_staff boolean;
    user_email text;
    user_role text;
    is_active boolean;
BEGIN
    SELECT email INTO user_email FROM auth.users WHERE id = auth.uid();
    
    SELECT 
        true, role, staff_members.is_active 
    INTO 
        is_staff, user_role, is_active
    FROM staff_members 
    WHERE email = user_email;
    
    IF is_staff IS NULL OR COALESCE(is_active, false) = false THEN
        RETURN json_build_object('staff', false, 'email', user_email, 'role', null);
    END IF;
    
    RETURN json_build_object('staff', true, 'email', user_email, 'role', user_role);
END;
$$;

-- Create helper functions
CREATE OR REPLACE FUNCTION staff_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_role text;
    user_is_active boolean;
BEGIN
    SELECT role, is_active INTO user_role, user_is_active
    FROM staff_members
    WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid());
    
    IF user_role IS NULL OR COALESCE(user_is_active, false) = false THEN
        RETURN null;
    END IF;
    
    RETURN user_role;
END;
$$;

CREATE OR REPLACE FUNCTION is_staff()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_is_active boolean;
BEGIN
    SELECT is_active INTO user_is_active
    FROM staff_members
    WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid());
    
    RETURN COALESCE(user_is_active, false);
END;
$$;

-- 4. RLS Policy Changes (Browsers become READ-ONLY on orders and order_items)

-- Orders RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Drop existing authenticated policies
DROP POLICY IF EXISTS "Staff can do everything on orders" ON orders;
DROP POLICY IF EXISTS "Staff can insert orders" ON orders;
DROP POLICY IF EXISTS "Staff can update orders" ON orders;
DROP POLICY IF EXISTS "Staff can delete orders" ON orders;

-- Add read-only policy for staff
DROP POLICY IF EXISTS "Staff can read orders" ON orders;
CREATE POLICY "Staff can read orders" ON orders
    FOR SELECT
    TO authenticated
    USING (is_staff());

-- Revoke mutation privileges from authenticated users on orders
REVOKE INSERT, UPDATE, DELETE ON orders FROM authenticated;

-- Order Items RLS
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Drop existing authenticated policies
DROP POLICY IF EXISTS "Staff can do everything on order_items" ON order_items;
DROP POLICY IF EXISTS "Staff can insert order_items" ON order_items;
DROP POLICY IF EXISTS "Staff can update order_items" ON order_items;
DROP POLICY IF EXISTS "Staff can delete order_items" ON order_items;

-- Add read-only policy for staff
DROP POLICY IF EXISTS "Staff can read order_items" ON order_items;
CREATE POLICY "Staff can read order_items" ON order_items
    FOR SELECT
    TO authenticated
    USING (is_staff());

-- Revoke mutation privileges from authenticated users on order_items
REVOKE INSERT, UPDATE, DELETE ON order_items FROM authenticated;

-- Menu Items RLS
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

-- Drop existing authenticated policies
DROP POLICY IF EXISTS "Staff can do everything on menu_items" ON menu_items;

-- Add read policy for all staff
DROP POLICY IF EXISTS "Staff can read menu_items" ON menu_items;
CREATE POLICY "Staff can read menu_items" ON menu_items
    FOR SELECT
    TO authenticated
    USING (is_staff());

-- Add write policy for admin only
DROP POLICY IF EXISTS "Admin can write menu_items" ON menu_items;
CREATE POLICY "Admin can write menu_items" ON menu_items
    FOR ALL
    TO authenticated
    USING (staff_role() = 'admin')
    WITH CHECK (staff_role() = 'admin');

COMMIT;
