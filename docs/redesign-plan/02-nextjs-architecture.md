# 02 — Next.js Architecture: Audit & Target Specification

> Prepared: 2026-03-05
> Auditor: Staff Engineer / Next.js Architecture Lead
> Scope: CheersAI 2.0 — full codebase audit against Next.js 15/16 App Router best practices

---

## 1. Current Architecture Audit

### 1.1 Route Structure

**Overall shape**

```
src/app/
  layout.tsx                    ← root layout (Server Component, correct)
  page.tsx                      ← root redirect page
  (app)/                        ← authenticated shell
    layout.tsx                  ← Server Component, fetches user ✓
    planner/page.tsx            ← Server Component ✓
    planner/[contentId]/page.tsx
    planner/notifications/page.tsx
    create/page.tsx             ← Server Component ✓
    library/page.tsx            ← Server Component (no data fetch — see below)
    connections/page.tsx        ← Server Component (no data fetch — see below)
    settings/page.tsx           ← Server Component ✓
  (auth)/                       ← unauthenticated shell
    layout.tsx                  ← Server Component, guard redirect ✓
    login/page.tsx              ← "use client" (full page) ✗
  (public)/                     ← public link-in-bio pages
    layout.tsx
    l/[slug]/page.tsx
  api/
    auth/login/route.ts
    auth/magic-link/route.ts
    oauth/[provider]/callback/route.ts
    cron/publish/route.ts
    cron/purge-trash/route.ts
    planner/activity/route.ts
  auth/login/page.tsx           ← legacy redirect ✓
  auth/forgot-password/page.tsx ← legacy redirect
  auth/signup/page.tsx          ← legacy redirect
  dashboard/page.tsx            ← legacy redirect ✓
  campaigns/page.tsx            ← legacy redirect (assumed)
  terms/page.tsx
  help/[[...slug]]/page.tsx
```

**Findings**

| Severity | Issue | Evidence |
|---|---|---|
| HIGH | Duplicate route trees for auth | `src/app/auth/login/page.tsx` and `src/app/(auth)/login/page.tsx` both exist. The legacy tree simply calls `permanentRedirect`. Every legacy route is an extra server render and an extra redirect hop in production. |
| HIGH | No middleware-based auth guard | `middleware.ts` only handles apex-to-www redirect. Auth enforcement relies entirely on per-layout `redirect()` calls. This means unauthenticated requests to `/(app)/*` traverse the full React tree up to `(app)/layout.tsx` before being rejected. |
| MEDIUM | `library/page.tsx` performs no data fetching | The Library page renders `<MediaAssetGrid>` which is an async Server Component that calls `listMediaAssets()` internally. The page shell is therefore a static Server Component with no metadata or Suspense boundary around the fetching child. There is no `loading.tsx` fallback. |
| MEDIUM | `connections/page.tsx` performs no data fetching either | `ConnectionCards` is a Server Component that calls `listConnectionSummaries()` directly but has no Suspense wrapper at the page level. |
| LOW | `help/[[...slug]]` and `terms/page.tsx` live outside all route groups | These orphaned routes inherit only the root layout and `AppProviders` (which loads TanStack Query, auth context, and `CreateModal`). They are public pages that should not carry that overhead. |

---

### 1.2 Component Model — Server vs Client Boundaries

**Correct boundaries found:**
- `(app)/layout.tsx` — async Server Component, calls `getCurrentUser()`, passes result down as prop to `<AuthProvider>`. Good pattern.
- `PlannerCalendar`, `ConnectionCards`, `MediaAssetGrid` — async Server Components doing data fetching. Correct.
- `CreatePageClient`, form components — correctly marked `"use client"`.

**Problematic boundaries:**

| Severity | Issue | File | Line |
|---|---|---|---|
| HIGH | `AppProviders` is mounted in the root layout and wraps every route | `src/app/layout.tsx:27`, `src/components/providers/app-providers.tsx:1` | `AppProviders` includes `QueryClientProvider`, `AuthProvider`, `CreateModalProvider`, and `ReactQueryDevtools`. This client subtree forces the **entire application** into a client boundary including public pages (`/l/[slug]`, `/terms`, `/help`). All RSC benefits are lost for public routes. |
| HIGH | `AuthProvider` is instantiated twice — once inside `AppProviders` (root layout) and once directly in `(app)/layout.tsx` | `src/components/providers/app-providers.tsx:23`, `src/app/(app)/layout.tsx:14` | `AuthProvider` in the root layout receives `user=null` because it is rendered before the `(app)` route group runs `getCurrentUser()`. The `(app)/layout.tsx` then wraps children in a second `AuthProvider` with the real user. This creates a nested context that shadows the outer one. The inner shadow works by coincidence, not by design. |
| HIGH | `CreateModalProvider` + `<CreateModal>` is mounted globally for every route | `src/components/providers/app-providers.tsx:26–28` | Public and auth routes load the CreateModal dialog infrastructure on every request. The modal's `useQuery` call to `getCreateModalData` (a Server Action) fires against the Supabase service role for any unauthenticated visitor who opens the modal, leaking a surface. |
| MEDIUM | `PageHeader.tsx` is marked `"use client"` to support `MobileNav` | `src/components/layout/PageHeader.tsx:1` | The `PageHeader` component itself needs no client interactivity. The `Topbar` (which contains `MobileNav`) uses `usePathname` and `useFormStatus`. These are two distinct concerns bundled into one file, forcing the static header element into the client bundle. |
| MEDIUM | `AppShell.tsx` is a plain Server Component that imports `Sidebar` (client) and `Topbar` (client) | `src/components/layout/AppShell.tsx` | `AppShell` has no `"use client"` directive but its children are client components. This is valid React but the shell renders no markup of its own that benefits from being a Server Component. The composition is fine but should be explicit. |
| MEDIUM | Two parallel sidebar implementations exist | `src/components/layout/Sidebar.tsx` (Framer Motion, custom) and `src/components/layout/app-sidebar.tsx` (Radix/shadcn `Sidebar` primitive) | `AppShell` imports `Sidebar` (Framer Motion version). `app-sidebar.tsx` (`AppSidebar`) appears unused by the active shell. Dead code that bloats the client bundle. |
| LOW | `Topbar` contains a non-functional search input | `src/components/layout/PageHeader.tsx:37` | An `<input>` exists with no `onChange`, no state, no action. Dead UI code. |

