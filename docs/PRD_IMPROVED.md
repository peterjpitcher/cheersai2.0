# PubHubAI - Product Requirements Document

## 1. Executive Summary
PubHubAI is a mobile-first content production platform specifically designed for pub and hospitality businesses. It enables automated content creation, smart scheduling, and multi-platform publishing while maintaining consistent brand voice across all communications.

## 2. Problem Statement & Target Audience

### Problem
Pub owners struggle with:
- Creating consistent, engaging content while running their business
- Knowing when and what to post for maximum engagement
- Managing multiple social media platforms
- Maintaining professional brand consistency

### Primary Users
- **Pub Owners/Managers**: Using primarily mobile devices, need quick content creation
- **Marketing Teams**: Managing multiple locations, need brand consistency
- **Hospitality Groups**: Multi-venue operations requiring centralized control

## 3. Core Features

### 3.1 Brand Identity & Tone Setup
**User Journey**: One-time setup wizard capturing:
- Business type (pub, bar, restaurant, etc.)
- Target audience demographics
- Tone preferences (casual, professional, witty, traditional)
- Language/dialect preferences (UK English, US English, etc.)
- Brand colors and logo
- Content boundaries (topics to avoid)

**Database Schema**:
```sql
-- Brand Identity
CREATE TABLE brand_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    business_type TEXT NOT NULL,
    target_audience JSONB NOT NULL,
    tone_attributes TEXT[] NOT NULL,
    language_code VARCHAR(10) DEFAULT 'en-GB',
    brand_colors JSONB,
    logo_url TEXT,
    content_boundaries TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 Template Library & Management
**Superadmin Features**:
- Create/edit master templates
- Track template usage analytics
- A/B test template variations
- Publish/unpublish templates

**User Features**:
- Browse categorized templates (Events, Specials, Seasonal, Announcements)
- Preview with their brand applied
- Customize and save as drafts

**Database Schema**:
```sql
-- Templates (Superadmin managed)
CREATE TABLE templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    content_structure JSONB NOT NULL, -- Defines placeholders and AI prompts
    thumbnail_url TEXT,
    is_published BOOLEAN DEFAULT false,
    usage_count INTEGER DEFAULT 0,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Template Usage Tracking
CREATE TABLE template_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID REFERENCES templates(id),
    tenant_id UUID REFERENCES tenants(id),
    used_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.3 Media Library
**Features**:
- Upload once, use multiple times
- Automatic compression and optimization
- Tag and categorize images
- Smart cropping for different platforms

**Database Schema**:
```sql
-- Media Library
CREATE TABLE media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type VARCHAR(50),
    file_size INTEGER,
    tags TEXT[],
    metadata JSONB, -- dimensions, alt text, etc.
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.4 Smart Content Campaigns
**Event Campaign Flow**:
1. Create event (Quiz Night, Live Music, Special Menu)
2. Set event date/time
3. Upload hero image
4. AI generates posting schedule:
   - 1 week before: "Save the date!"
   - 3 days before: "This Friday..."
   - Day of: "Tonight! Don't miss..."
   - 1 hour before: "Starting soon..."

**Database Schema**:
```sql
-- Content Campaigns
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    event_date TIMESTAMPTZ,
    campaign_type VARCHAR(50), -- event, promotion, seasonal
    hero_image_id UUID REFERENCES media_assets(id),
    status VARCHAR(20) DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign Posts
CREATE TABLE campaign_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    content_type VARCHAR(20), -- social, story, reel, gmb
    platform VARCHAR(20), -- facebook, instagram, twitter, gmb
    content TEXT NOT NULL,
    media_ids UUID[], -- Array of media_assets IDs
    scheduled_for TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    publish_status VARCHAR(20) DEFAULT 'scheduled',
    external_post_id TEXT, -- Platform's post ID
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.5 Content Production & Preview
**Features**:
- Rich text editor with mobile-optimized interface
- Real-time preview across platforms (FB post, IG square, Stories format)
- AI-powered content suggestions based on brand voice
- SEO optimization for web content

