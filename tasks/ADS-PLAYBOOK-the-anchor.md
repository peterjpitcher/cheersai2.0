# Off-App Ads Playbook, The Anchor

Standing reference for building paid Meta campaigns that the CheersAI wizard cannot produce.
Verified against the live Supabase project `nbkjciurhvkfpcpatbnt` and `src/lib/meta/marketing.ts`
on 2026-08-09. Re-verify the account facts before any campaign that spends money.

---

## 1. Account facts (verified live)

| Thing | Value |
|---|---|
| Account row | The Anchor, `91fda684-2801-4abb-980e-f42cec017cef` |
| Meta ad account | `act_1640006396819878` |
| Currency / timezone | GBP / Europe/London |
| Facebook Page | The Anchor - Heathrow Pub & Dining, `628953850871830` |
| Instagram | theanchor.pub, `17841409165322018`, healthy (see note below) |
| Pixel | `757659911002159` |
| Conversions API token | present |
| Configured conversion event | `Purchase` |
| Conversion optimisation flag | **OFF** |
| Venue address | The Anchor, Horton Road, Stanwell Moor Village, TW19 6AQ |
| Venue coordinates | 51.4625, -0.5021 |
| Booking URL | https://www.the-anchor.pub/book-table |
| Menu URL | https://www.the-anchor.pub/food-menu |
| Website | https://www.the-anchor.pub |
| Phone | 01753 682707 |

**Do not raise the Instagram `status` column as a problem.** The stored value is `expiring`, but
that is a dead label. Facebook and Instagram are both in `NEVER_EXPIRING_PROVIDERS`
(`src/lib/connections/readiness.ts:40`), so a null expiry produces no warning and the UI
computes the status fresh as active. Nothing in the codebase writes `expiring` any more; the
nightly token-health cron only ever writes `expired` or `needs_action`, and only on red health.
The publish worker blocks on `needs_action` alone (`supabase/functions/publish-queue/worker.ts:998`
and `:1782`). The row was last written on 2026-05-31 by a code path that no longer exists.
Instagram publishes daily without issue.

---

## 2. What the app can already do, and where the edge is

The wizard only produces two campaign kinds: `event` and `food_booking`. Anything else is
off-app work and belongs here.

Off-app examples: Sunday roast, Christmas bookings, function room hire, new menu launch,
beer garden, dog-friendly, live sport, recruitment, Heathrow parking, Mother's or Father's
Day, gift vouchers, a general awareness push.

### The API layer supports (in `src/lib/meta/marketing.ts`)

- Campaigns: 5 objectives (awareness, traffic, engagement, leads, sales), special ad
  category, campaign budget optimisation with per-ad-set min and max spend caps.
- Ad sets: full targeting object, optimisation goal, bid strategy, daily or lifetime budget,
  start and end times, promoted object.
- Creatives: single-image link ads only, via `object_story_spec.link_data`. Message,
  headline, description, call to action.
- Ads, pause and status changes, insights fetch.

### The API layer does NOT support (would need new code)

Carousel, video, collection, catalogue or dynamic product ads, custom audiences, lookalikes,
Advantage+ shopping, dynamic creative testing, native A/B tests, boosting an existing organic
post (`object_story_id`), lead forms, placement-level creative variants.

If a campaign needs any of these, I write the code first or we run it manually in Ads Manager.
I will say which, up front, in the brief response.

### Can a custom campaign publish through the app? Yes

The publish path (`src/app/(app)/campaigns/[id]/actions.ts`) is generic. It branches on
`campaign_kind` only for kind-specific behaviour (booking URLs, attribution), and its hard
failures are about venue coordinates, unresolved interests and missing creative assets. Nothing
requires an event source: `source_type` and `source_id` are both nullable.

Better still, an off-app route already exists. `saveCampaignDraft` has a non-event branch
(`src/app/(app)/campaigns/actions.ts:493` onward) that writes `campaign_kind: 'evergreen'` with
`source_type: 'custom_promotion'` and calls `calculateEvergreenPhases(startDate, endDate)`. That
is the path a custom campaign should take. It does not need an event record behind it.

Permitted kinds after the 2026-08-09 migration:

```
meta_campaigns_campaign_kind_check
  CHECK (campaign_kind = ANY (ARRAY['event','evergreen','food_booking']))
```

Use `evergreen` for custom promotions. Only add a new kind if a campaign needs genuinely
different publish behaviour, not merely a different label.

### Gotchas already encoded

- `BOOK_NOW` is rewritten to `BOOK_TRAVEL`, otherwise Ads Manager shows "Unknown".
- Lifetime budgets require an end time, on both campaign and ad set.
- `billing_event: IMPRESSIONS` is always set.
- Objective and attribution window are immutable once the ad set exists. Getting these wrong
  means deleting and rebuilding, not editing.
