# CLAUDE.md - CheersAI AI Assistant Development Guide v4.0

**CRITICAL: This file provides comprehensive guidance to AI assistants (Claude, GPT, Copilot, etc.) when working with the CheersAI codebase.**

---

# === PROJECT PROFILE (AI MUST load first) ===
```yaml
# CheersAI - AI-powered social media management for UK hospitality businesses
name: cheersai
stack: node
runtime: node-20
package_manager: npm
framework: nextjs-15

commands:
  install: "npm install"
  build: "npm run build"
  test: "npm test"
  lint: "npm run lint"
  typecheck: "tsc --noEmit"
  format: "prettier --write ."
  start: "npm start"
  dev: "npm run dev"
  
  # Database commands
  db_push: "npx supabase db push --include-all"
  db_migrate: "npx supabase migration new"
  db_pull: "npx supabase db pull"
  
  # Issue tracking
  create_issue: "gh issue create --title '{title}' --body '{body}' --label '{label}'"

paths:
  src: "./app"                   # Next.js App Router
  api: "./app/api"              # API routes
  lib: "./lib"                  # Shared utilities
  components: "./components"    # React components
  tests: "./__tests__"          # Test files
  docs: "./docs"                # Documentation
  migrations: "./supabase/migrations"  # Database migrations
  public: "./public"            # Static assets

artifacts:
  server: true                  # Next.js SSR
  cli: false
  library: false
  frontend: true                # React frontend
  mobile: false                 # PWA support
  pwa: true                     # Progressive Web App
  
quality_bars:
  coverage_min: 80              # Minimum test coverage
  complexity_max: 10            # Maximum cyclomatic complexity
  duplication_max: 5            # Maximum duplicate code percentage
  p95_latency_ms: 300          # 95th percentile latency target
  error_budget_pct: 1          # Maximum error rate
  bundle_budget_kb: 200        # Maximum bundle size
  memory_budget_mb: 512        # Maximum memory usage
  
security:
  data_classes: ["public", "internal", "confidential", "pii", "tenant"]
  secrets_scanning: true
  dependency_check: true
  sast_enabled: true
  multi_tenant: true           # Tenant isolation required
  rls_enabled: true            # Row Level Security enforced
  
observability:
  logging_level: "info"
  tracing_enabled: true
  metrics_enabled: true
  health_endpoint: "/api/health"
  
release:
  strategy: "canary"
  feature_flags: true
  rollback_window: "30m"
  deployment_url: "https://cheersai.uk"
  
conventions:
  naming: "camelCase"          # JavaScript/TypeScript convention
  indent: 2                    # 2 spaces
  quotes: "double"             # For consistency with Next.js
  semicolons: true             # TypeScript best practice
  
business_context:
  domain: "UK Hospitality"     # Pubs, restaurants, bars
  users: "Business owners, managers, marketers"
  locale: "en-GB"              # UK English
  currency: "GBP"              # British Pounds
  timezone: "Europe/London"    # UK timezone
```

---

## 📑 Document Structure

**Section 1: Core Foundations**
- Project Profile & Configuration ✓
- Agent Behaviour Contract
- Definition of Ready (DoR)
- Definition of Done (DoD)
- Ethics & Safety Stop Conditions

**Section 2: CheersAI Architecture**
- Multi-Tenancy Implementation
- Authentication & Authorization
- Social Media Integration
- AI Content Generation
- Subscription Management

**Section 3: Development Workflow**
- Task Complexity Assessment
- Incremental Development Philosophy
- Database Migration Strategy
- API Development Guidelines

**Section 4: AI Optimization**
- Context Window Management
- OpenAI Integration Patterns
- Content Generation Guidelines
- Cost Controls

**Section 5: Engineering Standards**
- Non-Functional Requirements
- Resilience Patterns
- Observability Blueprint
- Security & Governance

**Section 6: Quality Assurance**
- Test Strategy
- Performance Validation
- Accessibility Standards
- UK Compliance

**Section 7: Operations**
- Release Management
- Monitoring & Alerting
- Incident Response
- Documentation

