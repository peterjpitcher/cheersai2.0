# CheersAI Implementation Plan

## Project Overview
**Duration**: 4 weeks  
**Goal**: Launch MVP with campaigns, media library, and AI content generation  
**Stack**: Next.js, Supabase, OpenAI, Stripe, ShadCN/Tailwind

---

## Phase 1: Foundation & Setup (Week 1)
### Day 1-2: Project Setup & Infrastructure

#### Tasks:
1. **Initialize Next.js project**
   ```bash
   npx create-next-app@latest cheersai --typescript --tailwind --app
   cd cheersai
   ```

2. **Install core dependencies**
   ```bash
   npm install @supabase/supabase-js @supabase/auth-helpers-nextjs
   npm install openai stripe @stripe/stripe-js
   npx shadcn-ui@latest init
   ```

3. **Setup Supabase project**
   - Create new Supabase project
   - Configure environment variables
   - Setup auth providers (email/password, magic link)

4. **Create database schema**
   ```sql
   -- Enable UUID extension
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

   -- Tenants table
   CREATE TABLE tenants (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     name TEXT NOT NULL,
     slug TEXT UNIQUE NOT NULL,
     subscription_status VARCHAR(20) DEFAULT 'trial',
     trial_ends_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days',
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   -- Users table (extends Supabase auth.users)
   CREATE TABLE users (
     id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
     tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
     full_name TEXT,
     role VARCHAR(20) DEFAULT 'owner',
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   -- Brand profiles
   CREATE TABLE brand_profiles (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     tenant_id UUID UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
     business_type VARCHAR(50),
     tone_attributes TEXT[],
     target_audience TEXT,
     brand_colors JSONB,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     updated_at TIMESTAMPTZ DEFAULT NOW()
   );

   -- Media assets
   CREATE TABLE media_assets (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
     file_url TEXT NOT NULL,
     file_name TEXT NOT NULL,
     file_type VARCHAR(50),
     file_size INTEGER,
     tags TEXT[],
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   -- Campaigns
   CREATE TABLE campaigns (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     event_date TIMESTAMPTZ,
     campaign_type VARCHAR(50),
     hero_image_id UUID REFERENCES media_assets(id),
     status VARCHAR(20) DEFAULT 'draft',
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   -- Campaign posts
   CREATE TABLE campaign_posts (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
     post_timing VARCHAR(50), -- 'week_before', 'day_before', 'day_of', 'hour_before'
     content TEXT NOT NULL,
     scheduled_for TIMESTAMPTZ,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```

5. **Setup Row Level Security (RLS)**
   ```sql
   -- Enable RLS on all tables
   ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
   ALTER TABLE users ENABLE ROW LEVEL SECURITY;
   ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
   ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
   ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
   ALTER TABLE campaign_posts ENABLE ROW LEVEL SECURITY;

   -- Create policies
   CREATE POLICY "Users can view own tenant" ON tenants
     FOR ALL USING (id IN (
       SELECT tenant_id FROM users WHERE id = auth.uid()
     ));

   -- Repeat similar policies for other tables
   ```

### Day 3-4: Authentication & Onboarding

#### Files to create:
```
/app
  /auth
    /login
      page.tsx
    /signup
      page.tsx
    /callback
      route.ts
  /onboarding
    page.tsx
    actions.ts
```

#### Key Components:
1. **Signup flow with tenant creation**
2. **Magic link authentication**
3. **Onboarding wizard (3 steps)**
   - Business details
   - Brand personality
   - Trial activation

### Day 5: Brand Profile Setup

#### Files to create:
```
/app
  /(dashboard)
    /settings
      /brand
        page.tsx
        actions.ts
/components
  /brand
    brand-form.tsx
    tone-selector.tsx
```

#### Features:
- Business type selector (Pub, Bar, Restaurant, Hotel)
- Tone attributes (Friendly, Professional, Witty, Traditional)
- Target audience definition
- Color picker for brand colors

---

## Phase 2: Core Features (Week 2)
### Day 6-7: Media Library

#### Files to create:
```
/app
  /(dashboard)
    /media
      page.tsx
      upload-button.tsx
      media-grid.tsx
      actions.ts
/lib
  /supabase
    storage.ts
/hooks
  use-media.ts
```

#### Features:
1. **Drag-and-drop upload**
2. **Image compression (client-side)**
3. **Grid view with search/filter**
4. **Delete/rename capabilities**
5. **Storage bucket setup in Supabase**

### Day 8-9: Campaign Creation

#### Files to create:
```
/app
  /(dashboard)
    /campaigns
      page.tsx
      /new
        page.tsx
      /[id]
        page.tsx
        edit-form.tsx
/components
  /campaigns
    campaign-card.tsx
    campaign-form.tsx
    date-scheduler.tsx
```

#### Campaign Types:
1. **Event** (Quiz Night, Live Music)
2. **Special** (Happy Hour, Food Special)
3. **Seasonal** (Christmas, Summer)
4. **Announcement** (New Menu, Opening Hours)

### Day 10: AI Integration

#### Files to create:
```
/lib
  /openai
    client.ts
    prompts.ts
    content-generator.ts
/app
  /api
    /generate
      route.ts
```

