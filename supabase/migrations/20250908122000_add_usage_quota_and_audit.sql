-- Usage quota tracking and post revisions/audit trail

-- Usage quota table (per-tenant rolling period)
create table if not exists usage_quota (
  tenant_id uuid not null references tenants(id) on delete cascade,
  period_start timestamptz not null default now(),
  tokens_used bigint not null default 0,
  tokens_limit bigint not null default 100000,
  requests_used integer not null default 0,
  requests_limit integer not null default 1000,
  primary key (tenant_id, period_start)
);
create index if not exists idx_usage_quota_tenant on usage_quota(tenant_id);

-- Post revisions for immutable diffs
create table if not exists post_revisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references campaign_posts(id) on delete cascade,
  ts timestamptz not null default now(),
  user_id uuid references users(id),
  version int not null,
  diff jsonb not null
);
create index if not exists idx_post_revisions_post on post_revisions(post_id, version desc);

-- Generic audit log
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  tenant_id uuid references tenants(id),
  user_id uuid references users(id),
  entity_type text not null,
  entity_id text not null,
  action text not null,
  meta jsonb
);
create index if not exists idx_audit_log_tenant on audit_log(tenant_id, ts desc);

alter table audit_log enable row level security;
create policy audit_log_tenant_read on audit_log for select using (
  tenant_id in (select tenant_id from users where id = auth.uid())
);

