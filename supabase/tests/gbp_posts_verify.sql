-- Verification for the gbp_posts_and_switch and guard_google_posts_switch migrations
-- (tasks/SPEC-gbp-posting-reintroduction.md v4, sections 1 and 2).
-- Run AFTER applying the migration, against a fresh local rebuild or production. Each block
-- raises an exception if an expectation is not met; a clean run = pass. Writes nothing lasting:
-- the constraints are exercised on a temporary copy of the table, never on real rows.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/gbp_posts_verify.sql

do $$
declare
  v_col record;
  v_role text;
  v_priv text;
begin
  -- 1. The switch: boolean, not null, default false, and off for every brand that has not been
  --    switched on by hand (the migration itself turns nothing on).
  select data_type, is_nullable, column_default into v_col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'accounts' and column_name = 'google_posts_enabled';
  if not found then raise exception 'accounts.google_posts_enabled is missing'; end if;
  if v_col.data_type <> 'boolean' then raise exception 'accounts.google_posts_enabled is %, expected boolean', v_col.data_type; end if;
  if v_col.is_nullable <> 'NO' then raise exception 'accounts.google_posts_enabled must be not null'; end if;
  if v_col.column_default is distinct from 'false' then
    raise exception 'accounts.google_posts_enabled default is %, expected false', v_col.column_default;
  end if;

  -- 2. The table exists with RLS on and no policies (service role only).
  if to_regclass('public.gbp_posts') is null then raise exception 'public.gbp_posts is missing'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.gbp_posts'::regclass) then
    raise exception 'RLS is off on public.gbp_posts';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gbp_posts') then
    raise exception 'public.gbp_posts has an RLS policy; it is meant to be service role only';
  end if;

  -- 3. anon, authenticated and PUBLIC hold nothing on it; service_role holds everything it needs.
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(v_role, 'public.gbp_posts', v_priv) then
        raise exception '% holds % on public.gbp_posts', v_role, v_priv;
      end if;
    end loop;
  end loop;
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'gbp_posts' and grantee = 'PUBLIC'
  ) then
    raise exception 'PUBLIC holds a privilege on public.gbp_posts';
  end if;
  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.gbp_posts', v_priv) then
      raise exception 'service_role lacks % on public.gbp_posts', v_priv;
    end if;
  end loop;

  -- 4. The indexes that carry the guarantees.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'gbp_posts' and indexname = 'gbp_posts_one_per_event'
       and indexdef ilike '%unique%' and indexdef ilike '%source_event_key is not null%'
  ) then
    raise exception 'gbp_posts_one_per_event is missing or not a partial unique index';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'gbp_posts' and indexname = 'gbp_posts_content_item_key'
       and indexdef ilike '%unique%'
  ) then
    raise exception 'gbp_posts_content_item_key is missing or not unique';
  end if;

  -- 5. Foreign keys: brand and content item cascade, publish job is kept as null.
  if (
    select count(*) from pg_constraint
     where conrelid = 'public.gbp_posts'::regclass and contype = 'f'
       and (
         (confrelid = 'public.accounts'::regclass and confdeltype = 'c')
         or (confrelid = 'public.content_items'::regclass and confdeltype = 'c')
         or (confrelid = 'public.publish_jobs'::regclass and confdeltype = 'n')
       )
  ) <> 3 then
    raise exception 'gbp_posts foreign keys are not as expected';
  end if;
end $$;

-- 6. Exercise the CHECK constraints and the one-per-event rule on a temporary copy
--    (LIKE copies defaults, CHECKs and indexes, not foreign keys).
do $$
declare
  v_account uuid := gen_random_uuid();
  v_parent text := 'accounts/123/locations/456';