---

## 🤖 Agent Behaviour Contract

### Core Directives
1. **Do ONLY what is asked** - No unsolicited improvements or additions
2. **Respect multi-tenancy** - ALWAYS include tenant_id in queries
3. **Ask ONE clarifying question maximum** - If unclear, proceed with safest minimal implementation
4. **Record EVERY assumption** - Document in PR/commit messages
5. **One concern per changeset** - If second concern emerges, park it
6. **Fail safely** - When in doubt, stop and request human approval
7. **Log issues to GitHub** - Use `gh issue create` for bugs/errors

### 🇬🇧 British English Requirements

**CRITICAL: All user-facing text MUST use British English spelling and terminology**

#### Spelling Rules
- **-ise NOT -ize**: organise, customise, realise, specialise, analyse
- **-our NOT -or**: colour, behaviour, flavour, honour, favourite  
- **-re NOT -er**: centre, theatre, litre
- **-lled NOT -led**: cancelled, modelled, travelled, labelled
- **-ogue NOT -og**: catalogue, dialogue, analogue
- **-ce NOT -se**: licence (noun), defence, offence

#### Common Word Differences
- programme (NOT program, except for computer programs)
- enquiry (NOT inquiry)
- whilst (acceptable alongside while)
- amongst (acceptable alongside among)
- practise (verb) / practice (noun)
- license (verb) / licence (noun)

#### UI/UX Text
- "Customise" NOT "Customize"  
- "Analyse" NOT "Analyze"
- "Cancelled" NOT "Canceled"
- "Colour scheme" NOT "Color scheme"
- "Favourites" NOT "Favorites"

#### Exception: Technical Terms
Keep US spelling for:
- Technical configuration (e.g., `optimizePackageImports`)
- CSS properties and classes (e.g., `color`, `background-color`)
- Third-party library methods
- API endpoint names that are already established

### Source of Truth Hierarchy
```
1. Project Profile (above)
2. Explicit task instructions  
3. Existing code patterns in /lib and /app
4. Next.js 15 App Router best practices
5. Supabase RLS patterns
6. Industry best practices
```

### Decision Recording
Every non-trivial decision MUST be documented:
```markdown
Decision: [what was decided]
Reason: [why this option]
Alternatives: [what else was considered]
Consequences: [impact and trade-offs]
Tenant Impact: [any multi-tenant considerations]
```

### When Uncertain Protocol
```
1. Check existing patterns in /lib/social/, /app/api/
2. Ask ONE precise, specific question
3. Wait 30 seconds for response
4. If no response: proceed with lowest-risk minimal change
5. Document assumption clearly
6. Add TODO marker for human review
7. Create GitHub issue if blocking
```

---

## ✅ Definition of Ready (DoR) - CheersAI Specific

**MANDATORY before ANY coding begins:**

### Requirements Checklist
- [ ] **Problem statement written** - Clear description of issue/need
- [ ] **Success criteria defined** - Measurable definition of "done"
- [ ] **User story clear** - "As a [pub owner/manager]... I want... So that..."
- [ ] **Acceptance criteria listed** - Specific testable requirements
- [ ] **Tenant isolation verified** - Multi-tenant impact assessed

### Technical Checklist  
- [ ] **Inputs/outputs identified** - Data flow documented
- [ ] **Data classes marked** - PII/tenant/confidential/internal/public
- [ ] **Dependencies identified** - Supabase/OpenAI/Stripe/Social APIs
- [ ] **API contracts defined** - Request/response formats
- [ ] **RLS policies identified** - Required database permissions

### Risk & Quality Checklist
- [ ] **Failure modes listed** - Social API failures, rate limits
- [ ] **Rollback strategy defined** - Database migrations reversible
- [ ] **Test oracle defined** - What proves it works?
- [ ] **Performance targets set** - OpenAI response time considered
- [ ] **Security requirements clear** - OAuth tokens, tenant isolation
- [ ] **UK compliance checked** - GDPR, UK data protection

