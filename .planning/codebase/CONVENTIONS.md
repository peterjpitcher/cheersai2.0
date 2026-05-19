# Coding Conventions

**Analysis Date:** 2025-05-18

## Naming Patterns

**Files:**
- Components: PascalCase (e.g., `BannerOverlay.tsx`, `DeleteCampaignButton.tsx`)
- Utilities and helpers: camelCase (e.g., `palette.ts`, `validation.ts`, `time-utils.ts`)
- Test files: co-located alongside source with `.test.ts` or `.test.tsx` suffix (e.g., `palette.test.ts`, `banner-overlay.test.tsx`)
- Types: `snake_case` in database context, `camelCase` in TypeScript interfaces
- Server actions: camelCase with verb prefix (e.g., `createTournament`, `deleteCampaign`)

**Functions:**
- Utility functions: camelCase verb-first pattern
  - Getters: `getTournamentById`, `getFixturesByTournament`
  - Builders: `buildRepeatedBannerLabel`, `buildConnectionsMap`
  - Converters: `paletteFromColours`, `toMidnightLondon`
  - Validators: `checkTournamentPreconditions`, `validateCampaignCopy`
- React Components: PascalCase
- Hooks: `use` prefix (e.g., `use-now-minute.test.tsx`)

**Variables:**
- camelCase: standard for all variables
- Constants: UPPERCASE_SNAKE_CASE (e.g., `BANNER_LABEL_REPEAT_COUNT`, `DEFAULT_TIMEZONE`)
- React props: camelCase (e.g., `mediaUrl`, `postTemplate`, `houseRulesText`)

**Types:**
- Interfaces: PascalCase (e.g., `Tournament`, `CampaignPerformanceMetrics`)
- Type aliases for unions: PascalCase (e.g., `TournamentStatus`, `CampaignObjective`)
- Database domain types separate: snake_case in DB, camelCase in TS (converted via `fromDb<T>`)
- Enum-like types stored as unions: `type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'`

## Code Style

**Formatting:**
- Prettier (implicit via Next.js config)
- 2-space indentation
- Single quotes for strings
- Trailing commas in multi-line objects/arrays
- Line length: no hard limit enforced, but keep readable

**Linting:**
- ESLint config: `eslint.config.mjs` with Next.js presets (`eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`)
- Strict TypeScript: `tsconfig.json` has `"strict": true`
- No `any` types unless explicitly justified with a comment
- `skipLibCheck: true` (skip type checking of node_modules)
- `isolatedModules: true` (each file is independently valid)

**Key ESLint Rules Enforced:**
- Next.js core web vitals (image optimization, font optimization, script loading)
- TypeScript strict mode rules
- React hooks rules (built-in to next/typescript preset)
- Accessibility rules via JSX A11y plugin

## Import Organization

**Order:**
1. Node.js built-ins (`node:*` imports)
2. External packages (`react`, `next/*`, `@supabase/...`, third-party libraries)
3. Type imports from packages (`import type { ... } from "package"`)
4. Internal absolute imports using `@` alias (`@/types/...`, `@/lib/...`, `@/components/...`)
5. Relative imports (rarely used; prefer `@` alias)

**Path Aliases:**
- `@/*` → `./src/*` (defined in `tsconfig.json` and `vitest.config.ts`)
- Example: `import { formatFriendlyTime } from '@/lib/utils/date'`

**Module Organization:**
- Barrel exports not heavily used; direct imports preferred
- Internal helpers kept private (no `export`)
- Type exports always use `import type { ... }`

## Error Handling

**Patterns:**
- Server actions return `Promise<{ success?: boolean; error?: string }>` with optional additional fields
- Input validation via Zod schemas (e.g., `tournamentCreateSchema`, `fixtureCreateSchema`)
- Parse before using: `const parsed = schema.parse(input)` — throws if invalid
- Try/catch in server actions to catch Zod errors and Supabase errors
- Errors logged with context helpers (e.g., `tournamentDebugError`, `redactId`)
- No silent failures: always surface errors to caller via return value

