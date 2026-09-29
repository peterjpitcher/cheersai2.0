# Runbook: offboarding a customer brand

Decision D5 (`tasks/SPEC-new-customer-readiness.md`): offboarding is done by the operator on request, never by a customer button. The brand is stopped straight away; its data is kept for 30 days, then deleted.

Everything below is in **Admin → Offboarding**. Each step asks you to type the brand's name.

## When a subscription lapses and nobody asks

Decision L8: a brand whose subscription ended at least 90 days ago (London calendar days, from the later of Stripe's cancel time and the period end) and that is not offboarded appears in the daily operator email under "No subscription for 90 days". If nobody has asked to keep it, offboard it with the steps below; the 30-day hold then starts as usual. To keep a lapsed brand on purpose, set its billing override to **Suspended** in Admin → Billing (it keeps read and export access and stops appearing in the email). Comped brands are never listed.

## When a customer asks to leave

1. **Confirm who is asking.** Only an owner of the brand (Settings → Team shows owners) can ask. Reply from the support address and keep the email.
   While self-serve sign-up is open (the `self_serve_signup` switch and `billing_enforcement` both on), an owner can also press *Ask us to close this venue* in Settings (only logins with an owner row in the brand; an operator's super-admin access does not count). You then get "[Cheers operator] Request to close a venue" (venue, brand id, the owner's login email and the time), the owner gets a confirmation listing these steps and the 30-day deletion, and `admin_audit` records `venue_closure_request`. It stops and deletes nothing: carry on from this step. A second request for the same brand within 24 hours sends no email, presses at the same moment send one, and at most 5 are sent per brand per 24-hour window.
2. **Cancel billing.** Cancel the brand's subscription in Stripe (or from Admin → Billing once Stripe re-sync is live), effective now or at period end as agreed. Offboarding is refused while a subscription is still running.
3. **Stop paid ads.** If the brand runs paid Meta campaigns, pause them in the app first (and check Ads Manager: a campaign switched back on there counts as live). Offboarding is refused while any campaign can still spend: active in the app or at Meta, with no end date or one today or later (London date), because deleting the ads token would leave spend running with no way to pause it. A campaign whose end date has passed does not block.
4. **Export, if asked.** Admin → Offboarding → *Export data* downloads a JSON file: posts and schedule, brand profile, link-in-bio, and media download links valid for 7 days. It contains no tokens or passwords, and it is streamed, so a large brand's file is not cut off. Send it to the owner. While self-serve sign-up is on, owners can download the same file themselves from Settings → *Download my data* (3 per brand per 24-hour window, counted only when a file is sent; one is prepared at a time per brand, and at most 10 are started per window, after which you are alerted; each file sent, and only a file sent, is recorded in `admin_audit` as `export_brand_data` with detail kind `owner_download`).
5. **Offboard.** Admin → Offboarding → *Offboard*. This:
   - turns every scheduled post back into a draft and holds its publish job;
   - deletes every credential held for the brand: Facebook, Instagram and ads tokens, the Conversions API token, the booking-ingest key, tournament feed keys and the management app key;
   - archives the brand, so its users no longer see it;
   - sets the deletion date 30 days out.
6. **Tell the customer** the brand is closed, the date their data will be deleted, and that posts already on their Facebook Page and Instagram stay there (they can delete those on Meta).

## After 30 days

Deletion is manual. From the day a brand's deletion date passes, the daily data-retention job (`/api/cron/data-retention`, 03:45 UTC) emails `OPERATOR_ALERT_EMAIL` a list of every offboarded brand that is due and not yet deleted, with how many days overdue each is and a link to Admin → Offboarding. It repeats every day until the brand is deleted, and sends nothing when none are due (see `docs/runbooks/data-retention.md`).

7. **Delete.** Admin → Offboarding → *Delete data* (only enabled once the date has passed). It deletes:
   - the brand's files (uploads, derived images, tournament images, rendered banners);
   - the brand's paid-campaign records, its link-in-bio clicks and page views, then every other database row for the brand (all other tables cascade from `accounts`);
   - any login that belonged only to this brand (operators and people in other brands keep theirs).
   It cannot be undone. The admin audit log keeps a record that it happened.

## If something fails

- Offboard and delete stop at the first error and report it; nothing after that point runs. Fix the cause and run the step again: both are safe to repeat.
- If an owner's *Download my data* or *Ask us to close this venue* fails, the owner sees an error with our email address and you get "[Cheers operator] Owner request problem: owner_export" (or `closure_request`, `closure_notice`), at most once an hour per kind; each failure is also listed in the next daily operator email. For a failed download, send the owner the export from Admin. A `closure_request` failure means the request did not reach you, so expect the owner to email instead.
- If the files were deleted but the database delete failed, run *Delete data* again.
- If *Delete data* reports a login it could not delete, the brand itself is already gone; the message lists the user id and the reason. The likely cause is audit history in another brand that still points at that login (`audit_log.user_id` blocks the delete), and the Supabase dashboard will hit the same block. Detach it first in the SQL editor, `update public.audit_log set user_id = null where user_id = '<user id>';`, then delete the login in Supabase → Authentication → Users. For any other reason, retry the dashboard delete.
- The Anchor's booking conversions also arrive through a shared key in the Vercel settings (`BOOKING_CONVERSION_INGEST_SECRET` with `BOOKING_CONVERSION_ACCOUNT_ID`). Offboarding does not touch Vercel, so if The Anchor were ever offboarded, remove those two variables as well.
- A Meta data-deletion request for a person is handled automatically (see `src/app/api/social/delete-data/route.ts`); unmatched requests are emailed to the operator for a manual check.