begin
  -- ON COMMIT DROP: the copy goes when this block's transaction ends, with no DROP statement
  -- (the Supabase connector asks for confirmation before any DROP, even of a temporary table).
  create temp table gbp_posts_probe (like public.gbp_posts including defaults including constraints including indexes) on commit drop;

  -- Defaults: a new row is not scheduled and has no checks.
  insert into gbp_posts_probe (account_id, content_item_id, local_post_parent)
  values (v_account, gen_random_uuid(), v_parent);
  if (select delivery_state from gbp_posts_probe) <> 'not_scheduled' then
    raise exception 'delivery_state default is not not_scheduled';
  end if;
  if (select check_attempts from gbp_posts_probe) <> 0 then raise exception 'check_attempts default is not 0'; end if;

  -- Every delivery state is accepted; anything else is refused.
  update gbp_posts_probe set delivery_state = 'claimed' where true;
  update gbp_posts_probe set delivery_state = 'sent' where true;
  update gbp_posts_probe set delivery_state = 'uncertain' where true;
  update gbp_posts_probe set delivery_state = 'failed' where true;
  begin
    update gbp_posts_probe set delivery_state = 'published' where true;
    raise exception 'delivery_state "published" was accepted';
  exception when check_violation then null;
  end;

  -- The destination must be accounts/{a}/locations/{l}.
  begin
    insert into gbp_posts_probe (account_id, content_item_id, local_post_parent)
    values (v_account, gen_random_uuid(), 'locations/456');
    raise exception 'a bare location id was accepted as local_post_parent';
  exception when check_violation then null;
  end;

  -- The event key must be mgmt:<id> or campaign:<id>.
  begin
    insert into gbp_posts_probe (account_id, content_item_id, local_post_parent, source_event_key)
    values (v_account, gen_random_uuid(), v_parent, 'quiz night');
    raise exception 'a free-text source_event_key was accepted';
  exception when check_violation then null;
  end;

  -- One Google post per event per profile.
  insert into gbp_posts_probe (account_id, content_item_id, local_post_parent, source_event_key)
  values (v_account, gen_random_uuid(), v_parent, 'mgmt:evt-1');
  begin
    insert into gbp_posts_probe (account_id, content_item_id, local_post_parent, source_event_key)
    values (v_account, gen_random_uuid(), v_parent, 'mgmt:evt-1');
    raise exception 'a second Google post for the same event and profile was accepted';
  exception when unique_violation then null;
  end;

  -- The same event on another profile, another brand, and any number of ordinary posts are fine.
  insert into gbp_posts_probe (account_id, content_item_id, local_post_parent, source_event_key)
  values
    (v_account, gen_random_uuid(), 'accounts/123/locations/789', 'mgmt:evt-1'),
    (gen_random_uuid(), gen_random_uuid(), v_parent, 'mgmt:evt-1'),
    (v_account, gen_random_uuid(), v_parent, null),
    (v_account, gen_random_uuid(), v_parent, null);

  -- One tracked row per content item.
  begin
    insert into gbp_posts_probe (account_id, content_item_id, local_post_parent)
    select account_id, content_item_id, local_post_parent from gbp_posts_probe limit 1;
    raise exception 'a second row for the same content item was accepted';
  exception when unique_violation then null;
  end;

end $$;

-- 7. The switch is guarded (the guard_google_posts_switch migration): a user session may change
--    accounts.google_posts_enabled only as a super-admin.
do $$
declare
  v_fn record;
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.accounts'::regclass
       and tgname = 'accounts_guard_google_posts_enabled'
       and not tgisinternal
       and tgenabled = 'O'
       and tgfoid = 'public.guard_google_posts_enabled()'::regprocedure
       and pg_get_triggerdef(oid) ilike '%before update of google_posts_enabled%'
  ) then
    raise exception 'accounts_guard_google_posts_enabled is missing, disabled or not BEFORE UPDATE OF google_posts_enabled';
  end if;

  select prosecdef, proconfig into v_fn from pg_proc where oid = 'public.guard_google_posts_enabled()'::regprocedure;
  -- SECURITY INVOKER, so current_user is the caller's role; search_path pinned.
  if v_fn.prosecdef then raise exception 'guard_google_posts_enabled must be SECURITY INVOKER'; end if;
  if v_fn.proconfig is null or not exists (select 1 from unnest(v_fn.proconfig) c where c like 'search_path=%') then
    raise exception 'guard_google_posts_enabled has no pinned search_path';
  end if;
  if has_function_privilege('anon', 'public.guard_google_posts_enabled()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_google_posts_enabled()', 'EXECUTE') then
    raise exception 'guard_google_posts_enabled is callable by anon or authenticated';
  end if;
