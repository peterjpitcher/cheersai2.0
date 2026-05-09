# Orchestration Plan: proximity-label week-aware fix

## Plan Summary
Execute the SPEC and PLAN under `tasks/banner-orchestration/proximity-week-fix/`. Two waves: tests first (TDD red), then implementation (TDD green). Orchestrator handles verification.

## Eligibility Gate
| Criterion | Result |
|-----------|--------|
| ≥2 natural work streams | ✓ test authoring vs implementation |
| Limited overlap | ✓ tests in `tests/`, source in `src/` and `supabase/functions/` |
| Parallel/sequential helps | ✓ TDD discipline requires tests-before-fix |
| Coordination overhead worth it | ✓ explicit user invocation; well-bounded scope |

## Work Streams
| # | Role | Wave | Depends On | Owns |
|---|------|------|------------|------|
| 1 | Test Author | 1 | None | `tests/lib/scheduling/proximity-label.test.ts` (additions only); new `tests/lib/scheduling/proximity-label-parity.test.ts` |
| 2 | Implementer | 2 | Wave 1 outputs | `src/lib/scheduling/proximity-label.ts`; `supabase/functions/publish-queue/banner-label.ts` |

Single Implementer (not two parallel) chosen deliberately: identical logic across two duplicated runtimes — one author guarantees byte-level consistency. Drift is the failure mode the plan is designed to prevent; splitting the work would re-introduce that risk.

## Wave Structure
- **Wave 1:** Test Author
- **Wave 2:** Implementer
- **Verification (orchestrator):**
  - Stage 1: `npm run ci:verify` (lint + typecheck + test + build)
  - Stage 2: codex-qa-review of the resulting code (Mode B — Code Review)

## Workspace
```
tasks/banner-orchestration/proximity-week-fix/orchestration/
├── plan.md  (this file)
├── wave-1/
│   └── test-author/
│       └── handoff.md
└── wave-2/
    └── implementer/
        └── handoff.md
```

## Commits (4 total, per PLAN.md)
1. `test(proximity-label): add bug regression, DST and year-boundary cases (red)` — Test Author
2. `test(proximity-label): add behavioural parity test between Node and Deno copies` — Test Author
3. `fix(proximity-label): use calendar-week diff for 7+ day labels` — Implementer
4. `fix(publish-queue): mirror week-aware proximity label in Deno worker` — Implementer
