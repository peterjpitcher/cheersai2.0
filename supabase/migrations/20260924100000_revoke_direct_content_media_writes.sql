-- Close a cross-brand media path (SPEC-new-customer-readiness I1, review R14).
--
-- RLS on these tables checks only that the user is a member of the brand that
-- owns the ROW. A signed-in user could therefore write, straight through the
-- Supabase API, another brand's media id into their own post
-- (content_variants.media_ids, content_media_attachments.media_id) or point
-- their own media row at another brand's storage path. Server code that signs
-- or publishes media by id would then hand out another brand's files.
--
-- The app never writes these tables with a user session: every write goes
-- through server actions and edge functions using the service role (checked
-- 2026-09-24: the browser client only uploads storage objects). So the fix is
-- to remove direct INSERT/UPDATE/DELETE for anon and authenticated. SELECT is
-- unchanged (the planner and realtime feed read with the session).
--
-- Rollback (restores the previous grants):
--   grant insert, update, delete on public.content_items, public.content_variants,
--     public.content_media_attachments, public.media_assets, public.media_library
--     to anon, authenticated;

revoke insert, update, delete on table
  public.content_items,
  public.content_variants,
  public.content_media_attachments,
  public.media_assets,
  public.media_library
from anon, authenticated;
