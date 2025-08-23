# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Issue Tracking

**IMPORTANT:** Always log bugs, errors, and issues to GitHub Issues using the `gh` CLI:

```bash
# Create a new issue with title and body
gh issue create --title "Brief description" --body "Detailed description" --label "bug"

# Common labels to use: bug, enhancement, documentation, help wanted
# Include in issue body:
# - Error messages and stack traces
# - Steps to reproduce
# - Expected vs actual behavior
# - Potential solutions
# - Affected components/pages
```

## Development Commands

### Running the Application
```bash
npm run dev      # Start development server on localhost:3000
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

### Testing
```bash
npm test                # Run all tests
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Generate coverage report
```

### Database Management
```bash
npx supabase db push              # Push local migrations to remote database
npx supabase db push --include-all # Push all pending migrations
npx supabase migration list       # Show migration status
npx supabase db pull              # Pull remote schema to local
npx supabase migration new <name> # Create new migration file
```

## Architecture Overview

CheersAI is a Next.js 15 application using App Router, built specifically for UK hospitality businesses (pubs, restaurants, bars) to manage their social media presence with AI-powered content generation.

### Core Technologies
- **Frontend**: Next.js 15 with React 19, TypeScript, Tailwind CSS
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **Authentication**: Supabase Auth with email/password
- **AI Generation**: OpenAI GPT-4 for content generation
- **Payments**: Stripe subscription management
- **Email**: Resend for transactional emails
- **File Storage**: Supabase Storage for media assets
- **Rate Limiting**: Upstash Redis with configurable limits per endpoint

### Key Architecture Patterns

#### Multi-Tenancy
The application implements tenant-based isolation:
- Each user belongs to a tenant (organization) via `users.tenant_id`
- All data tables include `tenant_id` for isolation
- RLS policies enforce tenant isolation at database level
- Tenant creation happens automatically on user signup
- Users can be invited to existing tenants via team invitations

#### Authentication & Authorization
- Primary auth via Supabase Auth (email/password)
- Password reset flow with email verification via Resend
- Session management via Supabase SSR middleware
- Role-based access: owner, admin, editor, viewer
- Service role key used only for admin operations

#### Social Media Integration Architecture
Platform integrations in `/lib/social/`:
- **Facebook/Instagram**: Graph API v23.0 with Business Account support
- **Twitter/X**: OAuth 2.0 with PKCE flow
- **LinkedIn**: OAuth 2.0 integration
- **Google My Business**: Pending implementation

Each platform has:
- OAuth connection flow via `/api/social/connect`
- Token refresh logic
- Platform-specific content formatting
- Error handling with retry logic
- Publishing queue with exponential backoff

#### AI Content Generation
- Uses OpenAI GPT-4 via `/api/generate` endpoint
- Platform-specific prompt optimization
- Brand voice training from sample content
- Guardrails system for content quality checks
- Location-specific content variants
- Hashtag and emoji recommendations

#### Subscription Tiers
Defined in `/lib/stripe/config.ts`:
- **Free Trial**: 14 days, full features
- **Starter**: £29/month - 5 campaigns, 50 posts
- **Professional**: £44.99/month - 20 campaigns, 200 posts
- **Enterprise**: Custom pricing and limits

Each tier enforces limits on:
- Number of campaigns
- Posts per month
- Team members
- Connected social accounts
- Analytics history

## Database Schema

### Core Tables with RLS
- `tenants` - Organizations with subscription info
- `users` - User accounts with tenant association and profile data
- `campaigns` - Marketing campaigns with scheduling
- `campaign_posts` - Individual posts within campaigns
- `social_accounts` - Connected social platform accounts
- `social_connections` - Legacy OAuth tokens (being migrated)
- `team_members` - Team invitations and roles
- `media_assets` - Uploaded images/videos
- `brand_profiles` - Brand voice and style settings
- `watermark_settings` - Logo watermark configuration
- `posting_schedules` - Optimal posting times per platform

### Migration Strategy
- Migrations numbered sequentially in `/supabase/migrations/`
- Format: `XXX_description.sql` or `YYYYMMDD_description.sql`
- Each migration must be idempotent
- RLS policies defined in separate migration files
- Always test migrations locally before pushing

## API Routes & Rate Limiting

Configured in `middleware.ts`:
- `/api/generate`: 10 req/min - AI content generation
- `/api/social/publish`: 30 req/min - Publishing posts
- `/api/social/connect`: 10 req/min - OAuth flows
- `/api/auth/*`: 5 req/min - Authentication endpoints
- `/api/stripe/*`: 20 req/min - Payment operations
- General API: 100 req/min default

## Environment Variables Required

```env
# Supabase (Required)
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

# OpenAI (Required for AI features)
OPENAI_API_KEY

# Stripe (Required for payments)
STRIPE_SECRET_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET

# Social Media (Required for respective platforms)
NEXT_PUBLIC_FACEBOOK_APP_ID=1001401138674450  # Production App ID
FACEBOOK_APP_SECRET
TWITTER_CLIENT_ID
TWITTER_CLIENT_SECRET

# Email (Required for notifications)
RESEND_API_KEY

# Application
NEXT_PUBLIC_APP_URL=https://cheersai.orangejelly.co.uk
CRON_SECRET  # For scheduled jobs

# Rate Limiting (Optional)
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

## Key API Endpoints

### Content Generation
- `POST /api/generate` - Generate AI content with platform optimization
- `POST /api/generate/bulk` - Generate multiple post variations
- `POST /api/generate/campaign` - Generate complete campaign content

### Social Publishing
- `POST /api/social/connect` - Initiate OAuth connection
- `GET /api/social/callback` - OAuth callback handler
- `POST /api/social/publish` - Publish to connected platforms
- `POST /api/social/schedule` - Schedule future posts
- `DELETE /api/social/disconnect` - Remove platform connection

### Subscription Management
- `POST /api/stripe/create-checkout` - Create checkout session
- `POST /api/stripe/webhook` - Handle Stripe webhooks
- `POST /api/stripe/portal` - Create customer portal session
- `GET /api/stripe/subscription` - Get current subscription

### Team Management
- `POST /api/team/invite` - Send team invitation
- `PUT /api/team/update-role` - Change member role
- `DELETE /api/team/remove` - Remove team member
- `POST /api/team/accept` - Accept invitation

## Testing Strategy

Uses Jest with React Testing Library. Test organization:
- `__tests__/` - Unit and integration tests
- `__tests__/api/` - API route tests
- `__tests__/components/` - Component tests
- `__tests__/lib/` - Utility function tests

Run single test file:
```bash
npm test -- path/to/test.test.ts
```

## Progressive Web App Features

PWA configuration in `/public/`:
- `manifest.json` - App manifest for installation
- `service-worker.js` - Offline caching and background sync
- Icons in multiple sizes for different devices
- Background sync for scheduled posts
- Push notification support (pending implementation)

## Common Development Tasks

### Adding a New Social Platform
1. Create platform module in `/lib/social/platforms/`
2. Add OAuth flow in `/api/social/connect`
3. Implement publishing logic in `/api/social/publish`
4. Add platform to `PLATFORMS` constant
5. Update UI components to show new platform

### Creating a New Migration
```bash
npx supabase migration new migration_name
# Edit the file in supabase/migrations/
npx supabase db push --include-all
```

### Updating Subscription Limits
1. Modify tiers in `/lib/stripe/config.ts`
2. Update limit checks in `/lib/subscription/limits.ts`
3. Update UI displays in settings and upgrade pages
4. Test with Stripe test mode

## Important Notes

- Always check tenant isolation when writing queries
- Use Supabase client for user operations, service role only for admin
- Platform tokens are encrypted in database
- Media files are stored in tenant-specific buckets
- All timestamps are stored in UTC
- UK-specific features: timezone handling, UK English content
- Logo component has three variants: full (140px), compact (header), icon (60px)
- User greeting shows first name in navigation: "Good morning, Peter!"