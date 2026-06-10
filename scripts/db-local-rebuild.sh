#!/usr/bin/env bash
# Rebuild the LOCAL Supabase database from scratch with the v1 baseline staged first.
#
# The v1 baseline (supabase/baseline/v1_baseline.sql) is NOT a committed migration — it
# supplies the v1 objects the migration chain assumes already exist (ad_sets, ads,
# advisory_lock_fixture, publish_jobs_with_variant, …). This script stages it as the
# first migration after the v1->v2 bridge, runs `supabase db reset`, then ALWAYS removes
# the staged copy (via the EXIT trap) so it can never be committed or pushed to prod.
# CI performs the same staging step in .github/workflows/ci.yml.
#
# Usage: npm run db:rebuild        (the local stack must be running: `supabase start`)
#        npm run db:rebuild -- --no-seed   (extra args are forwarded to `supabase db reset`)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGED="$ROOT/supabase/migrations/20260519230001_v1_baseline.sql"

cleanup() { rm -f "$STAGED"; }
trap cleanup EXIT

cp "$ROOT/supabase/baseline/v1_baseline.sql" "$STAGED"
echo "Staged v1 baseline -> $STAGED"
supabase db reset "$@"
