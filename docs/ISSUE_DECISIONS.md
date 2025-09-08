# GitHub Issues - MVP Decisions Tracker
> Note: Analytics-related decisions in this document are historical; the Analytics feature was removed from the product.
*Last Updated: 2025-08-21*

## Overview
This document tracks the final decisions made for each GitHub issue during MVP planning.

## High Priority Issues

### Issue #80, #95 - Watermark positioning off image
**Decision**: FIX
- Must fix before launch
- Implement dynamic container size detection
- 4 hours estimated

### Issue #82 - Voice settings 404
**Decision**: SIMPLIFY
- Remove from settings entirely
- Move to onboarding only
- Keep website scraping but make optional

### Issue #83 - Remove locations page
**Decision**: REMOVE
- Each location needs own account
- Remove completely from app

### Issue #85 - 2FA verification
**Decision**: REMOVE FOR MVP
- Too much friction for MVP
- Can add post-launch

### Issue #87 - Team settings 404
**Decision**: REMOVE FOR MVP
- Single user accounts only for MVP
- Remove team management entirely

### Issue #88 - Welcome message shows "User"
**Decision**: FIX
- Add first_name to query
- Critical for personalization

### Issue #89 - Quick Post button broken
**Decision**: FIX
- Essential for reactive content
- Simple import fix needed

### Issue #93 - Publishing queue 404
**Decision**: FIX
- Move from backup folder
- Add week view as enhancement

### Issue #98 - Analytics not showing data
**Decision**: SIMPLIFY
- One page with 5 key metrics only
- May just need data to exist first

## Medium Priority Issues

### Issue #81 - Duplicate navigation in settings
**Decision**: FIX
- Quick win, remove duplicates

### Issue #84 - Smart Recommendations no feedback
**Decision**: FIX
- Add toast notification
- Quick win

### Issue #86 - Notifications functionality
**Decision**: SIMPLIFY
- Email only on failure
- Remove all preferences

### Issue #90 - Campaign categories
**Decision**: KEEP AS-IS
- Categories affect AI generation
- Working adequately for MVP

### Issue #91 - No watermark in campaign upload
**Decision**: POSTPONE
- Can add post-MVP
- Not critical

### Issue #92 - Missing delete campaign on list
**Decision**: FIX WITH LIMITS
- Add delete button
- Track lifetime campaigns (10 max for trial)
- Cannot bypass by deleting

### Issue #94 - Campaign filters not working
**Decision**: FIX
- Simple searchParams implementation
- Quick win

### Issue #96 - Redundant page headers
**Decision**: POSTPONE
- Not critical for MVP
- Can redesign post-launch

### Issue #97 - Post edit modal issues
**Decision**: POSTPONE
- Polish issue, not critical
- Can improve post-MVP

### Issue #99-102 - Analytics subpages 404
**Decision**: REMOVE
- No subpages needed
- One simple analytics page only

### Issue #103 - Monitoring not showing stats
**Decision**: REMOVE
- Remove monitoring entirely
- Use Vercel Analytics

### Issue #104-107 - Monitoring subpages 404
**Decision**: REMOVE
- Remove all monitoring
- Not needed for MVP

### Issue #108 - Settings excessive headers
**Decision**: POSTPONE
- UX polish, not critical
- Can fix with #96 post-MVP

## Summary of MVP Approach

### FIXING (Must have for launch)
- Watermark positioning (#80, #95)
- Quick Post button (#89)
- Publishing queue (#93)
- Welcome message (#88)
- Campaign deletion with limits (#92)
- Campaign filters (#94)
- Remove locations (#83)
- Toast notifications (#84)
- Remove duplicate nav (#81)

### SIMPLIFYING
- Analytics - one page, 5 metrics (#98, #99-102)
- Voice training - onboarding only (#82)
- Notifications - email only (#86)
- Publishing queue - add week view

### REMOVING
- All monitoring (#103-107)
- Team management (#87)
- 2FA authentication (#85)
- GDPR export (keep delete only)
- Analytics subpages (#99-102)
- Admin AI prompts
- Content approval

### POSTPONING
- Header redesign (#96, #108)
- Post edit modal polish (#97)
- Watermark in campaigns (#91)
- Enhanced analytics
- Complex features

## Timeline

### Week 1 (2-3 days actual work)
- All critical fixes
- Quick wins
- Remove unnecessary features

### Week 2 (3-4 days actual work)
- Simplifications
- Testing
- Documentation

### Total: ~2 weeks to MVP launch

## Notes

- **Campaign Limit**: Changed from 5 to 10 for free trial
- **Analytics**: Research showed 5 key metrics for hospitality
- **Publishing Queue**: Adding week view per request
- **Website Scraping**: Optional but strongly recommended
- **Social Platforms**: Keeping 3 (FB, IG, X) — LinkedIn removed
- **Quick Post**: Essential for reactive content (daily specials, etc.)

---

*This document represents final decisions made during MVP planning session on 2025-08-21*
