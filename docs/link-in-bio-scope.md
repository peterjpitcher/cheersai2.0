# Link-in-Bio Page Scope

## Context
- Deliver a branded "link in bio" experience for The Anchor that consolidates evergreen venue actions and spotlights active campaigns.
- Page must feel consistent with https://www.the-anchor.pub while running inside the existing CheersAI Next.js app and Supabase stack.
- Campaign imagery and titles should deep-link to URLs provided during campaign creation and remain visible until midnight after the final scheduled post for that campaign.

## Discovery Highlights
- Campaigns are persisted in `public.campaigns` with JSON `metadata`; generated posts live in `public.content_items` with `content_variants` holding media IDs. No link-in-bio metadata exists today.
- Creation flows (instant, event, promotion, weekly) already capture an optional CTA URL (`ctaUrl`) and generate `prompt_context.slot` metadata for each content item.
- Media assets are stored in the `media` bucket and accessed via signed URLs; existing server code (e.g. planner and library modules) signs previews using the Supabase service client.
- Settings UI only manages brand voice and posting defaults; there is no place to configure public-facing venue links (phone, menu, bookings, etc.).
- All authenticated app surfaces sit under `/app/(app)/`; any public page must live outside that layout and fetch data with the service client or a dedicated public view because RLS is enabled.

## Goals
- Public page with permanent CTA buttons (call, WhatsApp, book table, menu, parking, Facebook, Instagram, website) and campaign cards that link to campaign-specific URLs.
- Campaign cards should auto-populate from Supabase data, prioritising Instagram creatives, and disappear after the campaign window elapses (midnight end-of-day in venue timezone).
- Operators can pin “always-on” tiles with bespoke image, title, and CTA targeting evergreen assets (e.g., live music, Sunday roast) that sit alongside the scheduled campaign highlights.
- Allow operators to set or edit the link-in-bio URL when creating a campaign and manage the permanent CTA destinations via settings.
- Preserve brand alignment with The Anchor’s site (palette, typography, logos/imagery) while keeping the component reusable for future venues.

## Non-Goals
- Tracking click analytics or conversion metrics.
- Implementing custom domains or deep Instagram integration beyond a shareable page URL.
- Automated ingestion of assets or colors directly from the the-anchor.pub site (manual theme inputs assumed for v1).

## Functional Requirements
### Public Link Page
- Route: expose `/l/[slug]` under the `cheersai.uk` host (e.g. `cheersai.uk/l/the-anchor`), rendered with a dedicated minimalist layout.
- Header: venue logo/hero image, venue name, short description/bio, optional opening hours.
- CTA button grid: render the mandatory actions; hide any button lacking configuration but preserve order.
- Evergreen tile row: display always-on tiles (operator managed) ahead of campaign cards; tiles honour configured image, title, and CTA and stay visible until manually retired.
- Accessibility: each button labelled for assistive tech; phone/WhatsApp use `tel:`/`https://wa.me/`; external links open in new tab with rel guards.

### Campaign Highlights
- Fetch campaigns tied to the account where `link_in_bio_url` is set during creation (campaigns without the field remain hidden).
- Determine campaign visibility window from the earliest and latest scheduled `content_items` (status in `scheduled`, `publishing`, `posted`); keep active until midnight (venue timezone) after the final scheduled timestamp.
- For each qualifying content item within the active window:
  - Select the first media asset (prefer derived square variant) and sign a URL.
  - Surface campaign name and, when available, `prompt_context.slot` or formatted scheduled date to differentiate multiple posts.
  - Link image and title to `link_in_bio_url`; include optional "View campaign" tertiary link if we need text accessibility.
- Sort cards by urgency (soonest end date first, then most recent scheduled time) so upcoming deadlines remain top-of-grid.

### Always-On Tiles
- Let operators create/edit/delete evergreen tiles comprising: title, optional subtitle, CTA label + URL, and hero image (select from existing media library assets).
- No hard limit on tile count; expand layout responsively.
- Tiles support manual ordering (drag-and-drop), defaulting to creation order; display ahead of scheduled campaigns on the public page.
- Provide toggle for temporarily disabling a tile without deleting it.

