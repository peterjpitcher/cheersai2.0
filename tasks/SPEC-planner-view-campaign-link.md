# SPEC: remove the wrong "View campaign" link from planner post detail

## What changes

The "Belongs to" card on `/planner/[contentId]` no longer shows a "View campaign" button. It still shows the campaign name (or "Instant post"). The card moves to `src/features/planner/belongs-to-card.tsx` so it can be unit-tested.

## Why

`detail.campaign` is a row from the v1 content `campaigns` table, but the link pointed at `/campaigns/[id]`, the paid Meta campaigns page, which reads `meta_campaigns`. Content campaign ids never match a paid campaign, so the link opened a not-found page (and a 404 for brands without paid ads once per-brand gating lands). No page for content campaigns exists (no route, no planner filter by campaign), so there is no correct destination; the link is removed rather than repointed.

## Decisions

- Remove, not repoint. If a content-campaign page is built later, add the link back to that page.
- Paid-ads gating is untouched.

## Rollback

Revert the commit. No schema, env or data changes.
