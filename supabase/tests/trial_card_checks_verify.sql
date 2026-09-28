-- Behaviour check for public.trial_card_checks (migration 20260928200000,
-- tasks/SPEC-self-serve-signup.md §4.7): the constraints the app's race-safe
-- decision relies on.
--   - one first_trial per card code (partial unique index), any number of
--     repeat_refused rows for it;
--   - one row per Stripe subscription (primary key), whatever the outcome;
--   - card_hash is 64 lower-case hex characters, or 'none' only for no_card;
--   - outcome is one of first_trial, repeat_refused, no_card; the brand,
--     outcome and card_hash are required; deleting the brand deletes its rows.
-- Writes nothing lasting: the fixtures live in a sub-transaction that is
-- always rolled back. LOCAL ONLY: never run this against production.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/trial_card_checks_verify.sql
-- The concurrent case (many connections at once) is trial_card_checks_race_verify.sh.

do $$
declare
  v_brand_a uuid;
  v_brand_b uuid;
  v_card constant text := repeat('c', 64);
  v_other_card constant text := repeat('d', 64);
  v_n bigint;
  -- The SQLSTATE the last probe failed with, or null.
  v_state text;
begin
  begin
    insert into public.accounts (business_name, email, auth_user_id)
      values ('Card check probe A', 'card-check-a@example.invalid', gen_random_uuid()) returning id into v_brand_a;
    insert into public.accounts (business_name, email, auth_user_id)
      values ('Card check probe B', 'card-check-b@example.invalid', gen_random_uuid()) returning id into v_brand_b;

    -- The first trial on a card is accepted.
    insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
      values ('sub_verify_a', v_brand_a, v_card, 'first_trial');

    -- A second first_trial on the same card, from another brand, is refused.
    v_state := null;
    begin
      insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
        values ('sub_verify_b', v_brand_b, v_card, 'first_trial');
    exception when unique_violation then v_state := '23505';
    end;
    if v_state is distinct from '23505' then
      raise exception 'a second first_trial on one card was accepted';
    end if;

    -- ...and so is ON CONFLICT DO NOTHING (no target): nothing is inserted.
    insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
      values ('sub_verify_b', v_brand_b, v_card, 'first_trial')
      on conflict do nothing;
    if exists (select 1 from public.trial_card_checks where stripe_subscription_id = 'sub_verify_b') then
      raise exception 'on conflict do nothing inserted a second first_trial';
    end if;

    -- The refusal on the same card is accepted, and more than one is allowed.
    insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
      values ('sub_verify_b', v_brand_b, v_card, 'repeat_refused'),
             ('sub_verify_b2', v_brand_b, v_card, 'repeat_refused');

    -- One row per subscription, whatever the outcome.
    v_state := null;
    begin
      insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
        values ('sub_verify_a', v_brand_a, v_other_card, 'first_trial');
    exception when unique_violation then v_state := '23505';
    end;
    if v_state is distinct from '23505' then
      raise exception 'a second row for one subscription was accepted';
    end if;

    -- A different card is its own first trial.
    insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
      values ('sub_verify_c', v_brand_b, v_other_card, 'first_trial');

    -- no_card rows carry 'none'; 'none' is refused for any other outcome.
    insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
      values ('sub_verify_no_card', v_brand_a, 'none', 'no_card');
    v_state := null;
    begin
      insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
        values ('sub_verify_bad_none', v_brand_a, 'none', 'first_trial');
    exception when check_violation then v_state := '23514';
    end;
    if v_state is distinct from '23514' then
      raise exception '''none'' was accepted as the code of a first_trial';
    end if;

    -- A raw Stripe fingerprint (not 64 hex characters) is refused.
    v_state := null;
    begin
      insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
        values ('sub_verify_raw', v_brand_a, 'Xt5EWLLDS7FJjR1c', 'first_trial');
    exception when check_violation then v_state := '23514';
    end;
    if v_state is distinct from '23514' then
      raise exception 'a raw fingerprint was accepted as card_hash';
    end if;

    -- Upper-case hex is refused too (the app writes lower case).
    v_state := null;
    begin
      insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
        values ('sub_verify_upper', v_brand_a, repeat('E', 64), 'first_trial');
    exception when check_violation then v_state := '23514';
    end;
    if v_state is distinct from '23514' then
      raise exception 'an upper-case card_hash was accepted';
    end if;

    -- Outcome must be one of the three.
    v_state := null;
    begin
      insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
        values ('sub_verify_outcome', v_brand_a, repeat('e', 64), 'allowed');
    exception when check_violation then v_state := '23514';
    end;
    if v_state is distinct from '23514' then
      raise exception 'an unknown outcome was accepted';
    end if;

    -- The brand, outcome and code are required, and the brand must exist.
    v_state := null;
    begin
      insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
        values ('sub_verify_null', null, repeat('e', 64), 'first_trial');
    exception when not_null_violation then v_state := '23502';
    end;
    if v_state is distinct from '23502' then
      raise exception 'a row with no brand was accepted';
    end if;
    v_state := null;
    begin
      insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
        values ('sub_verify_null', v_brand_a, repeat('e', 64), null);
    exception when not_null_violation then v_state := '23502';
    end;
    if v_state is distinct from '23502' then
      raise exception 'a row with no outcome was accepted';
    end if;
    v_state := null;
    begin
      insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
        values ('sub_verify_fk', gen_random_uuid(), repeat('e', 64), 'first_trial');
    exception when foreign_key_violation then v_state := '23503';
    end;
    if v_state is distinct from '23503' then
      raise exception 'a row for a brand that does not exist was accepted';
    end if;

    -- created_at defaults to now; cancelled_at starts empty.
    if exists (select 1 from public.trial_card_checks
                where stripe_subscription_id = 'sub_verify_a' and (created_at is null or cancelled_at is not null)) then
      raise exception 'created_at or cancelled_at default is wrong';
    end if;

    -- Deleting a brand deletes its rows, and frees its cards' first trials.
    delete from public.accounts where id = v_brand_a;
    select count(*) into v_n from public.trial_card_checks where account_id = v_brand_a;
    if v_n <> 0 then raise exception 'deleting a brand left % trial_card_checks rows', v_n; end if;
    insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome)
      values ('sub_verify_after_delete', v_brand_b, v_card, 'first_trial');

    raise exception using errcode = 'P0099', message = 'rollback fixtures';
  exception when sqlstate 'P0099' then null;
  end;

  if exists (select 1 from public.accounts where email like 'card-check-_@example.invalid') then
    raise exception 'fixture rows were not rolled back';
  end if;
  raise notice 'trial_card_checks verification PASSED';
end;
$$;
