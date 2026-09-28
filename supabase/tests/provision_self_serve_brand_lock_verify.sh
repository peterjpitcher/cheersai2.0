#!/usr/bin/env bash
# Row-lock check for public.provision_self_serve_brand (migration 20260928190000)
# against the self-serve login clean-up (public.delete_stale_self_serve_login,
# migration 20260928170000). LOCAL ONLY: run after a local rebuild, never
# against production.
#
# The fixture is a login that confirmed its email 31 days ago and never made a
# venue, so the clean-up may delete it, and the person creates their venue at
# the moment the daily cron tries. Both functions lock the login's sign-up row,
# so one must wait for the other:
#
#   Race 1, clean-up first: session A deletes the login and holds its
#   transaction open for 3 seconds; session B, a second later, provisions. B
#   must wait, then find the login gone ("no_login"), and no brand is made.
#
#   Race 2, venue first: session A provisions and holds its transaction open
#   for 3 seconds; session B, a second later, runs the clean-up. B must wait,
#   then see the venue and keep the login ("kept"); the brand and its owner
#   membership stay.
#
# The sign-up switch is turned on only inside the provisioning session's own
# transaction (rolled back in race 1, set back to what it was before commit in
# race 2), so no other session ever sees it change.
# Everything it creates is deleted at the end.
# Usage: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres \
#          bash supabase/tests/provision_self_serve_brand_lock_verify.sh
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the LOCAL database}"
case "$DATABASE_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "Refusing: DATABASE_URL is not a local database." >&2; exit 1 ;;
esac

TAG="lock-$$"
OUT="$(mktemp)"
USER_1="$(psql "$DATABASE_URL" -qAtc "select gen_random_uuid()")"
USER_2="$(psql "$DATABASE_URL" -qAtc "select gen_random_uuid()")"
SWITCH="$(psql "$DATABASE_URL" -qAtc "select enabled from public.app_flags where name = 'self_serve_signup'")"
case "$SWITCH" in t|f) ;; *) echo "app_flags has no self_serve_signup row" >&2; exit 1 ;; esac
cleanup() {
  rm -f "$OUT"
  psql "$DATABASE_URL" -qAt >/dev/null <<SQL
delete from public.accounts where auth_user_id in ('$USER_1', '$USER_2');
delete from auth.users where id in ('$USER_1', '$USER_2');
delete from public.self_serve_signups where user_id in ('$USER_1', '$USER_2') or (user_id is null and legal_version = '$TAG');
SQL
}
trap cleanup EXIT

fixture() {
  psql "$DATABASE_URL" -qAt -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into auth.users (id, email, created_at, email_confirmed_at)
  values ('$1', '$2', now() - interval '31 days', now() - interval '31 days');
-- legal_version carries the tag so the row can be found after its user_id is cleared.
insert into public.self_serve_signups (user_id, requested_at, last_requested_at, legal_version)
  values ('$1', now() - interval '31 days', now() - interval '31 days', '$TAG');
SQL
}

fail() {
  echo "provision_self_serve_brand_lock_verify: FAIL ($1)" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Race 1: the clean-up holds the lock; provisioning waits and finds nothing.
# ---------------------------------------------------------------------------
fixture "$USER_1" "$TAG-1@example.invalid"

psql "$DATABASE_URL" -qAt -v ON_ERROR_STOP=1 >/dev/null <<SQL &
begin;
set local role service_role;
select public.delete_stale_self_serve_login('$USER_1');
select pg_sleep(3);
commit;
SQL
A_PID=$!

sleep 1
start="$(date +%s)"
psql "$DATABASE_URL" -qAt -v ON_ERROR_STOP=1 >"$OUT" <<SQL
begin;
update public.app_flags set enabled = true where name = 'self_serve_signup';
set local role service_role;
select public.provision_self_serve_brand('$USER_1', 'Race One Inn', 'pub', '$TAG-1@example.invalid', '$TAG') ->> 'status';
rollback;
SQL
end="$(date +%s)"
wait "$A_PID"

status="$(tr -d '[:space:]' <"$OUT")"
waited=$((end - start))
login="$(psql "$DATABASE_URL" -qAtc "select count(*) from auth.users where id = '$USER_1'")"
brands="$(psql "$DATABASE_URL" -qAtc "select count(*) from public.accounts where auth_user_id = '$USER_1' or business_name = 'Race One Inn'")"
echo "race 1 (clean-up first): provision status=$status waited=${waited}s login_left=$login brands_made=$brands"
if [ "$status" != "no_login" ] || [ "$waited" -lt 1 ] || [ "$login" != "0" ] || [ "$brands" != "0" ]; then
  fail "race 1"
fi

# ---------------------------------------------------------------------------
# Race 2: provisioning holds the lock; the clean-up waits and keeps the login.
# ---------------------------------------------------------------------------
fixture "$USER_2" "$TAG-2@example.invalid"

before="$(psql "$DATABASE_URL" -qAtc "begin; set local role service_role; select public.delete_stale_self_serve_login('$USER_2') ->> 'status'; rollback;" | grep -E '^(kept|deleted|failed)$')"
echo "race 2 fixture without a venue (rolled back): clean-up would answer $before"
[ "$before" = "deleted" ] || fail "the race 2 fixture should qualify for deletion"

psql "$DATABASE_URL" -qAt -v ON_ERROR_STOP=1 >/dev/null <<SQL &
begin;
update public.app_flags set enabled = true where name = 'self_serve_signup';
set local role service_role;
-- The tag as the legal version keeps the row findable for the clean-up at the end.
select public.provision_self_serve_brand('$USER_2', 'Race Two Tavern', 'bar', '$TAG-2@example.invalid', '$TAG');
reset role;
update public.app_flags set enabled = $( [ "$SWITCH" = t ] && echo true || echo false ) where name = 'self_serve_signup';
select pg_sleep(3);
commit;
SQL
A_PID=$!

sleep 1
start="$(date +%s)"
psql "$DATABASE_URL" -qAtc "set role service_role; select public.delete_stale_self_serve_login('$USER_2') ->> 'status'" >"$OUT"
end="$(date +%s)"
wait "$A_PID"

status="$(tr -d '[:space:]' <"$OUT")"
waited=$((end - start))
login="$(psql "$DATABASE_URL" -qAtc "select count(*) from auth.users where id = '$USER_2'")"
owner="$(psql "$DATABASE_URL" -qAtc "select count(*) from public.accounts a join public.account_members m on m.account_id = a.id and m.user_id = '$USER_2' and m.role = 'owner' where a.business_name = 'Race Two Tavern'")"
flag="$(psql "$DATABASE_URL" -qAtc "select enabled from public.app_flags where name = 'self_serve_signup'")"
echo "race 2 (venue first): clean-up status=$status waited=${waited}s login_left=$login owner_membership=$owner switch_after=$flag"
if [ "$status" != "kept" ] || [ "$waited" -lt 1 ] || [ "$login" != "1" ] || [ "$owner" != "1" ] || [ "$flag" != "$SWITCH" ]; then
  fail "race 2"
fi

echo "provision_self_serve_brand_lock_verify: pass"
