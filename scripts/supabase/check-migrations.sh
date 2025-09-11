#!/usr/bin/env bash
set -euo pipefail

# CI-friendly check that fails if local migrations are not aligned
# with the linked remote project.

echo "Running Supabase migrations alignment check (dry-run push)..."
OUTPUT=$(supabase db push --dry-run || true)
echo "$OUTPUT"

if echo "$OUTPUT" | rg -q "Remote database is up to date."; then
  echo "✅ Migrations are aligned."
  exit 0
else
  echo "❌ Migrations not aligned with remote. Run: npm run db:realign" >&2
  exit 1
fi