---

### 1.3 Data Fetching Patterns

**Good patterns found:**
- Server Components fetch data via `requireAuthContext()` + Supabase SDK on the server. No API round-trips.
- Server Actions (`"use server"`) are used for mutations. Zod validation is applied before DB writes.
- `revalidatePath()` is called after mutations in Server Actions.
- The Create page pre-fetches media and planner overview in a single `Promise.all`.

**Anti-patterns:**

| Severity | Issue | Evidence |
|---|---|---|
| HIGH | Login page uses `fetch('/api/auth/login')` from client instead of a Server Action | `src/app/(auth)/login/page.tsx:36–45`. A Server Action would eliminate the Route Handler entirely, reduce surface area, and allow React's `useActionState` to manage pending/error state cleanly. The Route Handler approach requires managing two `isSubmitting` + `isPending` booleans (lines 13–16) and manual JSON serialisation. |
| HIGH | `CreateModal` uses TanStack Query to call a Server Action | `src/features/create/create-modal.tsx:14–19`. `useQuery({ queryFn: () => getCreateModalData() })` treats a Server Action as a fetch. Server Actions are not query functions — they are not idempotent and cannot be deduplicated by the query cache. The correct approach is to stream props from a Server Component or use `startTransition` + a cached data function. |
| MEDIUM | `getOwnerSettings()` is called redundantly on multiple pages | `create/page.tsx:21`, `planner/[contentId]/page.tsx:25`, `planner-calendar.tsx:57`. Each call hits Supabase independently. No request-level memoisation (React `cache()`) is applied. With `cache()` wrapping, these concurrent awaits within a single render would share one DB round-trip. |
| MEDIUM | `listMediaAssets()` is called on both `create/page.tsx` and `library/page.tsx` independently, and again via `MediaAssetGrid` as a Server Component child of `library/page.tsx` | This results in two DB queries for the same data on `/library`. The page-level fetch is absent (no data passed down), so the child does the fetch. On `/create`, the page fetches and passes props. Inconsistent pattern. |
| LOW | `getCreateModalData` Server Action duplicates the same fetch logic as `create/page.tsx` | `src/features/create/create-modal-actions.ts:10–33` vs `src/app/(app)/create/page.tsx:20–31`. The planner overview fetch with the same date range calculation is copy-pasted. |

---

### 1.4 State Management

| Severity | Issue | Evidence |
|---|---|---|
| HIGH | `CreateModalContext` holds `isOpen`, `initialTab`, `initialDate`, `initialMedia` as four separate `useState` calls | `src/features/create/create-modal-context.tsx:18–21`. These four pieces of state always transition together. Four `useState` calls trigger four potential re-renders on `openModal`. A single `useState<ModalState | null>` would be cleaner and reduce renders. |
| MEDIUM | `QueryClient` is instantiated inside a `useState` initialiser in `AppProviders` | `src/components/providers/app-providers.tsx:19`. This is the correct React pattern but `AppProviders` renders for public routes where TanStack Query is not needed at all, creating a client-side `QueryClient` even on the link-in-bio page. |
| LOW | `AuthContext` is initialised with `null` as the default, but `useAuth()` returns `AppUser | null` without a type guard | `src/components/providers/auth-provider.tsx:7`. Components that call `useAuth()` must null-check or risk runtime errors. Inside `(app)/*` the user will always be non-null, but the type system cannot guarantee this. A separate `useRequiredAuth()` hook returning `AppUser` (throwing if null) would make the invariant explicit. |

---

### 1.5 TypeScript Usage

| Severity | Issue | Evidence |
|---|---|---|
| MEDIUM | DB row types are defined inline in data functions rather than in a shared types module | `src/lib/planner/data.ts:7–54` defines `PlannerItem`, `TrashedPlannerItem`, `PlannerActivity`, `PlannerOverview` etc. These are co-located with data fetch logic, which is reasonable, but there is no central `types/` barrel so consuming modules must import from `lib/` data files, creating tight coupling. |
| MEDIUM | `env.ts` uses `as const` on plain objects but does not validate types at the entry point | `src/env.ts` runs `validateProductionEnv()` at module import time (line 116). This validation is string-presence only — it does not validate formats (e.g. that `NEXT_PUBLIC_SUPABASE_URL` is a valid URL). The function also throws at runtime in production, not at build time. t3-env or a custom Zod schema parsed at startup would catch issues during `next build`. |
| LOW | `clearSupabaseSessionCookies` uses a double `as unknown as` cast | `src/lib/auth/server.ts:242`. This is a workaround for Next.js cookie store typing inconsistencies, but it bypasses TypeScript entirely for this operation. |
| LOW | Schema file (`lib/create/schema.ts`) exports both form schemas and domain schemas for the same concepts, leading to a 581-line file with duplicated `superRefine` logic | `src/lib/create/schema.ts:53–176`. `instantPostSchema` and `instantPostFormSchema` share identical `superRefine` validators with slightly different error messages. This will drift over time. |

