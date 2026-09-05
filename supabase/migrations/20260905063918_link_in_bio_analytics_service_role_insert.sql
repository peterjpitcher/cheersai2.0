-- Restrict link-in-bio analytics INSERT to the service role.
--
-- NOT YET APPLIED. Written for the owner to push; nothing here has run against
-- production.
--
-- link_in_bio_clicks_service_insert and link_in_bio_page_views_service_insert
-- were created by 00000000000009_link_in_bio_reconcile.sql under the comment
-- "Service-role INSERT", but neither policy carries a TO clause, so both apply
-- to PUBLIC, and both check expressions are literally true. Combined with the
-- INSERT privilege anon holds from the default ACL, any holder of the
-- publishable key can insert click and page-view rows against any profile_id,
-- including one belonging to another tenant. The damage is corrupted analytics
-- for an arbitrary customer rather than a data read, because the matching
-- SELECT policies are already gated on the owning account. Recorded before this
-- migration as the two entries in ANON_POLICY_OPEN_ITEMS in
-- supabase/anon-access-allowlist.ts.
--
-- Verified before writing this migration: the only writer is
-- src/lib/link-in-bio/click-tracking.ts, a 'use server' module that already
-- inserts through tryCreateServiceSupabaseClient, the service-role client. It
-- has two callers. src/app/(public)/l/[slug]/page.tsx is a server component.
-- src/features/link-in-bio/public/click-tracker.tsx is a client component, but
-- it invokes the exported functions as server actions, so the insert still runs
-- on the server under the service role and never in the browser. No application
-- path loses access.
--
-- service_role also holds BYPASSRLS, so the TO clause is belt and braces: the
-- point of it is that anon and authenticated stop matching a permissive policy.
--
-- Rollback: drop the two policies recreated below and restore the originals,
-- FOR INSERT WITH CHECK (true) with no TO clause.

BEGIN;

DROP POLICY IF EXISTS "link_in_bio_clicks_service_insert" ON public.link_in_bio_clicks;

CREATE POLICY "link_in_bio_clicks_service_insert" ON public.link_in_bio_clicks
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "link_in_bio_page_views_service_insert" ON public.link_in_bio_page_views;

CREATE POLICY "link_in_bio_page_views_service_insert" ON public.link_in_bio_page_views
  FOR INSERT TO service_role WITH CHECK (true);

COMMIT;
