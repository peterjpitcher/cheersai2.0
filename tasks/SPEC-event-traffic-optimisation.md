# Event campaigns: back to traffic optimisation

Actioned 9 August 2026, from `OJ-The-Anchor.pub/tasks/meta-ads-change-brief-2026-08-08.md`.

## Why

Measured on link clicks (not the "clicks" column, which counts reactions and profile
clicks and hides the problem), campaigns created since 1 May 2026:

| Objective | Spend | Link clicks | Cost per link click | Cost per landing page view |
|---|---|---|---|---|
| `OUTCOME_TRAFFIC` | £68.69 | 473 | £0.145 | £0.245 |
| `OUTCOME_SALES` | £264.25 | 345 | £0.766 | £1.277 |

Conversion optimisation needs roughly 50 events per ad set per week to leave the learning
phase. One booking reached Meta through CAPI in three months, so the optimiser was bidding
blind. Revisit only when booking volume can feed it.

## What Meta does not allow

Neither half of the switch can be applied to a campaign that already exists:

- Campaign objective: *"Cannot update the objective of a campaign that has at least one
  advert set."*
- Ad set optimisation goal: moving to `LINK_CLICKS` forces a 1 day attribution window, and
  *"Attribution window update is no longer supported after ad set creation."*

Existing campaigns must therefore be rebuilt, not edited.

## Changes

1. **`media-plan.ts`**: `MIN_EVENT_BUDGET_PER_EXECUTION_PHASE` raised from 15 to 50. Each
   execution phase is a separate ad set with its own learning phase; at £15 a normal £45
   event split three ways. A £45 event now runs one ad set, and splitting needs £100.
2. **`campaigns/[id]/actions.ts`**: the publish preflight no longer blocks event campaigns
   when conversion optimisation is deliberately switched off. It still blocks when the pixel
   is missing or pointed at the wrong event (a misconfiguration, not a choice), and still
   blocks `food_booking`, which has no traffic fallback. Drafts already stored as
   `OUTCOME_SALES` are coerced to `OUTCOME_TRAFFIC` / `LINK_CLICKS` at publish time so they
   do not reach Meta asking for conversions with no pixel attached.
3. **`generate.ts`**: new hard `vague_headline` rule for event campaigns. A headline must
   state a price, a number, a date, or a distinctive word the brief itself used (host name,
   prize, theme). Rejects the four headlines named in the brief. `food_booking` is out of
   scope and keeps its own service rules.

## Turning conversion optimisation off

There is no UI toggle. It is one field, and it must not be flipped before change 2 is
deployed or every event campaign becomes unpublishable:

```sql
update meta_ad_accounts set conversion_optimisation_enabled = false
where account_id = '91fda684-2801-4abb-980e-f42cec017cef';
```

Re-enable by setting it back to `true`, or by re-saving the pixel settings in Connections.
The pixel and the Purchase event stay configured either way, so CAPI reporting continues.

## Live campaign rebuilt

Cowboys & Queens (event 14 August) could not be converted in place, so it was rebuilt:

- Paused: `120245065688030609` (`OUTCOME_SALES`, 3 ad sets, £7.31 of £45 spent)
- Created: `120245367022280609` (`OUTCOME_TRAFFIC`, 1 ad set `120245367022350609`,
  `LINK_CLICKS`, £37 lifetime, ends 14 Aug 19:00), 4 ads with concrete headlines

Targeting and destination short links were left exactly as they were.

## Not done

- `fbc` capture: only 5 of 87 conversions carry the click identifier. Lives in the
  The-Anchor.pub site repo, tracked separately.
- Attendance recording: `event_check_ins` holds 98 rows across all events, so judging these
  campaigns on attendance is not yet possible.
