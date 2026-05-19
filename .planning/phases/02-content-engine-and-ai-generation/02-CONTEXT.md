# Phase 2: Content Engine and AI Generation - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Owner can create all five content types (Instant Post, Story, Event, Promotion, Weekly Recurring), have AI generate platform-specific copy with fine-tune controls, upload media, and schedule content on the planner calendar — all within a responsive design system with dark mode support. Publishing to actual platforms is Phase 3+4; this phase covers creation, generation, media, scheduling UI, and design foundations.

</domain>

<decisions>
## Implementation Decisions

### Create Flow Steps
- **D-01:** Multi-step wizard with 4 steps: 1) Pick type + write brief, 2) AI generates — review/edit per platform, 3) Attach media, 4) Schedule + confirm
- **D-02:** Shared wizard for all 5 content types with type-specific fields at step 1 — Event adds date/venue fields, Promotion adds coupon code, Weekly Recurring adds recurrence config. Same 4-step structure throughout.
- **D-03:** Auto-save draft to DB on each step change. If owner closes mid-flow, they can resume where they left off. Prevents lost work.

### AI Generation Controls
- **D-04:** Progressive disclosure for fine-tune controls. Sensible defaults with a collapsible "Advanced" panel. Most owners just click "Generate" — power users expand to tweak tone/length/CTA/proof-points.
- **D-05:** Curated hospitality tones (5-6 named options): Friendly & Warm, Professional, Playful, Sophisticated, Community-focused. Industry-specific language, not generic sliders.
- **D-06:** Regenerate-with-modifier uses inline modifier chips below AI output: "Make shorter", "More formal", "Add emoji", "Stronger CTA". One click regenerates with that modifier applied. No free-text prompt editing.
- **D-07:** Per-platform AI output shown as side-by-side columns (Facebook, Instagram, GBP) for comparison. Columns stack vertically on mobile/tablet for responsiveness.

### Design System Identity
- **D-08:** Bold & branded visual feel — strong brand colour presence, chunky elements, personality-driven. The platform should feel like it has character, not just clean utility.
- **D-09:** Dark mode supported from the start. Design tokens support both light and dark themes from day one via CSS custom properties. Avoids costly retrofit later.
- **D-10:** Subtle micro-interactions using Framer Motion — smooth page transitions, hover states, loading skeletons. Polished but not flashy.
- **D-11:** Compact/dense card density in list views (planner, library, campaigns). Tight padding, 4-5 cards per row on desktop. Maximises content visible per screen.

### Media Library
- **D-12:** Media upload panel combines drag-drop zone, "Browse" file picker, and "Library" tab showing previously uploaded media — all three in one panel within the wizard's media step.
- **D-13:** Manual free-text tags on upload. Media automatically tagged with campaign name when attached to content. Search by tag or campaign name.
- **D-14:** Media stored in Supabase Storage — RLS-protected buckets, direct URL serving, image transforms via CDN. No additional service dependency.
- **D-15:** Media library accessible both as standalone `/library` page for browsing/managing all media, and as inline picker within the create wizard.

### Claude's Discretion
- Exact spacing token values (4px scale implementation)
- Typography scale and heading hierarchy
- Loading skeleton designs per view
- Error state UI patterns
- Platform preview mockup fidelity in review step
- Dark mode colour palette specifics (derived from brand colours)
- Exact modifier chip set (beyond the 4 examples above)
- Banner/overlay image generation approach

### Folded Todos
None — no pending todos matched this phase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Content Creation
- `.planning/REQUIREMENTS.md` §Content Creation — CONT-01 through CONT-08 define all content type requirements
- `.planning/REQUIREMENTS.md` §AI Generation — AI-01 through AI-09 define generation, fine-tune, structured output, post-processing

### Scheduling
- `.planning/REQUIREMENTS.md` §Scheduling — SCHED-01 (planner calendar), SCHED-02 (conflict detection), SCHED-03 (recurring materialiser), SCHED-05 (Europe/London timezone)

### UX & Design System
- `.planning/REQUIREMENTS.md` §UX & Design System — UX-01 through UX-10 define design tokens, responsive layout, accessibility, status chips

### Project Context
- `.planning/PROJECT.md` §Constraints — Tech stack, Europe/London timezone, security-first mandate
- `.planning/PROJECT.md` §Key Decisions — Provider abstraction, Supabase Realtime, magic link auth

### Prior Phase
- `.planning/phases/01-security-and-auth-foundation/01-CONTEXT.md` — Auth flow, schema baseline, RLS patterns, token vault decisions

### Codebase Patterns
- `.planning/codebase/ARCHITECTURE.md` — Layered architecture, server actions pattern
- `.planning/codebase/CONVENTIONS.md` — Naming, error handling, type conversion
- `.planning/codebase/STACK.md` — Full dependency list and versions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ui/` — Radix-based primitives (button, card, dialog, input, tabs, sheet, skeleton, sidebar, tooltip, badge, label, separator) — foundation for design system
- `src/app/globals.css` — Brand colours, semantic tokens, sidebar theme already defined — extend for dark mode and full token set
- `src/hooks/use-mobile.tsx` — Mobile detection hook for responsive behaviour

### Established Patterns
- Server actions return `Promise<{ success?: boolean; error?: string }>`
- `fromDb<T>()` for snake_case to camelCase conversion
- `requireAuthContext()` for server-side auth in actions
- Feature-first directory structure: `src/features/`, shared in `src/lib/`
- Zod schema validation at API boundaries

### v1 Reference Code (not carried forward, but informative)
- `src/lib/ai/` — AI client, prompts, voice model, pillars, postprocess, content-rules, proof-points
- `src/lib/create/` — Event cadence, schema, service, story schedule
- `src/lib/scheduling/` — Conflict detection, materialisation, spread, campaign timing
- `src/lib/banner/` — Config, palette, server rendering (with tests)
- `src/lib/library/` — Data access, tags, client derivatives
- `src/features/create/` — Full wizard, all 5 content type forms, streaming preview, media selector
- `src/features/planner/` — Calendar, activity feed, banner overlay, content schedule form

### Integration Points
- `src/app/(app)/` — Protected app routes (auth guard from Phase 1)
- `src/app/(app)/layout.tsx` — App shell with sidebar (where new nav items land)
- `src/lib/supabase/` — Client factories (server, service-role, browser)
- `src/env.ts` — Extend with any new env vars (e.g. Supabase Storage bucket name)

</code_context>

<specifics>
## Specific Ideas

- Side-by-side platform columns for comparison during AI review — owner wants to see all three platforms at once
- Compact/dense card views — owner wants to maximise visible content, not generous whitespace
- Bold & branded feel — the platform should have personality and character, not generic SaaS clean
- Dark mode from day one — owner considers this essential, not a polish item

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-content-engine-and-ai-generation*
*Context gathered: 2026-05-19*