---

### 1.6 Build Configuration

| Severity | Issue | Evidence |
|---|---|---|
| CRITICAL | `"build": "next build --webpack"` | `package.json:7`. The `--webpack` flag forces the Webpack bundler instead of Turbopack. Next.js 15+ defaults to Turbopack for both dev and build. Forcing Webpack on Next.js 16 means: (a) significantly slower builds, (b) missing Turbopack-specific optimisations, (c) divergence between dev (Turbo) and prod (Webpack) if `dev` is run without `--webpack`. The flag may have been added to work around a specific Turbopack incompatibility — that root cause should be identified and fixed rather than papering over it. |
| HIGH | `next.config.ts` references `tsconfig.build.json` but only `tsconfig.json` exists in the repo root | `next.config.ts:3`. If `tsconfig.build.json` does not exist, Next.js falls back to `tsconfig.json` silently. This creates a divergence risk: if `tsconfig.build.json` is ever created with different strictness settings, the type check that runs in CI (`npm run typecheck` which uses `tsconfig.json`) will disagree with the build. |
| MEDIUM | No `Suspense` boundaries at the page level | `src/app/(app)/library/page.tsx`, `connections/page.tsx`. Pages with async Server Component children have no `loading.tsx` files and no `<Suspense>` wrappers. Users see a blank page until the server finishes all awaits. |
| MEDIUM | No `error.tsx` boundaries anywhere in the route tree | `find src/app -name "error.tsx"` → 0 results. Unhandled errors in Server Components will produce Next.js default error pages with no recovery UI. |
| LOW | `dotenv` is listed as a production dependency | `package.json:34`. `dotenv` should be a `devDependency` or removed entirely — Next.js handles `.env` loading natively in all environments. Having it in `dependencies` inflates the production bundle. |
| LOW | `@tanstack/react-query-devtools` is in production `dependencies` | `package.json:31`. Devtools are conditionally rendered (`process.env.NODE_ENV !== "production"`) but the package is still included in the production bundle. It should be a `devDependency`, relying on tree-shaking — or better, loaded via dynamic import to guarantee exclusion. |

---

### 1.7 Missing Infrastructure

| Missing | Impact |
|---|---|
| No `error.tsx` at `(app)` level | Server Component errors bubble to root and display an unbranded error page |
| No `loading.tsx` at `(app)` level or per-route | No streaming skeleton during navigation; users see blank screen |
| No `not-found.tsx` at `(app)` level | `notFound()` calls (e.g. `planner/[contentId]/page.tsx:22`) fall back to Next.js default 404 |
| No Middleware auth guard | Every `(app)` route must independently call `requireAuthContext()` and redirect; a single Middleware matcher would be more reliable and cacheable at the Edge |
| No request-level memoisation | `React.cache()` is not applied to `getOwnerSettings`, `listMediaAssets`, `requireAuthContext` — all of which are called multiple times per render tree |

---

## 2. Target Architecture Specification

### 2.1 Route Group Design

```
src/app/
  layout.tsx                    Root layout — minimal: html/body, fonts, globals.css only
  not-found.tsx                 Root 404 — branded
  (marketing)/                  Public-facing static pages (terms, help, privacy)
    layout.tsx                  No auth, no providers, minimal CSS
    terms/page.tsx
    help/[[...slug]]/page.tsx
    privacy/page.tsx
  (public)/                     Link-in-bio and other unauthenticated dynamic pages
    layout.tsx                  Minimal — no app providers
    l/[slug]/page.tsx
  (auth)/                       Authentication flows
    layout.tsx                  Checks session, redirects authenticated users
    login/page.tsx
  (app)/                        Authenticated application shell
    layout.tsx                  Loads user, mounts QueryClient + Toast providers
    error.tsx                   (app)-level error boundary
    loading.tsx                 (app)-level skeleton
    not-found.tsx
    planner/
      page.tsx
      loading.tsx
      [contentId]/
        page.tsx
        loading.tsx
      notifications/
        page.tsx
    create/
      page.tsx
      loading.tsx
    library/
      page.tsx
      loading.tsx
    connections/
      page.tsx
      loading.tsx
    settings/
      page.tsx
      loading.tsx
  api/
    auth/
      login/route.ts            Keep — needed for cookie-setting on login
      magic-link/route.ts
      logout/route.ts           (new) — move signOut from Server Action
    oauth/
      [provider]/callback/route.ts
    cron/
      publish/route.ts
      purge-trash/route.ts
    planner/
      activity/route.ts
```

**Rationale for route group changes:**
- `(marketing)` group: static content pages that currently inherit `AppProviders` from the root layout, creating unnecessary client bundle weight. Their own minimal layout removes all JS providers.
- `(public)` group: unchanged concept but now isolated from root `AppProviders`. Link-in-bio pages are server-rendered with no React Query or auth context.
- Root layout becomes a pure shell (html/body/fonts) with no provider logic. Providers are pushed to the route groups that need them.

---

### 2.2 Middleware Auth Guard

Replace the current per-layout `redirect()` pattern with a single Middleware guard.

