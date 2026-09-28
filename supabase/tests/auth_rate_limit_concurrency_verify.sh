#!/usr/bin/env bash
# Concurrency check for public.consume_rate_limit (migration 20260928120000).
# LOCAL ONLY: run after a local rebuild, never against production.
#
# Fires 20 calls at one key at the same moment, from 20 separate connections, with a
# limit of 5, and passes only if exactly 5 are allowed. Then it deletes the probe key.
# Usage: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres \
#          bash supabase/tests/auth_rate_limit_concurrency_verify.sh
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the LOCAL database}"
case "$DATABASE_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "Refusing: DATABASE_URL is not a local database." >&2; exit 1 ;;
esac

KEY="verify:concurrent:$$"
CALLS=20
LIMIT=5
OUT="$(mktemp)"
trap 'rm -f "$OUT"; psql "$DATABASE_URL" -qAtc "delete from public.auth_rate_limits where key = '"'"'$KEY'"'"'" >/dev/null' EXIT

for _ in $(seq "$CALLS"); do
  psql "$DATABASE_URL" -qAtc "set role service_role; select allowed from public.consume_rate_limit('$KEY', $LIMIT, 60)" >>"$OUT" &
done
wait

allowed="$(grep -c '^t$' "$OUT" || true)"
blocked="$(grep -c '^f$' "$OUT" || true)"
echo "calls=$CALLS limit=$LIMIT allowed=$allowed blocked=$blocked"
if [ "$allowed" -ne "$LIMIT" ] || [ "$blocked" -ne $((CALLS - LIMIT)) ]; then
  echo "auth_rate_limit_concurrency_verify: FAIL" >&2
  exit 1
fi
echo "auth_rate_limit_concurrency_verify: pass"