**Database Schema**:
```sql
-- Content Production
CREATE TABLE content_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    template_id UUID REFERENCES templates(id),
    title TEXT,
    content JSONB NOT NULL, -- Rich content with formatting
    seo_metadata JSONB, -- title, description, keywords, og tags
    status VARCHAR(20) DEFAULT 'draft',
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.6 Publishing & Scheduling
**Supported Platforms**:
- Facebook (Page posts, Events)
- Instagram (Feed, Stories, Reels descriptions)
- X/Twitter
- Google My Business (Posts, Updates, Events)

**Smart Scheduling**:
- Best time recommendations based on pub industry data
- Conflict detection (avoid posting during service rush)
- Platform-specific optimization

**Database Schema**:
```sql
-- Publishing Configurations
CREATE TABLE publishing_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL,
    credentials JSONB, -- Encrypted OAuth tokens
    page_id TEXT, -- Platform-specific identifiers
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Publishing Queue
CREATE TABLE publishing_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_item_id UUID REFERENCES content_items(id),
    campaign_post_id UUID REFERENCES campaign_posts(id),
    platform VARCHAR(20) NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    published_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'pending'
);
```

### 3.7 Multi-Tenant & User Management
**Features**:
- Role-based access (Owner, Manager, Staff)
- Tenant isolation with Row Level Security
- Invitation system

**Database Schema**:
```sql
-- Tenants
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    subscription_tier VARCHAR(20) DEFAULT 'free',
    subscription_status VARCHAR(20) DEFAULT 'active',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Roles
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL, -- owner, manager, staff
    is_superadmin BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, tenant_id)
);
```

## 4. Technical Architecture

### Core Stack
- **Framework**: Next.js 14 (App Router, Server Actions)
- **Database**: Supabase (PostgreSQL + Auth + Storage + Realtime)
- **UI**: ShadCN UI + Tailwind CSS (Mobile-first responsive)
- **AI**: OpenAI API (GPT-4 for content generation)
- **Payments**: Stripe (Subscriptions & billing)
- **Deployment**: Vercel (Edge functions for scheduling)

### Integrations
- **Social Publishing**: Buffer API (multi-platform scheduling)
- **Google My Business**: Direct API integration
- **Image Processing**: Supabase Storage with Sharp.js transformations

### Mobile-First Design Principles
- Touch-optimized UI elements (minimum 44px touch targets)
- Swipe gestures for navigation
- Bottom navigation for primary actions
- Progressive disclosure for complex features
- Offline draft capability

## 5. SEO & Performance Requirements

### SEO Features
- Automatic meta tag generation
- Open Graph optimization for social sharing
- Schema.org structured data for events
- Sitemap generation for published content
- Image alt text AI generation

### Performance Targets
- First Contentful Paint: < 1.2s
- Time to Interactive: < 2.5s
- Mobile Lighthouse Score: > 90
- Image lazy loading with blur placeholders

## 6. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)
1. Supabase setup with RLS policies
2. Authentication flow with magic links
3. Tenant management system
4. Basic UI scaffolding

### Phase 2: Content Core (Weeks 3-4)
1. Brand identity setup wizard
2. Template system (superadmin)
3. Rich text editor with preview
4. Media library

### Phase 3: AI Integration (Weeks 5-6)
1. OpenAI integration
2. Content generation with brand voice
3. Smart scheduling recommendations
4. SEO optimization

### Phase 4: Publishing (Weeks 7-8)
1. Social media OAuth flows
2. Publishing queue system
3. Campaign management
4. Google My Business integration

### Phase 5: Polish & Launch (Weeks 9-10)
1. Mobile optimization
2. Performance tuning
3. Error handling & logging
4. User onboarding flow

## 7. File Structure
```
/app
  /(auth)
    /login
    /signup
    /onboarding
  /(dashboard)
    /dashboard
    /content
    /campaigns
    /media
    /schedule
    /settings
  /(superadmin)
    /templates
    /analytics
  /api
    /webhooks
      /stripe
    /cron
      /publish
/components
  /ui (ShadCN)
  /content
    /editor
    /preview
  /campaigns
  /media
  /publishing
/lib
  /supabase
  /openai
  /social-platforms
  /seo
/hooks
  /use-tenant
  /use-auth
  /use-media
/types
/utils
```

## 8. Security & Compliance
- Row Level Security for all tenant data
- Encrypted storage for OAuth tokens
- GDPR compliance for EU pubs
- Rate limiting on AI generation
- Input sanitization for user content
- Webhook signature verification

## 9. Monitoring & Analytics
- Vercel Analytics for performance
- Sentry for error tracking
- Custom usage tracking for superadmin
- Template performance metrics
- Publishing success rates

## 10. Future Enhancements
- WhatsApp Business integration
- Review response automation
- Competitor content analysis
- Local event integration (sports, holidays)
- Multi-location campaign coordination
- Video content generation