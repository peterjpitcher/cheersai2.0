-- Fix database linter findings: enable RLS and set view security invoker

-- 1) Views should not run with definer privileges. Make index_usage_stats use invoker rights.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'index_usage_stats'
  ) THEN
    EXECUTE 'ALTER VIEW public.index_usage_stats SET (security_invoker = on)';
  END IF;
END $$;

-- 2) Enable RLS on public.usage_quota and add tenancy policy
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'usage_quota'
  ) THEN
    EXECUTE 'ALTER TABLE public.usage_quota ENABLE ROW LEVEL SECURITY';
    -- Drop existing policies if re-running
    EXECUTE 'DROP POLICY IF EXISTS usage_quota_tenant_rw ON public.usage_quota';
    EXECUTE $pol$
      CREATE POLICY usage_quota_tenant_rw ON public.usage_quota FOR ALL
      USING (tenant_id = get_auth_tenant_id())
      WITH CHECK (tenant_id = get_auth_tenant_id());
    $pol$;
  END IF;
END $$;

-- 3) Enable RLS on public.post_revisions and scope by tenant via campaign_posts
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'post_revisions'
  ) THEN
    EXECUTE 'ALTER TABLE public.post_revisions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS post_revisions_tenant_rw ON public.post_revisions';
    EXECUTE $pol$
      CREATE POLICY post_revisions_tenant_rw ON public.post_revisions FOR ALL
      USING (
        post_id IN (SELECT id FROM public.campaign_posts WHERE tenant_id = get_auth_tenant_id())
      )
      WITH CHECK (
        post_id IN (SELECT id FROM public.campaign_posts WHERE tenant_id = get_auth_tenant_id())
      );
    $pol$;
  END IF;
END $$;

-- 4) Enable RLS on public.short_clicks
--    We allow INSERTs from anyone (to collect clicks) but restrict SELECT by tenant via short_links
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'short_clicks'
  ) THEN
    EXECUTE 'ALTER TABLE public.short_clicks ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS short_clicks_select_tenant ON public.short_clicks';
    EXECUTE 'DROP POLICY IF EXISTS short_clicks_insert_any ON public.short_clicks';
    -- Restrict SELECT to tenant owning the link
    EXECUTE $pol$
      CREATE POLICY short_clicks_select_tenant ON public.short_clicks FOR SELECT
      USING (
        link_id IN (
          SELECT id FROM public.short_links WHERE tenant_id = get_auth_tenant_id()
        )
      );
    $pol$;
    -- Allow inserts from any role (including anon) to record clicks
    EXECUTE $pol$
      CREATE POLICY short_clicks_insert_any ON public.short_clicks FOR INSERT
      WITH CHECK (true);
    $pol$;
  END IF;
END $$;
