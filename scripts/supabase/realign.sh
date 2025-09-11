#!/usr/bin/env bash
set -euo pipefail

# Realign local Supabase migrations to the linked remote project.
# - Backs up current migrations to supabase/_backup
# - Fetches remote migration history into supabase/migrations
# - Verifies push dry-run is clean

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT_DIR"

mkdir -p supabase/_backup
if [ -d supabase/migrations ]; then
  TS=$(date +%Y%m%d_%H%M%S)
  mv supabase/migrations "supabase/_backup/migrations_${TS}"
  echo "Backed up local migrations to supabase/_backup/migrations_${TS}"
fi

echo "Fetching remote migration history..."
supabase migration fetch --linked

echo "Validating with dry-run push..."
if supabase db push --dry-run | rg -q "Remote database is up to date."; then
  echo "✅ Local migrations are aligned with remote."
else
  echo "❌ Dry-run push did not report up-to-date. Review output above." >&2
  exit 1
fi

echo "Done."

