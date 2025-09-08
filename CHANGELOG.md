# Changelog

All notable changes to this project are documented here.

## [Stage 2] - 2025-09-08

Highlights
- Unified feedback patterns (inline banners for blocking, Sonner toasts for non-blocking)
- Standardised buttons via `components/ui/button` including loading state
- Established form control wrappers and validation wiring
- Replaced hard-coded colours with CSS variables + Tailwind token mapping
- Consolidated app header into a single component
- Normalised page spacing via a `Container` component
- Documentation sweep: removed LinkedIn references; renamed Google My Business to Google Business Profile (GBP)

Developer Notes
- ESLint now flags legacy `btn-*` and `input-field` classes
- Codemods and audit scripts are available under `scripts/codemods` and `docs/development/CODEMODS.md`
- New API HTTP helpers and zod validation scaffolding added (see `lib/http.ts`)
- Routes using Node APIs must declare `export const runtime = 'nodejs'`

Migration
- Replace legacy `btn-*` usage with `<Button variant="..." />`
- Replace `alert(...)` with toasts or inline banners as per severity
- Prefer tokens over hex colours; see `tailwind.config.ts` and `app/globals.css`
- See `docs/development/ROLLING_OUT_STAGE2.md` for a detailed rollout guide