end $$;

-- 8. Exercise the guard. A user session on the real table is stopped by RLS before the trigger
--    is reached unless real users exist, so the same function is attached to a scratch table and
--    driven as each role. Everything in the inner block is undone by the exception that ends it,
--    so nothing is left behind and no DROP is needed.
do $$
declare
  v_refused boolean := false;
  v_server_ok boolean := false;
  v_other_column_ok boolean := false;
begin
  begin
    create table public._gbp_guard_probe (id integer primary key, label text, google_posts_enabled boolean not null default false);
    grant select, update on public._gbp_guard_probe to authenticated;
    create trigger probe_guard before update of google_posts_enabled on public._gbp_guard_probe
      for each row execute function public.guard_google_posts_enabled();
    insert into public._gbp_guard_probe (id) values (1);

    -- A signed-in user who is not a super-admin (no JWT here, so is_super_admin() is false).
    set local role authenticated;
    begin
      update public._gbp_guard_probe set google_posts_enabled = true where id = 1;
    exception when insufficient_privilege then
      v_refused := true;
    end;
    -- The same user may still change other columns, and may "set" the switch to what it already is.
    update public._gbp_guard_probe set label = 'renamed', google_posts_enabled = false where id = 1;
    v_other_column_ok := (select label = 'renamed' from public._gbp_guard_probe where id = 1);
    reset role;

    -- Server code (not a user session) is unaffected.
    update public._gbp_guard_probe set google_posts_enabled = true where id = 1;
    v_server_ok := (select google_posts_enabled from public._gbp_guard_probe where id = 1);

    raise exception 'undo_gbp_guard_probe';
  exception when others then
    if sqlerrm <> 'undo_gbp_guard_probe' then raise; end if;
  end;

  if not v_refused then raise exception 'a non-admin user session was allowed to switch Google posting on'; end if;
  if not v_other_column_ok then raise exception 'the guard blocked an update that did not change the switch'; end if;
  if not v_server_ok then raise exception 'server code was blocked from changing the switch'; end if;
  if to_regclass('public._gbp_guard_probe') is not null then raise exception 'the guard probe table was left behind'; end if;
end $$;

