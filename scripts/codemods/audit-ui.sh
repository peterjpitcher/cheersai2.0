#!/usr/bin/env bash
set -euo pipefail

echo "== Auditing legacy UI patterns =="

echo "\n-- Legacy btn-* classes --"
rg -n "\bbtn-(primary|secondary|ghost|danger|destructive)\b" --glob '!node_modules' --ts --tsx || true

echo "\n-- Legacy input-field wrapper --"
rg -n "\binput-field\b" --glob '!node_modules' --ts --tsx || true

echo "\n-- alert() calls --"
rg -n "\balert\s*\(" --glob '!node_modules' --ts --tsx || true

echo "\n-- Hard-coded colour hexes in classnames --"
rg -n "[#][0-9a-fA-F]{6}" --glob '!node_modules' --ts --tsx --md --css | rg -n "class(Name)?|bg-\[|text-\[|border-\[|outline-\[" || true

echo "\n-- API routes missing export const runtime = 'nodejs' --"
comm -13 <(rg -l "^export const runtime" app/api -g "**/route.ts" | sort) <(rg -l ".*" app/api -g "**/route.ts" | sort) || true

echo "\n== Done =="