- Judge event and traffic ads on `inline_link_clicks`, never `clicks`.

---

## 3. Performance benchmarks (actual, last 10 campaigns)

| Objective | Typical spend | Impressions | Clicks | CTR | CPC |
|---|---|---|---|---|---|
| OUTCOME_TRAFFIC | £27 to £30 | 17,300 to 17,500 | 196 to 197 | ~1.45% | £0.11 |
| OUTCOME_SALES | £30 to £59 | 5,200 to 10,100 | 43 to 79 | 1.3% to 3.5% | £0.18 to £0.46 |

Traffic buys roughly 3x the reach and 4x the clicks per pound. Every campaign to date shows
**zero Purchase conversions**, because no booking has ever been attributed to a paid click.
So conversion optimisation starves delivery and should stay off until the booking conversion
pipeline proves it fires.

Default planning assumption: budget ÷ £0.12 = expected link clicks, on traffic.

---

## 4. Creative constraints

- Only 13 usable non-tournament images exist in the library (bar, kitchen, staff, pub,
  Sunday roast, quiz night, recruitment). The other 200 are tournament graphics.
- I can generate banner overlays via `src/lib/banner/render-server.ts`, but not photography.
- Ratio: 1:1 for feed, 9:16 if stories placements are included.
- Any new campaign theme will likely need a fresh photo. Raise this per brief, at the point the
  theme is known, rather than asking for a speculative batch up front.

---

## 5. Copy guardrails (non-negotiable)

First person plural throughout. "We", "our", "us". The pub team is the narrator.

**Venue name in body copy** is only allowed as an opening location anchor, when directing
someone to find the place, once near the top of a GBP post, in a headline field, or in a
referral framing. Never as the subject of a feeling verb, never twice, never in an Instagram
caption.

**Banned phrases:** Premium dining experience, Elevated gastropub, Luxury, Exclusive,
Curated experience, Fine dining, Hidden gem, Airport pub, Unforgettable night, Unforgettable
evening, Good vibes, Avoid disappointment, Spaces are limited, Epic night, Sing your heart
out, A night to remember.

**Banned positioning:** formal, expensive, luxury-led or corporate. Do not overplay Heathrow
to a local audience. No forced slang or chain-brand tone.

**Key phrases to draw on:** Proper pub food. Good food, good drinks, good company. Your local
in Stanwell Moor. A proper village pub. Walk-ins welcome, booking recommended. Bring your
mates. A proper community night. A feel-good night out. Food served before the fun starts.
Free on-site parking.

**Headlines must state a concrete fact** (a price, a time, a date, a dish, a number). No mood
words standing alone.

---

## 6. Brief template

Copy this into chat. Anything you leave blank, I fill with the default shown and tell you.

```
CAMPAIGN: <what we are promoting>
GOAL: <bookings | footfall on a date | awareness | enquiries>
DATES: <run from> to <run to>          [default: 7 days ending on the event date]
BUDGET: £<total>                        [default: lifetime, not daily]
DESTINATION: <URL people land on>       [default: the-anchor.pub/book-table]
THE CONCRETE FACT: <price, time, dish, or number the headline can state>
AUDIENCE: <local only | local + interests>  [default: local only, 5 miles]
IMAGES: <attach, or name library tags, or "generate a banner">
MUST SAY: <anything mandatory, e.g. "over 18s only">
MUST NOT SAY: <anything off limits beyond the standard banned list>
```

## 7. What I return for each brief

1. A `tasks/ADS-<slug>.md` spec: objective, structure, budget split by phase, targeting,
   full copy for every ad, creative list, and the measurement plan.
2. A plain statement of whether it can publish through the existing API layer, needs new
   code, or must be built by hand in Ads Manager.
3. A recorded row in `meta_campaigns` if we publish through the app, so the dashboard,
   performance sync and optimiser still see it. If we build it in Ads Manager instead, it is
   invisible to all three, and I will say so.
4. Nothing goes live without your explicit go-ahead. Campaigns are created PAUSED by default.

---

## 8. Decisions already made (2026-08-09)

- **Publish through the app**, not by hand in Ads Manager, so the dashboard, performance sync
  and optimiser all see the campaign. This is settled; do not re-ask.
- **No standard budget for custom campaigns.** The £30 to £45 lifetime figure applies to
  wizard-built event campaigns only. For anything custom, propose a budget with the spec and
  agree it per campaign.
- **No speculative photo shoots.** Nothing is being built yet. Raise a specific creative need
  when a brief lands and the theme is known.

## 9. Open risks to clear before spending

- No custom audiences or retargeting exist. Every campaign is cold prospecting.
- Booking attribution has never fired. Treat all conversion counts as unproven.
- Venue coordinates must stay set in Settings, or publishing throws.
