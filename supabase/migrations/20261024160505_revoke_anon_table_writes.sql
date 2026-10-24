-- The public (anon) key can no longer write to any table in public.
--
-- Owner approval: 24 October 2026, relayed by the chief of staff session ("yes tighten the
-- permissions"). Spec: tasks/SPEC-revoke-anon-table-writes.md.
--
-- anon is the role behind the anon key every browser holds; requests without a signed-in session
-- run as it. It held INSERT, UPDATE, DELETE and TRUNCATE on 26 tables and one view, and TRUNCATE on
-- five more tables, all copied from the v1 database. Row level security was the only thing
-- stopping those writes, and TRUNCATE ignores row level security altogether.
--
-- Checked on production on 24 October 2026 that nothing relies on anon writing to any of them:
--   - every write policy that applies to anon needs brand membership, a super admin or the service
--     role, and three of the tables have no write policy at all;
--   - no function anon can execute writes to them;
--   - every app path that writes while signed out (link-in-bio views and clicks, the booking
--     conversion ingest, sign-up, invitations, crons, webhooks, the publish-queue edge function)
--     uses the service role.
--
-- SELECT, REFERENCES, TRIGGER and MAINTAIN for anon stay as they are, and no other role changes.
-- Default privileges need nothing: 20260905053036 already stopped new tables granting anon
-- anything for postgres, the role that runs migrations.
--
-- Rollback: grant the same privileges back to anon on the same relations (the SQL is in the spec).

do $$
declare
  v_relations constant text[] := array[
    -- INSERT, UPDATE, DELETE and TRUNCATE before this migration
    'accounts',
    'ad_metrics_history',
    'ad_sets',
    'ads',
    'analytics_snapshots',
    'booking_conversion_events',
    'brand_profile',
    'campaigns',
    'content_item_versions',
    'content_templates',
    'link_in_bio_clicks',
    'link_in_bio_page_views',
    'link_in_bio_profiles',
    'link_in_bio_tiles',
    'meta_campaigns',
    'meta_optimisation_actions',
    'meta_optimisation_runs',
    'notifications',
    'posting_defaults',
    'profiles',
    'publish_attempts',
    'publish_jobs',
    'publish_jobs_with_variant',
    'social_connections',
    'tournament_fixtures',
    'tournaments',
    'worker_heartbeats',
    -- TRUNCATE only before this migration
    'content_items',
    'content_media_attachments',
    'content_variants',
    'media_assets',
    'media_library'
  ];
  v_name text;
  v_relation regclass;
  v_priv text;
begin
  foreach v_name in array v_relations loop
    v_relation := to_regclass(format('public.%I', v_name));
    if v_relation is null then
      -- Every one exists on production; a local rebuild may lack one.
      raise notice 'revoke_anon_table_writes: public.% does not exist here, skipped', v_name;
      continue;
    end if;

    execute format('revoke insert, update, delete, truncate on table %s from anon', v_relation);

    -- Prove it before the migration commits: anon can no longer write, by table or by column.
    foreach v_priv in array array['insert', 'update', 'delete', 'truncate'] loop
      if has_table_privilege('anon', v_relation, v_priv) then
        raise exception 'revoke_anon_table_writes: anon still has % on %', v_priv, v_relation;
      end if;
    end loop;
    foreach v_priv in array array['insert', 'update'] loop
      if has_any_column_privilege('anon', v_relation, v_priv) then
        raise exception 'revoke_anon_table_writes: anon still has % on a column of %', v_priv, v_relation;
      end if;
    end loop;
  end loop;
end;
$$;
