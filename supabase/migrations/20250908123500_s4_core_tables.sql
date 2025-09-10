-- S4 Core: approvals, comments, short links/clicks, roles, PQL events, history columns

-- Approvals
CREATE TABLE IF NOT EXISTS post_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES campaign_posts(id) ON DELETE CASCADE,
  required INT NOT NULL DEFAULT 1,
  approved_count INT NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|changes_requested
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, post_id)
);

ALTER TABLE post_approvals ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Tenant can manage own post approvals" ON post_approvals';
  EXECUTE $pol$
    CREATE POLICY "Tenant can manage own post approvals" ON post_approvals FOR ALL
    USING (tenant_id = get_auth_tenant_id()) WITH CHECK (tenant_id = get_auth_tenant_id());
  $pol$;
END $$;

-- Tenant setting for required approvers (default 1)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS approvals_required INT DEFAULT 1;

-- Comments (threaded)
CREATE TABLE IF NOT EXISTS post_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES campaign_posts(id) ON DELETE CASCADE,
  parent_id UUID NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'note', -- note|change_request
  platform_scope TEXT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Tenant can view own post comments" ON post_comments';
  EXECUTE $pol$
    CREATE POLICY "Tenant can view own post comments" ON post_comments FOR SELECT
    USING (tenant_id = get_auth_tenant_id());
  $pol$;
  EXECUTE 'DROP POLICY IF EXISTS "Tenant can insert post comments" ON post_comments';
  EXECUTE $pol$
    CREATE POLICY "Tenant can insert post comments" ON post_comments FOR INSERT
    WITH CHECK (tenant_id = get_auth_tenant_id());
  $pol$;
END $$;

-- Roles & permissions
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  UNIQUE (tenant_id, name)
);
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Tenant manage roles" ON roles';
  EXECUTE $pol$
    CREATE POLICY "Tenant manage roles" ON roles FOR ALL
    USING (tenant_id = get_auth_tenant_id()) WITH CHECK (tenant_id = get_auth_tenant_id());
  $pol$;
END $$;

CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL
);
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Tenant manage role permissions" ON role_permissions';
  EXECUTE $pol$
    CREATE POLICY "Tenant manage role permissions" ON role_permissions FOR ALL
    USING (tenant_id = get_auth_tenant_id()) WITH CHECK (tenant_id = get_auth_tenant_id());
  $pol$;
END $$;

CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, user_id, role_id)
);
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Tenant manage user roles" ON user_roles';
  EXECUTE $pol$
    CREATE POLICY "Tenant manage user roles" ON user_roles FOR ALL
    USING (tenant_id = get_auth_tenant_id()) WITH CHECK (tenant_id = get_auth_tenant_id());
  $pol$;
END $$;

-- Short links
CREATE TABLE IF NOT EXISTS short_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  campaign_id UUID NULL REFERENCES campaigns(id) ON DELETE SET NULL,
  platform TEXT NULL,
  connection_id UUID NULL REFERENCES social_connections(id) ON DELETE SET NULL,
  utm_source TEXT NULL,
  utm_medium TEXT NULL,
  utm_campaign TEXT NULL,
  utm_content TEXT NULL,
  publishing_history_id UUID NULL REFERENCES publishing_history(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE short_links ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Tenant manage short links" ON short_links';
  EXECUTE $pol$
    CREATE POLICY "Tenant manage short links" ON short_links FOR ALL
    USING (tenant_id = get_auth_tenant_id()) WITH CHECK (tenant_id = get_auth_tenant_id());
  $pol$;
END $$;
CREATE INDEX IF NOT EXISTS idx_short_links_tenant ON short_links(tenant_id);

-- Clicks
CREATE TABLE IF NOT EXISTS short_clicks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  link_id UUID NOT NULL REFERENCES short_links(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash TEXT NULL,
  ua_hash TEXT NULL,
  referer TEXT NULL,
  platform_hint TEXT NULL,
  country TEXT NULL,
  city TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_short_clicks_link ON short_clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_short_clicks_ts ON short_clicks(ts);

-- Publishing history enhancement
ALTER TABLE publishing_history ADD COLUMN IF NOT EXISTS post_type TEXT NULL;

-- Locking during publish
ALTER TABLE campaign_posts ADD COLUMN IF NOT EXISTS is_publishing BOOLEAN DEFAULT false;

-- PQL events
CREATE TABLE IF NOT EXISTS pql_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE pql_events ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Tenant manage pql events" ON pql_events';
  EXECUTE $pol$
    CREATE POLICY "Tenant manage pql events" ON pql_events FOR ALL
    USING (tenant_id = get_auth_tenant_id()) WITH CHECK (tenant_id = get_auth_tenant_id());
  $pol$;
END $$;

