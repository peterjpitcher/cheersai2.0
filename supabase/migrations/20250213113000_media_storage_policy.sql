do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'media_read_by_account'
  ) then
    create policy media_read_by_account
      on storage.objects
      for select
      using (
        bucket_id = 'media'
        and (
          auth.role() = 'service_role'
          or starts_with(
              name,
              coalesce(auth.jwt()->'user_metadata'->>'account_id', '') || '/'
            )
        )
      );
  end if;
end $$;
