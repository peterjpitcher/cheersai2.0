-- Expose pg_advisory_xact_lock as an RPC callable from the Supabase client.
-- Used by tournament content generation to prevent concurrent generation per fixture.
create or replace function public.advisory_lock_fixture(lock_key bigint)
returns void
language plpgsql
security definer
as $$
begin
  perform pg_advisory_xact_lock(lock_key);
end;
$$;

-- Only service role can call this
revoke execute on function public.advisory_lock_fixture(bigint) from public;
revoke execute on function public.advisory_lock_fixture(bigint) from anon;
revoke execute on function public.advisory_lock_fixture(bigint) from authenticated;
grant execute on function public.advisory_lock_fixture(bigint) to service_role;
