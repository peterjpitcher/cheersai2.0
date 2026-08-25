-- Provenance and an import state machine for media copied in from another system.
--
-- Two problems this solves.
--
-- 1. Idempotency. Importing the same event artwork twice must not create two
--    library assets, but artwork REPLACED in the source must create a new one:
--    posts already scheduled keep the artwork they were built with. A key
--    derived from the source files, not just the event id, gives both.
--
-- 2. Atomicity. An import writes four storage objects, a media_assets row and a
--    media_library row. content_media_attachments has a foreign key to
--    media_library, so an asset without its mirror looks healthy in the library
--    and then fails the moment it is attached to a post. The existing
--    browser-upload path treats that mirror as best effort and swallows its
--    errors, which is not good enough for a path with no user watching it.
--    These functions write both rows together or neither.
--
-- Purely additive: both columns are nullable and no existing row or code path
-- reads them.

-- ---------------------------------------------------------------------------
-- 1. Provenance columns
-- ---------------------------------------------------------------------------

alter table public.media_assets
  add column if not exists source_key text,
  add column if not exists source_metadata jsonb;

comment on column public.media_assets.source_key is
  'Canonical provenance for media copied from another system, e.g. ams:event:<uuid>:<hash>. The hash covers every source URL, its revision timestamp and the transform version, so replaced source artwork yields a new key rather than silently reusing the old render. Null for anything uploaded by hand.';

comment on column public.media_assets.source_metadata is
  'Structured form of source_key: provider, entity type, entity id, per-variant source URLs and the transform version. Queryable detail; source_key stays the cheap unique handle.';

-- Partial, so the millions of hand-uploaded rows with a null source_key are
-- unaffected and can still coexist freely.
create unique index if not exists media_assets_account_source_key_uniq
  on public.media_assets (account_id, source_key)
  where source_key is not null;

