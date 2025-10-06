-- Ensure helper function exists for deriving the current account id from Supabase JWT metadata
create or replace function public.current_account_id()
returns uuid
language plpgsql
stable
as $$
declare
  claim text;
  account uuid;
begin
  claim := auth.jwt()->'user_metadata'->>'account_id';
  if claim is null or length(trim(claim)) = 0 then
    return null;
  end if;
  begin
    account := claim::uuid;
  exception when others then
    return null;
  end;
  return account;
end;
$$;

comment on function public.current_account_id is 'Resolves the application account id from the authenticated Supabase user metadata.';

grant execute on function public.current_account_id to authenticated, anon, service_role;

-- Accounts table
alter table public.accounts enable row level security;
create policy "Accounts readable by owner" on public.accounts
for select using (
  auth.role() = 'service_role' or id = public.current_account_id()
);
create policy "Accounts updatable by owner" on public.accounts
for update using (
  auth.role() = 'service_role' or id = public.current_account_id()
) with check (
  auth.role() = 'service_role' or id = public.current_account_id()
);

-- Brand profile
alter table public.brand_profile enable row level security;
create policy "Brand profile accessible by account" on public.brand_profile
for all using (
  auth.role() = 'service_role' or account_id = public.current_account_id()
) with check (
  auth.role() = 'service_role' or account_id = public.current_account_id()
);

-- Posting defaults
alter table public.posting_defaults enable row level security;
create policy "Posting defaults accessible by account" on public.posting_defaults
for all using (
  auth.role() = 'service_role' or account_id = public.current_account_id()
) with check (
  auth.role() = 'service_role' or account_id = public.current_account_id()
);

-- Social connections
alter table public.social_connections enable row level security;
create policy "Social connections accessible by account" on public.social_connections
for all using (
  auth.role() = 'service_role' or account_id = public.current_account_id()
) with check (
  auth.role() = 'service_role' or account_id = public.current_account_id()
);

-- Media assets
alter table public.media_assets enable row level security;
create policy "Media assets accessible by account" on public.media_assets
for all using (
  auth.role() = 'service_role' or account_id = public.current_account_id()
) with check (
  auth.role() = 'service_role' or account_id = public.current_account_id()
);

-- Campaigns
alter table public.campaigns enable row level security;
create policy "Campaigns accessible by account" on public.campaigns
for all using (
  auth.role() = 'service_role' or account_id = public.current_account_id()
) with check (
  auth.role() = 'service_role' or account_id = public.current_account_id()
);

-- Content items
alter table public.content_items enable row level security;
create policy "Content items accessible by account" on public.content_items
for all using (
  auth.role() = 'service_role' or account_id = public.current_account_id()
) with check (
  auth.role() = 'service_role' or account_id = public.current_account_id()
);

-- Content variants (bridge via content items)
alter table public.content_variants enable row level security;
create policy "Content variants accessible via parent" on public.content_variants
for all using (
  auth.role() = 'service_role' or exists (
    select 1
    from public.content_items ci
    where ci.id = content_variants.content_item_id
      and ci.account_id = public.current_account_id()
  )
) with check (
  auth.role() = 'service_role' or exists (
    select 1
    from public.content_items ci
    where ci.id = content_variants.content_item_id
      and ci.account_id = public.current_account_id()
  )
);

-- Publish jobs (bridge via content items)
alter table public.publish_jobs enable row level security;
create policy "Publish jobs accessible via content" on public.publish_jobs
for all using (
  auth.role() = 'service_role' or exists (
    select 1
    from public.content_items ci
    where ci.id = publish_jobs.content_item_id
      and ci.account_id = public.current_account_id()
  )
) with check (
  auth.role() = 'service_role' or exists (
    select 1
    from public.content_items ci
    where ci.id = publish_jobs.content_item_id
      and ci.account_id = public.current_account_id()
  )
);

-- Notifications
alter table public.notifications enable row level security;
create policy "Notifications accessible by account" on public.notifications
for all using (
  auth.role() = 'service_role' or account_id = public.current_account_id()
) with check (
  auth.role() = 'service_role' or account_id = public.current_account_id()
);

-- OAuth states (service only)
alter table public.oauth_states enable row level security;
create policy "OAuth states managed by service role" on public.oauth_states
for all using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
