# Testing Patterns

**Analysis Date:** 2025-05-18

## Test Framework

**Runner:**
- Vitest (default test framework, not Jest)
- Config: `vitest.config.ts`
- Environment: `node` (not jsdom by default; override with `@vitest-environment jsdom` comment in test file)
- Test discovery: `tests/**/*.test.ts`, `src/**/*.test.ts`, `src/**/*.test.tsx`

**Assertion Library:**
- Vitest built-in `expect()` and assertions
- `@testing-library/react` for React component testing
- `@testing-library/jest-dom/vitest` for DOM assertions (loaded in setup)

**Run Commands:**
```bash
npm test                       # Run all tests once
npm run test:watch            # Watch mode (Vitest)
npm run test:ci               # With coverage report
npx vitest run src/lib/banner/palette.test.ts  # Single test file
```

## Test File Organization

**Location:**
- Co-located with source code: `src/**/*.test.ts` or `src/**/*.test.tsx`
- Not in separate `tests/` directory (though that directory exists for setup files)

**Naming:**
- Matches source file: `palette.ts` → `palette.test.ts`
- Component test: `BannerOverlay.tsx` → `banner-overlay.test.tsx`

**Structure by Type:**

```
src/lib/banner/
├── palette.ts
├── palette.test.ts          # Unit test
├── config.ts
├── config.test.ts
└── render-server.test.ts

src/features/planner/
├── banner-overlay.tsx
└── banner-overlay.test.tsx  # Component test (@vitest-environment jsdom)

src/lib/campaigns/
├── generate.ts
└── generate.test.ts         # Unit test with mocked clients
```

## Test Structure

**Suite Organization:**
Use nested `describe()` blocks grouped by feature or function:

```typescript
describe('validateCampaignCopy', () => {
  describe('cash-on-arrival payment reassurance', () => {
    it('passes when primary_text includes "No payment now"', () => {
      // ...
    });
  });

  describe('generic phrase detection', () => {
    it('flags "don\'t miss" in ad copy', () => {
      // ...
    });
  });
});
```

**Test Naming Pattern:**
- `it('should [expected behaviour] when [condition]', () => { ... })`
- Examples:
  - `it('returns "bronze" for the bronze preset (canonical lowercase hex)', () => { ... })`
  - `it('matches palettes case-insensitively (uppercase hex)', () => { ... })`
  - `it('passes when primary_text includes "No payment now"', () => { ... })`

**Patterns:**

1. **Setup/Teardown:** No global state; factories create fresh test data per test
2. **Assertions:** Chain multiple assertions in happy-path tests; one assertion per error-case test
3. **Mocking:** Module-level mocks via `vi.mock()`; function-level spies via `vi.spyOn()`
4. **Factories:** Helper functions (`makeAd()`, `makePayload()`) to generate test data

**Example Structure:**
```typescript
import { describe, it, expect, vi } from 'vitest';

describe('paletteFromColours', () => {
  it('returns "bronze" for the bronze preset', () => {
    const result = paletteFromColours(BANNER_PALETTES.bronze.bg, BANNER_PALETTES.bronze.text);
    expect(result).toBe('bronze');
  });

  it('falls back to bronze for unrecognised hex values', () => {
    expect(paletteFromColours('#000000', '#FFFFFF')).toBe('bronze');
    expect(paletteFromColours('#123456', '#FFFFFF')).toBe('bronze');
  });
});
```

## Mocking

**Framework:** Vitest `vi` module (`vi.mock()`, `vi.spyOn()`, `vi.fn()`)

**Module-Level Mocks:**
```typescript
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: (_, __) => (props: Record<string, unknown>) => props['children'] ?? null }),
  AnimatePresence: ({ children }: { children: unknown }) => children,
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn(), set: vi.fn() }),
}));
```

**Function-Level Mocks (for OpenAI, Supabase, external clients):**
```typescript
function makeMockClient(responseContent: string | null) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: responseContent } }],
        }),
      },
    },
  } as any;
}

// Usage:
const client = makeMockClient(JSON.stringify(expectedResponse));
const result = await attemptCopyCorrection(client, original, issues, options);
expect(client.chat.completions.create).toHaveBeenCalled();
```

**What to Mock:**
- External services: Supabase client, OpenAI API, Resend email, third-party HTTP clients
- Heavy UI libraries: Framer Motion, heavy animation libraries
- Browser APIs: `fetch` (if testing server logic), `localStorage`

**What NOT to Mock:**
- Internal utility functions (date formatters, validators, helpers)
- Type conversion helpers (`fromDb<T>`)
- Internal business logic modules
- Standard library functions

**Setup File Pattern:**
`tests/setup.ts` sets environment variables and global mocks before any test runs:
```typescript
import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock Framer Motion globally
vi.mock('framer-motion', () => ({ ... }));

// Set env vars required by src/env.ts
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key';
process.env.OPENAI_API_KEY = 'mock-openai-key';

// Mock Deno if it doesn't exist
if (!globalThis.Deno) {
  globalThis.Deno = { env: { get: (key: string) => process.env[key] } };
}
```

## Fixtures and Factories

**Test Data Pattern:**
Use factory functions to generate test fixtures, not inline object literals:

