---
phase: 02-content-engine-and-ai-generation
plan: 01
subsystem: ui
tags: [design-tokens, dark-mode, css-custom-properties, cva, lucide, typescript-types]

requires:
  - phase: 01-security-foundation-and-infrastructure
    provides: Auth types (AppUser, AuthContext), base globals.css, app layout with providers

provides:
  - Extended design tokens (status, platform, spacing, dark mode) in globals.css
  - StatusChip component for 6 content statuses
  - PlatformBadge component for 3 social platforms
  - ThemeProvider with dark mode toggle and localStorage persistence
  - ContentItem, ContentStatus, ContentType, Platform, PlatformCopy, DraftState types
  - MediaItem, ContentMediaAttachment types
  - CONTENT_TYPES, PLATFORMS, CONTENT_STATUSES constant arrays

affects: [02-02, 02-03, 02-04, 02-05, 02-06, 02-07, 02-08]

tech-stack:
  added: []
  patterns: [css-custom-properties-for-status-colours, class-based-dark-mode, cva-for-component-variants]

key-files:
  created:
    - src/components/providers/theme-provider.tsx
    - src/components/ui/status-chip.tsx
    - src/components/ui/platform-badge.tsx
    - src/types/content.ts
    - src/types/media.ts
  modified:
    - src/app/globals.css
    - src/app/layout.tsx
    - src/lib/constants.ts

key-decisions:
  - "Class-based dark mode (.dark) instead of prefers-color-scheme media query for programmatic toggle control"
  - "Status tokens are self-contrasting and remain unchanged in dark mode"
  - "CSS custom properties used for status/platform colours instead of Tailwind classes for dynamic theming"

patterns-established:
  - "Status colours via var(--status-{name}-fg/bg) CSS custom properties"
  - "Platform colours via var(--platform-{token}-bg) CSS custom properties"
  - "ThemeProvider wraps outside AppProviders in layout hierarchy"
  - "Domain types in src/types/{domain}.ts with camelCase matching snake_case DB columns"

requirements-completed: [UX-01, UX-04, UX-06]

duration: 2min
completed: 2026-05-19
---

# Phase 02 Plan 01: Design Tokens & Foundation Types Summary

**Design tokens for 6 status states, 3 platforms, 14 spacing values with dark mode toggle, plus content/media domain types and StatusChip/PlatformBadge components**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-19T09:21:22Z
- **Completed:** 2026-05-19T09:24:03Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Extended globals.css with status (6 states), platform (3), and spacing (14) design tokens plus full dark mode overrides
- Created ThemeProvider with system preference detection, localStorage persistence, and .dark class toggle
- Built StatusChip and PlatformBadge components using CSS custom properties for dynamic theming
- Defined ContentItem, MediaItem, PlatformCopy, DraftState TypeScript types matching database schema

## Task Commits

Each task was committed atomically:

1. **Task 1: Design tokens, dark mode provider, and theme wiring** - `22ae3c7` (feat)
2. **Task 2: StatusChip, PlatformBadge components, and domain type definitions** - `073bd0d` (feat)

## Files Created/Modified
- `src/app/globals.css` - Extended with status, platform, spacing tokens and .dark class overrides
- `src/components/providers/theme-provider.tsx` - Dark mode toggle provider with useTheme hook
- `src/app/layout.tsx` - ThemeProvider wrapping, suppressHydrationWarning on html
- `src/lib/constants.ts` - CONTENT_TYPES, PLATFORMS, CONTENT_STATUSES arrays
- `src/types/content.ts` - ContentItem, ContentStatus, ContentType, Platform, PlatformCopy, DraftState
- `src/types/media.ts` - MediaItem, ContentMediaAttachment
- `src/components/ui/status-chip.tsx` - Status badge with 6 states using CSS custom properties
- `src/components/ui/platform-badge.tsx` - Platform badge with Lucide icons and platform tokens

## Decisions Made
- Used class-based dark mode (.dark on html) instead of prefers-color-scheme media query -- enables programmatic toggle via ThemeProvider
- Status token colours are self-contrasting (high contrast fg on bg) and remain unchanged in dark mode
- CSS custom properties used for status/platform colours instead of static Tailwind classes -- enables runtime theming

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Design tokens and types are available for all subsequent plans in this phase
- StatusChip and PlatformBadge ready for use in content creation and planner views
- ThemeProvider wired and functional for dark mode testing

---
*Phase: 02-content-engine-and-ai-generation*
*Completed: 2026-05-19*