### DoR Validation Gate
```yaml
IF any_checklist_item == unchecked:
  status: NOT_READY
  action: Request missing information
  github_issue: Create if blocking
ELSE:
  status: READY
  action: Proceed to implementation
```

---

## 🎯 Definition of Done (DoD) - CheersAI Specific

**A feature is ONLY complete when ALL items pass:**

### Code Quality Gates
- ✅ **Builds successfully** - `npm run build` passes
- ✅ **All tests pass** - Jest tests green
- ✅ **Coverage meets minimum** - 80% coverage
- ✅ **No linting errors** - `npm run lint` clean
- ✅ **Type checks pass** - TypeScript compilation successful
- ✅ **Complexity within limits** - Max cyclomatic complexity: 10

### Security Gates
- ✅ **No hardcoded secrets** - Environment variables used
- ✅ **Tenant isolation verified** - RLS policies tested
- ✅ **OAuth tokens encrypted** - Platform tokens secure
- ✅ **Input validation complete** - All user inputs sanitized
- ✅ **Auth checks in place** - Supabase auth verified

### Performance Gates
- ✅ **Latency within budget** - P95 < 300ms
- ✅ **Memory within budget** - Peak < 512MB
- ✅ **Bundle size acceptable** - < 200KB per route
- ✅ **OpenAI costs tracked** - Token usage logged
- ✅ **Rate limits configured** - Upstash Redis limits set

### Documentation Gates
- ✅ **Code commented** - Complex logic explained
- ✅ **API documented** - Endpoint behavior clear
- ✅ **README updated** - If new setup needed
- ✅ **Migration documented** - SQL changes explained
- ✅ **GitHub issue updated** - Progress tracked

---

## 🛑 Ethics & Safety Stop Conditions - CheersAI Specific

### HARD STOP - Require Human Approval
**AI MUST stop and request explicit approval before:**

1. **Data Destruction Risk**
   - Any operation affecting tenant data
   - Schema migrations dropping columns/tables
   - Bulk updates to campaigns/posts
   - Deleting social_accounts or connections

2. **Security Degradation**
   - Modifying RLS policies
   - Changing tenant isolation
   - Exposing service role operations
   - Modifying OAuth token handling
   - Bypassing Supabase auth

3. **Privacy Violation Risk**
   - Logging social media tokens
   - Exposing user PII
   - Cross-tenant data access
   - Storing unencrypted credentials
   - UK GDPR compliance changes

4. **Business Impact Risk**
   - Stripe subscription changes
   - Pricing tier modifications
   - OpenAI prompt changes affecting quality
   - Social media API permission changes
   - Campaign publishing logic changes

5. **Availability Risk**
   - Supabase migration on production
   - Rate limit modifications
   - Social API integration changes
   - Payment webhook modifications

### Stop Condition Protocol
```
WHEN stop_condition_detected:
  1. HALT all changes
  2. Document the risk clearly
  3. Create GitHub issue with 'priority:high' label
  4. Request explicit approval with:
     - Risk description
     - Tenant impact analysis
     - Potential business impact
     - Mitigation options
  5. Wait for human decision
  6. Proceed ONLY with written approval
```

---

## 🏗️ CheersAI Architecture Deep Dive

### Multi-Tenancy Implementation
```typescript
// CRITICAL: Every database query MUST include tenant_id
const { data, error } = await supabase
  .from('campaigns')
  .select('*')
  .eq('tenant_id', tenantId)  // NEVER SKIP THIS
  .single();

// RLS Policy Pattern (enforced at DB level)
CREATE POLICY "tenant_isolation" ON campaigns
  FOR ALL USING (tenant_id = auth.jwt()->>'tenant_id');
```

### Authentication & Authorization Flow
```yaml
auth_flow:
  1. Email/Password via Supabase Auth
  2. Session management via SSR middleware
  3. Role checks: owner > admin > editor > viewer
  4. Service role ONLY for:
     - Admin dashboard operations
     - Webhook processing
     - Background jobs

password_reset:
  1. Request reset via /auth/forgot-password
  2. Email sent via Resend
  3. Token validation
  4. Password update via Supabase
```

