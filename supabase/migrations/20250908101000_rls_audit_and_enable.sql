-- Ensure RLS is enabled on all tenant-scoped tables and add minimal tenant policies
-- Uses get_auth_tenant_id() per the current architecture (migration 008+)

DO $$
DECLARE
  rec RECORD;
  has_policy BOOLEAN;
BEGIN
  -- Enable RLS on all public tables that have a tenant_id column
  FOR rec IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col ON col.table_schema = n.nspname AND col.table_name = c.relname
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'  -- ordinary tables
      AND col.column_name = 'tenant_id'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.table_name);

    -- If no policies exist on the table, add conservative tenant-scoped policies
    SELECT EXISTS(
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = rec.table_name
    ) INTO has_policy;

    IF NOT has_policy THEN
      -- SELECT policy
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = public.get_auth_tenant_id())',
        rec.table_name || '_tenant_select', rec.table_name
      );

      -- INSERT policy
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (tenant_id = public.get_auth_tenant_id())',
        rec.table_name || '_tenant_insert', rec.table_name
      );

      -- UPDATE policy
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE USING (tenant_id = public.get_auth_tenant_id()) WITH CHECK (tenant_id = public.get_auth_tenant_id())',
        rec.table_name || '_tenant_update', rec.table_name
      );

      -- DELETE policy
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE USING (tenant_id = public.get_auth_tenant_id())',
        rec.table_name || '_tenant_delete', rec.table_name
      );
    END IF;
  END LOOP;
END $$;

-- Log summary
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT COUNT(1) INTO cnt FROM pg_tables t
  JOIN information_schema.columns c ON c.table_schema = t.schemaname AND c.table_name = t.tablename
  WHERE t.schemaname = 'public' AND c.column_name = 'tenant_id';
  RAISE NOTICE 'RLS ensured on % tables with tenant_id', cnt;
END $$;

