# SPEC: optimiser copy rewrites must never publish internal text

Date: 22 September 2026. Status: Pieces 1 and 2 on `fix/optimiser-rewrite-copy`, Piece 3 on `feat/optimiser-controlled-test-guard` (stacked); owner approved shipping both, applying the migration and flagging the four Weekday campaigns.

## Problem

The conversion-first optimiser's copy rewrite put internal text into a live, public Meta ad.

- `buildBookingFocusedCopy` in `src/lib/campaigns/optimisation.ts` builds the subject from
  `snapshot.eventName ?? campaign.name`. Evergreen campaigns have no `eventName`, so the subject is
  `meta_campaigns.name`, an internal label.
- The detail line is the first sentence of `problem_brief`, which holds operator notes, not public
  copy: "(new since 1 September 2026)", "This is a message test with three ads", and on imported
  events "Here's the updated brief:".
- On 22 September at 04:36 BST a rewrite was applied through `applyOptimisationRecommendation`
  (`src/app/(app)/campaigns/actions.ts`). It created Meta ad 120246219010320609, ACTIVE at once,
  headline "Book Weekday Lunch A (cod and chips)". Meta moved the ad set's delivery onto the new ad
  within hours, which breaks the running message test.
- Apply trusts whatever proposal is stored, creates the ad ACTIVE, and records nobody.
- A read-only check on 22 September found 22 more `planned` copy_rewrite rows across the four
  "Weekday ..." campaigns. Each stores proposed copy from the old code, so fixing the generator
  alone would not stop them.

## What changes

### Piece 1: safe copy (no schema change)

- New pure module `src/lib/campaigns/rewrite-copy.ts` with `findRewriteCopyProblems()`. A proposal
  fails when it:
  - contains the internal campaign name (full name, the part before any `|`, or the 36-character
    cut the old code used), unless those exact words are the imported event name;
  - uses a banned phrase from `tasks/ADS-PLAYBOOK-the-anchor.md` section 5, the optimiser's generic
    urgency list, or "walk-ins welcome";
  - contains a raw URL or an ISO date;
  - has an empty headline or primary text, or breaks the Meta limits the Apply path already uses
    (headline 40, primary text 300, description 25 characters).
- `buildBookingFocusedCopy` returns nothing when there is no safe proposal, and no recommendation
  is recorded:
  - Event campaigns: subject is `source_snapshot.eventName` only; the detail comes from the imported
    facts (date, time, price, pay on arrival). `problem_brief` is no longer used.
  - Evergreen and every other kind: built from the ad's own headline and primary text, which the
    owner already approved and published. The headline is kept and must state a concrete fact
    (the playbook rule, checked with `headlineStatesAConcreteFact`). Sentences with walk-in wording,
    banned phrases or URLs are dropped, and "Book your table online and we'll have it ready for
    you." is added when no booking wording is left. If nothing would change, there is nothing to
    test, so no recommendation.
  - The result must pass `findRewriteCopyProblems()`.
- Apply re-checks the stored proposal with the same rules before touching Meta. A failing proposal
  is marked `skipped` with the reason, and the owner sees why.
- The dashboard and the campaign page show the reason instead of the approve button for a failing
  proposal.

### Piece 2: Apply creates a paused ad and records who (no schema change)

- The replacement ad is created PAUSED on Meta and saved as PAUSED locally.
- New server action `activateOptimisationReplacementAd(actionId)` and a "Switch on replacement ad"
  button, so the owner can check the paused ad and then start it from the app (performance sync
  only copies `meta_status`, so an ad started in Ads Manager would stay PAUSED to the optimiser).
- Who acted is written to `audit_log.user_id`, with `resource_type = 'meta_optimisation_action'`
  and `resource_id` = the action id:
  - `optimisation_rewrite_apply_attempt` before anything is sent to Meta. If this row cannot be
    written, Apply stops (fails closed);
  - `optimisation_rewrite_applied` or `optimisation_rewrite_apply_failed` afterwards;
  - `optimisation_replacement_activated` when the replacement is switched on (written before the
    Meta call, fails closed).
  `audit_log` already has `user_id` and no check constraint on `operation_type` (live schema,
  checked 22 September).
- Button text: "Create paused replacement"; afterwards "Replacement ad created paused. Check it,
  then switch it on."

### Piece 3: per-campaign controlled-test guard (schema change)

- Migration `20260922160000_meta_campaigns_controlled_test.sql` adds
  `meta_campaigns.controlled_test boolean not null default false`.
- The optimiser records no copy rewrites for a controlled-test campaign.
- Apply and Switch on refuse for a controlled-test campaign.
- A toggle on the campaign page, server action `setCampaignControlledTest(campaignId, enabled)`.
- Every read of the flag selects `*`, so the code runs the same before the migration (flag reads
  as off, which is today's behaviour) and the toggle is hidden until the column exists.

## Decisions and assumptions

1. `problem_brief` is not used in any rewrite, for any campaign kind: it is operator notes.
2. Evergreen rewrites never invent a subject. No concrete headline, or nothing to fix, means no
   recommendation.
3. Only the imported event name counts as public, so an event whose campaign is named after it
   still gets rewrites. The ad's own copy does not count: the leaked ad itself would otherwise
   make the campaign name look public. The cost is that an evergreen campaign named with ordinary
   words that also appear in its ads (say "Sunday Roast") gets no rewrites; that is the safe side.
4. The 22 existing planned rows stay in the database. They are blocked at Apply and shown as
   blocked; nothing in production is edited by this change.
5. Who applied lives in `audit_log`, not a new column.
6. Pause recommendations are not affected by the controlled-test flag: they are advisory and the app
   cannot apply them.

## Not in scope

- The live ad 120246219010320609: pausing or removing it is the owner's decision.
- Replacement ads link to the bare `destination_url` with no per-ad `utm_content`, so bookings
  cannot be credited to them. Separate task.
- Deleting or rewriting the planned rows.

## Deployment

- Pieces 1 and 2 have no schema change and can deploy on their own.
- Piece 3 is on its own branch, `feat/optimiser-controlled-test-guard`, stacked on Pieces 1 and 2.
  Its code works with or without the migration, so there is no hard order, but the guard does
  nothing until the migration is applied to `cheersai2.0`. Update `supabase/SCHEMA.md` once it is.
- After Piece 3 is live, the owner decides whether to flag the four Weekday campaigns.

## Rollback

- Pieces 1 and 2: revert the commits. No data to undo; any replacement created paused stays paused.
- Piece 3: revert the code. The column is harmless if left; dropping it
  (`alter table public.meta_campaigns drop column if exists controlled_test;`) needs the owner's
  approval.

## Tests

- Evergreen and event campaigns: the campaign name never appears in the proposed headline or primary
  text; a proposal is still made where one is safe.
- Evergreen: no recommendation when the headline is not concrete or nothing would change.
- `findRewriteCopyProblems`: the exact 22 September copy fails; public event names pass.
- Apply: a stored proposal containing the campaign name is skipped and Meta is never called; a safe
  one creates the Meta ad PAUSED and writes audit rows with the user id; a failed audit write stops
  Apply before Meta.
- Switch on: activates a paused replacement and records the user.
- Controlled test: no rewrites recorded; Apply and Switch on refuse.
- `npm run ci:verify`.