### Social Media Platform Integration
```typescript
// Platform modules in /lib/social/
platforms:
  facebook_instagram:
    api_version: "v23.0"
    auth: "OAuth 2.0"
    features: ["posts", "stories", "reels", "carousels"]
    
  twitter_x:
    auth: "OAuth 2.0 with PKCE"
    features: ["tweets", "threads", "media"]
    
  linkedin:
    auth: "OAuth 2.0"
    features: ["posts", "articles"]
    
  google_my_business:
    status: "pending_implementation"
    features: ["posts", "events", "offers"]

// Publishing Queue Pattern
queue_config:
  retry_attempts: 3
  backoff: "exponential"
  initial_delay: 1000
  max_delay: 60000
```

### AI Content Generation Architecture
```typescript
// OpenAI GPT-4 Integration
content_generation:
  model: "gpt-4-turbo-preview"
  max_tokens: 500
  temperature: 0.7
  
  features:
    - Platform-specific optimization
    - UK hospitality terminology
    - Brand voice training
    - Hashtag recommendations
    - Emoji suggestions
    - Location variants
    
  guardrails:
    - Content appropriateness check
    - Length validation
    - UK spelling enforcement
    - Promotional content balance
```

### Subscription Tiers & Limits
```typescript
// Defined in /lib/stripe/config.ts
tiers:
  free_trial:
    duration: 14 # days
    campaigns: 10 # total during trial
    posts_per_month: unlimited # during trial
    team_members: 1
    
  starter:
    price: 29.00 # GBP
    campaigns_per_month: 5
    posts_per_month: 50
    team_members: 2
    
  professional:
    price: 44.99 # GBP
    campaigns_per_month: 20
    posts_per_month: 200
    team_members: 5
    
  enterprise:
    price: custom
    campaigns_per_month: unlimited
    posts_per_month: unlimited
    team_members: unlimited

// Enforcement in /lib/subscription/limits.ts
```

---

## 📊 Database Schema & Migration Strategy

### Core Tables with RLS
```sql
-- Always include tenant_id in queries
tables:
  tenants:
    - id, name, subscription_status, subscription_tier
    - total_campaigns_created (trial tracking)
    
  users:
    - id, email, tenant_id, first_name, last_name
    - role: owner|admin|editor|viewer
    
  campaigns:
    - id, tenant_id, name, status, schedule
    
  campaign_posts:
    - id, campaign_id, platform, content, media_urls
    
  social_accounts:
    - id, tenant_id, platform, access_token (encrypted)
    
  posting_schedules:
    - tenant_id, day_of_week, time, platform
```

### Migration Best Practices
```bash
# Creating migrations
npx supabase migration new descriptive_name

# Migration format: XXX_description.sql
# Example: 032_add_total_campaigns_created.sql

# Migration checklist:
- [ ] Idempotent (can run multiple times)
- [ ] Includes rollback comments
- [ ] RLS policies updated if needed
- [ ] Tested locally first
- [ ] GitHub issue created for tracking
```

---

## 🔍 API Development Guidelines

### Rate Limiting Configuration
```typescript
// Configured in middleware.ts
rate_limits:
  "/api/generate": "10 req/min"        # OpenAI costs
  "/api/social/publish": "30 req/min"  # Platform limits
  "/api/social/connect": "10 req/min"  # OAuth flows
  "/api/auth/*": "5 req/min"           # Security
  "/api/stripe/*": "20 req/min"        # Payment ops
  "default": "100 req/min"             # General
```

### API Endpoint Patterns
```typescript
// Standard endpoint structure
export async function POST(request: Request) {
  try {
    // 1. Auth check
    const session = await getSession();
    if (!session) return unauthorized();
    
    // 2. Get tenant_id
    const tenantId = await getTenantId(session.user.id);
    
    // 3. Validate input
    const body = await request.json();
    const validated = schema.parse(body);
    
    // 4. Check limits
    await checkSubscriptionLimits(tenantId, 'feature');
    
    // 5. Perform operation with tenant isolation
    const result = await operation({ ...validated, tenantId });
    
    // 6. Log success
    await logActivity(tenantId, 'action', result);
    
    return NextResponse.json(result);
  } catch (error) {
    // 7. Error handling
    await logError(error);
    return handleError(error);
  }
}
```

