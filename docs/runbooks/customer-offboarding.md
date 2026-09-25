# Runbook: offboarding a customer brand

Decision D5 (`tasks/SPEC-new-customer-readiness.md`): offboarding is done by the operator on request, never by a customer button. The brand is stopped straight away; its data is kept for 30 days, then deleted.

Everything below is in **Admin → Offboarding**. Each step asks you to type the brand's name.

## When a customer asks to leave

1. **Confirm who is asking.** Only an owner of the brand (Settings → Team shows owners) can ask. Reply from the support address and keep the email.
2. **Cancel billing.** Cancel the brand's subscription in Stripe (or from Admin → Billing once Stripe re-sync is live), effective now or at period end as agreed. Offboarding is refused while a subscription is still running.
3. **Stop paid ads.** If the brand runs paid Meta campaigns, pause them in the app first. Offboarding is refused while any campaign is live, because deleting the ads token would leave spend running with no way to pause it.
4. **Export, if asked.** Admin → Offboarding → *Export data* downloads a JSON file: posts and schedule, brand profile, link-in-bio, and media download links valid for 7 days. It contains no tokens or passwords. Send it to the owner.
5. **Offboard.** Admin → Offboarding → *Offboard*. This:
   - turns every scheduled post back into a draft and holds its publish job;
   - deletes every credential held for the brand: Facebook, Instagram and ads tokens, the Conversions API token, the booking-ingest key, tournament feed keys and the management app key;
   - archives the brand, so its users no longer see it;
   - sets the deletion date 30 days out.
6. **Tell the customer** the brand is closed, the date their data will be deleted, and that posts already on their Facebook Page and Instagram stay there (they can delete those on Meta).

## After 30 days

7. **Delete.** Admin → Offboarding → *Delete data* (only enabled once the date has passed). It deletes:
   - the brand's files (uploads, derived images, tournament images, rendered banners);
   - the brand's content and paid-campaign records, then every other database row for the brand (all tables cascade from `accounts`);
   - any login that belonged only to this brand (operators and people in other brands keep theirs).
   It cannot be undone. The admin audit log keeps a record that it happened.

## If something fails

- Offboard and delete stop at the first error and report it; nothing after that point runs. Fix the cause and run the step again: both are safe to repeat.
- If the files were deleted but the database delete failed, run *Delete data* again.
- If *Delete data* reports a login it could not delete, the brand itself is already gone. Delete that login by hand in Supabase → Authentication → Users (the message lists its user id); the usual cause is audit history in another brand that still points at it.
- The Anchor's booking conversions also arrive through a shared key in the Vercel settings (`BOOKING_CONVERSION_INGEST_SECRET` with `BOOKING_CONVERSION_ACCOUNT_ID`). Offboarding does not touch Vercel, so if The Anchor were ever offboarded, remove those two variables as well.
- A Meta data-deletion request for a person is handled automatically (see `src/app/api/social/delete-data/route.ts`); unmatched requests are emailed to the operator for a manual check.