```ts
// middleware.ts
export function middleware(request: NextRequest) {
  // 1. Apex-to-www redirect (keep existing logic)
  // 2. Auth guard for (app) routes
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/planner') ||
      pathname.startsWith('/create') ||
      pathname.startsWith('/library') ||
      pathname.startsWith('/connections') ||
      pathname.startsWith('/settings')) {
    // Read Supabase session cookie — if absent, redirect to /login
    // Use @supabase/ssr createServerClient in middleware context
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|api/cron).*)'],
};
```

Runtime: **Edge** — no Node.js APIs needed, low latency, executes before React rendering.

The `(app)/layout.tsx` still calls `getCurrentUser()` for user data, but the redirect responsibility moves to Middleware. This prevents any React tree execution for unauthenticated requests.

---

### 2.3 Server Component vs Client Component Boundary Rules

#### Decision criteria

A component should be a **Server Component** if:
- It reads from a database, file system, or external API
- It renders content that is purely presentational with no event handlers
- It renders markdown, rich text, or large lists
- It would otherwise call a data-fetching hook that could be eliminated

A component must be a **Client Component** (`"use client"`) if:
- It uses any React hook (`useState`, `useEffect`, `useRef`, `useContext`, etc.)
- It attaches DOM event listeners
- It uses browser-only APIs (`window`, `document`, `navigator`)
- It uses `usePathname`, `useRouter`, or any Next.js navigation hook
- It uses Framer Motion animations
- It is a form with controlled inputs

#### Boundary placement rule

Push `"use client"` as far down the tree as possible. The boundary should be at the **leaf component that needs interactivity**, not at the parent that composes it.

**Correct pattern (current — keep):**
```
PlannerPage (SC) → <Suspense> → PlannerCalendar (SC) → DeleteContentButton (CC)
```

**Anti-pattern (fix):**
```
AppProviders (CC) wraps entire app → everything becomes client-side
```

**Target pattern:**
```
RootLayout (SC) → (app)/layout.tsx (SC, fetches user) → AppShell (SC)
  → Sidebar (CC) — needs usePathname
  → main (SC children passed as slot)
    → PageHeader (SC) — static title/description
    → Topbar (CC) — needs usePathname, Sheet state
    → [page content] (SC default, CC at leaf for forms)
```

#### `"use client"` boundary inventory for rebuild

| Component | Directive | Reason |
|---|---|---|
| Sidebar | CC | `usePathname`, `useState` (collapsed), Framer Motion |
| Topbar / MobileNav | CC | `usePathname`, Sheet state |
| PageHeader | SC | Pure display, receives `title`/`description` as props |
| PlannerCalendar | SC | Data fetch via `getPlannerOverview` |
| DeleteContentButton | CC | `useTransition`, Server Action call |
| CreateModal | CC | Dialog state, `useQuery` |
| CreateWizard | CC | Tab state, form state |
| All `*Form` components | CC | `react-hook-form` |
| MediaAssetGrid | SC | Data fetch via `listMediaAssets` |
| MediaAssetGridClient | CC | Selection state, editor modal |
| ConnectionCards | SC | Data fetch via `listConnectionSummaries` |
| ConnectionOAuthButton | CC | `window.location` redirect |

---

### 2.4 Data Fetching Strategy

#### Server Components (default for data)

Use Server Components for all initial data loads. Apply `React.cache()` to shared data functions so multiple components in the same render tree share one DB round-trip.

```ts
// lib/settings/data.ts
import { cache } from 'react';

export const getOwnerSettings = cache(async (): Promise<OwnerSettings> => {
  const { supabase, accountId } = await requireAuthContext();
  // ... db fetch
});
```

Apply `cache()` to: `getOwnerSettings`, `listMediaAssets`, `requireAuthContext` (already idempotent), `getPlannerContentDetail`.

#### Server Actions (mutations)

All write operations use Server Actions. Standard contract:

1. Parse input with Zod (throw on invalid — Next.js catches and routes to error boundary)
2. Call `requireAuthContext()` — never trust client-provided `accountId`
3. Perform DB write
4. Call `revalidatePath()` for affected routes
5. Return a typed `ActionResult<T>` (see Section 3)

Server Actions must **never** be used as query functions for TanStack Query (current anti-pattern in `CreateModal`).

#### TanStack Query (client-side cache for volatile data)

Reserve TanStack Query for data that changes **while the user is on the page** without a navigation event:
- Polling the planner activity feed (`/api/planner/activity`)
- Library upload status polling
- Optimistic UI for delete/restore actions

The `QueryClient` should be mounted only in `(app)/layout.tsx`, not in the root layout.

#### Route Handlers (API endpoints)

Keep Route Handlers only where a cookie-writing response is required (auth endpoints) or for external webhook/cron consumers. Internal UI mutations should use Server Actions exclusively.

---

### 2.5 Caching and Revalidation Strategy

| Route | Cache strategy | Revalidation |
|---|---|---|
| `/planner` | `no-store` (changes frequently, user-specific) | `revalidatePath('/planner')` on any content mutation |
| `/create` | `no-store` | Same |
| `/library` | `no-store` | `revalidatePath('/library')` on upload/delete |
| `/connections` | `no-store` | `revalidatePath('/connections')` on OAuth callback |
| `/settings` | `no-store` | `revalidatePath('/settings')` on save |
| `/l/[slug]` | ISR, `revalidate: 300` (5 min) | `revalidatePath('/l/[slug]')` on link-in-bio save |
| `/terms`, `/help/*` | Static (`force-static`) | Rebuild on deploy only |
| API cron routes | `no-store` | N/A |

