#!/usr/bin/env bash
set -euo pipefail

# Determine merge base against main or PR base
git fetch origin +refs/heads/*:refs/remotes/origin/* >/dev/null 2>&1 || true

BASE_REF=${GITHUB_BASE_REF:-origin/main}
if git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  MERGE_BASE=$(git merge-base HEAD "$BASE_REF")
else
  MERGE_BASE=$(git merge-base HEAD origin/main || echo "")
fi

if [ -n "$MERGE_BASE" ]; then
  CHANGED=$(git diff --name-only --diff-filter=ACMRT "$MERGE_BASE"...HEAD |
    grep -E '\.(ts|tsx|js|jsx|cjs|mjs|css|scss)$' || true)
else
  CHANGED=$(git diff --name-only --diff-filter=ACMRT origin/main... |
    grep -E '\.(ts|tsx|js|jsx|cjs|mjs|css|scss)$' || true)
fi

if [ -z "${CHANGED}" ]; then
  echo "No changed files to lint."
  exit 0
fi

echo "Linting changed files:" $CHANGED

# ESLint on changed files
npx eslint --max-warnings=0 $CHANGED

# Prettier check on changed files
npx prettier -c $CHANGED

# Stylelint only on CSS/SCSS
CSS_CHANGED=$(echo "$CHANGED" | tr ' ' '\n' | grep -E '\.(css|scss)$' || true)
if [ -n "$CSS_CHANGED" ]; then
  npx stylelint $CSS_CHANGED
fi

