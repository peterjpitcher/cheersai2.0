# SPEC: Default event venue per brand

Status: approved by the owner in chat on 22 September 2026 ("each brand gets its own default").
Complexity 4 (7+ files, one additive column with a one-row backfill), so two stacked PRs.

## What changes

The create wizard pre-fills a new event's venue with "The Anchor, Stanwell Moor Village" for every
brand (`DEFAULT_EVENT_VENUE` in `src/features/create/create-wizard.tsx`), and the venue field's
placeholder names The Anchor too. That text goes into the AI brief as `Venue:`, so another brand's
event posts would name The Anchor unless someone edits it.

Each brand gets a **Default event venue** in Settings, Posting defaults. The wizard pre-fills the
venue from it, and leaves the venue blank when it is not set. The placeholder becomes neutral.

## Design

**Storage.** New nullable column `public.posting_defaults.default_event_venue text`, at most 200
characters (the event brief's `venue` limit). Null means no default.

**Backfill.** The migration sets The Anchor's value to "The Anchor, Stanwell Moor Village", today's
hardcoded default, so The Anchor's events pre-fill exactly as before. It matches the brand by
`accounts.business_name = 'The Anchor'` (no hardcoded ids) and only where the value is still null,
so it is safe to re-run and a no-op on a fresh database.

**Settings (PR 1).** Posting defaults form gains the field; zod trims it and caps it at 200;
`updatePostingDefaults` stores blank as null; `getOwnerSettings` maps it to
`posting.defaultEventVenue`; `getCreateModalData` returns it to the wizard.

**Wizard (PR 2).** The event type's default venue comes from `defaultEventVenue` (blank when unset);
the hardcoded constant and the Anchor placeholder go.

## Deploy order and rollback

1. Apply migration `20260922140000_posting_defaults_default_event_venue.sql` to production first:
   the Settings loader selects the new column.
2. Merge PR 1, then PR 2.

Rollback: revert PR 2 (the hardcoded default returns), then PR 1. Dropping the column needs the
owner's approval because it discards entered text.

## Tests

Schema trimming and the 200 limit; save action stores blank as null; loader and create-modal data
map the value; wizard pre-fills the venue from the brand default and leaves it blank without one.
Both time zones, lint, typecheck and build.
