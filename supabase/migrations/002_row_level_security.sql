-- Enable RLS on all tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_posts ENABLE ROW LEVEL SECURITY;

-- Helper function to get user's tenant_id
CREATE OR REPLACE FUNCTION get_user_tenant_id(user_id UUID)
RETURNS UUID AS $$
  SELECT tenant_id FROM users WHERE id = user_id;
$$ LANGUAGE SQL SECURITY DEFINER;

-- Tenants policies
CREATE POLICY "Users can view their own tenant"
  ON tenants FOR SELECT
  USING (id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their own tenant"
  ON tenants FOR UPDATE
  USING (id = get_user_tenant_id(auth.uid()));

-- Users policies
CREATE POLICY "Users can view members of their tenant"
  ON users FOR SELECT
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their own profile"
  ON users FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Users can insert themselves during signup"
  ON users FOR INSERT
  WITH CHECK (id = auth.uid());

-- Brand profiles policies
CREATE POLICY "Users can view their tenant's brand profile"
  ON brand_profiles FOR SELECT
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their tenant's brand profile"
  ON brand_profiles FOR UPDATE
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can insert brand profile for their tenant"
  ON brand_profiles FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

-- Media assets policies
CREATE POLICY "Users can view their tenant's media"
  ON media_assets FOR SELECT
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can upload media for their tenant"
  ON media_assets FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their tenant's media"
  ON media_assets FOR UPDATE
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can delete their tenant's media"
  ON media_assets FOR DELETE
  USING (tenant_id = get_user_tenant_id(auth.uid()));

-- Campaigns policies
CREATE POLICY "Users can view their tenant's campaigns"
  ON campaigns FOR SELECT
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can create campaigns for their tenant"
  ON campaigns FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their tenant's campaigns"
  ON campaigns FOR UPDATE
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can delete their tenant's campaigns"
  ON campaigns FOR DELETE
  USING (tenant_id = get_user_tenant_id(auth.uid()));

-- Campaign posts policies
CREATE POLICY "Users can view posts from their tenant's campaigns"
  ON campaign_posts FOR SELECT
  USING (
    campaign_id IN (
      SELECT id FROM campaigns 
      WHERE tenant_id = get_user_tenant_id(auth.uid())
    )
  );

CREATE POLICY "Users can create posts for their tenant's campaigns"
  ON campaign_posts FOR INSERT
  WITH CHECK (
    campaign_id IN (
      SELECT id FROM campaigns 
      WHERE tenant_id = get_user_tenant_id(auth.uid())
    )
  );

CREATE POLICY "Users can update posts from their tenant's campaigns"
  ON campaign_posts FOR UPDATE
  USING (
    campaign_id IN (
      SELECT id FROM campaigns 
      WHERE tenant_id = get_user_tenant_id(auth.uid())
    )
  );

CREATE POLICY "Users can delete posts from their tenant's campaigns"
  ON campaign_posts FOR DELETE
  USING (
    campaign_id IN (
      SELECT id FROM campaigns 
      WHERE tenant_id = get_user_tenant_id(auth.uid())
    )
  );

-- Create storage bucket for media uploads
INSERT INTO storage.buckets (id, name, public, avif_autodetection, allowed_mime_types)
VALUES (
  'media',
  'media',
  true,
  false,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
);

-- Storage policies
CREATE POLICY "Users can upload media to their tenant folder"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'media' AND
    (storage.foldername(name))[1] = get_user_tenant_id(auth.uid())::text
  );

CREATE POLICY "Users can view media in their tenant folder"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'media' AND
    (storage.foldername(name))[1] = get_user_tenant_id(auth.uid())::text
  );

CREATE POLICY "Users can update media in their tenant folder"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'media' AND
    (storage.foldername(name))[1] = get_user_tenant_id(auth.uid())::text
  );

CREATE POLICY "Users can delete media from their tenant folder"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'media' AND
    (storage.foldername(name))[1] = get_user_tenant_id(auth.uid())::text
  );