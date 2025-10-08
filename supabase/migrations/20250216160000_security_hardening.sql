-- Harden security posture to address Supabase lint findings.

set check_function_bodies = off;

create table if not exists public.user_auth_snapshot (
  user_id uuid primary key,
  email text not null,
  status text not null default 'active',
  created_at timestamptz not null,
  last_sign_in_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.user_auth_snapshot is 'Cached subset of auth.users fields safe for exposure to public schema';
comment on column public.user_auth_snapshot.status is 'Cached status derived from auth.users metadata';

alter table public.user_auth_snapshot enable row level security;
alter table public.user_auth_snapshot force row level security;

create policy if not exists "User auth snapshot readable by authenticated" on public.user_auth_snapshot
for select
to authenticated, service_role
using (true);

create or replace function public.sync_user_auth_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_auth_snapshot (user_id, email, status, created_at, last_sign_in_at, updated_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'status', 'active'),
    new.created_at,
    new.last_sign_in_at,
    now()
  )
  on conflict (user_id) do update
  set email = excluded.email,
      status = excluded.status,
      created_at = excluded.created_at,
      last_sign_in_at = excluded.last_sign_in_at,
      updated_at = now();
  return new;
end;
$$;

revoke execute on function public.sync_user_auth_snapshot() from public;
grant execute on function public.sync_user_auth_snapshot() to postgres, service_role;

create or replace function public.purge_user_auth_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.user_auth_snapshot where user_id = old.id;
  return old;
end;
$$;

revoke execute on function public.purge_user_auth_snapshot() from public;
grant execute on function public.purge_user_auth_snapshot() to postgres, service_role;

drop trigger if exists trg_sync_user_auth_snapshot on auth.users;
create trigger trg_sync_user_auth_snapshot
after insert or update on auth.users
for each row
execute function public.sync_user_auth_snapshot();

drop trigger if exists trg_purge_user_auth_snapshot on auth.users;
create trigger trg_purge_user_auth_snapshot
after delete on auth.users
for each row
execute function public.purge_user_auth_snapshot();

insert into public.user_auth_snapshot (user_id, email, status, created_at, last_sign_in_at, updated_at)
select
  id,
  email,
  coalesce(raw_user_meta_data->>'status', 'active'),
  created_at,
  last_sign_in_at,
  now()
from auth.users
on conflict (user_id) do update
set email = excluded.email,
    status = excluded.status,
    created_at = excluded.created_at,
    last_sign_in_at = excluded.last_sign_in_at,
    updated_at = now();

