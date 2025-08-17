# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Running the Application
```bash
npm run dev      # Start development server on localhost:3000
npm run build    # Build for production
npm run start    # Start production server
```

### Testing & Quality
```bash
npm test                # Run all tests
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Generate coverage report
npm run lint            # Run ESLint
```

## Architecture Overview

This is a Next.js 15 application using App Router for an AI-powered social media management platform (CheersAI) targeting UK hospitality businesses.

### Core Technologies
- **Frontend**: Next.js 15 with React 19, TypeScript, Tailwind CSS
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **Authentication**: Supabase Auth with 2FA support
- **AI Generation**: OpenAI GPT-4 for content generation
- **Payments**: Stripe subscription management
- **Email**: Resend for transactional emails
- **Rate Limiting**: Built-in middleware with configurable limits

### Key Architecture Patterns

#### Multi-Tenancy
The application uses a tenant-based architecture where:
- Each user belongs to a tenant (organization)
- All data is isolated by tenant_id
- RLS policies enforce tenant isolation at the database level
- Tenant creation happens automatically on user signup

#### Authentication Flow
- Uses Supabase Auth with email/password
- Supports password reset via email
- Optional 2FA using speakeasy
- Session management via Supabase SSR middleware

#### Social Media Integration
Platform-specific modules in `/lib/social/`:
- Facebook/Instagram (Graph API)
- Twitter/X
- LinkedIn
- Google My Business

Each integration handles OAuth flows and API interactions.

#### Subscription Tiers
Defined in `/lib/stripe/config.ts`:
- Free Trial (14 days)
- Starter (£29/month)
- Professional (£44.99/month)
- Enterprise (custom pricing)

Each tier has specific limits for campaigns, posts, team members, etc.

## Database Schema

### Core Tables (with RLS)
- `tenants` - Organizations
- `users` - User accounts with tenant association
- `campaigns` - Marketing campaigns
- `posts` - Social media posts
- `social_accounts` - Connected social platforms
- `subscriptions` - Stripe subscription data
- `team_members` - Team collaboration
- `media_assets` - Uploaded media files

### Migration Strategy
Migrations are numbered sequentially in `/supabase/migrations/`.
The database setup includes comprehensive RLS policies for multi-tenant isolation.

## API Rate Limiting

Configured in `middleware.ts`:
- `/api/generate`: 10 requests/minute (AI generation)
- `/api/social`: 30 requests/minute (social publishing)
- `/api/auth`: 5 requests/minute (authentication)
- General API: 100 requests/minute

## Environment Variables Required

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

# OpenAI
OPENAI_API_KEY

# Stripe
STRIPE_SECRET_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET

# Social Media
NEXT_PUBLIC_FACEBOOK_APP_ID
FACEBOOK_APP_SECRET

# Email
RESEND_API_KEY

# Application
NEXT_PUBLIC_APP_URL
CRON_SECRET
```

## Key API Routes

### Content Generation
`POST /api/generate` - AI content generation with platform optimization

### Social Publishing
`POST /api/social/publish` - Publish to connected platforms
`POST /api/social/connect` - OAuth connection flows

### Subscription Management
`POST /api/stripe/create-checkout` - Create Stripe checkout
`POST /api/stripe/webhook` - Handle Stripe webhooks

### Team Management
`POST /api/team/invite` - Send team invitations
`PUT /api/team/update-role` - Update member roles

## Testing Approach

Uses Jest with React Testing Library. Test files are located in `__tests__/` directory.
Key test areas:
- API route handlers
- Component rendering
- Subscription limit checks
- Social media preview components

## Progressive Web App

The application includes PWA capabilities:
- Service worker in `/public/service-worker.js`
- Manifest file for installation
- Offline functionality
- Background sync for scheduled posts