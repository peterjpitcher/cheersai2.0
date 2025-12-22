# Link-in-Bio Implementation Plan

## Overview
Deliver a fully branded "link in bio" experience (`cheersai.uk/l/[slug]`) for The Anchor, including:
- Account-scoped profile configuration (theme, CTAs, evergreen tiles).
- Campaign surfacing that honours urgency and only shows entries with a link-in-bio URL.
- Always-on tiles backed by media library assets.

## Prerequisites
- Brand assets placed under `cheersai-app/public/brands/the-anchor/`:
  - `logo.png` (white mark, assumes green background `#005131`), `hero.jpg` (2400×1600 recommended), optional `texture.jpg` / `palette.json`.
- Confirm final slug (`the-anchor`) and production hostname `cheersai.uk` routing.
- Ensure Supabase service role credentials available in target environments.

## Phase 1 – Data Model & Migrations
1. Create migration adding `link_in_bio_url text` to `public.campaigns` (nullable, indexed) and backfill from `metadata->>'ctaUrl'` where applicable.
2. Create `public.link_in_bio_profiles` table:
   - Columns: `account_id` (PK, FK `accounts`), `slug`, `display_name`, `bio`, `hero_media_id` (FK `media_assets`), `theme jsonb`, CTA URL fields, timestamps.
   - Unique index on `slug`.
3. Create `public.link_in_bio_tiles` table:
   - Columns: `id` (uuid PK), `account_id` FK, `title`, `subtitle`, `cta_label`, `cta_url`, `media_asset_id`, `position int`, `enabled boolean`, timestamps.
4. Write RLS policies:
   - Owners (`auth.uid()`) can `select/insert/update/delete` on their account rows.
   - Service role bypass (security definer functions or `auth.role() = 'service_role'`).
5. Seed default profile row for the Anchor account via post-deploy script.

## Phase 2 – Server Data Layer
1. Add `src/lib/link-in-bio/profile.ts`:
   - Fetch profile, tiles, permanent CTA config using service client.
   - Provide helpers to upsert profile and tiles (with validation for URLs and CTA labels).
2. Add `src/lib/link-in-bio/public.ts`:
   - Resolve slug→account, fetch active campaigns (status filter), compute visibility windows using Luxon in account timezone.
   - Sign media URLs once per request (reuse library helper).
   - Sort campaigns by `(endTime asc, scheduledFor desc)`.
3. Tag revalidation triggers (e.g., `revalidateTag('link-in-bio:accountId')`) for profile updates, tile updates, campaign creation.

## Phase 3 – Settings UI & Admin
1. Introduce settings route section: `src/app/(app)/settings/link-in-bio/page.tsx` (server loader) + client component in `src/features/settings/link-in-bio/`.
2. Forms:
   - Profile form: slug, bio, hero asset picker, theme controls, CTA URLs (with masks for `tel:` / `https://wa.me/`).
   - Tiles manager: list with drag-and-drop ordering (`@dnd-kit` already in repo? If not, lightweight reorder control), create/edit modal referencing media library picker.
3. Server actions for profile + tile CRUD in `src/app/(app)/settings/link-in-bio/actions.ts` calling data layer and revalidating tags.
4. Update navigation to include new settings section anchor (accordion or tab).

## Phase 4 – Campaign Authoring Updates
1. Extend `link_in_bio_url` field across create forms:
   - Update schemas (`src/lib/create/schema.ts`) and TypeScript types.
   - Surface new input component with helper copy.
   - Persist value via existing server actions -> service layer storing field in `campaigns.link_in_bio_url` and metadata (for backwards compatibility).
2. Planner detail/editor: allow updating link field (likely modal or inline field) to maintain campaigns created pre-feature.
3. Ensure `createCampaignFromPlans` includes new column when writing campaign row.

## Phase 5 – Public Link Page
1. Add route `src/app/(public)/l/[slug]/page.tsx` with layout `src/app/(public)/layout.tsx` (minimal shell, no app nav).
2. Server loader uses `link-in-bio/public.ts` to fetch profile, tiles, campaigns; handle 404 when profile missing.
3. UI components under `src/features/link-in-bio/public/`:
   - `Header` (logo, hero, bio), `CTAButtons`, `TilesCarousel` (always-on), `CampaignGrid`.
   - Responsive Tailwind classes consistent with brand tokens (extend Tailwind config if new colors needed).
4. Handle fallback states: empty campaigns (show always-on tiles only), empty tiles (skip section).
5. Hook up metadata for SEO + OpenGraph using profile data.

## Phase 6 – Testing & QA
1. Unit tests (Vitest):
   - Visibility window calc, sorting logic, slug validation, tile ordering persistence.
2. Integration tests (Vitest + Supabase mock):
   - Loading profile, campaigns, and tiles returns expected structures.
3. Playwright smoke tests:
   - Public page renders with CTAs, tiles, campaigns; links point to correct URLs.
   - Settings forms allow CRUD and reflect changes.
4. Manual QA checklist covering timezone edge cases, signed URL expiry, reorder actions, link validation.

## Deployment & Ops
- Roll out migrations with supabase CLI (include rollback scripts).
- After deploy, run seed script to populate Anchor profile and import brand assets to storage if needed.
- Verify `cheersai.uk` domain routing to Next.js app and configure rewrite for `/l/:slug`.
- Monitor logs for Supabase policy errors; add alert for failed revalidation/logging.

## Risks & Mitigations
- **Slug collisions**: enforce unique constraint + friendly error in UI.
- **Signed URL expiry**: set to 10 min; page request re-fetches data so minimal risk.
- **Tile sprawl**: no hard limit; ensure UI handles large counts (paginate or collapse if performance degrades).
- **Timezones**: rely on Luxon, add tests around DST transitions.

## Timeline (Indicative)
1. Phase 1: 1.5 days (schema, migrations, RLS, seed).
2. Phase 2: 1 day (data layer, revalidation plumbing).
3. Phase 3: 2 days (settings UI + tile manager).
4. Phase 4: 1 day (create flows + planner updates).
5. Phase 5: 1.5 days (public page build + styling).
6. Phase 6: 1 day (tests, QA, docs).

Total: ~8 days engineering effort (single dev), adjust for review cycles and asset turnaround.