-- ---------------------------------------------------------------------------
-- 2. Reserve
--
-- Claims the source_key before any expensive work happens, so two imports of the
-- same artwork cannot both download, render and upload only to collide on the
-- unique index at the very end.
--
-- Returns what the caller should do next:
--   reserved     this call owns the import and should proceed
--   reused       a finished asset already exists; use it
--   in_progress  another call owns it and has not finished yet
--
-- A 'processing' row older than p_stale_after is taken over rather than trusted.
-- A serverless function can be killed between reserving and finalising, and
-- without takeover that source_key would be unusable forever.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_imported_media_asset(
  p_account_id   uuid,
  p_source_key   text,
  p_asset_id     uuid,
  p_storage_path text,
  p_file_name    text,
  p_tags         text[],
  p_stale_after  interval default '10 minutes'
)
returns table (asset_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id     uuid;
  v_existing_status text;
  v_existing_at     timestamptz;
begin
  if p_account_id is null or p_source_key is null or p_asset_id is null then
    raise exception 'reserve_imported_media_asset requires account, source key and asset id';
  end if;

  select ma.id, ma.processed_status, coalesce(ma.processed_at, ma.uploaded_at)
    into v_existing_id, v_existing_status, v_existing_at
  from media_assets ma
  where ma.account_id = p_account_id
    and ma.source_key = p_source_key
  for update;

  if v_existing_id is not null then
    if v_existing_status = 'ready' then
      return query select v_existing_id, 'reused'::text;
      return;
    end if;

    if v_existing_status = 'processing' and v_existing_at > now() - p_stale_after then
      return query select v_existing_id, 'in_progress'::text;
      return;
    end if;

    -- Abandoned or failed. Take the key over; the previous attempt's storage
    -- objects are addressed by its own asset id and are cleaned up by its
    -- caller, or left as orphans for the audit rather than deleted from under
    -- a run that might still be alive.
    update media_assets
    set source_key = null
    where id = v_existing_id;
  end if;

  insert into media_assets (
    id, account_id, storage_path, file_name, media_type, mime_type,
    tags, processed_status, derived_variants, aspect_class, source_key
  )
  values (
    p_asset_id, p_account_id, p_storage_path, p_file_name, 'image', 'image/jpeg',
    coalesce(p_tags, array[]::text[]), 'processing', '{}'::jsonb, 'square', p_source_key
  );

  -- The mirror content_media_attachments points at. Written here, in the same
  -- transaction, so an asset can never exist without it.
  insert into media_library (id, account_id, file_name, file_url, file_type, tags)
  values (p_asset_id, p_account_id, p_file_name, p_storage_path, 'image/jpeg', coalesce(p_tags, array[]::text[]))
  on conflict (id) do update
    set file_name = excluded.file_name,
        file_url  = excluded.file_url,
        file_type = excluded.file_type,
        tags      = excluded.tags;

  return query select p_asset_id, 'reserved'::text;
end;
$$;

comment on function public.reserve_imported_media_asset is
  'Claims a source_key and creates the media_assets + media_library pair in a processing state, before an import does any expensive work. Returns reserved, reused or in_progress.';

-- ---------------------------------------------------------------------------
-- 3. Finalise
-- ---------------------------------------------------------------------------

create or replace function public.finalise_imported_media_asset(
  p_account_id      uuid,
  p_asset_id        uuid,
  p_size_bytes      bigint,
  p_derived_variants jsonb,
  p_width           integer,
  p_height          integer,
  p_source_metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The publish worker refuses a story without this, and the wizard will not let
  -- one be picked. Marking such a row ready would produce an asset that looks
  -- publishable and is not.
  if p_derived_variants is null or coalesce(p_derived_variants ->> 'story', '') = '' then
    raise exception 'finalise_imported_media_asset requires a story derivative';
  end if;

  update media_assets
  set processed_status  = 'ready',
      processed_at      = now(),
      size_bytes        = p_size_bytes,
      derived_variants  = p_derived_variants,
      source_metadata   = coalesce(p_source_metadata, source_metadata)
  where id = p_asset_id
    and account_id = p_account_id;

  if not found then
    raise exception 'Media asset % not found for account %', p_asset_id, p_account_id;
  end if;

  update media_library
  set file_size_bytes = p_size_bytes,
      width           = p_width,
      height          = p_height
  where id = p_asset_id
    and account_id = p_account_id;
end;
$$;

comment on function public.finalise_imported_media_asset is
  'Flips a reserved import to ready and records its derivatives. Refuses a row with no story derivative, because the publish worker would reject it at publish time instead.';

-- ---------------------------------------------------------------------------
-- 4. Release
--
-- Compensation for a failed import. Deletes both rows so a retry starts clean.
-- Deliberately refuses to touch a ready asset or one already attached to
-- content: by then it is ordinary library media that a post may depend on.
-- ---------------------------------------------------------------------------

create or replace function public.release_imported_media_asset(
  p_account_id uuid,
  p_asset_id   uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_attached int;
begin
  select processed_status into v_status
  from media_assets
  where id = p_asset_id and account_id = p_account_id
  for update;

  if v_status is null then
    return false;
  end if;

  if v_status = 'ready' then
    return false;
  end if;

  select count(*) into v_attached
  from content_media_attachments
  where media_id = p_asset_id;

  if v_attached > 0 then
    return false;
  end if;

  delete from media_library where id = p_asset_id and account_id = p_account_id;
  delete from media_assets  where id = p_asset_id and account_id = p_account_id;
  return true;
end;
$$;

comment on function public.release_imported_media_asset is
  'Removes a failed import''s media_assets and media_library rows so the source key can be retried. Refuses when the asset is ready or already attached to content.';

-- ---------------------------------------------------------------------------
-- 5. Grants
--
-- All three are called by the import route with the service-role client, after
-- it has authenticated the user and resolved the account server-side. No other
-- role has any reason to reach them.
-- ---------------------------------------------------------------------------

revoke all on function public.reserve_imported_media_asset(uuid, text, uuid, text, text, text[], interval) from public, anon, authenticated;
revoke all on function public.finalise_imported_media_asset(uuid, uuid, bigint, jsonb, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.release_imported_media_asset(uuid, uuid) from public, anon, authenticated;

grant execute on function public.reserve_imported_media_asset(uuid, text, uuid, text, text, text[], interval) to service_role;
grant execute on function public.finalise_imported_media_asset(uuid, uuid, bigint, jsonb, integer, integer, jsonb) to service_role;
grant execute on function public.release_imported_media_asset(uuid, uuid) to service_role;