#### Prompt Templates:
```typescript
const EVENT_PROMPTS = {
  week_before: "Create an exciting 'save the date' post for [EVENT] happening next [DATE]",
  day_before: "Create an urgent 'tomorrow' reminder for [EVENT]",
  day_of: "Create a 'tonight' announcement for [EVENT] starting at [TIME]",
  hour_before: "Create a final call post for [EVENT] starting in 1 hour"
};
```

---

## Phase 3: Content Management (Week 3)
### Day 11-12: Content Editor & Preview

#### Files to create:
```
/app
  /(dashboard)
    /campaigns
      /[id]
        /posts
          page.tsx
          post-editor.tsx
/components
  /editor
    text-editor.tsx
    preview-panel.tsx
    platform-preview.tsx
```

#### Features:
1. **Rich text editing** (bold, italic, emojis)
2. **Variable insertion** ({business_name}, {event_date})
3. **Character count for platforms**
4. **Mobile preview mode**

### Day 13-14: Campaign Post Management

#### Files to create:
```
/components
  /campaigns
    post-timeline.tsx
    post-card.tsx
    bulk-actions.tsx
/lib
  /utils
    date-formatter.ts
    content-formatter.ts
```

#### Features:
1. **Timeline view of posts**
2. **Edit individual posts**
3. **Regenerate with AI**
4. **Copy to clipboard**
5. **Download as images/text**

### Day 15: Download & Export

#### Files to create:
```
/lib
  /export
    image-generator.ts
    text-exporter.ts
    campaign-packager.ts
/app
  /api
    /export
      route.ts
```

#### Export Options:
1. **Individual posts** (copy button)
2. **Bulk download** (ZIP file)
3. **Image generation** (using Canvas API)
4. **Calendar file** (.ics with reminders)

---

## Phase 4: Polish & Launch (Week 4)
### Day 16-17: Mobile Optimization

#### Tasks:
1. **Touch-optimized UI**
   - Minimum 44px touch targets
   - Swipe gestures for navigation
   - Bottom sheet modals

2. **Responsive layouts**
   ```css
   /* Mobile-first approach */
   @media (max-width: 768px) {
     /* Stack layouts vertically */
     /* Hide non-essential columns */
     /* Simplify navigation */
   }
   ```

3. **PWA configuration**
   ```json
   // manifest.json
   {
     "name": "CheersAI",
     "short_name": "Cheers",
     "display": "standalone",
     "orientation": "portrait"
   }
   ```

### Day 18: Stripe Integration

#### Files to create:
```
/app
  /(dashboard)
    /billing
      page.tsx
      upgrade-button.tsx
  /api
    /stripe
      /create-checkout
        route.ts
      /webhook
        route.ts
```

#### Subscription Tiers:
1. **Free Trial** (14 days, 10 campaigns)
2. **Starter** (£29/month, 50 campaigns)
3. **Pro** (£59/month, unlimited)

### Day 19: Error Handling & Loading States

#### Components to add:
```
/components
  /ui
    error-boundary.tsx
    loading-skeleton.tsx
    empty-state.tsx
    toast-notifications.tsx
```

#### Error Scenarios:
1. **API failures** (OpenAI, Supabase)
2. **Upload failures**
3. **Generation limits**
4. **Network issues**

### Day 20: Testing & Bug Fixes

#### Testing Checklist:
- [ ] Full user journey (signup → campaign → download)
- [ ] Mobile devices (iOS Safari, Android Chrome)
- [ ] Image upload (various sizes/formats)
- [ ] AI generation (edge cases, inappropriate content)
- [ ] Payment flow (trial → paid)
- [ ] Data isolation (multi-tenant security)

---

## Deployment & Launch

### Deployment Setup:
```bash
# Environment variables in Vercel
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

### Launch Tasks:
1. **Domain setup** (cheersai.com)
2. **SSL certificates**
3. **Error monitoring** (Sentry)
4. **Analytics** (Vercel Analytics)
5. **Support email** (help@cheersai.com)

---

## Post-Launch Roadmap

### Month 2:
- Instagram integration
- Google My Business
- Template library expansion

### Month 3:
- Team collaboration
- Analytics dashboard
- Bulk campaign creation

### Month 4:
- API for developers
- White-label options
- Advanced AI features

---

## Success Metrics

### Week 1 Goals:
- ✅ Working authentication
- ✅ Database schema deployed
- ✅ Basic UI scaffolding

### Week 2 Goals:
- ✅ Media upload working
- ✅ Campaign creation flow
- ✅ AI generating content

### Week 3 Goals:
- ✅ Full campaign workflow
- ✅ Content editing/preview
- ✅ Export functionality

### Week 4 Goals:
- ✅ Mobile optimized
- ✅ Payments integrated
- ✅ Deployed to production

---

## Risk Mitigation

### Potential Issues:
1. **OpenAI rate limits**
   - Solution: Implement queuing, caching
   
2. **Image storage costs**
   - Solution: Client-side compression, limits

3. **Multi-tenant data leaks**
   - Solution: Strict RLS, testing

4. **Mobile performance**
   - Solution: Progressive loading, optimization

---

## Development Commands

```bash
# Development
npm run dev

# Database migrations
npx supabase db push

# Type generation
npx supabase gen types typescript --local > types/supabase.ts

# Production build
npm run build

# Deploy
vercel --prod
```