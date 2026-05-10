# Orchestration Plan: instant-post-cleanup

## Plan Summary
Execute SPEC + PLAN under `tasks/instant-post-cleanup/`. Three agents across two waves: TDD-red tests + Zod schema in Wave 1, backend (service + route) and frontend (form) in parallel in Wave 2. Verification handled by orchestrator.

## Eligibility Gate
| Criterion | Result |
|-----------|--------|
| ≥2 natural work streams | ✓ tests/schema vs backend vs frontend |
| Limited overlap | ✓ each agent owns distinct files |
| Parallel/sequential helps | ✓ TDD discipline; backend/frontend parallelisable |
| Coordination overhead worth it | ✓ user explicitly invoked the skill |

## Work Streams
| # | Role | Wave | Depends On | Owns |
|---|------|------|------------|------|
| 1 | Test+Schema Author | 1 | None | `src/lib/create/schema.ts`, `tests/lib/create/service.test.ts`, `tests/api/generate-stream-route.test.ts` |
| 2 | Backend Implementer | 2 | Wave 1 schema | `src/lib/create/service.ts`, `src/app/api/create/generate-stream/route.ts` |
| 3 | Frontend Implementer | 2 | Wave 1 schema | `src/features/create/instant-post-form.tsx` |

## Wave Structure
- **Wave 1:** Test+Schema Author
- **Wave 2:** Backend Implementer + Frontend Implementer (parallel)
- **Verification (orchestrator):** Stage 1 = `npm run ci:verify`; Stage 2 = codex-qa-review (Mode B)

## Workspace
```
tasks/instant-post-cleanup/orchestration/
├── plan.md (this file)
├── wave-1/
│   └── test-schema-author/handoff.md
└── wave-2/
    ├── backend-implementer/handoff.md
    └── frontend-implementer/handoff.md
```

## Commits (5 expected, per PLAN.md)
1. Wave 1: `test(create): add instant-post banner + story-OpenAI regression cases (red)` AND `feat(create): accept optional banner override in instant-post schema`
2. Wave 2 Backend: `fix(create): instant posts always write explicit banner_enabled` AND `fix(create): skip OpenAI for story placements, lazy-init client`
3. Wave 2 Frontend: `feat(create): add banner overlay picker stage to instant post form`
