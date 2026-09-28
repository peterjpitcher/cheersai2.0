#!/usr/bin/env bash
# Row-lock check for public.delete_stale_self_serve_login (migration 20260928170000).
# LOCAL ONLY: run after a local rebuild, never against production.
#
# A stale self-serve login (unconfirmed, last asked 8 days ago) asks to sign up
# again at the moment the retention cron tries to delete it. Session A records
# the new request (record_self_serve_signup_request, which locks the sign-up
# row) and holds its transaction open for 3 seconds; session B, started a
# second later, calls delete_stale_self_serve_login on the same login. B must
# wait for A, then see the fresh request and keep the login. Passes only if B
# answers "kept", had to wait (at least a second), and the login still exists.
# Everything it creates is deleted at the end.
# Usage: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres \
#          bash supabase/tests/self_serve_login_delete_lock_verify.sh
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the LOCAL database}"
case "$DATABASE_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "Refusing: DATABASE_URL is not a local database." >&2; exit 1 ;;
esac

USER_ID="$(psql "$DATABASE_URL" -qAtc "select gen_random_uuid()")"
EMAIL="lock-verify-$$@example.invalid"
OUT="$(mktemp)"
cleanup() {
  rm -f "$OUT"
  psql "$DATABASE_URL" -qAtc "delete from auth.users where id = '$USER_ID'; delete from public.self_serve_signups where user_id = '$USER_ID' or (user_id is null and legal_version = 'lock-verify-$$')" >/dev/null
}
trap cleanup EXIT

psql "$DATABASE_URL" -qAt -v ON_ERROR_STOP=1 <<SQL >/dev/null
insert into auth.users (id, email, created_at) values ('$USER_ID', '$EMAIL', now() - interval '8 days');
insert into public.self_serve_signups (user_id, requested_at, last_requested_at, legal_version)
  values ('$USER_ID', now() - interval '8 days', now() - interval '8 days', 'lock-verify-$$');
SQL

before="$(psql "$DATABASE_URL" -qAtc "begin; set local role service_role; select public.delete_stale_self_serve_login('$USER_ID') ->> 'status'; rollback;" | grep -E '^(kept|deleted|failed)$')"
echo "without a concurrent request (rolled back): $before"
if [ "$before" != "deleted" ]; then
  echo "self_serve_login_delete_lock_verify: FAIL (the fixture login should qualify for deletion)" >&2
  exit 1
fi

# Session A: a new sign-up request that holds the row lock for 3 seconds.
psql "$DATABASE_URL" -qAt -v ON_ERROR_STOP=1 <<SQL >/dev/null &
begin;
set local role service_role;
select public.record_self_serve_signup_request('$USER_ID');
select pg_sleep(3);
commit;
SQL
A_PID=$!

sleep 1
start="$(date +%s)"
psql "$DATABASE_URL" -qAtc "set role service_role; select public.delete_stale_self_serve_login('$USER_ID') ->> 'status'" >"$OUT"
end="$(date +%s)"
wait "$A_PID"

status="$(tr -d '[:space:]' <"$OUT")"
waited=$((end - start))
exists="$(psql "$DATABASE_URL" -qAtc "select count(*) from auth.users where id = '$USER_ID'")"
echo "with a request holding the lock: status=$status waited=${waited}s login_still_there=$exists"
if [ "$status" != "kept" ] || [ "$waited" -lt 1 ] || [ "$exists" != "1" ]; then
  echo "self_serve_login_delete_lock_verify: FAIL" >&2
  exit 1
fi
echo "self_serve_login_delete_lock_verify: pass"
