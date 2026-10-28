-- Phase 1: RBAC Core Rollback
BEGIN;

-- Revert Menu Items RLS
DROP POLICY IF EXISTS "Staff can read menu_items" ON menu_items;
DROP POLICY IF EXISTS "Admin can write menu_items" ON menu_items;
CREATE POLICY "Staff can do everything on menu_items" ON menu_items
    FOR ALL
    TO authenticated
    USING (staff_check()->>'staff' = 'true')
    WITH CHECK (staff_check()->>'staff' = 'true');

-- Revert Order Items RLS
GRANT INSERT, UPDATE, DELETE ON order_items TO authenticated;
DROP POLICY IF EXISTS "Staff can read order_items" ON order_items;
CREATE POLICY "Staff can do everything on order_items" ON order_items
    FOR ALL
    TO authenticated
    USING (staff_check()->>'staff' = 'true')
    WITH CHECK (staff_check()->>'staff' = 'true');

-- Revert Orders RLS
GRANT INSERT, UPDATE, DELETE ON orders TO authenticated;
DROP POLICY IF EXISTS "Staff can read orders" ON orders;
CREATE POLICY "Staff can do everything on orders" ON orders
    FOR ALL
    TO authenticated
    USING (staff_check()->>'staff' = 'true')
    WITH CHECK (staff_check()->>'staff' = 'true');

-- Revert staff_check()
CREATE OR REPLACE FUNCTION staff_check()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_staff boolean;
    user_email text;
BEGIN
    SELECT email INTO user_email FROM auth.users WHERE id = auth.uid();
    
    SELECT true INTO is_staff
    FROM staff_members 
    WHERE email = user_email;
    
    IF is_staff IS NULL THEN
        RETURN json_build_object('staff', false, 'email', user_email);
    END IF;
    
    RETURN json_build_object('staff', true, 'email', user_email);
END;
$$;

-- Drop new functions
DROP FUNCTION IF EXISTS staff_role();
DROP FUNCTION IF EXISTS is_staff();

-- Drop order_status_log table
DROP TABLE IF EXISTS order_status_log;

-- Revert staff_members schema (Optional, usually we don't drop columns in rollbacks to avoid data loss, but we can drop the constraint)
ALTER TABLE staff_members DROP CONSTRAINT IF EXISTS staff_members_role_check;

COMMIT;
