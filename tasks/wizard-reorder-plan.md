# Orchestration Plan: Create Wizard Reorder

## Plan Summary
Reorder the create wizard from Brief → Generate → Media → Schedule to Brief → Media → Schedule → Generate, passing media and schedule context into AI generation. Spec: tasks/spec-create-wizard-reorder.md.

## Work Streams
| # | Role | Wave | Depends On | Files Owned |
|---|------|------|------------|-------------|
| 1 | Wizard Core | 1 | None | create-wizard.tsx, instant-post-fields.tsx |
| 2 | AI Generation Context | 1 | None | ai-generate.ts, prompts.ts |
| 3 | Step Components | 1 | None | generate-step.tsx, schedule-step.tsx, media-step.tsx |
| 4 | Integration & Build | 2 | All Wave 1 | All files (read + fix) |

## Wave Structure
- Wave 1: [Wizard Core, AI Generation, Step Components] — parallel, no file overlap
- Wave 2: [Integration] — verify build, fix imports, reconcile types
