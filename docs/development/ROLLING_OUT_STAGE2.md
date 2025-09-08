# Rollout Guide: Stage 2 UI/Docs Consolidation

This guide outlines how to deploy Stage 2 safely and how to migrate any downstream/custom code.

## What Changed

- Feedback: inline banners for blocking errors; Sonner toasts for non-blocking; dialogs for destructive confirms
- Buttons: single `<Button>` component with variants, sizes, icon placement, and loading state
- Forms: common wrappers ready for React Hook Form + zod adoption
- Colour Tokens: CSS variables with Tailwind mapping; no hard-coded brand hexes
- Layout: consolidated `AppHeader`; consistent page spacing via `Container`
- Docs: LinkedIn references removed; Google My Business renamed to Google Business Profile (GBP)

## Action Items

- Replace `btn-*` classes and `input-field` wrappers
- Replace `alert(...)` with toast/banners
- Map any hex colour usages to tokens in `tailwind.config.ts`
- Ensure routes using Node/Supabase/crypto include `export const runtime = 'nodejs'`

## Tools

- Audit helpers: `scripts/codemods/audit-ui.sh`
- Safe replacements (examples): `scripts/codemods/safe-replacements.sh`
- Reference: `docs/development/CODEMODS.md`

## Verification Checklist

- Lint passes: `npm run lint`
- Type-check passes: `npx tsc --noEmit`
- No `alert(` usages remain
- No legacy `btn-*` or `input-field` patterns
- No new hard-coded hex colours in classnames
- All affected routes declare `runtime = 'nodejs'`

## Communication

- Publish release notes (CHANGELOG)
- Note LinkedIn removal and GBP naming in docs
- Summarise migration steps for any contributors