```typescript
function makeAd(overrides: Partial<AiCampaignPayload['ad_sets'][number]['ads'][number]> = {}) {
  return {
    name: 'Ad 1',
    headline: 'Book your seats now',
    primary_text: 'Grab your table...',
    description: 'Reserve your table',
    cta: 'BOOK_NOW' as const,
    creative_brief: 'Fun quiz night atmosphere',
    angle: 'Booking urgency',
    ...overrides,  // Allow per-test customization
  };
}

function makePayload(ads: AiCampaignPayload['ad_sets'][number]['ads'][number][]): AiCampaignPayload {
  return {
    objective: 'OUTCOME_SALES',
    rationale: 'Test rationale',
    campaign_name: 'Test Campaign',
    // ... full payload structure ...
    ad_sets: [{ name: 'Run-up', ads, ... }],
  };
}

// Usage:
const payload = makePayload([
  makeAd({ primary_text: 'Custom text here' }),
]);
```

**Location:**
- Factories defined in the same test file, near top
- Constants or shared fixtures: consider `tests/__fixtures__/` if reused across multiple test files (not heavily used in current codebase)

## Coverage

**Requirements:**
- Business logic and server actions: target 90%
- API routes and data layers: target 80%
- UI components: target 70% (focus on interactive behaviour, not rendering)
- No minimum enforced in CI yet (but should be configured)

**View Coverage:**
```bash
npm run test:ci       # Generates LCOV report
# Coverage report saved to `coverage/` directory
```

## Test Types

**Unit Tests:**
- Scope: Single function or utility in isolation
- Approach: Test all branches, edge cases, error paths
- Example: `palette.test.ts` tests `paletteFromColours()` with multiple hex formats
- No external services mocked unless they're imports the function uses

**Integration Tests:**
- Scope: Multiple modules together (validation + AI correction flow)
- Approach: Mock external APIs (OpenAI, Supabase) but test logic flow
- Example: `generate.test.ts` tests `validateCampaignCopy()` → `attemptCopyCorrection()` pipeline
- Setup test data that flows through multiple functions

**Component Tests (React):**
- Scope: UI component rendering and interactions
- Approach: Use `@testing-library/react`, focus on user-facing behaviour
- Environment: `@vitest-environment jsdom` (override default node environment)
- Example: `banner-overlay.test.tsx` tests rendering conditionally based on props
```typescript
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';

it('renders nothing when config.enabled is false', () => {
  const { container } = render(
    <BannerOverlay mediaUrl="/x.jpg" config={{ ...baseConfig, enabled: false }} label="THIS WEDNESDAY" />,
  );
  expect(container.querySelector('[data-banner-overlay]')).toBeNull();
});
```

**E2E Tests:**
- Playwright not heavily used in current codebase
- If needed: would test full user workflows (login → create campaign → publish)

## Common Patterns

**Async Testing:**
```typescript
// With async/await
it('should return corrected payload when AI fixes the copy', async () => {
  const result = await attemptCopyCorrection(client, original, issues, options);
  expect(result).not.toBeNull();
});

// With mocked Promise resolution
it('uses the U+00B7 middle dot as separator', () => {
  const client = makeMockClient(JSON.stringify(data));
  const promise = attemptCopyCorrection(client, original, issues, options);
  // Vitest auto-awaits in expect() context
  await expect(promise).resolves.not.toBeNull();
});
```

**Error Testing:**
```typescript
it('should return null when correction still fails validation', async () => {
  const stillBadResponse = { ... };  // Response that fails validation
  const client = makeMockClient(JSON.stringify(stillBadResponse));
  
  const result = await attemptCopyCorrection(client, original, issues, options);
  
  expect(result).toBeNull();
});

it('should return null when AI returns no content', async () => {
  const client = makeMockClient(null);  // AI returns null
  const result = await attemptCopyCorrection(client, original, issues, {});
  expect(result).toBeNull();
});
```

**Array/Collection Testing:**
```typescript
it('produces repeated messages for multiple failing ads', () => {
  const payload = makePayload([
    makeAd({ name: 'Ad 1', primary_text: 'Come along Thursday.' }),
    makeAd({ name: 'Ad 2', primary_text: 'Join us Thursday.' }),
    makeAd({ name: 'Ad 3', primary_text: 'See you Thursday.' }),
  ]);
  
  const issues = validateCampaignCopy(payload, { cashOnArrival: true });
  const messages = issues.filter(i => i.code === 'missing_payment_reassurance').map(i => i.message);
  
  expect(messages.length).toBe(3);
  const unique = [...new Set(messages)];
  expect(unique).toHaveLength(1);  // All messages are identical
});
```

**Type Testing:**
```typescript
// Testing with discriminated unions
type SelectedNode =
  | { type: 'campaign' }
  | { type: 'adset'; adsetIndex: number }
  | { type: 'ad'; adsetIndex: number; adIndex: number };

it('handles campaign selection', () => {
  const node: SelectedNode = { type: 'campaign' };
  // TypeScript ensures only valid shape
  expect(node.type).toBe('campaign');
});
```

## Pre-Commit / CI

**Test Requirements Before Push:**
```bash
npm run lint          # ESLint with zero warnings
npm run typecheck    # tsc --noEmit with no errors
npm test             # All tests must pass
npm run build        # Production build succeeds
```

**CI Pipeline:**
```bash
npm run ci:verify    # Runs: lint → typecheck → test → build
```

All four steps must pass before merge to main. No exceptions.

## Debugging Tests

**Run Single Test:**
```bash
npx vitest run src/lib/banner/palette.test.ts
```

**Watch Single Test File:**
```bash
npx vitest src/lib/banner/palette.test.ts
```

**Debug with console logs:**
- Add `console.log()` in test or tested function
- Logs print to terminal during test run
- Never commit console.log() — remove before final commit

---

*Testing analysis: 2025-05-18*
