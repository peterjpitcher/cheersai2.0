-- Set search_path on user-defined functions (skip btree_gist extension functions)
ALTER FUNCTION public.advisory_lock_fixture(lock_key bigint) SET search_path = public, pg_catalog;
ALTER FUNCTION public.current_account_id() SET search_path = public, pg_catalog;
ALTER FUNCTION public.inspect_worker_db_context() SET search_path = public, pg_catalog;
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.touch_link_in_bio_updated_at() SET search_path = public, pg_catalog;

-- Convert SECURITY DEFINER view to SECURITY INVOKER
ALTER VIEW public.publish_jobs_with_variant SET (security_invoker = true);;
