# Feature Research

**Domain:** AI-powered social media management for hospitality venues
**Researched:** 2026-05-18
**Confidence:** HIGH (cross-referenced PROJECT.md requirements against 8+ competitor platforms and official API docs)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these means the product feels incomplete and users leave for Buffer/Later.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multi-platform publishing (FB, IG, GBP) | Every competitor supports at least 3 platforms. Owners will not use separate tools per platform. | HIGH | Each platform has different API constraints, rate limits, and content formats. GBP has Event/Offer/Standard post types. IG carousels limited to 10 items. |
| Content calendar with drag-and-drop | Buffer, Later, Hootsuite all have visual calendars. Owners need to see their week/month at a glance. | MEDIUM | Week and month views minimum. Drag to reschedule. Colour-coded by content type or platform. |
| Post scheduling (queue and calendar) | Fundamental feature of every social media tool. Manual posting is the pain point CheersAI solves. | MEDIUM | Must support exact-time scheduling and queue-based ("next available slot") scheduling. |
| AI content generation | In 2026, every major platform (Hootsuite OwlyWriter, Buffer AI Assistant, SocialBee Copilot) has AI writing. Users expect it. | MEDIUM | Generate platform-specific copy from a single brief. Must handle tone, length, CTA, and hashtag generation. |
| Platform-specific previews | Later and Buffer show exactly how posts appear on each platform before publishing. Prevents surprises. | MEDIUM | Must render IG feed post, IG story, FB post, and GBP post previews accurately. Aspect ratio and character limits enforced. |
| Media upload and storage | Cannot publish without images. Every tool has basic media handling. | MEDIUM | Support JPEG, PNG, GIF minimum. Image validation against platform size limits. Supabase Storage for persistence. |
| Post status tracking | Users need to know: scheduled, published, failed. Every competitor shows this. | LOW | Status badges on calendar items. Real-time updates via Supabase Realtime per PROJECT.md decision. |
| Authentication and account security | Non-negotiable for any SaaS. Magic link + password per PROJECT.md decisions. | HIGH | Supabase Auth, middleware guards, encrypted OAuth tokens for social platforms (AES-256-GCM per PROJECT.md). |
| Social account connection (OAuth) | Must connect FB pages, IG business accounts, GBP locations. Every competitor has this. | HIGH | OAuth flows for each platform. Token refresh logic. HMAC state validation. Token health monitoring. |
| Mobile-responsive design | 60%+ of SMB owners manage social from phones. Buffer and Later are mobile-first. | MEDIUM | Bottom nav (5 items, 64px per PROJECT.md). Touch targets 44px minimum. Responsive from 320px up. |
| Publish failure handling | Posts fail (expired tokens, API errors, rate limits). Users need to know why and how to fix it. | MEDIUM | Plain-English error messages. Retry button. Auto-retry with backoff (5m/15m/45m/4 attempts per PROJECT.md). |
| Basic analytics (per-post performance) | Sprout, Buffer, Hootsuite all show likes/comments/reach per post. Owners need to know what works. | MEDIUM | Engagement rate, reach, impressions per post. Platform comparison view. |

### Differentiators (Competitive Advantage)

