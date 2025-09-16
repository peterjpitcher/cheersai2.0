# CheersAI MVP Implementation Plan
> Note: The Analytics feature was de-scoped and removed from the product. Sections mentioning Analytics remain for historical planning context only. LinkedIn support was also removed from the product.
*Last Updated: 2025-08-21*

## Executive Summary
This document outlines the complete MVP implementation plan for CheersAI, focusing on delivering a lean, functional social media management platform for UK hospitality businesses (pubs, restaurants, bars) within 2 weeks.

## MVP Core Principles
- **Focus**: Essential features only - what UK hospitality businesses need TODAY
- **Simplicity**: Remove complexity, can always add features based on real feedback
- **Speed**: Launch in 2 weeks with working product
- **Value**: Solve the core problem - consistent social media presence

## Final Feature Set for MVP

### ✅ KEEPING - Core Features
1. **Campaign Creation**
   - AI-powered content generation
   - 10 campaigns limit for free trial (lifetime tracking)
   - 4 categories: Event, Special Offer, Seasonal, Announcement
   - Categories affect AI generation and visual organization

2. **Quick Post**
   - Essential for reactive content (daily specials, closures, etc.)
   - Fix broken button on dashboard (Issue #89)
   - Modal-based creation

3. **Social Platforms (Supported)**
   - Facebook
   - Instagram  
   
   - Google My Business
   - LinkedIn (removed)

4. **Media Library**
   - Image upload with compression
   - Watermark functionality (MUST FIX positioning bug)
   - HEIC/HEIF support for iPhone photos

5. **Brand Voice (Simplified)**
   - During onboarding only (not in settings)
   - Optional website scraping (strongly recommended)
   - Simple fields: Brand description, Tone, Target customers
   - Removes complex guardrails system

6. **Publishing Queue (Simplified)**
   - Three views: List, Calendar, Week (NEW)
   - Basic upcoming posts display
   - No complex queue management

7. **Analytics (One Page Only)**
   - 5 essential metrics based on research:
     - Engagement Rate (industry avg: 1.73%)
     - Total Reach
     - Best Performing Post
     - Follower Growth
     - Peak Engagement Times
   - Remove all subpages

8. **Subscription/Billing**
   - Stripe integration
   - Free trial with limits
   - Subscription tiers

### ❌ REMOVING/POSTPONING - Not in MVP

1. **Monitoring System** (Issues #103-107)
   - Remove entirely
   - Use Vercel Analytics instead

2. **Analytics Subpages** (Issues #99-102)
   - Remove engagement, reach, conversions, export pages
   - One simple analytics page only

3. **Team Management** (Issue #87)
   - Single user accounts only
   - Most small hospitality has 1-2 social media managers

4. **2FA Authentication** (Issue #85)
   - Remove for MVP
   - Adds friction to onboarding

5. **Admin AI Prompts**
   - Use default prompts only
   - No customization interface

6. **Content Approval Workflow**
   - Not needed for single users
   - Small businesses want speed

7. **Complex Notifications** (Issue #86)
   - Just email on post failure
   - Remove all preferences/settings

8. **GDPR Export**
   - Keep delete account only (legally required)
   - Remove complex export functionality

9. **Locations Management** (Issue #83)
   - Each location gets own account
   - Remove multi-location features

10. **Voice Training in Settings** (Issue #82)
    - Onboarding only
    - Remove from settings page

## Issue Resolution Plan

### Week 1 - Critical Fixes (2-3 days work)

#### High Priority Bugs to Fix
1. **Issue #80, #95** - Watermark positioning off image (4 hours)
   - Root cause: Fixed 400px container assumption
   - Fix: Implement dynamic size detection with getBoundingClientRect()

2. **Issue #89** - Quick Post button broken (30 mins)
   - Root cause: Missing QuickPostModal import
   - Fix: Add import and state management in dashboard

3. **Issue #93** - Publishing queue 404 (30 mins)
   - Root cause: Page in backup folder
   - Fix: Move from publishing.backup/queue to (authed)/publishing/queue

4. **Issue #88** - Welcome message shows "User" (1 hour)
   - Root cause: first_name not in query
   - Fix: Add first_name to database query, migration if needed

5. **Issue #92** - Campaign deletion without limit bypass (2 hours)
   - Root cause: No lifetime tracking
   - Fix: Add total_campaigns_created counter, never decrement

### Week 2 - Simplifications (3-4 days work)

#### Simplification Tasks
1. **Analytics Simplification** (4 hours)
   - Implement 5 essential metrics on one page
   - Remove all subpage navigation
   - Add empty state messaging

2. **Voice Training Simplification** (2 hours)
   - Move to onboarding only
   - Remove from settings
   - Keep website scraping optional but recommended

3. **Publishing Queue Enhancement** (4 hours)
   - Add week view
   - Simplify list view
   - Keep calendar view

4. **Remove Monitoring** (1 hour)
   - Delete all monitoring pages
   - Remove navigation items
   - Clean up routes

5. **Remove Team Management** (1 hour)
   - Remove team pages
   - Remove navigation
   - Simplify permissions to single user

### Quick Wins (Throughout)
- Issue #83 - Remove locations page (15 mins)
- Issue #84 - Add toast notification to recommendations (30 mins)
- Issue #94 - Fix campaign status filters (1 hour)
- Remove 2FA from security settings (30 mins)
- Issue #81 - Remove duplicate navigation in settings (30 mins)

### Post-MVP (After Launch)
- Issue #96, #108 - Header redesign
- Issue #97 - Post edit modal improvements
- Issue #91 - Watermark in campaign upload
- Enhanced analytics with subpages
- Team management
- Content approval workflow
- 2FA authentication
- Monitoring system

## Simplified Onboarding Flow

1. **Welcome Screen**
   - Business name
   - Business type (Pub/Restaurant/Bar/Cafe)

2. **Brand Understanding** (Optional but Recommended)
   ```
   🎯 Let us learn about your brand (recommended)
   We'll analyze your website to understand your unique voice 
   and create content that sounds like you, not a robot.
   
   [Enter Website URL] or [Skip for now]
   ```

3. **Simple Brand Fields**
   - Tone: Friendly / Professional / Casual
   - Target Customers: (text field)
   - Brand Description: (text field, pre-filled if website scraped)

4. **Connect Social Accounts**
   - Facebook/Instagram
    
   - LinkedIn

5. **Done!** (< 5 minutes total)

## Campaign Limits Implementation

### Free Trial: 10 Campaigns (Lifetime)
- Add `total_campaigns_created` column to tenants table
- Increment on creation, never decrement
- Display "3 of 10 campaigns used" on dashboard
- Cannot bypass by deleting campaigns

### Database Migration Required
```sql
ALTER TABLE tenants 
ADD COLUMN total_campaigns_created INTEGER DEFAULT 0;

UPDATE tenants 
SET total_campaigns_created = (
  SELECT COUNT(*) FROM campaigns WHERE tenant_id = tenants.id
);
```

## Analytics Metrics Detail

### Based on 2024 Hospitality Research
1. **Engagement Rate**
   - Likes + Comments + Shares / Reach
   - Industry average: 1.73%
   - Show trend over time

2. **Total Reach**
   - Unique users who saw content
   - Weekly/Monthly comparison

3. **Best Performing Post**
   - Highest engagement in period
   - Show post preview and metrics

4. **Follower Growth**
   - Net new followers
   - Growth rate percentage

5. **Peak Engagement Times**
   - Heat map of best posting times
   - Based on actual engagement data

## Technical Debt to Address

### Must Fix Before Launch
- Watermark positioning calculation
- Quick Post button import
- Welcome message first name
- Campaign deletion tracking
- Publishing queue routing

### Can Fix After Launch
- Redundant headers
- Post edit modal polish
- Campaign category enhancements
- Settings page structure

## Success Metrics

### Launch Goals
- 2 week development timeline
- < 50% of original feature scope
- Core functionality working
- 5 beta customers using platform

### Post-Launch Metrics
- User onboarding completion rate > 80%
- Daily active users creating content
- Customer feedback on missing features
- Time to first published post < 10 minutes

## Risk Mitigation

### Technical Risks
- **Social API Changes**: Have fallback error handling
- **Stripe Integration**: Test thoroughly in test mode
- **Database Migrations**: Test on staging first

### Business Risks
- **Feature Creep**: Stick to this document
- **Scope Expansion**: Say no to new features until post-MVP
- **Timeline Slip**: Daily progress checks

## Development Checklist

### Pre-Development
- [ ] Review this document with team
- [ ] Set up staging environment
- [ ] Confirm all API keys working

### Week 1 Deliverables
- [ ] All critical bugs fixed
- [ ] Quick wins implemented
- [ ] Testing on staging

### Week 2 Deliverables
- [ ] Simplifications complete
- [ ] Feature removals done
- [ ] Final testing

### Launch Checklist
- [ ] Production deployment
- [ ] Monitoring setup (Vercel)
- [ ] Beta user onboarding
- [ ] Support documentation

## Notes and Decisions

### Key Product Decisions Made
1. **10 campaigns** for free trial (not 5)
2. **Keep all 4 social platforms** (already built)
3. **Fix watermarks** (don't remove)
4. **Simplify voice training** (onboarding only)
5. **One page analytics** (remove subpages)
6. **Website scraping optional** (but recommended)
7. **Week view for queue** (new addition)
8. **Quick Post essential** (reactive content critical)

### Future Enhancement Ideas
- Advanced analytics dashboard
- Team collaboration
- Content approval workflow
- Multi-location support
- AI prompt customization
- Monitoring system
- 2FA security
- Export functionality

## Contact and Support

This MVP plan was created on 2025-08-21 for the CheersAI platform.
Target launch: 2 weeks from plan creation.
Target market: UK hospitality businesses (pubs, restaurants, bars).

---

*End of MVP Plan Document*
