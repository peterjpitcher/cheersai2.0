# Codebase Cleanup & Reorganisation Plan

## Guiding Principles
- Keep lint rules strict; do not disable checks to pass.
- Work in small branches scoped to a single domain or warning class.
- After each change-set, run:
  - `npm run lint`
  - `npm run test`
  - `npm run build`
- Merge only when the targeted area is clean and all checks succeed.

## Phase 1 — Publishing Feature
1. `app/(authed)/publishing/queue/page.tsx`
   - Remove unused `eslint-disable` directives
   - Replace legacy Tailwind classes (`flex-shrink-0`, unordered class lists)
   - Use `next/image` instead of `<img>`
2. `app/(authed)/campaigns/[id]/publishing/page.tsx`
   - Remove redundant `@ts-ignore`
   - Ensure modal components function without suppressions
3. `components/calendar/FullCalendar.tsx`
   - Clean mount effect; no unused disable
4. `components/publish-modal.tsx`
   - Fix redundant `alt` text

_Validate with lint/test/build and merge branch `feature/publishing-cleanup`._

## Phase 2 — Campaign Editing UI
1. `app/(authed)/campaigns/[id]/generate/page.tsx`
   - Fix `useCallback` dependencies, Tailwind order, `<img>` usage, `autoFocus`
2. `app/(authed)/campaigns/[id]/client-page.tsx`
   - Replace `img` tags, ensure accessibility (keyboard handlers, alt text)

_Run lint/test/build; merge._

## Phase 3 — Guardrails & Settings
1. `app/(authed)/settings/guardrails/page.tsx`
   - Remove obsolete disables, verify search logic
2. Address related settings components with similar issues

_Run lint/test/build; merge._

## Phase 4 — Publishing API & Cron Routes
1. `app/api/queue/process/route.ts`
2. `app/api/cron/route.ts`
3. `app/api/gdpr/cleanup/route.ts`

_Focus on typing, `prefer-const`, and removing suppressions._

## Phase 5 — Reliability & Security Libraries
1. `lib/reliability/*`
2. `lib/security/*`
3. `lib/inspiration/orchestrator.ts`
4. `lib/rate-limit.ts`
5. `lib/reliability/api-client.ts`
6. `lib/reliability/retry.ts`

_Introduce proper TypeScript types, ensure ESM imports, remove `any` usage._

## Phase 6 — Remaining Lint Sweep
- After Phase 5, run full lint to identify remaining hotspots (e.g., `lib/openai/*`, `lib/social/*`, `lib/supabase/*`, `lib/validation/*`).
- Tackle each module individually with lint/test/build validation.

## Phase 7 — Directory Reorganisation (Optional)
1. Agree on target structure (e.g., feature-first under `app/features/*`).
2. Update import aliases (`tsconfig`, `eslint`, `jest`).
3. Move one domain at a time, fix imports, document the new layout.

## Final Verification
- Run `npm run lint`, `npm run test`, `npm run build` on `main`.
- Enable CI gates (lint/test) to prevent regressions.