---

## 🚀 Environment Variables

### Required Environment Variables
```env
# Supabase (Required)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# OpenAI (Required for AI features)
OPENAI_API_KEY=

# Stripe (Required for payments)
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# Social Media (Required for respective platforms)
NEXT_PUBLIC_FACEBOOK_APP_ID=1001401138674450  # Production App ID
FACEBOOK_APP_SECRET=
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=

# Email (Required for notifications)
RESEND_API_KEY=

# Application
NEXT_PUBLIC_APP_URL=https://cheersai.uk
CRON_SECRET=  # For scheduled jobs

# Rate Limiting (Optional but recommended)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

---

## 🧪 Test Strategy

### Test Pyramid Distribution
```
       /\        5% - E2E Tests (Critical user journeys)
      /  \
     /    \     15% - Integration Tests (API, Supabase)
    /      \
   /        \   30% - Component Tests (React components)
  /          \
 /____________\ 50% - Unit Tests (Utils, hooks, helpers)
```

### Test Organization
```bash
__tests__/
├── api/          # API route tests
├── components/   # React component tests
├── lib/          # Utility function tests
├── integration/  # Supabase, Stripe, Social APIs
└── e2e/          # Critical user journeys
```

### Test Data Management
```typescript
// Use deterministic test data
test_data:
  tenant_id: "test-tenant-001"
  user_id: "test-user-001"
  campaign_id: "test-campaign-001"
  
  timestamps:
    created: "2024-01-01T00:00:00Z"
    updated: "2024-01-01T12:00:00Z"
    
  uk_specific:
    timezone: "Europe/London"
    currency: "GBP"
    locale: "en-GB"
```

---

## 📋 Common Development Tasks

### Adding a New Social Platform
```bash
1. Create platform module in /lib/social/platforms/
2. Add OAuth flow in /api/social/connect
3. Implement publishing logic in /api/social/publish
4. Add platform to PLATFORMS constant
5. Update UI components
6. Add tests in __tests__/lib/social/
7. Create migration for platform-specific fields
8. Update documentation
9. Create GitHub issue for tracking
```

### Creating a New Campaign Feature
```bash
1. Update schema in /supabase/migrations/
2. Add RLS policies for tenant isolation
3. Create API endpoint in /app/api/campaigns/
4. Add UI components in /app/(authed)/campaigns/
5. Implement subscription limit checks
6. Add tests
7. Update help documentation
```

### Updating Subscription Tiers
```bash
1. Modify tiers in /lib/stripe/config.ts
2. Update limit checks in /lib/subscription/limits.ts
3. Update UI in settings and upgrade pages
4. Test with Stripe test mode
5. Create migration if database changes needed
6. Document pricing changes
```

---

## 🚦 Quick Reference Card

### Before Starting ANY Task
```bash
1. Load Project Profile (top of this doc)
2. Check Definition of Ready
3. Assess complexity score
4. Check tenant isolation requirements
5. Review UK compliance needs
6. Create checkpoint: git commit -m "checkpoint: before [task]"
```

### During Development Loop
```bash
while not_done:
  1. Make 1-3 atomic changes
  2. Run: npm run lint
  3. Run: tsc --noEmit
  4. Run: npm test
  5. Verify tenant isolation maintained
  6. If all pass: git commit -m "checkpoint: [description]"
  7. If blocked: gh issue create