-- 9. The attached-version columns (the gbp_posts_attached_versions migration, decision D12):
--    every column with its type, nullability and default.
do $$
declare
  v_expected text[][] := array[
    array['state', 'text', 'NO', '''pending''::text'],
    array['hold_reason', 'text', 'YES', null],
    array['topic_type', 'text', 'NO', '''STANDARD''::text'],
    array['summary', 'text', 'NO', '''''::text'],
    array['cta_type', 'text', 'YES', null],
    array['cta_url', 'text', 'YES', null],
    array['event_title', 'text', 'YES', null],
    array['event_start', 'timestamp with time zone', 'YES', null],
    array['event_end', 'timestamp with time zone', 'YES', null],
    array['attempts', 'integer', 'NO', '0'],
    array['next_attempt_at', 'timestamp with time zone', 'YES', null],
    array['claimed_at', 'timestamp with time zone', 'YES', null],
    array['sent_at', 'timestamp with time zone', 'YES', null],
    array['summary_edited_at', 'timestamp with time zone', 'YES', null],
    array['resend_count', 'integer', 'NO', '0']
  ];
  v_row text[];
  v_col record;
  v_name text;
begin
  foreach v_row slice 1 in array v_expected loop
    select data_type, is_nullable, column_default into v_col
      from information_schema.columns
     where table_schema = 'public' and table_name = 'gbp_posts' and column_name = v_row[1];
    if not found then raise exception 'gbp_posts.% is missing', v_row[1]; end if;
    if v_col.data_type <> v_row[2] then raise exception 'gbp_posts.% is %, expected %', v_row[1], v_col.data_type, v_row[2]; end if;
    if v_col.is_nullable <> v_row[3] then raise exception 'gbp_posts.% nullability is %, expected %', v_row[1], v_col.is_nullable, v_row[3]; end if;
    if v_col.column_default is distinct from v_row[4] then
      raise exception 'gbp_posts.% default is %, expected %', v_row[1], v_col.column_default, v_row[4];
    end if;
  end loop;

  -- The older column is still there, untouched (it is superseded, not removed).
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'gbp_posts' and column_name = 'delivery_state'
  ) then
    raise exception 'gbp_posts.delivery_state is missing; this migration must leave it in place';
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_delivery_state_check'
  ) then
    raise exception 'gbp_posts_delivery_state_check is missing; this migration must leave it in place';
  end if;

  -- Every named CHECK is present and validated.
  foreach v_name in array array[
    'gbp_posts_state_check', 'gbp_posts_topic_type_check', 'gbp_posts_cta_type_check', 'gbp_posts_cta_pair_check',
    'gbp_posts_event_fields_check', 'gbp_posts_held_reason_check', 'gbp_posts_claimed_at_check',
    'gbp_posts_sent_fields_check', 'gbp_posts_summary_length_check', 'gbp_posts_attempts_check',
    'gbp_posts_resend_count_check'
  ] loop
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.gbp_posts'::regclass and conname = v_name and contype = 'c' and convalidated
    ) then
      raise exception 'CHECK constraint % is missing or not validated on public.gbp_posts', v_name;
    end if;
  end loop;

  -- The sender's index: partial, on the states still in play.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'gbp_posts' and indexname = 'gbp_posts_live_states'
       and indexdef ilike '%(account_id, state, next_attempt_at)%'
       and indexdef ilike '%where%' and indexdef ilike '%pending%' and indexdef ilike '%claimed%' and indexdef ilike '%uncertain%'
  ) then
    raise exception 'gbp_posts_live_states is missing or not the expected partial index';
  end if;
end $$;

-- 10. Exercise the new CHECKs on a temporary copy (same approach as block 6).
do $$
declare
  v_account uuid := gen_random_uuid();
  v_parent text := 'accounts/123/locations/456';
  v_id uuid;
  v_state text;
begin
  create temp table gbp_versions_probe (like public.gbp_posts including defaults including constraints including indexes) on commit drop;

  -- Defaults: a new version is pending, STANDARD, with no wording, no button and no attempts.
  insert into gbp_versions_probe (account_id, content_item_id, local_post_parent)
  values (v_account, gen_random_uuid(), v_parent)
  returning id into v_id;
  if (select state || '/' || topic_type || '/' || summary || '/' || attempts || '/' || resend_count
        from gbp_versions_probe where id = v_id) <> 'pending/STANDARD//0/0' then
    raise exception 'the defaults of a new Google version are not as expected';
  end if;

  -- Every state is accepted when its own rules are met.
  update gbp_versions_probe set state = 'held', hold_reason = 'alcohol_promotion' where id = v_id;
  update gbp_versions_probe set state = 'pending', hold_reason = null where id = v_id;
  update gbp_versions_probe set state = 'claimed', claimed_at = now() where id = v_id;
  update gbp_versions_probe set state = 'uncertain' where id = v_id;
  update gbp_versions_probe set state = 'sent', google_post_name = v_parent || '/localPosts/1', sent_at = now() where id = v_id;
  update gbp_versions_probe set state = 'failed' where id = v_id;
  update gbp_versions_probe set state = 'skipped' where id = v_id;
  update gbp_versions_probe set state = 'pending' where id = v_id;

  -- An unknown state, and a NULL state, are refused.
  begin
    update gbp_versions_probe set state = 'published' where id = v_id;
    raise exception 'state "published" was accepted';
  exception when check_violation then null;
  end;
  begin
    update gbp_versions_probe set state = null where id = v_id;
    raise exception 'a NULL state was accepted';
  exception when not_null_violation or check_violation then null;
  end;

  -- Each state's own rule: held needs a reason, claimed and uncertain need claimed_at,
  -- sent needs Google's name and a sent time.
  begin
    update gbp_versions_probe set state = 'held', hold_reason = null where id = v_id;
    raise exception 'a held version with no reason was accepted';
  exception when check_violation then null;
  end;
  begin
    update gbp_versions_probe set state = 'held', hold_reason = '   ' where id = v_id;
    raise exception 'a held version with a blank reason was accepted';
  exception when check_violation then null;
  end;
  foreach v_state in array array['claimed', 'uncertain'] loop
    begin
      update gbp_versions_probe set state = v_state, claimed_at = null where id = v_id;
      raise exception 'a % version with no claimed_at was accepted', v_state;
    exception when check_violation then null;
    end;
  end loop;
  begin
    update gbp_versions_probe set state = 'sent', google_post_name = null, sent_at = now() where id = v_id;
    raise exception 'a sent version with no Google post name was accepted';
  exception when check_violation then null;
  end;
  begin
    update gbp_versions_probe set state = 'sent', google_post_name = v_parent || '/localPosts/1', sent_at = null where id = v_id;
    raise exception 'a sent version with no sent time was accepted';
  exception when check_violation then null;
  end;

  -- Topic type: STANDARD and EVENT only.
  begin
    update gbp_versions_probe set topic_type = 'OFFER' where id = v_id;
    raise exception 'topic_type "OFFER" was accepted';
  exception when check_violation then null;
  end;

  -- An event needs a title, a start and a later end; each missing part is refused.
  begin
    update gbp_versions_probe set topic_type = 'EVENT' where id = v_id;
    raise exception 'an EVENT with no title or times was accepted';
  exception when check_violation then null;
  end;
  begin
    update gbp_versions_probe
       set topic_type = 'EVENT', event_title = 'Quiz Night', event_start = now(), event_end = null
     where id = v_id;
    raise exception 'an EVENT with no end was accepted';
  exception when check_violation then null;
  end;
  begin
    update gbp_versions_probe
       set topic_type = 'EVENT', event_title = 'Quiz Night', event_start = now(), event_end = now() - interval '1 hour'
     where id = v_id;
    raise exception 'an EVENT that ends before it starts was accepted';
  exception when check_violation then null;
  end;
  begin
    update gbp_versions_probe
       set topic_type = 'EVENT', event_title = ' ', event_start = now(), event_end = now() + interval '2 hours'
     where id = v_id;
    raise exception 'an EVENT with a blank title was accepted';
  exception when check_violation then null;
  end;
  update gbp_versions_probe
     set topic_type = 'EVENT', event_title = 'Quiz Night', event_start = now(), event_end = now() + interval '2 hours'
   where id = v_id;

  -- The button: BOOK or LEARN_MORE with an https link, or nothing at all.
  update gbp_versions_probe set cta_type = 'BOOK', cta_url = 'https://example.com/book' where id = v_id;
  update gbp_versions_probe set cta_type = 'LEARN_MORE', cta_url = 'https://example.com/more' where id = v_id;
  begin
    update gbp_versions_probe set cta_type = 'CALL', cta_url = 'https://example.com/call' where id = v_id;
    raise exception 'cta_type "CALL" was accepted';
  exception when check_violation then null;
  end;
  begin
    update gbp_versions_probe set cta_type = 'BOOK', cta_url = null where id = v_id;
    raise exception 'a button with no link was accepted';
  exception when check_violation then null;
  end;
  begin
    update gbp_versions_probe set cta_type = null, cta_url = 'https://example.com/book' where id = v_id;
    raise exception 'a link with no button was accepted';
  exception when check_violation then null;
  end;
  begin
    update gbp_versions_probe set cta_type = 'BOOK', cta_url = 'http://example.com/book' where id = v_id;
    raise exception 'a button link that is not https was accepted';
  exception when check_violation then null;
  end;
  update gbp_versions_probe set cta_type = null, cta_url = null where id = v_id;

  -- Wording: 1,500 characters at most.
  update gbp_versions_probe set summary = repeat('a', 1500) where id = v_id;
  begin
    update gbp_versions_probe set summary = repeat('a', 1501) where id = v_id;
    raise exception 'a summary of 1,501 characters was accepted';
  exception when check_violation then null;
  end;

  -- Counters: never negative, and at most one send after an unanswered one.
  begin
    update gbp_versions_probe set attempts = -1 where id = v_id;
    raise exception 'a negative attempts count was accepted';
  exception when check_violation then null;
  end;
  update gbp_versions_probe set resend_count = 1 where id = v_id;
  begin
    update gbp_versions_probe set resend_count = 2 where id = v_id;
    raise exception 'a second re-send was accepted';
  exception when check_violation then null;
  end;
end $$;
