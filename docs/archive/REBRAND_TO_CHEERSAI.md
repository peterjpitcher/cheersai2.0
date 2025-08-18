# 🎉 Rebranding: CheersAI Complete

## Files to Update

### Core Application Files
1. **package.json** - Change name, description
2. **package-lock.json** - Update name references
3. **README.md** - Update all references
4. **app/layout.tsx** - Update metadata, title, description
5. **public/manifest.json** - Update PWA name and short_name
6. **public/robots.txt** - Update sitemap URL
7. **public/sitemap.xml** - Update domain references
8. **middleware.ts** - Update any references in comments

### Environment & Config
9. **.env.local** - Update NEXT_PUBLIC_APP_URL if needed
10. **lib/stripe/config.ts** - Update product names
11. **lib/email/resend.ts** - Update from email domain

### Pages & Components
12. **app/page.tsx** - Landing page branding
13. **app/auth/login/page.tsx** - Update branding
14. **app/auth/layout.tsx** - Update title
15. **app/dashboard/layout.tsx** - Update branding
16. **app/dashboard/page.tsx** - Update welcome messages
17. **app/campaigns/layout.tsx** - Update title
18. **app/pricing/layout.tsx** - Update title
19. **app/settings/layout.tsx** - Update title
20. **app/settings/page.tsx** - Update app name references
21. **app/settings/connections/page.tsx** - Update references
22. **app/billing/page.tsx** - Update product names
23. **app/not-found.tsx** - Update branding
24. **app/global-error.tsx** - Update branding
25. **components/trial-banner.tsx** - Update branding
26. **components/seo/meta-tags.tsx** - Update defaults
27. **components/pwa/pwa-init.tsx** - Update PWA name

### API Routes
28. **app/api/auth/2fa/setup/route.ts** - Update issuer name
29. **app/api/team/invite/route.ts** - Update email templates
30. **app/api/export/analytics/route.ts** - Update export headers
31. **app/api/analyze-website/route.ts** - Update user agent

### Documentation
32. **DATABASE_SETUP.md** - Update references
33. **DATABASE_SETUP_GUIDE.md** - Update references
34. **SETUP_CHECKLIST.md** - Update references
35. **TRIAL_STRATEGY.md** - Update references
36. **IMPLEMENTATION_STATUS.md** - Update references
37. **FINAL_STATUS.md** - Update references
38. **COMPLETE_IMPLEMENTATION_STATUS.md** - Update references
39. **docs/BRAND_STYLE_GUIDE.md** - Complete rebrand
40. **docs/IMPLEMENTATION_PLAN.md** - Update references
41. **docs/PRD_IMPROVED.md** - Update product name

### Scripts & Setup
42. **setup.sh** - Update references
43. **scripts/setup-database.js** - Update comments
44. **scripts/verify-database.ts** - Update comments
45. **run-all-migrations.sql** - Update comments

### Service Worker
46. **public/service-worker.js** - Update cache names

## Brand Identity Updates
- **Name**: CheersAI
- **Tagline**: "AI-Powered Social Media for Hospitality"
- **Domain**: cheersai.com (to be configured)
- **Support Email**: support@cheersai.com
- **From Email**: hello@cheersai.com

## Logo Requirements
- Need logo file (SVG preferred)
- Favicon (favicon.ico, 32x32)
- Apple touch icon (180x180)
- OG image for social sharing (1200x630)