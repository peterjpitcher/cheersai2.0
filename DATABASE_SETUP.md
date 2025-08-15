# 🚀 Complete Database Setup for CheersAI

## Quick Setup (Copy & Paste)

Go to your Supabase Dashboard → SQL Editor and run this complete setup script:

```sql
-- ============================================
-- COMPLETE DATABASE SETUP FOR CHEERSAI
-- Run this entire script in Supabase SQL Editor
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. CORE TABLES
-- ============================================

-- Tenants table (organizations/pubs)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  subscription_status VARCHAR(20) DEFAULT 'trial',
  subscription_tier VARCHAR(20) DEFAULT 'free',
  trial_ends_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT UNIQUE,
  full_name TEXT,
  role VARCHAR(20) DEFAULT 'owner',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brand profiles
CREATE TABLE IF NOT EXISTS brand_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  business_type VARCHAR(50),
  tone_attributes TEXT[],
  target_audience TEXT,
  brand_colors JSONB DEFAULT '{}',
  language_code VARCHAR(10) DEFAULT 'en-GB',
  content_boundaries TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Media assets
CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type VARCHAR(50),
  file_size INTEGER,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  campaign_type VARCHAR(50) NOT NULL,
  event_date TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'draft',
  metadata JSONB DEFAULT '{}',
  hero_image_id UUID REFERENCES media_assets(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign posts
CREATE TABLE IF NOT EXISTS campaign_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  post_timing VARCHAR(50),
  content TEXT NOT NULL,
  media_assets UUID[],
  scheduled_for TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User engagement tracking
CREATE TABLE IF NOT EXISTS user_engagement (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  action VARCHAR(50),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. SOCIAL MEDIA INTEGRATION TABLES
-- ============================================

-- Social media connections
CREATE TABLE IF NOT EXISTS social_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL, -- facebook, instagram, google_my_business
  account_id TEXT,
  account_name TEXT,
  page_id TEXT,
  page_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Publishing history
CREATE TABLE IF NOT EXISTS publishing_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_post_id UUID REFERENCES campaign_posts(id) ON DELETE CASCADE,
  social_connection_id UUID REFERENCES social_connections(id) ON DELETE CASCADE,
  platform VARCHAR(50),
  status VARCHAR(20), -- pending, published, failed
  published_at TIMESTAMPTZ,
  platform_post_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Publishing queue for scheduled posts
CREATE TABLE IF NOT EXISTS publishing_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_post_id UUID REFERENCES campaign_posts(id) ON DELETE CASCADE,
  social_connection_id UUID REFERENCES social_connections(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending, processing, published, failed
  attempts INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaign_posts_campaign ON campaign_posts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_posts_tenant ON campaign_posts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_tenant ON media_assets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_brand_profiles_tenant ON brand_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_social_connections_tenant ON social_connections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_publishing_history_post ON publishing_history(campaign_post_id);
CREATE INDEX IF NOT EXISTS idx_publishing_queue_scheduled ON publishing_queue(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_publishing_queue_status ON publishing_queue(status);

-- ============================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_engagement ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_queue ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 5. RLS POLICIES
-- ============================================

-- Users policies
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON users
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- Tenants policies
CREATE POLICY "Users can view own tenant" ON tenants
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update own tenant" ON tenants
  FOR UPDATE TO authenticated
  USING (
    id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Brand profiles policies
CREATE POLICY "Users can manage own brand profile" ON brand_profiles
  FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Media assets policies
CREATE POLICY "Users can manage own media" ON media_assets
  FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Campaigns policies
CREATE POLICY "Users can manage own campaigns" ON campaigns
  FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Campaign posts policies
CREATE POLICY "Users can manage own campaign posts" ON campaign_posts
  FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Social connections policies
CREATE POLICY "Users can manage own social connections" ON social_connections
  FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Publishing history policies
CREATE POLICY "Users can view own publishing history" ON publishing_history
  FOR SELECT TO authenticated
  USING (
    campaign_post_id IN (
      SELECT id FROM campaign_posts 
      WHERE tenant_id IN (
        SELECT tenant_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- Publishing queue policies
CREATE POLICY "Users can manage own publishing queue" ON publishing_queue
  FOR ALL TO authenticated
  USING (
    campaign_post_id IN (
      SELECT id FROM campaign_posts 
      WHERE tenant_id IN (
        SELECT tenant_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- User engagement policies
CREATE POLICY "Users can track own engagement" ON user_engagement
  FOR ALL TO authenticated
  USING (user_id = auth.uid());

-- ============================================
-- 6. FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to all tables with that column
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_brand_profiles_updated_at BEFORE UPDATE ON brand_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_media_assets_updated_at BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_posts_updated_at BEFORE UPDATE ON campaign_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_social_connections_updated_at BEFORE UPDATE ON social_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_publishing_queue_updated_at BEFORE UPDATE ON publishing_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 7. STORAGE BUCKETS
-- ============================================

-- Create storage bucket for media assets (run in Supabase Dashboard > Storage)
-- Note: This needs to be done via the Supabase Dashboard UI
-- 1. Go to Storage
-- 2. Create bucket named "media"
-- 3. Make it public for viewing

-- ============================================
-- SETUP COMPLETE!
-- ============================================

-- Verify tables were created:
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

## Step-by-Step Setup Instructions

### 1. Open Supabase Dashboard
- Go to your project at https://supabase.com/dashboard
- Navigate to **SQL Editor** (left sidebar)

### 2. Run the Complete Script
- Copy the entire SQL script above
- Paste it into the SQL Editor
- Click **Run** (or press Cmd/Ctrl + Enter)

### 3. Create Storage Bucket
- Go to **Storage** in the left sidebar
- Click **New bucket**
- Name it: `media`
- Toggle **Public bucket** ON
- Click **Create bucket**

### 4. Configure Authentication
- Go to **Authentication** → **URL Configuration**
- Set **Site URL**: `http://localhost:3000`
- Add **Redirect URLs**:
  - `http://localhost:3000/auth/callback`
  - `http://localhost:3001/auth/callback`
  - `http://localhost:3002/auth/callback`
  - `http://localhost:3003/auth/callback`
  - Your production URL + `/auth/callback`

### 5. Enable Email Templates
- Go to **Authentication** → **Email Templates**
- Ensure all templates use `{{ .ConfirmationURL }}`

### 6. Get Your API Keys
- Go to **Settings** → **API**
- Copy these to your `.env.local`:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

## Verify Setup

Run this query to check all tables exist:

```sql
SELECT table_name, 
       (SELECT COUNT(*) FROM information_schema.columns 
        WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expected tables:
- brand_profiles
- campaign_posts
- campaigns
- media_assets
- publishing_history
- publishing_queue
- social_connections
- tenants
- user_engagement
- users

## Common Issues

### "Permission denied for schema public"
Run this first:
```sql
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
```

### "Relation already exists"
This is fine! The script uses `IF NOT EXISTS` so it won't duplicate tables.

### "Foreign key constraint error"
Make sure to run the complete script in order - tables reference each other.

## Testing the Setup

1. Sign up for a new account in your app
2. Check the `auth.users` table in Supabase
3. Complete onboarding
4. Check that records appear in `users`, `tenants`, and `brand_profiles`

## Next Steps

✅ Database is ready!
✅ You can now sign up and use the app
✅ All features will work properly

Need help? Check the logs in Supabase Dashboard → Logs → API