Enforce `no-store` explicitly on authenticated routes via `export const dynamic = 'force-dynamic'` or by using `cookies()` / `headers()` (which already opts the route out of static caching).

---

### 2.6 Streaming and Suspense Boundary Placement

Every data-fetching Server Component must be wrapped in `<Suspense>`. The skeleton must be defined as a co-located `loading.tsx` **and** as an inline `<Suspense fallback={<Skeleton />}>` for nested async components.

Target tree for `/planner`:

```
PlannerPage (SC, no await)
  <PageHeader title="Planner" /> (SC, static)
  <CreatePostButton /> (CC, no data)
  <Suspense fallback={<PlannerSkeleton />}>   ← existing ✓
    <PlannerCalendar />                        ← async SC
      <Suspense fallback={<CalendarGridSkeleton />}>
        [calendar grid JSX] (synchronous after data fetch)
      </Suspense>
  </Suspense>
```

For `/settings` (4 parallel awaits):

```
SettingsPage
  await Promise.all([settings, management, linkInBio, media])
  → render immediately, no nested streaming needed (single request)
```

`loading.tsx` placement:
- `(app)/loading.tsx` — skeleton that matches the shell (sidebar present, main area spinner)
- `(app)/planner/loading.tsx` — calendar grid skeleton
- `(app)/create/loading.tsx` — tab bar skeleton
- `(app)/library/loading.tsx` — grid skeleton
- `(app)/settings/loading.tsx` — stacked card skeletons

---

### 2.7 Error Boundary Hierarchy

```
RootLayout
  not-found.tsx (root)
  (app)/
    error.tsx          ← catches all SC errors in the app shell; shows "Something went wrong" with retry
    (app)/planner/
      error.tsx        ← optional, more specific planner error UI
    (app)/planner/[contentId]/
      error.tsx        ← "Content not found or failed to load"
```

`error.tsx` files must be Client Components (Next.js requirement). Pattern:

```tsx
'use client';

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <p className="text-destructive">{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

---

## 3. Coding Standards

### 3.1 TypeScript

**Strict mode settings (`tsconfig.json`):**

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

`noUncheckedIndexedAccess` is the most impactful addition — it eliminates the class of bugs where `array[0]` is accessed without a null check (several instances exist in the current codebase, e.g. `src/lib/create/schema.ts:97`).

**No `any` policy:**

- ESLint rule `@typescript-eslint/no-explicit-any: error`
- ESLint rule `@typescript-eslint/no-unsafe-*: error`
- The only permitted escape hatch is `unknown` with a subsequent type guard

**Shared type locations:**

```
src/types/
  db.ts          ← raw Supabase row shapes (generated or hand-maintained)
  domain.ts      ← application domain types (AppUser, PlannerItem, MediaAsset, etc.)
  actions.ts     ← ActionResult<T>, ActionError shape
  api.ts         ← Route Handler request/response shapes
```

Do not define domain types inside `lib/*/data.ts` files. Data files import from `types/domain.ts` and map DB rows to domain types.

**`ActionResult<T>` pattern:**

```ts
// src/types/actions.ts
export type ActionSuccess<T> = { ok: true; data: T };
export type ActionFailure = { ok: false; error: string; fieldErrors?: Record<string, string[]> };
export type ActionResult<T> = ActionSuccess<T> | ActionFailure;
```

Every Server Action returns `ActionResult<T>`. Client components discriminate on `result.ok`. This eliminates the current inconsistency where some actions throw, some return data, and some return `undefined`.

---

### 3.2 Import Conventions

**Path alias:** `@/*` → `src/*` (keep existing)

**No barrel files for features.** Barrel files (`index.ts`) cause Next.js to bundle entire feature directories when any single export is imported. Import directly:

```ts
// Good
import { PlannerCalendar } from '@/features/planner/planner-calendar';

// Bad — forces bundler to evaluate every export in features/planner/
import { PlannerCalendar } from '@/features/planner';
```

**Exception:** `src/types/*.ts` may export via a single barrel (`src/types/index.ts`) since types are erased at runtime and cannot affect bundle size.

**Import order (enforced by ESLint `import/order`):**
1. React / Next.js
2. Third-party packages
3. Internal `@/` imports (sorted: types → lib → features → components → app)
4. Relative imports

---

### 3.3 Component Patterns

**Props contract:**

- All component props are named interfaces, not inline types
- No spreading unknown props onto DOM elements
- `children` is typed as `React.ReactNode` (not `JSX.Element`)
- Optional props that can be `undefined` use `?:` not `| undefined`

**Composition model:**

Server Components accept `children` slots and Client Component islands:

```tsx
// SC shell — no "use client"
export function PlannerLayout({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div className="...">
      <PageHeader action={action} />  {/* SC */}
      {children}                       {/* SC or CC */}
    </div>
  );
}
```

Client Component islands are passed as props to Server Component wrappers, not imported inside Server Components (the current pattern is correct in most places — keep it).

**Form pattern:**

```
FormServer (SC) — fetches initial data, renders FormClient
  FormClient (CC, "use client") — react-hook-form, Server Action via useTransition + startTransition
```

No `<form action={serverAction}>` for complex forms with validation. Use `handleSubmit` from react-hook-form + manual `startTransition(() => serverAction(values))` so Zod errors can be surfaced field-by-field.

---

### 3.4 Server Actions: Validation Pattern and Error Shape

```ts
'use server';

