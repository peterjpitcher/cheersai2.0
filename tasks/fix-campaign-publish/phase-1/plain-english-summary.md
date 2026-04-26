# What We Found — Plain English

**6 problems in the campaign publish pipeline. Here's what matters:**

---

### Causing harm right now

- **Campaign creation is failing with "Invalid parameter".** When publishing, the code sends `special_ad_categories` to Meta as the text string `"[]"` — Meta doesn't recognise this as an empty array and rejects the whole request. This is the direct cause of "Publishing Failed" you're seeing.

- **Even if campaign creation worked, all ad sets would silently fail.** The code is missing a required field (`billing_event`) when creating ad sets on Meta. Meta rejects every ad set silently, the error is swallowed, and the campaign gets marked as ACTIVE anyway — with zero actual ad sets running. You'd be paying for nothing.

- **Ad creative text is placed in the wrong field.** The primary text for each ad is being sent inside a part of the API request that Meta deprecated in API v24.0. Creative creation would likely fail or produce ads with missing text.

---

### Will break under edge cases or load

- **Campaign can be marked ACTIVE even when nothing was actually published to Meta.** If all ad set creations fail (for any reason), the pipeline marks the campaign ACTIVE regardless. The user has no way to know nothing is running.

---

### Missing (should exist, doesn't)

- **No warning before publishing with no images.** A user can hit Publish with no images assigned to any ads. The code will silently skip all ads, the campaign will "publish" but run nothing. There is no pre-publish warning about this.

- **Raw Meta API errors shown to user.** Messages like "Invalid parameter" are shown verbatim — users have no idea what to fix.

---

### What else needs updating (ripple effects)

- The "No creative" badge in the campaign detail view is working correctly — it's accurately showing that no images have been assigned to the ads. This is a legitimate signal to the user, not a bug.
- After fixes, the campaign creation + ad set creation + ad creation flow will work end-to-end once the user assigns images.
- A separate review is recommended for the sync cron (`sync-meta-campaigns`) which doesn't account for ACTIVE campaigns with no Meta ad sets.

---

### What we're not touching in this pass

- Campaign editor UI (CampaignTree.tsx) — image assignment UX is out of scope
- Cron sync logic — separate follow-on review
- The campaign delete flow — no Meta cleanup, separate concern

---

**The plan:** We'll deploy a Backend Engineer and a Frontend Engineer to fix all of the above in parallel, then a three-agent validation team to confirm every fix holds.

Ready to proceed? Say **YES** to start, or tell me what to adjust.
