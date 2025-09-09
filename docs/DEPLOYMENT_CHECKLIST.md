# CheersAI Production Deployment Checklist

*Last Updated: 2025-08-22*

## Pre-Deployment Checklist

### Code Review
- [ ] All TODO comments resolved or documented
- [ ] Console.log statements removed from production code
- [ ] Error handling implemented for all API routes
- [ ] TypeScript errors resolved
- [ ] ESLint warnings addressed
- [ ] Build completes without errors: `npm run build`

### Database
- [ ] All migrations tested on staging
- [ ] Run migrations on production: `npx supabase migration up`
- [ ] Verify RLS policies are enabled on all tables
- [ ] Check indexes are created for performance
- [ ] Backup production database before deployment

### Environment Variables
Verify all required environment variables are set in production:

#### Supabase
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`

#### OpenAI
- [ ] `OPENAI_API_KEY`

#### Stripe
- [ ] `STRIPE_SECRET_KEY`
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`

#### Social Media
- [ ] `NEXT_PUBLIC_FACEBOOK_APP_ID`
- [ ] `FACEBOOK_APP_SECRET`
- [ ] `TWITTER_CLIENT_ID`
- [ ] `TWITTER_CLIENT_SECRET`
<!-- LinkedIn removed -->

#### Email
- [ ] `RESEND_API_KEY`

#### Application
- [ ] `NEXT_PUBLIC_APP_URL`
- [ ] `CRON_SECRET`
- [ ] `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`

### Security
- [ ] All API routes have authentication checks
- [ ] Rate limiting configured and tested
- [ ] CORS settings reviewed
- [ ] Content Security Policy headers set
- [ ] Secrets rotated since last deployment
- [ ] OAuth redirect URLs updated for production

### Testing
- [ ] Unit tests passing: `npm test`
- [ ] End-to-end testing completed
- [ ] Cross-browser testing (Chrome, Firefox, Safari, Edge)
- [ ] Mobile responsive testing
- [ ] Accessibility testing (WCAG 2.1 AA compliance)
- [ ] Performance testing (Lighthouse score > 90)

### Features Verification

#### Core Functionality
- [ ] User registration and login
- [ ] Password reset flow
- [ ] Onboarding completion
- [ ] Campaign creation (respects 10 campaign trial limit)
- [ ] AI content generation
- [ ] Quick Post functionality

#### Social Media
- [ ] Facebook/Instagram connection
- [ ] Twitter/X connection
- [ ] Google Business Profile connection
- [ ] Post publishing to all platforms
- [ ] Publishing queue processing

#### Media & Watermarks
- [ ] Image upload (including HEIC/HEIF)
- [ ] Watermark application
- [ ] Media library management

#### Monitoring
- [ ] Error tracking setup (optional)

#### Billing
- [ ] Stripe checkout flow
- [ ] Subscription management
- [ ] Trial expiration handling
- [ ] Payment webhook processing

#### Notifications
- [ ] Email notifications for failures
- [ ] Email delivery confirmed

### Infrastructure

#### Vercel Configuration
- [ ] Production domain configured
- [ ] SSL certificate active
- [ ] Environment variables set
- [ ] Build settings configured
- [ ] Function regions optimized (UK/Europe)

#### Supabase Configuration
- [ ] Production project created
- [ ] Database pooling enabled
- [ ] Backup schedule configured
- [ ] Storage buckets configured with policies

#### Third-Party Services
- [ ] Stripe webhook endpoint registered
- [ ] Resend domain verified
- [ ] Social media app review completed (if needed)
- [ ] Rate limits configured for all APIs

## Deployment Steps

### 1. Pre-Deployment (30 minutes)
```bash
# Create production build locally
npm run build

# Run production build locally
npm run start

# Test critical paths
```

### 2. Database Migration (15 minutes)
```bash
# Connect to production database
npx supabase link --project-ref [PRODUCTION_PROJECT_REF]

# Run migrations
npx supabase migration up

# Verify migrations
npx supabase migration list
```

### 3. Deploy to Vercel (10 minutes)
```bash
# Deploy to production
vercel --prod

# Or use Git push to main branch if configured
git push origin main
```

### 4. Post-Deployment Verification (30 minutes)

#### Smoke Tests
- [ ] Homepage loads
- [ ] Login works
- [ ] Dashboard displays
- [ ] Create test campaign
- [ ] Upload test image
- [ ] Connect test social account

#### Monitoring
- [ ] Check Vercel Functions logs
- [ ] Monitor Supabase logs
- [ ] Verify error tracking is working
- [ ] Check rate limiting is active

#### Performance
- [ ] Run Lighthouse audit
- [ ] Check Core Web Vitals
- [ ] Verify CDN caching

### 5. DNS & Domain (if needed)
- [ ] Update DNS records
- [ ] Verify SSL certificate
- [ ] Test www and non-www redirects
- [ ] Update sitemap.xml
- [ ] Submit to Google Search Console

## Rollback Plan

If issues are detected:

### Immediate Rollback (5 minutes)
```bash
# Revert to previous deployment in Vercel
vercel rollback

# Or use Vercel dashboard to instant rollback
```

### Database Rollback (if needed)
```bash
# Restore from backup
# Use Supabase dashboard to restore point-in-time
```

### Communication
- [ ] Update status page if issues detected
- [ ] Notify affected users via email
- [ ] Document incident for post-mortem

## Post-Deployment

### Monitoring (First 24 hours)
- [ ] Monitor error rates
- [ ] Check performance metrics
- [ ] Review user feedback
- [ ] Monitor social media connections
- [ ] Check email delivery rates

### Documentation
- [ ] Update deployment log
- [ ] Document any issues encountered
- [ ] Update runbook with new procedures
- [ ] Schedule post-mortem if needed

### Communication
- [ ] Announce new features to users
- [ ] Update changelog
- [ ] Send release notes email
- [ ] Update social media

## Production Endpoints

### Health Checks
- Status: `https://app.cheersai.com/api/health`
- Version: `https://app.cheersai.com/api/version`

### Monitoring
- Vercel Dashboard: `https://vercel.com/[team]/cheersai`
- Supabase Dashboard: `https://app.supabase.com/project/[project-ref]`
- Stripe Dashboard: `https://dashboard.stripe.com`

## Emergency Contacts

- **Technical Lead**: [Contact Info]
- **DevOps**: [Contact Info]
- **Customer Support**: [Contact Info]
- **Vercel Support**: support@vercel.com
- **Supabase Support**: support@supabase.com

## Notes

### Known Issues
- None currently documented

### Recent Changes
- Removed team management (single user only)
- Simplified analytics to 5 metrics
- Added 10 campaign trial limit
- Removed 2FA authentication
- Email notifications for failures only

### Performance Targets
- Time to First Byte: < 200ms
- First Contentful Paint: < 1.5s
- Largest Contentful Paint: < 2.5s
- Time to Interactive: < 3.5s
- Cumulative Layout Shift: < 0.1

---

**Deployment Approved By**: _________________ **Date**: _________________

**Deployment Completed By**: _________________ **Date**: _________________