do $$
begin
  if to_regclass('public.profiles') is not null then
    execute $view$
      create or replace view public.profiles_view as
      select
        p.id,
        p.full_name,
        p.avatar_url,
        coalesce(p.email, uas.email) as email,
        p.created_at,
        p.updated_at
      from public.profiles p
      left join public.user_auth_snapshot uas on uas.user_id = p.id;
    $view$;
    execute 'comment on view public.profiles_view is ''Profiles view without direct auth.users dependency''';
  else
    execute 'drop view if exists public.profiles_view cascade';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.workflow_invitations') is not null
     and to_regclass('public.profiles') is not null then
    execute $view$
      create or replace view public.user_invitation_status as
      select distinct on (p.id)
        p.id,
        p.email,
        p.full_name,
        uas.last_sign_in_at,
        wi.expires_at,
        wi.status as invitation_status,
        case
          when uas.last_sign_in_at is not null then 'active'
          when wi.expires_at < now() then 'expired'
          when wi.status = 'pending' then 'pending'
          else 'no_invitation'
        end as user_status
      from public.profiles p
      left join public.user_auth_snapshot uas on uas.user_id = p.id
      left join public.workflow_invitations wi on wi.email = p.email
      order by p.id, coalesce(wi.created_at, uas.created_at, p.created_at) desc;
    $view$;
  else
    execute 'drop view if exists public.user_invitation_status cascade';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.user_brand_permissions') is not null then
    execute $view$
      create or replace view public.active_brand_users_v as
      select
        uas.user_id as id,
        coalesce(p.email, uas.email) as email,
        p.full_name,
        p.avatar_url,
        ubp.brand_id,
        p.job_title,
        uas.created_at,
        p.updated_at
      from public.user_auth_snapshot uas
      join public.user_brand_permissions ubp on ubp.user_id = uas.user_id
      left join public.profiles p on p.id = uas.user_id
      where uas.status = 'active';
    $view$;
    execute 'comment on view public.active_brand_users_v is ''Brand-scoped active users view without auth.users exposure''';
  else
    execute 'drop view if exists public.active_brand_users_v cascade';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.claims') is not null then
    execute $view$
      create or replace view public.claims_pending_approval as
      select
        c.id,
        c.claim_text,
        c.claim_type,
        c.level,
        c.description,
        c.workflow_id,
        c.current_workflow_step,
        c.workflow_status,
        c.created_at,
        c.created_by,
        cw.name as workflow_name,
        ws.name as current_step_name,
        ws.role as current_step_role,
        ws.assigned_user_ids as current_step_assignees,
        p.full_name as creator_name,
        case
          when c.level = 'brand' then mcb.name
          when c.level = 'product' then prod.name
          when c.level = 'ingredient' then ing.name
          else null
        end as entity_name,
        coalesce(cw.brand_id, b.id, mcb_brand.id) as brand_id,
        coalesce(b.name, mcb_brand.name) as brand_name,
        coalesce(b.logo_url, mcb_brand.logo_url) as brand_logo_url,
        coalesce(b.brand_color, mcb_brand.brand_color) as brand_primary_color
      from public.claims c
      left join public.claims_workflows cw on c.workflow_id = cw.id
      left join public.claims_workflow_steps ws on c.current_workflow_step = ws.id
      left join public.profiles p on c.created_by = p.id
      left join public.master_claim_brands mcb on c.master_brand_id = mcb.id
      left join public.products prod on c.product_id = prod.id
      left join public.ingredients ing on c.ingredient_id = ing.id
      left join public.brands b on cw.brand_id = b.id
      left join public.brands mcb_brand on mcb.mixerai_brand_id = mcb_brand.id
      where c.workflow_status = 'pending_review'
        and c.workflow_id is not null;
    $view$;
    execute $view$
      create or replace view public.claims_with_arrays as
      select
        c.id,
        c.claim_text,
        c.claim_type,
        c.level,
        c.master_brand_id,
        c.ingredient_id,
        c.description,
        c.created_at,
        c.updated_at,
        c.created_by,
        c.workflow_id,
        c.current_workflow_step,
        c.workflow_status,
        c.completed_workflow_steps,
        c.updated_by,
        public.get_claim_products(c.id) as product_ids,
        public.get_claim_countries(c.id) as country_codes,
        public.get_claim_ingredients(c.id) as ingredient_ids,
        case
          when c.level = 'brand' then mcb.name
          when c.level = 'ingredient' then (
            select string_agg(i.name, ', ' order by i.name)
            from public.claim_ingredients ci
            join public.ingredients i on ci.ingredient_id = i.id
            where ci.claim_id = c.id
          )
          else null
        end as entity_name,
        case
          when c.level = 'product' then (
            select string_agg(p.name, ', ' order by p.name)
            from public.claim_products cp
            join public.products p on cp.product_id = p.id
            where cp.claim_id = c.id
          )
          else null
        end as product_names,
        case
          when c.level = 'ingredient' then (
            select string_agg(i.name, ', ' order by i.name)
            from public.claim_ingredients ci
            join public.ingredients i on ci.ingredient_id = i.id
            where ci.claim_id = c.id
          )
          else null
        end as ingredient_names
      from public.claims c
      left join public.master_claim_brands mcb on c.master_brand_id = mcb.id;
    $view$;
  else
    execute 'drop view if exists public.claims_pending_approval cascade';
    execute 'drop view if exists public.claims_with_arrays cascade';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.profiles_view') is not null then
    revoke all on public.profiles_view from anon;
    grant select on public.profiles_view to authenticated, service_role;
  end if;
  if to_regclass('public.user_invitation_status') is not null then
    revoke all on public.user_invitation_status from anon;
    grant select on public.user_invitation_status to authenticated, service_role;
  end if;
  if to_regclass('public.active_brand_users_v') is not null then
    revoke all on public.active_brand_users_v from anon;
    grant select on public.active_brand_users_v to authenticated, service_role;
  end if;
  if to_regclass('public.claims_pending_approval') is not null then
    revoke all on public.claims_pending_approval from anon;
    grant select on public.claims_pending_approval to authenticated, service_role;
  end if;
  if to_regclass('public.claims_with_arrays') is not null then
    revoke all on public.claims_with_arrays from anon;
    grant select on public.claims_with_arrays to authenticated, service_role;
  end if;
end;
$$;

create or replace function public.current_account_id()
returns uuid
language plpgsql
stable
as $$
begin
  return auth.uid();
end;
$$;

comment on function public.current_account_id() is 'Resolves the current account id from the JWT subject.';

grant execute on function public.current_account_id() to authenticated, anon, service_role;

do $$
declare
  table_name text;
  tables text[] := array[
    'workflow_invitations',
    'content_types',
    'brand_selected_agencies',
    'content_vetting_agencies',
    'user_tasks',
    'market_claim_overrides',
    'countries',
    'workflow_steps'
  ];
begin
  foreach table_name in array tables loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('alter table public.%I force row level security', table_name);
    end if;
  end loop;
end;
$$;
