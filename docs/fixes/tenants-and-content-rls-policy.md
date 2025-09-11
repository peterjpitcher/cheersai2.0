# Fix: RLS Visibility for Tenants and Content Tables

This applies the minimal Row Level Security (RLS) SELECT policies so your session can read your own tenant and tenant‑scoped content (campaigns, posts, queue, brand profiles). Run each block separately in the Supabase SQL editor for project:

- onvnfijtzumtnmgwhiaq

Use exactly as written. Blocks include diagnostics and verification.

---

0) (Optional) Simulate your session for diagnostics in this editor tab
```
set local role authenticated;
set local request.jwt.claims = '{
  "sub": "9995ff23-626a-4a59-80b8-d346d91ac424",
  "role": "authenticated",
  "email": "peter@orangejelly.co.uk"
}';

select public.get_auth_tenant_id() as tenant_id;
```

---

1) Tenants – enable SELECT under RLS
```
alter table public.tenants enable row level security;

do $$
begin
  perform 1 from pg_policy p
   join pg_class c on c.oid = p.polrelid
   join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relname='tenants' and p.polname='tenants_select_self';
  if not found then
    execute $$ create policy tenants_select_self
      on public.tenants for select
      using (id = public.get_auth_tenant_id()); $$;
  end if;
end $$;
```

---

2) Brand Profiles – enable SELECT under RLS
```
alter table public.brand_profiles enable row level security;

do $$
begin
  perform 1 from pg_policy p
   join pg_class c on c.oid = p.polrelid
   join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relname='brand_profiles' and p.polname='brand_profiles_select';
  if not found then
    execute $$ create policy brand_profiles_select
      on public.brand_profiles for select
      using (tenant_id = public.get_auth_tenant_id()); $$;
  end if;
end $$;
```

---

3) Campaigns – enable SELECT under RLS
```
alter table public.campaigns enable row level security;

do $$
begin
  perform 1 from pg_policy p
   join pg_class c on c.oid = p.polrelid
   join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relname='campaigns' and p.polname='campaigns_select';
  if not found then
    execute $$ create policy campaigns_select
      on public.campaigns for select
      using (tenant_id = public.get_auth_tenant_id()); $$;
  end if;
end $$;
```

---

4) Campaign Posts – enable SELECT under RLS
```
alter table public.campaign_posts enable row level security;

do $$
begin
  perform 1 from pg_policy p
   join pg_class c on c.oid = p.polrelid
   join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relname='campaign_posts' and p.polname='campaign_posts_select';
  if not found then
    execute $$ create policy campaign_posts_select
      on public.campaign_posts for select
      using (
        tenant_id = public.get_auth_tenant_id()
        or campaign_id in (
          select id from public.campaigns
          where tenant_id = public.get_auth_tenant_id()
        )
      ); $$;
  end if;
end $$;
```

---

5) Publishing Queue – enable SELECT via post ownership
```
alter table public.publishing_queue enable row level security;

do $$
begin
  perform 1 from pg_policy p
   join pg_class c on c.oid = p.polrelid
   join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relname='publishing_queue' and p.polname='publishing_queue_select';
  if not found then
    execute $$ create policy publishing_queue_select
      on public.publishing_queue for select
      using (
        exists (
          select 1
          from public.campaign_posts cp
          where cp.id = campaign_post_id
            and cp.tenant_id = public.get_auth_tenant_id()
        )
      ); $$;
  end if;
end $$;
```

---

6) Verify visibility under your session (run with block 0 still set)
```
-- Tenants becomes visible
select id, name from public.tenants where id = public.get_auth_tenant_id();

-- Optional branding
select primary_color from public.brand_profiles where tenant_id = public.get_auth_tenant_id();

-- Campaigns and posts now visible
select count(*) as campaigns from public.campaigns where tenant_id = public.get_auth_tenant_id();
select count(*) as posts     from public.campaign_posts where tenant_id = public.get_auth_tenant_id();

-- Queue join path
select q.id
from public.publishing_queue q
join public.campaign_posts p on p.id = q.campaign_post_id
where p.tenant_id = public.get_auth_tenant_id()
limit 1;
```

Expected:
- Tenants returns 1 row (The Anchor).
- Campaigns count = 2 (per your data), posts > 0, queue row(s) present.

---

7) (Optional) Clear simulated session in this tab
```
reset role;
reset all;
```

After these, Settings and Dashboard/Calendar/Queue should render for your session.

