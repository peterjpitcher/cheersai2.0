-- Backfill users.tenant_id from user_tenants or tenants.owner_id

-- 1) Prefer membership in user_tenants (owner first), then tenants.owner_id
UPDATE public.users u
SET tenant_id = COALESCE(
  (
    SELECT ut.tenant_id
    FROM public.user_tenants ut
    WHERE ut.user_id = u.id
    ORDER BY CASE WHEN ut.role = 'owner' THEN 0 ELSE 1 END, ut.created_at
    LIMIT 1
  ),
  (
    SELECT t.id
    FROM public.tenants t
    WHERE t.owner_id = u.id
    ORDER BY t.created_at
    LIMIT 1
  )
)
WHERE u.tenant_id IS NULL;

-- 2) Verify count after backfill (notice only)
DO $$
DECLARE v_missing int;
BEGIN
  SELECT COUNT(*) INTO v_missing FROM public.users WHERE tenant_id IS NULL;
  RAISE NOTICE 'Users still missing tenant_id after backfill: %', v_missing;
END $$;

