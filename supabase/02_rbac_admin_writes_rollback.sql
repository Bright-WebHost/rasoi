-- Phase 1 (Optional): RBAC Admin Writes Rollback
BEGIN;

CREATE OR REPLACE FUNCTION revert_admin_write_policy(table_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    -- Drop new policies
    EXECUTE format('DROP POLICY IF EXISTS "Staff can read %I" ON %I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Admin can write %I" ON %I', table_name, table_name);
    
    -- Revert to original staff can do everything
    EXECUTE format('DROP POLICY IF EXISTS "Staff can do everything on %I" ON %I', table_name, table_name);
    EXECUTE format('CREATE POLICY "Staff can do everything on %I" ON %I FOR ALL TO authenticated USING (staff_check()->>''staff'' = ''true'') WITH CHECK (staff_check()->>''staff'' = ''true'')', table_name, table_name);
END;
$$;

SELECT revert_admin_write_policy('settings');
SELECT revert_admin_write_policy('promotions');
SELECT revert_admin_write_policy('delivery_pincodes');
SELECT revert_admin_write_policy('customers');
SELECT revert_admin_write_policy('messages');
SELECT revert_admin_write_policy('chat_sessions');
SELECT revert_admin_write_policy('memory');
SELECT revert_admin_write_policy('reviews');
SELECT revert_admin_write_policy('carts');
SELECT revert_admin_write_policy('blast_log');

DROP FUNCTION IF EXISTS revert_admin_write_policy(text);

COMMIT;
