# Spec: a campaign paused in Meta shows as paused

Owner approval: 23 October 2026, relayed by the chief of staff session ("6 yes", low priority). Peter paused the four Weekday food campaigns in Ads Manager on 9 October 2026, and CheersAI still showed them as Active.

## Problem
- `meta_campaigns` keeps two statuses:
  - `status` is the app's own view;
  - `meta_status` is what Meta last reported.
- The daily sync (`/api/cron/sync-meta-campaigns`, `src/lib/campaigns/performance-sync.ts`) writes `meta_status` and never `status`. A campaign paused or switched back on in Ads Manager therefore keeps its old `status` for good.
- What reads `status`:
  - the campaign page header and badge (`src/app/(app)/campaigns/[id]/page.tsx`), which still say "Active";
  - the campaign list (`src/features/campaigns/CampaignList.tsx`);
  - the Pause or Resume button;
  - the optimiser, which works only on campaigns whose `status` is ACTIVE.
- The dashboard already reads `meta_status` first, so it was right.
- Live on 23 October 2026: all four Weekday campaigns are `status` ACTIVE and `meta_status` PAUSED.

## Decision
- When the sync reads a campaign's status from Meta, the app's `status` follows it:
  - Meta PAUSED while the app says ACTIVE: the app's status becomes PAUSED;
  - Meta ACTIVE while the app says PAUSED: it becomes ACTIVE.
- Only a move between ACTIVE and PAUSED is followed. Anything else Meta reports (ARCHIVED, DELETED) stays in `meta_status` only, as now.
- The update applies only while the row still holds the status the sync read, so a pause or resume made in the app during the sync is never overwritten.
- Each change is logged. A failed write fails that campaign's sync, as a failed metrics write already does.
- Campaigns only. Ad sets and ads already show Meta's own status in their own column.
- The "Sync performance" button runs the same code, so it follows Meta too.
- No migration: `status` has no CHECK constraint and no trigger (checked live on 23 October 2026).

## What changes for Peter
- After the first sync following the deploy (06:00 UTC daily), the four Weekday campaigns show as Paused on their own pages and in the list.
- From then on, a campaign paused in Ads Manager shows as paused by the next morning, and the optimiser leaves it alone.

## Rollback
- Revert the PR. Statuses the sync changed stay as they are, and they match Meta.

## Tests
- A pause in Ads Manager is followed, conditional on the status that was read.
- A campaign switched back on is followed.
- No write when Meta agrees, or when Meta reports anything other than ACTIVE or PAUSED.
- A failed write fails the sync.
