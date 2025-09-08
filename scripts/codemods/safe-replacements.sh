#!/usr/bin/env bash
set -euo pipefail

echo "This script contains example replacements. Review diffs before committing."

# Example: remove legacy btn-* class tokens (manual component migration still needed)
if rg -n "\bbtn-(primary|secondary|ghost|danger|destructive)\b" --ts --tsx > /dev/null; then
  files=$(rg -l "\bbtn-(primary|secondary|ghost|danger|destructive)\b" --ts --tsx)
  echo "Removing legacy btn-* classes in:"
  echo "$files"
  # macOS BSD sed (use gsed -i for GNU sed)
  sed -i '' -E "s/\bbtn-(primary|secondary|ghost|danger|destructive)\b//g" $files
fi

# Example: replace alert('...') -> toast.success('...')
if rg -n "\balert\s*\(" --ts --tsx > /dev/null; then
  files=$(rg -l "\balert\s*\(" --ts --tsx)
  echo "Replacing alert(...) with toast.success(...) in:"
  echo "$files"
  sed -i '' -E "s/alert\((\'|\")(.*?)(\'|\")\)/toast.success(\1\2\3)/g" $files || true
fi

echo "Done. Run: npm run lint && npx tsc --noEmit"

