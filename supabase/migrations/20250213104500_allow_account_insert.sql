do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'accounts'
      and policyname = 'Accounts insertable by owner'
  ) then
    execute '
      create policy "Accounts insertable by owner" on public.accounts
        for insert
        with check (
          auth.role() = ''service_role''
          or id = public.current_account_id()
        );
    ';
  end if;
end $$;
