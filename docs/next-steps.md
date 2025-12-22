# Rebuild Follow-Up Checklist

## 1. Decisions to Confirm
- **Job Worker Platform**: Supabase Edge Function vs external queue service (e.g. QStash) for publish pipeline.
- **Media Transcoding Approach**: Client-side preprocessing vs serverless FFmpeg worker.
- **Email Provider**: Continue with Resend or adopt alternative.
- **Notification Channels**: Email only, or expand to push/SMS later.
- **GBP CTA Defaults**: Final mapping of CTA buttons per post type.
- **Instagram Stories Support**: Verify API availability for business account; define manual fallback if unavailable.
- **Post Expiry Automation**: Whether GBP offers/events should auto-delete after expiry.

## 2. Immediate Next Steps
1. Review `cheersai-rebuild-prd.md` and `technical-design.md` for alignment; capture edits inline.
2. Greenlight data model so migrations can be drafted (`supabase/migrations`).
3. Approve integration specifications or flag provider-specific constraints.
4. Define staging environment resources (social accounts, GBP location, storage bucket).
5. Draft schema migration scripts and API contract document (to live in this folder).
6. Produce sequence diagrams for publishing and token refresh workflows.
7. Outline development timeline and resourcing once scope confirmed.

## 3. Artifacts Created
- `cheersai-rebuild-prd.md`
- `technical-design.md`
- `integration-spec.md`
- `next-steps.md` (this file)

## 4. Outstanding Questions for Owner
- Any additional UI simplifications or copy changes desired before design begins?
- Preferred cadence for progress demos/reviews during rebuild?
- Are offline/mobile (poor connectivity) scenarios important enough to influence architecture?
