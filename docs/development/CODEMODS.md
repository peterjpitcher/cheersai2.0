# Codemods: Find & Replace Aids (Stage 2)

Practical, low-risk commands to audit and migrate legacy UI patterns to our new design system.

Use these read-only audits first, then apply safe replacements where applicable. Prefer running in feature branches.

## Audit Commands

- Legacy button classes:
  ```bash
  rg -n "\\bbtn-(primary|secondary|ghost|danger|destructive)\\b" --glob '!node_modules' --ts --tsx
  ```

- Legacy input wrapper:
  ```bash
  rg -n "\\binput-field\\b" --glob '!node_modules' --ts --tsx
  ```

- Runtime `alert()` calls (replace with toasts or inline banners):
  ```bash
  rg -n "\\balert\\s*\\(" --glob '!node_modules' --ts --tsx
  ```

- Hard-coded colour hexes in classnames:
  ```bash
  rg -n "[#][0-9a-fA-F]{6}" --glob '!node_modules' --ts --tsx --md --css | rg -n "className|bg-\\[|text-\\[|border-\\[|outline-\\["
  ```

- API routes missing explicit Node runtime:
  ```bash
  comm -13 <(rg -l "^export const runtime" app/api -g "**/route.ts" | sort) <(rg -l ".*" app/api -g "**/route.ts" | sort)
  ```

- Direct `NextResponse.json({ error` shape (migrate to http helpers):
  ```bash
  rg -n "NextResponse\\.json\\(\\{\\s*error" app/api -g "**/route.ts"
  ```

## Safe Replacements (examples)

- Replace alert() with Sonner toast (manual review still required):
  ```bash
  # Example: alert('Saved') -> toast.success('Saved')
  sed -i '' "s/alert(\(['\"]/\(.*\)\1)/toast.success(\1)/g" $(rg -l "\\balert\\s*\\(")
  ```

- Remove legacy `btn-*` classes (migrate to <Button>):
  ```bash
  # Replace class tokens with nothing; then replace button element manually
  sed -i '' -E "s/\\bbtn-(primary|secondary|ghost|danger|destructive)\\b//g" $(rg -l "\\bbtn-(primary|secondary|ghost|danger|destructive)\\b")
  ```

- Hex colours in classnames → tokens (manual mapping):
  ```bash
  # Lists candidates; replace per design token mapping in tailwind.config.ts
  rg -n "[#][0-9a-fA-F]{6}" --ts --tsx --md --css | sort -u
  ```

- Add runtime to all routes using Node/Supabase/crypto:
  ```bash
  # Preview files missing runtime
  comm -13 <(rg -l "^export const runtime" app/api -g "**/route.ts" | sort) <(rg -l ".*" app/api -g "**/route.ts" | sort)
  # For each, add at top-level:
  # export const runtime = 'nodejs'
  ```

## Notes

- Always run `npm run lint` and `npx tsc --noEmit` after replacements.
- Prefer manual review for JSX structure changes (e.g. replacing `<button className>` with `<Button>`).
- Keep British English in UI copy; US spelling is fine in code.
- Do not run replacements in `node_modules` or generated files.