Features that set CheersAI apart from generic tools like Buffer or Later. These target the hospitality-specific gap.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Hospitality content types (Events, Promotions, Weekly Recurring, Stories) | Generic tools treat all posts the same. CheersAI understands that a "Quiz Night" is an event, a "2-for-1 cocktails" is a promotion, and "Sunday Roast" recurs weekly. Structured content types mean smarter AI generation and correct GBP post types (Event/Offer/Standard). | HIGH | Five content flows per PROJECT.md: Instant Post, Stories, Event, Promotion, Weekly Recurring. Each maps to specific platform post types. |
| AI with fine-tune controls (tone, length, CTA, proof-points) | Generic AI tools generate bland copy. Hospitality owners need "friendly pub voice" not "corporate marketing speak". Exposed controls let owners dial in their venue's personality. | MEDIUM | Tone slider, length control, CTA selection, proof-point injection. Regenerate-with-modifier after initial generation. |
| GBP Event and Offer post types | Most social tools only publish standard GBP posts. CheersAI publishes proper Event posts (with date ranges) and Offer posts (with voucher codes and terms). GBP Events stay active for the full event window rather than expiring after 7 days. | MEDIUM | Uses GBP LocalPosts API. Event posts get date range fields. Offer posts get voucher code and terms fields. Significant SEO/visibility advantage for venues. |
| Conflict detection in scheduling | Hospitality venues cannot double-book their social calendar (two events on the same night confuse customers). Generic tools do not check for this. | MEDIUM | Surface conflicts in scheduling UI. Detect overlapping events. Warn when a promotion overlaps an event on the same platform. |
| Weekly recurring with auto-publish | "Fish & Chip Friday" runs every week. Approve once, publish forever. Generic tools require re-scheduling each week. | MEDIUM | Materialise recurring events into individual posts. Auto-publish after initial approval. Editable per-instance. |
| Link-in-bio page (built-in) | Eliminates need for separate Linktree subscription. Hospitality venues need: menu link, booking link, phone, map, and event tiles. Up to 12 custom tiles with drag-reorder. | MEDIUM | Branded profile page. Contact links. Custom tiles. Server-side analytics only (no third-party tracking per PROJECT.md). Faster load than Linktree (target <0.5s). |
| Preflight checks with actionable CTAs | Before publishing, validate: image dimensions, character limits, token health, scheduling conflicts. Show errors in plain English ("Your image is too small for Instagram. Tap here to crop it.") | MEDIUM | `preflight.ts` validates all platform constraints. Errors surfaced in UI with fix-it buttons. Blocks publish until resolved. |
| Instagram Stories as first-class content | Many schedulers treat Stories as an afterthought. For hospitality, Stories are primary (daily specials, behind-the-scenes). CheersAI treats Stories as a named content type with its own creation flow. | MEDIUM | Note: Instagram API does not reliably support Story publishing via API. May need notification-based workflow (send push to owner's phone to post). Research this constraint carefully. |
| Activity feed with real-time updates | Sprout and Hootsuite have activity feeds but use polling. CheersAI uses Supabase Realtime for instant status updates. Owner sees "Published to Facebook" appear live without refreshing. | LOW | Supabase Realtime subscription. No polling overhead. Instant feedback on publish pipeline progress. |
| Bulk approve workflow | Owners batch-create content then want to approve it all at once. "Select individually" plus "approve all" covers both careful and fast workflows. | LOW | Multi-select UI. "Approve All Visible" button. Individual checkboxes. Minimal extra backend work. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems for a hospitality-focused SMB tool. Deliberately excluding these.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Social listening / brand monitoring | Enterprise tools like Sprout Social ($199/seat/mo) offer this. Looks impressive. | Massive scope increase. Requires real-time data ingestion across platforms. Single-venue hospitality owners do not need to monitor brand mentions at scale. Cost-to-value ratio is terrible for SMBs. | Link to native platform notifications. Owners already check their FB/IG notifications directly. |
| Unified social inbox (DMs + comments) | Hootsuite and Sprout Social have this. Seems like a natural extension. | Requires persistent webhook connections to each platform. Comment/DM APIs have strict rate limits and approval requirements. Adds massive complexity for a single-user-per-account product. | Focus on publishing excellence. DM management is a different product. Owners handle replies in native apps where they already get push notifications. |
| Video post publishing | Video is dominant on social media. Users will ask for it. | Storage costs, transcoding pipeline, and bandwidth make this expensive at SMB price points. Instagram Reels require embedded audio (cannot add music via API). Facebook video has its own upload pipeline. PROJECT.md explicitly defers this. | Support image and carousel first. Video is a future milestone after validating core product. |
| Multi-timezone support | Some owners may operate venues in different timezones. | All current users are UK-based. Multi-timezone adds complexity to scheduling engine, conflict detection, and recurring event materialisation. PROJECT.md hardcodes Europe/London. | Hardcode Europe/London. Revisit only if user base expands internationally. |
| TikTok / X (Twitter) / LinkedIn / Pinterest support | "Support all platforms" seems like table stakes. | Each platform adds OAuth flow, API integration, content format handling, and ongoing maintenance. Facebook + Instagram + GBP covers the three platforms that matter most for local hospitality venues. Adding TikTok alone would be weeks of work for uncertain ROI. | Ship with FB + IG + GBP. Add platforms only when user demand data justifies it. |
| Team collaboration / multi-user | Enterprise tools emphasise team workflows, approvals, and role-based access. | CheersAI serves single-venue owners who manage their own social media. Multi-user adds RBAC complexity, seat-based pricing logic, and collaboration UX. PROJECT.md specifies single-user per account. | Single-owner model. If demand emerges, add "delegate" role (one additional user) before full RBAC. |
| Ad management / boosted posts | Hootsuite includes social ad campaign management. Seems like a natural add. | Requires Meta Ads API integration, budget management, billing complexity, and ad performance reporting. Completely different product domain. | Focus on organic content. If owners want to boost, they do it natively on FB/IG where the workflow is already simple. |
| Download ZIP fallback for failed posts | When publishing fails, let users download the content to post manually. | Invests engineering in the failure path instead of fixing the success path. Normalises failures. PROJECT.md explicitly rejected this. | Better retry UX with plain-English root cause and one-tap retry. Invest in reliability, not workarounds. |
| Real-time chat / messaging | Could help with customer support, team coordination. | Completely outside the product's core value. Not related to social media management. PROJECT.md explicitly excludes this. | Not applicable. Different product entirely. |
| Native mobile app | "Build an app" is a common request. | Web-first responsive design covers mobile use cases. Native app doubles the codebase and deployment surface. PWA would add offline but with minimal value (social media management requires internet). | Responsive web design with mobile bottom nav. Revisit native only if specific mobile capabilities (camera integration, push notifications) become essential. |

## Feature Dependencies

```
[Auth + Social OAuth]
    |
    +--requires--> [Multi-platform Publishing]
    |                  |
    |                  +--requires--> [Content Calendar]
    |                  |                  |
    |                  |                  +--enhances--> [Conflict Detection]
    |                  |                  |
    |                  |                  +--enhances--> [Drag-and-drop Reschedule]
    |                  |
    |                  +--requires--> [Post Status Tracking]
    |                  |                  |
    |                  |                  +--enhances--> [Activity Feed (Realtime)]
    |                  |
    |                  +--requires--> [Preflight Checks]
    |                  |
    |                  +--requires--> [Publish Failure Handling + Retry]
    |                  |
    |                  +--enhances--> [Basic Analytics]
    |
    +--requires--> [Media Upload + Storage]
    |                  |
    |                  +--enhances--> [Media Library (search, tags, campaigns)]
    |
    +--requires--> [AI Content Generation]
                       |
                       +--enhances--> [Fine-tune Controls (tone, CTA, etc.)]
                       |
                       +--enhances--> [Regenerate with Modifier]

[Hospitality Content Types (Event, Promotion, Recurring, Story, Instant)]
    |
    +--requires--> [AI Content Generation] (templates per content type)
    |
    +--requires--> [Multi-platform Publishing] (type-to-post-type mapping)
    |
    +--requires--> [GBP Event/Offer Post Types] (Event -> GBP Event, Promotion -> GBP Offer)
    |
    +--enhances--> [Conflict Detection] (events cannot overlap)
    |
    +--enhances--> [Weekly Recurring Auto-publish] (requires scheduling engine)

[Link-in-bio]
    |
    +--independent--> (can be built in parallel, only needs Auth)
    |
    +--enhances--> [Analytics] (click tracking on link-in-bio tiles)

[Bulk Approve]
    |
    +--requires--> [Content Calendar] (needs list of pending posts to approve)
    |
    +--requires--> [Multi-platform Publishing] (approved posts go to publish queue)
```

### Dependency Notes

- **Auth + Social OAuth is the foundation:** Nothing works without authenticated users and connected social accounts. Must be Phase 1.
- **Multi-platform publishing is the critical path:** Calendar, status tracking, preflight, analytics, and content types all depend on the ability to actually publish.
- **AI content generation is independent of publishing:** Can be built and tested before the publish pipeline exists. Good candidate for early phase.
- **Link-in-bio is fully independent:** Only needs Auth. Can be built in parallel with the main product or deferred without blocking anything.
- **Conflict detection enhances but does not block scheduling:** Can ship scheduling without conflict detection, then add it. But it should come before Weekly Recurring (which amplifies conflict risk).
- **GBP Event/Offer types require hospitality content types:** Must define the Event and Promotion content types before mapping them to GBP-specific post types.

## MVP Definition

### Launch With (v1)

Minimum viable product -- what an owner needs to replace manual social media posting.

- [ ] **Auth (magic link + password fallback)** -- cannot use the product without signing in
- [ ] **Social account OAuth (FB, IG, GBP)** -- cannot publish without connected accounts
- [ ] **Token health monitoring + refresh** -- silent token expiry is the #1 cause of "it stopped working"
- [ ] **AI content generation from brief** -- the core value proposition: describe what you want, AI writes it per platform
- [ ] **Five content types (Instant, Story, Event, Promotion, Weekly Recurring)** -- hospitality-specific structure is the key differentiator
- [ ] **Platform-specific previews** -- owners must see what they are publishing before it goes out
- [ ] **Content calendar (week + month view)** -- visual planning is expected by every user
- [ ] **Scheduling + publish pipeline** -- the core product: schedule now or later, publish reliably
- [ ] **GBP Event and Offer post types** -- major differentiator over generic tools
- [ ] **Preflight checks with plain-English errors** -- prevent failed publishes before they happen
- [ ] **Publish failure handling (retry + root cause)** -- when things fail, users must be able to fix it
- [ ] **Media upload** -- cannot publish without images
- [ ] **Mobile-responsive design** -- majority of owners will use this on their phones
- [ ] **Post status tracking** -- owners must know what happened to their posts
- [ ] **Basic analytics (per-post)** -- engagement rate and reach per post, so owners know what works

### Add After Validation (v1.x)

Features to add once the core publish loop is working and users are retained.

- [ ] **Conflict detection in scheduling UI** -- add when owners start using Events and Promotions heavily and overlap becomes a real problem
- [ ] **Weekly recurring auto-publish** -- add once the scheduling engine is proven reliable. Auto-publish without approval is risky if the publish pipeline has bugs
- [ ] **Bulk approve** -- add when owners have enough scheduled content that approving one-by-one is painful
- [ ] **Media library (search, tags, campaign filters)** -- add when owners have uploaded enough media that finding images becomes a problem
- [ ] **Activity feed with Supabase Realtime** -- add once the publish pipeline is stable. Real-time updates are a polish feature
- [ ] **AI fine-tune controls (tone, length, CTA, proof-points)** -- add once basic AI generation is validated. Start simple, add knobs later
- [ ] **Regenerate with modifier** -- add alongside fine-tune controls
- [ ] **Email alerts for failures and token expiry** -- add once the publish pipeline is live and failure patterns are understood
- [ ] **Instagram carousel support** -- add once single-image IG publishing is solid

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Link-in-bio page** -- valuable but independent. Does not contribute to the core publish loop. Build when core is stable
- [ ] **Advanced analytics (best day/time, content-type comparison, weekly summary)** -- needs sufficient data to be meaningful. Requires weeks of published content
- [ ] **GBP daily location metrics** -- depends on GBP Insights API which has its own complexity
- [ ] **Video post support** -- explicitly deferred in PROJECT.md. Revisit after image publishing is rock-solid
- [ ] **Additional platform support (TikTok, X)** -- only if user demand data justifies it
- [ ] **Drag-and-drop calendar reschedule** -- convenience feature; owners can delete and re-create initially

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Auth + social OAuth | HIGH | HIGH | P1 |
| AI content generation | HIGH | MEDIUM | P1 |
| Five hospitality content types | HIGH | HIGH | P1 |
| Content calendar | HIGH | MEDIUM | P1 |
| Scheduling + publish pipeline | HIGH | HIGH | P1 |
| Platform-specific previews | HIGH | MEDIUM | P1 |
| Preflight checks | HIGH | MEDIUM | P1 |
| Media upload | HIGH | LOW | P1 |
| Post status tracking | HIGH | LOW | P1 |
| Mobile-responsive design | HIGH | MEDIUM | P1 |
| Publish failure handling + retry | HIGH | MEDIUM | P1 |
| Token health monitoring | HIGH | MEDIUM | P1 |
| GBP Event/Offer post types | MEDIUM | MEDIUM | P1 |
| Basic analytics | MEDIUM | MEDIUM | P1 |
| Conflict detection | MEDIUM | MEDIUM | P2 |
| Weekly recurring auto-publish | MEDIUM | MEDIUM | P2 |
| Bulk approve | MEDIUM | LOW | P2 |
| AI fine-tune controls | MEDIUM | LOW | P2 |
| Activity feed (Realtime) | MEDIUM | LOW | P2 |
| Media library (search/tags) | MEDIUM | MEDIUM | P2 |
| Email alerts | MEDIUM | LOW | P2 |
| Instagram carousels | MEDIUM | MEDIUM | P2 |
| Regenerate with modifier | LOW | LOW | P2 |
| Link-in-bio | MEDIUM | MEDIUM | P3 |
| Advanced analytics | MEDIUM | HIGH | P3 |
| GBP location metrics | LOW | MEDIUM | P3 |
| Video posts | HIGH | HIGH | P3 (deferred) |
| Additional platforms | MEDIUM | HIGH | P3 (deferred) |

**Priority key:**
- P1: Must have for launch -- the product is unusable without these
- P2: Should have, add as soon as core is stable -- improves retention
- P3: Nice to have, future consideration -- build when product-market fit is proven

## Competitor Feature Analysis

| Feature | Buffer | Later | Hootsuite | Sprout Social | CheersAI Approach |
|---------|--------|-------|-----------|---------------|-------------------|
| AI content generation | AI Assistant (basic) | AI caption writer | OwlyWriter AI (advanced) | AI-assisted replies | AI with hospitality-specific tone controls and content-type templates |
| Platforms supported | 8+ (FB, IG, X, LinkedIn, TikTok, Pinterest, Threads, Bluesky) | 7+ (IG, FB, TikTok, Pinterest, LinkedIn, X, YouTube) | 10+ (all major) | 10+ (all major) | 3 (FB, IG, GBP) -- focused on what hospitality venues need |
| GBP support | Basic post only | No | Basic post only | Basic post only | Full: Standard, Event, and Offer post types |
| Content types | Generic post | Generic post | Generic post | Generic post | 5 hospitality types: Instant, Story, Event, Promotion, Weekly Recurring |
| Pricing | Free tier, $6/mo/channel | Free tier, $25/mo | $199/mo minimum | $199/seat/mo | SMB-friendly pricing (single-user, all platforms) |
| Social inbox | No | No | Yes (full) | Yes (full) | No -- deliberate omission, owners use native apps |
| Social listening | No | No | Yes | Yes (advanced) | No -- not needed for single-venue hospitality |
| Link-in-bio | No (separate tool) | Yes (built-in) | No | No | Yes (built-in, hospitality-focused tiles) |
| Conflict detection | No | No | No | No | Yes -- prevents double-booking events |
| Preflight checks | Basic (character limits) | Basic (image size) | Basic | Basic | Advanced: platform limits, token health, scheduling conflicts, plain-English errors |
| Recurring posts | No native support | No native support | No native support | No native support | Weekly Recurring with auto-publish after initial approval |
| Target user | Creators, small teams | Visual-first brands | Agencies, enterprise | Enterprise, mid-market | Single-venue hospitality owners |

## Key Research Insight: The Hospitality Gap

Generic social media tools (Buffer, Later, Hootsuite, Sprout) are built for marketers managing brands. None of them understand hospitality content semantics:

1. **No tool maps content to GBP Event/Offer post types.** They all publish "Standard" posts to GBP. CheersAI's type-aware publishing is a genuine differentiator with SEO implications (Events stay visible longer, Offers get distinct visual treatment in local search).

2. **No tool has conflict detection.** A pub posting "Live Jazz Friday" and "Quiz Night Friday" on the same date confuses customers. No generic tool catches this.

3. **No tool has recurring content with auto-publish.** "Fish & Chip Friday" every week is a real use case. Generic tools require manual re-scheduling.

4. **Pricing is the gap.** Hootsuite ($199/mo) and Sprout ($199/seat/mo) are absurdly expensive for a single pub owner. Buffer is affordable but lacks hospitality-specific features. CheersAI occupies the "affordable + hospitality-aware" position.

## Instagram Stories API Constraint (Research Flag)

**MEDIUM confidence.** Multiple sources conflict on whether the Instagram Content Publishing API supports Stories. Meta's official documentation states Stories are supported via the Content Publishing API as of late 2023, but several developer sources report limitations and unreliability. This needs deeper technical investigation during implementation. Fallback: notification-based workflow where CheersAI sends a push/notification to the owner's phone with the Story content ready to post manually in the Instagram app.

## Sources

- [Buffer: Best Social Media Management Tools 2026](https://buffer.com/resources/best-social-media-management-tools/)
- [Buffer: Social Media Scheduling Tools 2026](https://buffer.com/resources/social-media-scheduling-tools/)
- [Zapier: 9 Best AI Tools for Social Media Management 2026](https://zapier.com/blog/best-ai-social-media-management/)
- [Techno-Pulse: Best AI Social Media Management Tools 2026](https://www.techno-pulse.com/2026/03/best-ai-social-media-management-tools.html)
- [Sprout Social: Social Media Scheduling Tools 2026](https://sproutsocial.com/insights/social-media-scheduling-tools/)
- [Sprout Social Review 2026 (Research.com)](https://research.com/software/reviews/sprout-social)
- [Schedpilot: Best Social Media Management Tools for Restaurants 2026](https://schedpilot.com/best-social-media-management-tools-for-restaurants/)
- [Restaurant Velocity: GBP for Operators 2026](https://restaurantvelocity.com/blog/google-business-profile-restaurant/)
- [Meta: Instagram Content Publishing API](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- [Google: LocalPosts API (GBP)](https://developers.google.com/my-business/content/posts-data)
- [Hootsuite vs Buffer (Planable)](https://planable.io/blog/hootsuite-vs-buffer/)
- [Zernio: Social Media Management Platform Comparison 2026](https://zernio.com/blog/social-media-management-platform-comparison)
- [Jotform: Linktree Alternatives 2026](https://www.jotform.com/blog/linktree-alternatives/)
- [UniLink: Best Link in Bio Tools 2026](https://unil.ink/blog/best-link-in-bio-tools)

---
*Feature research for: AI-powered social media management for hospitality venues*
*Researched: 2026-05-18*