```

### Before Marking Complete
```bash
1. Run full verification pipeline
2. Check all quality gates
3. Verify RLS policies work
4. Test with UK timezone/locale
5. Update documentation
6. Create PR with template
7. Update GitHub issue
```

### If Something Goes Wrong
```bash
1. Stop immediately
2. Check git status
3. Identify last working commit
4. Rollback: git reset --hard [commit]
5. Document in GitHub issue
6. Try smaller incremental approach
```

---

## 📜 CheersAI Development Principles

### The 10 Commandments of CheersAI Development
1. **Thou shalt ALWAYS include tenant_id in queries**
2. **Thou shalt NEVER expose OAuth tokens or API keys**
3. **Thou shalt test with UK locale and timezone**
4. **Thou shalt respect subscription limits**
5. **Thou shalt handle social API failures gracefully**
6. **Thou shalt optimize OpenAI token usage**
7. **Thou shalt maintain RLS policies**
8. **Thou shalt document all migrations**
9. **Thou shalt create GitHub issues for bugs**
10. **Thou shalt validate UK hospitality context**

---

## 🔄 Verification Pipeline - CheersAI

### Pipeline Order
```yaml
pipeline:
  1_lint:
    command: "npm run lint"
    fail_fast: true
    
  2_typecheck:
    command: "tsc --noEmit"
    fail_fast: true
    
  3_security:
    command: "Check for exposed keys, tokens"
    fail_fast: true
    
  4_unit_tests:
    command: "npm test"
    fail_fast: true
    coverage_threshold: 80
    
  5_integration_tests:
    command: "npm test -- __tests__/integration"
    fail_fast: false
    
  6_build:
    command: "npm run build"
    fail_fast: true
    
  7_tenant_isolation:
    command: "Verify RLS policies"
    fail_fast: true
    
  8_smoke:
    command: "Check /api/health endpoint"
    timeout: 30s
```

---

## 📡 Monitoring & Observability

### Key Metrics to Track
```yaml
business_metrics:
  - Campaigns created per day
  - Posts published success rate
  - AI generation success rate
  - Social platform connection rate
  
technical_metrics:
  - API response times (P50, P95, P99)
  - OpenAI token usage and costs
  - Supabase query performance
  - Error rates by endpoint
  
user_experience:
  - Time to first post
  - Campaign creation time
  - Content generation latency
  - Platform connection success
```

### Structured Logging
```typescript
// Standard log format
{
  timestamp: "2024-01-15T10:30:00Z",
  level: "INFO|WARN|ERROR",
  service: "cheersai",
  tenant_id: "uuid",  // ALWAYS include
  user_id_hash: "sha256(user_id)",
  event: "campaign.created",
  platform: "facebook|instagram|twitter|linkedin",
  duration_ms: 123,
  error: null,
  metadata: {
    subscription_tier: "professional",
    posts_count: 5
  }
}
```

---

## 🌐 UK Hospitality Context

### Business Domain Knowledge
```yaml
target_businesses:
  - Pubs (traditional, gastropubs, sports bars)
  - Restaurants (casual dining, fine dining)
  - Bars (cocktail bars, wine bars)
  - Cafes (coffee shops, tea rooms)
  - Hotels with F&B
  
peak_times:
  breakfast: "08:00-10:00"
  lunch: "12:00-14:00"
  after_work: "17:00-19:00"
  dinner: "19:00-21:00"
  weekend_brunch: "10:00-14:00"
  
uk_specific:
  - Bank holiday promotions
  - Sunday roast specials
  - Quiz night announcements
  - Live sports events
  - Seasonal menus
  - Local supplier highlights
```

### Content Guidelines
```yaml
tone:
  - Warm and welcoming
  - Community-focused
  - Locally relevant
  - ALWAYS use British English spelling (see British English Requirements section above)
  - Use UK idioms and expressions
  
avoid:
  - Excessive alcohol promotion
  - Medical/health claims
  - Political statements
  - Competitor criticism
  
include:
  - Opening hours
  - Special offers
  - Event announcements
  - Menu highlights
  - Staff introductions
  - Customer testimonials
```

---

**Version**: 4.0.0-cheersai  
**Last Updated**: 2024-12-19  
**Status**: Production Ready  
**Environment**: https://cheersai.uk  

**Remember**: 
- Always check tenant isolation
- Respect UK business context  
- Track OpenAI costs
- Log issues to GitHub
- Quality > Speed
- Safety > Features

---

*End of Document*