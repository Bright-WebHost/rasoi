-- Phase 1 (Optional): RBAC Admin Writes Migration
BEGIN;

-- Function to apply standard staff-read / admin-write RLS
CREATE OR REPLACE FUNCTION apply_admin_write_policy(table_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    
    -- Drop existing authenticated policies
    EXECUTE format('DROP POLICY IF EXISTS "Staff can do everything on %I" ON %I', table_name, table_name);
    
    -- Read for all staff
    EXECUTE format('DROP POLICY IF EXISTS "Staff can read %I" ON %I', table_name, table_name);
    EXECUTE format('CREATE POLICY "Staff can read %I" ON %I FOR SELECT TO authenticated USING (is_staff())', table_name, table_name);
    
    -- Write for admin only
    EXECUTE format('DROP POLICY IF EXISTS "Admin can write %I" ON %I', table_name, table_name);
    EXECUTE format('CREATE POLICY "Admin can write %I" ON %I FOR ALL TO authenticated USING (staff_role() = ''admin'') WITH CHECK (staff_role() = ''admin'')', table_name, table_name);
END;
$$;

SELECT apply_admin_write_policy('settings');
SELECT apply_admin_write_policy('promotions');
SELECT apply_admin_write_policy('delivery_pincodes');
SELECT apply_admin_write_policy('customers');
SELECT apply_admin_write_policy('messages');
SELECT apply_admin_write_policy('chat_sessions');
SELECT apply_admin_write_policy('memory');
SELECT apply_admin_write_policy('reviews');
SELECT apply_admin_write_policy('carts');
SELECT apply_admin_write_policy('blast_log');

DROP FUNCTION IF EXISTS apply_admin_write_policy(text);

COMMIT;