import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/server';
import type { ActionResult } from '@/types/actions';

const schema = z.object({
  contentId: z.string().uuid(),
  body: z.string().max(10_000),
});

export async function updatePostBody(raw: unknown): Promise<ActionResult<{ id: string }>> {
  // 1. Validate input
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid input',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // 2. Auth — always server-side, never trust client-provided accountId
  const { supabase, accountId } = await requireAuthContext();

  // 3. Authorise — confirm ownership
  const { data: item } = await supabase
    .from('content_items')
    .select('id')
    .eq('id', parsed.data.contentId)
    .eq('account_id', accountId)
    .single();

  if (!item) return { ok: false, error: 'Not found' };

  // 4. Mutate
  await supabase.from('content_items').update({ body: parsed.data.body }).eq('id', item.id);

  // 5. Revalidate
  revalidatePath('/planner');

  return { ok: true, data: { id: item.id } };
}
```

Rules:
- Never `throw` from a Server Action — always return `ActionResult`
- Always call `requireAuthContext()` — never accept `accountId` from the client
- Always authorise the record belongs to `accountId` before mutation
- Always `revalidatePath` before returning

---

### 3.5 Environment Variables

**Replace the custom `env.ts` with `@t3-oss/env-nextjs`:**

```ts
// src/env.ts
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1),
    RESEND_API_KEY: z.string().min(1),
    RESEND_FROM: z.string().email(),
    FACEBOOK_APP_SECRET: z.string().min(1),
    CRON_SECRET: z.string().min(1),
    // ...
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_SITE_URL: z.string().url(),
    NEXT_PUBLIC_FACEBOOK_APP_ID: z.string().min(1),
  },
  runtimeEnv: {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    // ...
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
```

Benefits over current approach:
- Validation runs at **import time** — `next build` fails immediately if any required variable is missing, regardless of `NODE_ENV`
- Type-safe access: `env.NEXT_PUBLIC_SUPABASE_URL` not `env.client.NEXT_PUBLIC_SUPABASE_URL`
- No custom `resolveSupabaseUrl()` function with dual-key fallback (a security anti-pattern that could expose server-only keys)
- No `readOptionalEnv` fallback — optional vars are explicitly typed as `z.string().optional()`

---

## 4. Folder Structure (Full Target Tree)

```
cheersai2.0/
  src/
    app/
      (marketing)/
        layout.tsx
        terms/page.tsx
        privacy/page.tsx
        help/
          [[...slug]]/page.tsx
      (public)/
        layout.tsx
        l/
          [slug]/page.tsx
      (auth)/
        layout.tsx
        login/page.tsx
      (app)/
        layout.tsx              ← mounts QueryClient, user context
        error.tsx               ← CC error boundary
        loading.tsx             ← app shell skeleton
        not-found.tsx
        planner/
          page.tsx
          loading.tsx
          error.tsx
          actions.ts            ← "use server"
          [contentId]/
            page.tsx
            loading.tsx
            error.tsx
          notifications/
            page.tsx
        create/
          page.tsx
          loading.tsx
          actions.ts            ← "use server"
        library/
          page.tsx
          loading.tsx
          actions.ts            ← "use server"
        connections/
          page.tsx
          loading.tsx
          actions.ts            ← "use server"
        settings/
          page.tsx
          loading.tsx
          actions.ts            ← "use server"
      api/
        auth/
          login/route.ts
          logout/route.ts
          magic-link/route.ts
        oauth/
          [provider]/
            callback/route.ts
        cron/
          publish/route.ts
          purge-trash/route.ts
        planner/
          activity/route.ts
      layout.tsx                ← root layout: html/body/fonts/globals.css ONLY
      not-found.tsx
      globals.css
    components/
      layout/
        app-shell.tsx           ← SC wrapper (sidebar slot + main slot)
        sidebar.tsx             ← CC (usePathname, collapse state)
        topbar.tsx              ← CC (MobileNav, usePathname)
        page-header.tsx         ← SC (static title/description)
        mobile-nav.tsx          ← CC (Sheet, usePathname)
      auth/
        sign-out-form.tsx
      providers/
        query-provider.tsx      ← CC wrapping QueryClientProvider
        toast-provider.tsx
      ui/                       ← shadcn/ui primitives (unchanged)
        button.tsx
        card.tsx
        dialog.tsx
        input.tsx
        label.tsx
        separator.tsx
        sheet.tsx
        sidebar.tsx
        skeleton.tsx
        tabs.tsx
        tooltip.tsx
    features/
      planner/
        planner-calendar.tsx    ← SC (data fetch + render)
        planner-skeleton.tsx    ← CC or SC (pure JSX)
        planner-status-filters.tsx ← CC
        planner-view-toggle.tsx ← CC
        content-detail.tsx      ← SC (receives detail as prop)
        content-body-form.tsx   ← CC
        content-schedule-form.tsx ← CC
        content-media-editor.tsx ← CC
        approve-draft-button.tsx ← CC
        delete-content-button.tsx ← CC
        restore-content-button.tsx ← CC
        dismiss-notification-button.tsx ← CC
        activity-feed.tsx       ← CC (polling via TanStack Query)
        planner-interaction-components.tsx ← CC
        create-post-button.tsx  ← CC
        utils.ts
        status-filter-options.ts
      create/
        create-wizard.tsx       ← CC
        instant-post-form.tsx   ← CC
        story-series-form.tsx   ← CC
        event-campaign-form.tsx ← CC
        promotion-campaign-form.tsx ← CC
        weekly-campaign-form.tsx ← CC
        generated-content-review-list.tsx ← CC
        generation-progress.tsx ← CC
        media-attachment-selector.tsx ← CC
        stage-accordion.tsx     ← CC
        create-modal.tsx        ← CC
        create-modal-context.tsx ← CC
        schedule/
          schedule-calendar.tsx ← CC
          suggestion-utils.ts
        media-swap-utils.ts
        management-prefill-utils.ts
      library/
        media-asset-grid.tsx    ← SC (data fetch)
        media-asset-grid-client.tsx ← CC
        media-asset-editor.tsx  ← CC
        upload-panel.tsx        ← CC
        reprocess-button.tsx    ← CC
      connections/
        connection-cards.tsx    ← SC (data fetch)
        connection-oauth-button.tsx ← CC
        connection-oauth-handler.tsx ← CC
        connection-metadata-form.tsx ← CC
        connection-diagnostics.tsx ← CC
      settings/
        brand-voice-form.tsx    ← CC
        posting-defaults-form.tsx ← CC
        management-connection-form.tsx ← CC
        schema.ts
        link-in-bio/
          link-in-bio-settings-section.tsx ← CC
          link-in-bio-profile-form.tsx ← CC
          link-in-bio-tile-manager.tsx ← CC
          index.ts
      link-in-bio/
        public/
          link-in-bio-public-page.tsx ← SC
          index.ts
    lib/
      auth/
        server.ts               ← requireAuthContext, getCurrentUser (with React.cache)
        actions.ts              ← signOut Server Action
        types.ts                ← AppUser
        rate-limit.ts
      supabase/
        client.ts               ← browser client
        server.ts               ← server client
        service.ts              ← service role client
        route.ts                ← Route Handler client
        errors.ts
      create/
        schema.ts               ← consolidated (remove FormSchema/Schema duplication)
        service.ts
        event-cadence.ts
      planner/
        data.ts                 ← wrapped with React.cache
        notifications.ts
      library/
        data.ts                 ← wrapped with React.cache
        tags.ts
        client-derivatives.ts
      settings/
        data.ts                 ← wrapped with React.cache
      connections/
        data.ts
        oauth.ts
        token-exchange.ts
        metadata.ts
        diagnostics.ts
      ai/
        client.ts
        prompts.ts
        postprocess.ts
        content-rules.ts
        voice.ts
        proof-points.ts
      scheduling/
        conflicts.ts
        materialise.ts
      publishing/
        queue.ts
        preflight.ts
      meta/
        graph.ts
      management-app/
        client.ts
        data.ts
        mappers.ts
      link-in-bio/
        profile.ts
        public.ts
        types.ts
      utils.ts
      constants.ts
    types/
      db.ts                     ← raw Supabase row types
      domain.ts                 ← AppUser, PlannerItem, MediaAsset, etc.
      actions.ts                ← ActionResult<T>, ActionSuccess, ActionFailure
      api.ts                    ← Route Handler shapes
      index.ts                  ← barrel (types only)
    env.ts                      ← t3-env validated env
  docs/
  scripts/
  middleware.ts                 ← apex redirect + auth guard
  next.config.ts
  tsconfig.json
  package.json
```

---

## 5. Dependency Recommendations

### 5.1 Keep

| Package | Version | Rationale |
|---|---|---|
| `next` | 16.1.0 | Current — stay on this version for the rebuild |
| `react` / `react-dom` | 19.2.3 | Required by Next.js 16 |
| `@supabase/ssr` | ^0.8.0 | Correct SSR-compatible Supabase client |
| `@supabase/supabase-js` | ^2.89.0 | Stable |
| `@tanstack/react-query` | ^5.90 | Correct tool for client-side polling and optimistic mutations |
| `zod` | ^4.2.1 | Schema validation — use for both Server Actions and t3-env |
| `react-hook-form` + `@hookform/resolvers` | latest | Best-in-class form management for complex multi-step forms |
| `tailwindcss` | ^4 | Stay on v4; PostCSS plugin is correct |
| `tailwind-merge` + `clsx` | current | `cn()` utility is correct pattern |
| `class-variance-authority` | current | Used by shadcn/ui components |
| `lucide-react` | current | Consistent icon set |
| `luxon` | ^3.7.2 | Timezone-aware date handling — justified for this app |
| `framer-motion` | ^12 | Acceptable for sidebar animation; limit to layout components only |
| `openai` | ^6 | Required for AI content generation |
| `resend` | ^6 | Email notifications |
| `@radix-ui/*` | current | Headless UI primitives for accessibility |

### 5.2 Remove

| Package | Reason |
|---|---|
| `dotenv` (production dep) | Move to `devDependencies` or remove — Next.js handles `.env` natively in all environments. Using `dotenv` in production can cause double-loading and override Next.js behaviour. |
| `@tanstack/react-query-devtools` (production dep) | Move to `devDependencies`. In the rebuild, load conditionally via `next/dynamic` with `ssr: false` to guarantee zero production bundle impact. |

### 5.3 Add

| Package | Rationale |
|---|---|
| `@t3-oss/env-nextjs` | Replace custom `env.ts` with validated, type-safe environment schema that fails at build time |
| `server-only` | Import in any file that must never be bundled client-side (service clients, auth server functions). Provides a build-time error if accidentally imported in a Client Component. |
| `client-only` | Import in Client Component hooks to prevent accidental Server Component usage |
| `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser` | Enforce `no-explicit-any`, `no-unsafe-*` rules. Current ESLint config uses only `eslint-config-next` which does not include these rules. |
| `eslint-plugin-import` | Enforce import ordering and prevent circular dependencies between `lib/` and `features/` |

### 5.4 Evaluate / Consider

| Package | Decision criteria |
|---|---|
| `framer-motion` | Heavy (180 KB gzipped). If the sidebar collapse animation is the only use, replace with CSS `transition` + Tailwind classes. If more animations are added (page transitions, skeleton reveals), keep. |
| `luxon` | `Temporal` (TC39) is shipping in V8. When Next.js runtime supports it natively, Luxon becomes redundant. For now, keep. |

---

## 6. Deployment Strategy

### 6.1 Vercel Configuration

**`vercel.json`:**

```json
{
  "framework": "nextjs",
  "buildCommand": "next build",
  "functions": {
    "src/app/api/cron/**": {
      "maxDuration": 300
    },
    "src/app/api/auth/**": {
      "maxDuration": 10
    },
    "src/app/api/oauth/**": {
      "maxDuration": 30
    }
  },
  "crons": [
    {
      "path": "/api/cron/publish",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/cron/purge-trash",
      "schedule": "0 3 * * *"
    }
  ]
}
```

**Remove `--webpack` from the build command.** Vercel builds with Turbopack by default for Next.js 15+. The `--webpack` flag is incompatible with this and will produce a warning. The correct build command is `next build` with no flags.

### 6.2 Edge vs Node Runtime Decisions

| Route / Handler | Runtime | Reason |
|---|---|---|
| `middleware.ts` | **Edge** | Domain redirect + auth cookie check; no Node.js APIs needed; low latency |
| `(app)/*` pages | **Node.js** (default) | Supabase SDK uses Node.js crypto; `requireAuthContext` calls `cookies()` |
| `(public)/l/[slug]` | **Node.js** | Supabase data fetch |
| `(marketing)/*` | **Edge** or static | No dynamic data; can be statically generated |
| `api/auth/login` | **Node.js** | Cookie setting, rate limiting (uses in-memory Map — Edge-incompatible) |
| `api/auth/magic-link` | **Node.js** | Same |
| `api/oauth/[provider]/callback` | **Node.js** | Token exchange, crypto |
| `api/cron/publish` | **Node.js** | Long-running, external API calls |
| `api/cron/purge-trash` | **Node.js** | DB write |
| `api/planner/activity` | **Node.js** | Supabase query |

Do not set `export const runtime = 'edge'` on any route that uses:
- `require('node:crypto')` (library actions)
- `@supabase/ssr` `createServerClient` (uses Node.js Buffer)
- The in-memory rate limiter in `rate-limit.ts`

### 6.3 Build Optimisation

**Fix the `--webpack` flag:** This is the single highest-impact build change. Turbopack (default for Next.js 15/16) is 5–10x faster for both dev and production builds.

**`next.config.ts` target additions:**

```ts
const nextConfig: NextConfig = {
  typescript: {
    // Remove tsconfig.build.json reference — use tsconfig.json
  },
  experimental: {
    // Enable React compiler when stable for automatic memoisation
    // reactCompiler: true,
    ppr: 'incremental',          // Partial Pre-Rendering per route
  },
  images: {
    remotePatterns: [
      { hostname: '*.supabase.co' },   // Supabase Storage
    ],
    formats: ['image/avif', 'image/webp'],
  },
  // Replace <img> usage in planner-calendar.tsx and trash list
  // with next/image for automatic optimisation
};
```

**Partial Pre-Rendering (PPR):** Next.js 16 supports incremental PPR. Enable it per route:

```ts
// src/app/(app)/planner/page.tsx
export const experimental_ppr = true;
```

PPR allows the static shell (sidebar, page header) to be served instantly from CDN while the dynamic calendar data streams in. This eliminates the blank-screen during navigation.

**Replace `<img>` with `next/image`:** The planner calendar and trash list use raw `<img>` tags with Supabase Storage URLs. `next/image` provides automatic AVIF/WebP conversion, responsive sizing, and lazy loading — important for the media-heavy planner view.

**Bundle analysis:** Add `@next/bundle-analyzer` to `devDependencies` and run `ANALYZE=true next build` to identify the largest client bundles. Current suspects: `framer-motion` in the sidebar, `@tanstack/react-query-devtools` if it leaks into production, and the `create-wizard.tsx` subtree.

---

## Summary of Critical Actions (Priority Order)

1. **Remove `--webpack` from build script** — unlocks Turbopack, fastest win
2. **Move `AppProviders` out of root layout** — eliminates the global client subtree for public routes; correctly scopes QueryClient to `(app)/*`
3. **Add Middleware auth guard** — removes per-layout redirect dependency
4. **Add `error.tsx` and `loading.tsx` to `(app)/`** — minimum viable error/loading infrastructure
5. **Apply `React.cache()` to shared data functions** — eliminates duplicate DB queries in single renders
6. **Fix `AuthProvider` double-instantiation** — remove from `AppProviders`, keep only in `(app)/layout.tsx`
7. **Replace custom `env.ts` with `@t3-oss/env-nextjs`** — build-time env validation
8. **Refactor login page to use Server Action** — eliminates Route Handler + manual fetch boilerplate
9. **Fix `CreateModal` TanStack Query pattern** — Server Actions are not query functions
10. **Add `server-only` sentinel to all `lib/` files that must not reach the client bundle**