**Example Pattern:**
```typescript
export async function createTournament(
  input: unknown,
): Promise<{ success: boolean; error?: string; tournamentId?: string }> {
  try {
    const parsed = tournamentCreateSchema.parse(input);
    const { supabase, accountId } = await requireAuthContext();
    // ... business logic ...
    return { success: true, tournamentId: data.id };
  } catch (err) {
    return { success: false, error: 'Failed to create tournament' };
  }
}
```

## Logging

**Framework:** Plain `console` methods (no dedicated logging library)

**Patterns:**
- Debug helpers with context: `tournamentDebug(redactId(tournamentId), 'doing work')`
- Error helpers: `tournamentDebugError(redactId(tournamentId), err)`
- All console calls should have descriptive context (what operation, which resource)
- Use `redactId()` to anonymize sensitive IDs in logs

**When to Log:**
- Entry/exit of long-running operations
- Important state transitions (draft → active)
- Errors with full context for debugging
- External API calls and responses (when safe)

## Comments

**When to Comment:**
- Algorithm explanations (especially date/timezone logic)
- Non-obvious business rules or constraints
- Workarounds with reason for workaround
- Complex regex patterns or data transformations
- Date/timezone handling edge cases (e.g., GMT vs BST transitions)

**Example from codebase:**
```typescript
// During GMT  (UTC+0, late October → late March): midnight London = 00:00 UTC same calendar day.
// During BST  (UTC+1, late March  → late October): midnight London = 23:00 UTC previous calendar day.
export function toMidnightLondon(isoDate: string): string { ... }
```

**JSDoc:**
- Exported functions have single-line or multi-line JSDoc
- Parameters documented only if non-obvious
- Example from codebase:
```typescript
/**
 * Format a Date as a friendly 12-hour time string (e.g. "6pm", "1:30pm").
 * Converts to the project default timezone before formatting.
 */
export function formatFriendlyTime(date: Date): string { ... }
```

## Function Design

**Size:**
- Aim for 20-50 lines (excluding comments)
- Extract helper functions aggressively for readability
- Single responsibility principle: one function, one job

**Parameters:**
- Max 3-4 parameters; use objects for related parameters
- Always typed explicitly: `function foo(id: string, count: number): Promise<Result>`
- Optional/nullable parameters at end, use `?` and `default` values
- Objects destructured at function signature when appropriate

**Return Values:**
- Always explicitly typed on exported functions
- Server actions return wrapped success/error objects: `Promise<{ success?: boolean; error?: string }>`
- Query functions return typed data (via `fromDb<T>`) or null
- Validators return structured result objects with `ready: boolean` and `missing: string[]`

**Example:**
```typescript
export function checkTournamentPreconditions(
  tournament: Tournament,
  hasConnections: Record<string, boolean>,
): TournamentPreconditionResult {
  const missing: string[] = [];
  // ... validation logic ...
  return { ready: missing.length === 0, missing };
}
```

## Module Design

**Exports:**
- Named exports for everything; no default exports
- Private helpers use no `export` keyword
- Barrel files (`index.ts`) not commonly used; direct imports preferred

**File Organization per Module:**
- Feature-specific code in `src/features/[feature]/`
- Shared utilities in `src/lib/[domain]/`
- Types in `src/types/[domain].ts` (centralized)
- Server actions in `src/app/actions/[domain].ts`
- Components in `src/components/` or `src/features/`

**Example Structure:**
```
src/lib/tournament/
├── validation.ts      # Zod schemas
├── queries.ts         # Data fetching
├── generate.ts        # Content generation
├── placeholder.ts     # Helper logic
└── template.test.ts   # Tests
```

## Type Patterns

**Database Types:**
- All database types centralized in `src/types/database.ts` (or domain-specific: `tournament.ts`, `campaigns.ts`)
- Database columns: `snake_case`
- TypeScript properties: `camelCase`
- Conversion always via `fromDb<T>(dbRow)` utility

**Server Action Returns:**
```typescript
Promise<{ success?: boolean; error?: string }>
// or with additional fields:
Promise<{ success: boolean; error?: string; tournamentId?: string }>
```

**Props Interfaces:**
- Named interface, never inline anonymous object for props
- Convention: `interface ComponentNameProps { ... }`
- Example:
```typescript
interface DeleteCampaignButtonProps {
  campaignId: string;
  campaignName: string;
}
```

---

*Convention analysis: 2025-05-18*
