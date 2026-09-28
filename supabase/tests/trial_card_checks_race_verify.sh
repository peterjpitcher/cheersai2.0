#!/usr/bin/env bash
# Concurrency check for public.trial_card_checks (migration 20260928200000,
# tasks/SPEC-self-serve-signup.md §4.7). LOCAL ONLY: never against production.
#
# The app's decision is race-safe only if the database lets exactly one insert
# win when many run at once, each on its own connection (as parallel webhook
# reconciles do through PostgREST):
#   1. 20 different subscriptions insert 'first_trial' for the SAME card at the
#      same moment: exactly 1 may succeed (the partial unique index); the other
#      19 get a unique violation and go on to record 'repeat_refused'.
#   2. 20 connections insert 'repeat_refused' for the SAME subscription: exactly
#      1 may succeed (the primary key), so only one reconcile cancels in Stripe.
# The probe brand and its rows are deleted at the end (on delete cascade).
# Usage: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres \
#          bash supabase/tests/trial_card_checks_race_verify.sh
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the LOCAL database}"
case "$DATABASE_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "Refusing: DATABASE_URL is not a local database." >&2; exit 1 ;;
esac

CALLS=20
TAG="race$$"
CARD="$(printf 'f%.0s' $(seq 64))"
OUT="$(mktemp -d)"

BRAND="$(psql "$DATABASE_URL" -qAtX -c "insert into public.accounts (business_name, email, auth_user_id) values ('Card race probe $TAG', 'card-race-$TAG@example.invalid', gen_random_uuid()) returning id" | head -n 1)"
cleanup() {
  rm -rf "$OUT"
  psql "$DATABASE_URL" -qAtX -c "delete from public.accounts where id = '$BRAND'" >/dev/null
}
trap cleanup EXIT

insert() {
  # One connection, one insert as service_role; prints ok or the SQLSTATE.
  local sub="$1" outcome="$2" file="$3"
  if psql "$DATABASE_URL" -qAtX -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.trial_card_checks (stripe_subscription_id, account_id, card_hash, outcome) values ('$sub', '$BRAND', '$CARD', '$outcome')" >/dev/null 2>"$file.err"; then
    echo ok >"$file"
  else
    grep -q 'duplicate key value violates unique constraint' "$file.err" && echo conflict >"$file" || { echo error >"$file"; cat "$file.err" >&2; }
  fi
}

# 1. Same card, different subscriptions, all at once.
for i in $(seq "$CALLS"); do
  insert "sub_${TAG}_$i" first_trial "$OUT/first_$i" &
done
wait
first_ok="$(cat "$OUT"/first_? "$OUT"/first_?? 2>/dev/null | grep -c '^ok$' || true)"
first_conflict="$(cat "$OUT"/first_? "$OUT"/first_?? 2>/dev/null | grep -c '^conflict$' || true)"
echo "same card, $CALLS subscriptions at once: first_trial inserted=$first_ok unique_violation=$first_conflict"

# 2. Same subscription, all at once (the refusal step of parallel reconciles).
for i in $(seq "$CALLS"); do
  insert "sub_${TAG}_refused" repeat_refused "$OUT/refused_$i" &
done
wait
refused_ok="$(cat "$OUT"/refused_? "$OUT"/refused_?? 2>/dev/null | grep -c '^ok$' || true)"
refused_conflict="$(cat "$OUT"/refused_? "$OUT"/refused_?? 2>/dev/null | grep -c '^conflict$' || true)"
echo "same subscription, $CALLS connections at once: repeat_refused inserted=$refused_ok unique_violation=$refused_conflict"

rows="$(psql "$DATABASE_URL" -qAtX -c "select count(*) filter (where outcome = 'first_trial') || ',' || count(*) filter (where outcome = 'repeat_refused') from public.trial_card_checks where account_id = '$BRAND'")"
echo "stored rows (first_trial,repeat_refused): $rows"

if [ "$first_ok" -ne 1 ] || [ "$first_conflict" -ne $((CALLS - 1)) ] \
  || [ "$refused_ok" -ne 1 ] || [ "$refused_conflict" -ne $((CALLS - 1)) ] || [ "$rows" != "1,1" ]; then
  echo "trial_card_checks_race_verify: FAIL" >&2
  exit 1
fi
echo "trial_card_checks_race_verify: pass"