### Admin & Authoring
- Extend all campaign creation forms (instant, event, promotion, weekly) with an optional "Link in bio URL" field (URL validation, help copy describing usage).
- Persist the value to Supabase so the campaign retains a stable outbound link; allow editing post-creation via planner detail or new campaign settings modal.
- Add a "Link in bio" section under Settings for operators to manage:
  - Slug / vanity path (validated against permitted format, e.g. `the-anchor`).
  - Venue bio, hero media (from library or upload), accent colours, typography choice.
  - Permanent CTA destinations (phone, WhatsApp, booking URL, menu URL, parking URL, Facebook, Instagram, website) with inline validation.
  - Preview pane showing how the public page will render.
  - Always-on tile manager with tile CRUD, ordering controls, and asset picker.

## Data & Schema Changes
- `public.campaigns`: add nullable `link_in_bio_url text` column (and backfill migration copying any existing `metadata->>ctaUrl` if we decide to seed).
- New table `public.link_in_bio_profiles` (1:1 with account) containing slug, display name, bio, hero_media_id, theme JSON (colors, fonts), and the required CTA destination fields. Include timestamps and RLS policy allowing service role + account owners.
- Table `public.link_in_bio_tiles` (account scoped) capturing always-on entries: title, subtitle, cta_label, cta_url, media_asset_id, position, enabled flag, created/updated timestamps. Foreign-key to `link_in_bio_profiles` and `media_assets`.
- Optional: add `link_in_bio_active_after timestamptz`/`active_until` computed columns or view to simplify queries (otherwise derive in app code).

## API & Data Access
- Create `lib/link-in-bio/data.ts` to load profile + campaign data via the Supabase service client (server-only). Enforce slug→account lookup and guard against missing profile (return 404).
- Build helper to sign media URLs (mirroring `library` logic) and memoise per request to avoid redundant storage calls.
- Ensure RLS policies allow the service role to read campaigns/content/media for the specific account (existing service role bypass should suffice, but validate).
- Revalidate public page on campaign or profile updates (use `revalidateTag` or route segment revalidation triggered from relevant server actions).

## UI & Styling Notes
- Theme tokens: primary background `#005131`, secondary accent `#a57626`; ensure contrast meets accessibility (white logo requires solid green backdrop).
- Reuse Tailwind tokens where possible; extend config only if necessary for brand fonts.
- Use responsive layout: CTA grid collapses to 2-column on mobile, campaign cards display as masonry/stack with accessible hover states.
- Provide fallback illustrations when campaigns lack media (e.g., neutral card with campaign initials).

## Technical Considerations
- Caching: mark the public route as dynamic but leverage Next cache with revalidation triggers to balance freshness and performance.
- Timezone handling: rely on account timezone (from `posting_defaults`/`accounts`) via Luxon to compute midnight cut-off accurately (DST-safe).
- Error states: graceful messaging when no campaigns are active or profile incomplete; ensure non-configured CTAs degrade cleanly.
- Security: never expose Supabase service key client-side; keep signed URLs short-lived (≤10 minutes) and consider edge caching if traffic grows.
- Testing: add unit coverage for visibility window calculations and integration tests for data loader (Vitest + mocked Supabase) plus Playwright smoke test for page rendering.

## Dependencies & Assumptions
- Brand assets (logo, hero imagery, palette, typography references) will be supplied and stored in the repository for reuse.
- Campaigns generated through CheersAI will always attach at least one media asset when a link-in-bio URL is provided.
- Always-on tiles rely on the existing media library upload flow; no direct uploads within the tile editor.

## Next Steps
- Validate schema design with product/data owners and confirm brand asset availability.
- Draft Supabase migration scripts and RLS policies for `link_in_bio_profiles` and `campaigns.link_in_bio_url`.
- Produce Figma mock aligned with the-anchor.pub branding and iterate with stakeholders.
- Plan implementation phases: settings/admin work, data loaders, public page UI, revalidation hooks, QA & rollout.
