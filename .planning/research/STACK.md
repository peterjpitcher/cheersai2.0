# Stack Research

**Domain:** AI-powered social media management platform for hospitality
**Researched:** 2026-05-18
**Confidence:** HIGH

## Verdict

The chosen stack (Next.js 16, React 19, TypeScript, Tailwind v4, Supabase, Vercel, OpenAI, QStash, Axiom) is validated as production-ready and well-suited for this domain. Three gaps identified: (1) missing shadcn/ui for component primitives, (2) missing react-email for transactional email templates, (3) the `framer-motion` package name should migrate to the new `motion` package. No stack-level changes needed -- these are additive fills.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Next.js | 16.1.x | Full-stack framework | Stable Turbopack (50%+ faster builds), React Compiler auto-memoization, cache components with opt-in model, proxy replacing middleware. Native Vercel deployment. | HIGH |
| React | 19.2.x | UI rendering | Server Components, View Transitions API, useEffectEvent. Bundled with Next.js 16. | HIGH |
| TypeScript | 5.x (strict) | Type safety | Non-negotiable for a codebase this size. Zod 4 gives 10x faster TS compilation. | HIGH |
| Tailwind CSS | 4.x (4.2+) | Styling | CSS-first config via `@theme`, 8x faster incremental builds, native container queries, `@starting-style` support. v4.2 added webpack plugin for Next.js. | HIGH |
| Supabase | JS SDK 2.89+ / SSR 0.8+ | Database, Auth, Realtime, Storage | PostgreSQL + RLS + Auth + Realtime + Storage in one platform. Cookie-based auth via `@supabase/ssr`. Realtime Postgres Changes for activity feed. | HIGH |
| Vercel | Platform | Hosting, CI/CD, Edge | Native Next.js 16 deployment. Axiom integration via marketplace. Preview deployments per PR. | HIGH |
| OpenAI | SDK 6.15+ | AI content generation | GPT-4o with Structured Outputs (strict JSON schema, 100% schema compliance). Use `response_format` with Zod schemas for type-safe AI responses. | HIGH |
| QStash (Upstash) | Latest | Background job queue | HTTP-based message queue with built-in retry (configurable backoff), signed delivery, message ID idempotency. Simpler than Inngest for this use case. Cost-effective at scale ($40/mo vs $1500/mo reported). | HIGH |
| Axiom + next-axiom | 1.10.x | Structured logging | Vercel-native integration. Isomorphic logging (client/edge/server). Auto-monitors request duration, memory, Web Vitals. Zero-config via `withAxiom` wrapper. | HIGH |

### Supporting Libraries

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| Zod | 4.2.x | Schema validation | Env validation, form validation, API contracts, OpenAI Structured Outputs schemas. 14x faster string parsing vs v3. New top-level format validators (`z.email()`, `z.uuid()`). | HIGH |
| React Hook Form | 7.76.x | Form state management | All user-facing forms. v8 is still beta -- stay on v7 stable. | HIGH |
| @hookform/resolvers | 5.2.x | Zod-RHF bridge | Connects Zod 4 schemas to React Hook Form validation. | HIGH |
| TanStack React Query | 5.100.x | Server state / caching | All client-side data fetching. Built-in Suspense support, background refetch, optimistic updates. | HIGH |
| Motion (was Framer Motion) | 12.x | Animations | Page transitions, micro-interactions. Renamed from `framer-motion` to `motion` -- import from `motion/react`. Hardware-accelerated via Web Animations API. | HIGH |
| Luxon | 3.7.x | Date/time handling | All timezone-aware date operations (Europe/London). Stick with Luxon -- Temporal API polyfill is not production-ready in Node.js. | MEDIUM |
| Radix UI primitives | 1.1.x | Accessible headless components | Dialog, tooltip, dropdown, separator, slot. Use selectively for a11y-critical components. | HIGH |
| shadcn/ui | Latest CLI | Component system | **GAP: Add this.** Pre-built Radix + Tailwind components you own. CLI copies source into project. Default choice for React + Tailwind in 2026. 75k+ GitHub stars. | HIGH |
| react-email | 6.1.x | Email templates | **GAP: Add this.** Build transactional email with React components. Pairs with Resend. Visual editor available. 2M weekly npm downloads. | HIGH |
| @react-email/components | Latest | Email UI primitives | Pre-built email components (Button, Section, Text, etc.) that render correctly across all inbox providers. | HIGH |
| Resend | SDK 6.6.x | Transactional email delivery | Token expiry alerts, publish failure notifications, magic link delivery. Server-action integration with `'use server'`. | HIGH |
| sharp | 0.34.x | Image processing | Media library uploads, thumbnail generation, format conversion. Must be in `serverExternalPackages` in next.config.ts. | HIGH |
| satori | 0.26.x | HTML-to-SVG/image | Social share image generation, OG images, banner creation from templates. | HIGH |
| Lucide React | 0.562+ | Icons | Tree-shakeable, consistent icon set. Already in v1 stack. | HIGH |
| clsx + tailwind-merge | 2.1.x / 3.4.x | Class composition | Dynamic Tailwind class merging without conflicts. Foundation for component variants. | HIGH |
| CVA (class-variance-authority) | 0.7.x | Component variants | Type-safe variant definitions for button, badge, input components. Used by shadcn/ui. | HIGH |
| p-limit | 7.3.x | Concurrency control | Rate-limit concurrent API calls to Facebook/Instagram/GBP. Essential for bulk publishing. | HIGH |

### Development Tools

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| Vitest | 4.x | Unit/integration tests | Vite-native, fast. Colocate tests with source. | 
| Playwright | Latest | E2E testing | 6 critical journeys. Use Page Object Model pattern. Auth state reuse across tests. |
| ESLint | 9.x (flat config) | Linting | Next.js config + custom rules. Zero warnings in CI. |
| tsx | 4.21.x | Script runner | Run operational TypeScript scripts (backfill, seed, ops). |
| dotenv | 17.x | Env loading | Dev-only. Production uses Vercel env vars. |

### Security Libraries

| Library | Purpose | Notes |
|---------|---------|-------|
| Node.js `crypto` (built-in) | AES-256-GCM encryption | Encrypt social OAuth tokens at rest. Unique IV per encryption. 96-bit IV + auth tag. No external dependency needed. |
| libphonenumber-js | Phone normalization | E.164 format for any SMS/phone features. Already in workspace standards. |

---

## Installation

```bash
# Core framework (already present)
npm install next@latest react@latest react-dom@latest

# Database and auth
npm install @supabase/supabase-js @supabase/ssr

# AI
npm install openai

# Forms and validation
npm install react-hook-form @hookform/resolvers zod

# Data fetching
npm install @tanstack/react-query

# Animation (MIGRATE: framer-motion -> motion)
npm install motion
npm uninstall framer-motion

# Dates
npm install luxon

# UI primitives (keep selective Radix + add shadcn/ui)
npx shadcn@latest init
npm install @radix-ui/react-dialog @radix-ui/react-tooltip @radix-ui/react-slot

# Email (NEW)
npm install resend react-email @react-email/components

# Image processing
npm install sharp satori

# Background jobs
npm install @upstash/qstash

# Logging
npm install next-axiom

# Utilities
npm install clsx tailwind-merge class-variance-authority lucide-react p-limit

# Dev dependencies
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
npm install -D @playwright/test
npm install -D typescript @types/node @types/luxon
npm install -D eslint eslint-config-next
npm install -D tsx dotenv
npm install -D @tanstack/react-query-devtools
```

---

## Alternatives Considered

| Category | Recommended | Alternative | When to Use Alternative |
|----------|-------------|-------------|-------------------------|
| Background Jobs | QStash | Inngest | If you need multi-step durable workflows with sleep/wait between steps. QStash is simpler and cheaper for HTTP delivery + retry. |
| Background Jobs | QStash | Trigger.dev | If you need long-running compute (video processing, ffmpeg). CheersAI doesn't need this -- video is out of scope. |
| Animation | Motion 12 | CSS `@starting-style` + View Transitions | If you only need simple enter/exit animations. Motion is better for gesture-driven and layout animations. |
| Date/Time | Luxon | Temporal API (polyfill) | When Node.js ships native Temporal (not yet as of May 2026). Chrome 144 has it, but server-side needs polyfill. Too early for production. |
| Date/Time | Luxon | date-fns | If you need tree-shaking and functional API. Luxon is better for timezone-heavy work (Europe/London throughout). |
| Components | shadcn/ui (Radix) | shadcn/ui (Base UI) | Base UI is more actively maintained than Radix primitives. But Radix-backed shadcn is battle-tested and 131M weekly downloads on `@radix-ui/react-slot`. |
| Email | react-email + Resend | MJML | If you need framework-agnostic email templates. react-email is better for React teams. |
| State | React Query | SWR | Never. React Query has better devtools, Suspense support, and mutation handling. |
| Logging | Axiom | Datadog | If you need APM traces. Axiom is simpler, cheaper, and Vercel-native. Overkill to add Datadog. |
| Image Gen | satori + sharp | Puppeteer/Playwright screenshots | If you need pixel-perfect HTML rendering. satori is 100x faster but supports CSS subset only. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `framer-motion` (package name) | Renamed to `motion` in 2025. Old package still works but won't receive future features. Import path is now `motion/react`. | `motion` v12+ |
| Vercel Cron | No built-in retry, no idempotency, no signed delivery. Double-fire risk is a known issue. | QStash with retry config |
| Moment.js | Deprecated, mutable, enormous bundle (232KB). | Luxon 3.7.x |
| Zod 3 (legacy import) | Zod 4 is 14x faster, 2.3x smaller bundle. v1 already uses Zod 4.2.x. | `zod` (v4 at default import path) |
| `z.string().email()` | Zod 4 moved format validators to top-level. Old method works but is deprecated. | `z.email()`, `z.uuid()`, `z.url()` |
| Inline Tailwind hex colors | Tailwind v4 uses `@theme` CSS-first tokens. Hardcoded hex breaks the design system. | `@theme` tokens in `globals.css` |
| `tailwind.config.ts` | Tailwind v4 removed JS config files. All customization lives in CSS `@theme` blocks. | CSS-first configuration |
| DaisyUI 4 | Incompatible with Tailwind v4. Plugin API changed. | shadcn/ui (owns the source, no plugin dependency) |
| SWR | Inferior mutation handling, no built-in devtools, weaker Suspense support vs React Query. | TanStack React Query v5 |
| React Hook Form v8 | Still in beta as of May 2026. | React Hook Form v7.76.x (stable) |
| `@js-temporal/polyfill` (server) | Not production-ready in Node.js. Chrome has native Temporal but Node.js does not. | Luxon 3.7.x |
| Unified social media APIs (e.g. Nango, Outstand) | Adds vendor dependency for core publishing pipeline. Token refresh logic and rate limits are domain-critical -- own them. | Direct Facebook Graph API + Instagram Graph API + GBP API with provider abstraction layer |

---

## Stack Gaps Identified

### Gap 1: shadcn/ui Component System (CRITICAL)

**Current state:** Raw Radix primitives + custom Tailwind classes.
**Recommendation:** Initialize shadcn/ui to get pre-built, accessible, Tailwind v4-compatible components (Button, Dialog, Input, Card, Table, etc.). You own the source code -- no runtime dependency.

```bash
npx shadcn@latest init
npx shadcn@latest add button dialog input card table badge
```

### Gap 2: react-email Templates (IMPORTANT)

**Current state:** Resend SDK present but no template system.
**Recommendation:** Add react-email for type-safe, visually testable email templates. Token expiry alerts, publish failure notifications, and magic link emails all benefit from a component-based template system.

### Gap 3: Motion Package Migration (MINOR)

**Current state:** Using `framer-motion` v12.23.26.
**Recommendation:** Migrate import from `framer-motion` to `motion` package. Same API, new package name. The old package still works but new features ship only to `motion`.

### Gap 4: Supabase Realtime Worker Mode (NICE-TO-HAVE)

**Current state:** Standard Realtime connection.
**Recommendation:** When implementing the activity feed, use `worker: true` option (new in 2026) to run the WebSocket connection in a Web Worker. Prevents disconnection from browser tab throttling -- critical for a dashboard app where users switch tabs.

---

## Version Compatibility Matrix

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Next.js 16.1 | React 19.2, Tailwind 4.2+ | Turbopack stable. React Compiler built-in. |
| Tailwind CSS 4.2 | PostCSS (postcss.config.mjs) | Webpack plugin added in 4.2. Lightning CSS bundled. |
| Zod 4.2 | @hookform/resolvers 5.2+ | RHF v8 resolvers also support Zod 4, but v8 is beta. Use resolvers v5 with RHF v7. |
| Zod 4.2 | OpenAI SDK 6.x | Use Zod schemas with `response_format` for Structured Outputs. |
| shadcn/ui (latest) | Tailwind v4, Radix 1.1.x | CLI auto-generates v4-compatible components since Jan 2026. |
| react-email 6.1 | Resend SDK 6.6, React 19 | Unified package. `@react-email/components` for primitives. |
| Motion 12.x | React 19 | Import from `motion/react`. Drop-in replacement for `framer-motion`. |
| next-axiom 1.10 | Next.js 16 | Wrap config with `withAxiom()`. Vercel integration sets env vars. |
| @supabase/ssr 0.8 | @supabase/supabase-js 2.89+ | Cookie-based auth for App Router. |
| sharp 0.34 | Next.js 16 | Must be in `serverExternalPackages` array in `next.config.ts`. |
| Playwright (latest) | Next.js 16 | Test against production build. Use `webServer` config. |
| Vitest 4.x | React 19, jsdom 29 | Vite-native. Path aliases must match `tsconfig.json`. |

---

## OpenAI Integration Pattern

For CheersAI's content generation, use Structured Outputs with Zod schemas:

```typescript
// Define schema with Zod 4
const platformContent = z.object({
  facebook: z.object({
    copy: z.string(),
    hashtags: z.array(z.string()),
    cta: z.string(),
  }),
  instagram: z.object({
    caption: z.string(),
    hashtags: z.array(z.string()),
    altText: z.string(),
  }),
  gbp: z.object({
    summary: z.string(),
    callToAction: z.enum(["BOOK", "ORDER", "LEARN_MORE", "CALL"]),
  }),
});

// Use with OpenAI Structured Outputs
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [...],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "platform_content",
      strict: true,
      schema: zodToJsonSchema(platformContent),
    },
  },
});
```

This guarantees 100% schema compliance -- no parsing errors, no missing fields. Schema-first development with Zod 4 means the same schema validates forms, API responses, and AI outputs.

---

## Social Platform API Considerations

| Platform | API Version | Token Lifecycle | Rate Limits | Key Concern |
|----------|-------------|-----------------|-------------|-------------|
| Facebook | Graph API v21.0 | 60-day long-lived tokens, refreshable after 24h | 200 calls/user/hour | Token refresh before expiry. Version deprecation quarterly. |
| Instagram | Graph API v21.0 | Same as Facebook (shared token) | 200 calls/user/hour | Carousel requires multiple media items uploaded first. Stories have 24h expiry. |
| Google Business Profile | v1 | OAuth2 refresh tokens (no hard expiry, revocable) | 60 requests/min/project | Must handle location-level access. Event and Offer post types differ from STANDARD. |

**Architecture recommendation:** Provider abstraction layer (registry pattern) with per-platform adapters. Each adapter owns: token refresh, rate limiting, content formatting, error mapping. This isolates platform-specific complexity and makes adding future platforms (TikTok, X) straightforward.

---

## Sources

- [Next.js 16 Blog Post](https://nextjs.org/blog/next-16) -- Features, Turbopack, React Compiler (HIGH)
- [Next.js 16 Upgrade Guide](https://nextjs.org/docs/app/guides/upgrading/version-16) -- Migration details (HIGH)
- [Tailwind CSS v4 Release](https://tailwindcss.com/blog/tailwindcss-v4) -- CSS-first config, performance (HIGH)
- [Zod v4 Changelog](https://zod.dev/v4/changelog) -- Breaking changes, migration (HIGH)
- [Motion Changelog](https://motion.dev/changelog) -- Framer Motion rename, v12 features (HIGH)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) -- JSON schema, strict mode (HIGH)
- [Axiom for Vercel](https://vercel.com/marketplace/axiom) -- Integration setup (HIGH)
- [next-axiom GitHub](https://github.com/axiomhq/next-axiom) -- Version, API (HIGH)
- [Supabase Realtime Docs](https://supabase.com/docs/guides/realtime) -- Broadcast, Presence, Postgres Changes (HIGH)
- [Supabase Realtime in Practice (2026)](https://eastondev.com/blog/en/posts/dev/20260512-supabase-realtime-practice/) -- Worker mode, reconnection (MEDIUM)
- [QStash at Scale Case Study](https://upstash.com/blog/qstash-workflow-at-scale) -- Cost comparison with alternatives (MEDIUM)
- [React Email 6.0](https://resend.com/blog/react-email-6) -- Visual editor, unified package (HIGH)
- [Resend + Next.js Docs](https://resend.com/docs/send-with-nextjs) -- Server action integration (HIGH)
- [shadcn/ui vs Radix vs Base UI (2026)](https://www.pkgpulse.com/guides/shadcn-ui-vs-base-ui-vs-radix-components-2026) -- Component ecosystem (MEDIUM)
- [Playwright + Next.js Docs](https://nextjs.org/docs/app/guides/testing/playwright) -- E2E setup (HIGH)
- [Instagram Graph API Guide (2026)](https://elfsight.com/blog/instagram-graph-api-complete-developer-guide-for-2026/) -- API versioning, tokens (MEDIUM)
- [Temporal API Status](https://groundy.com/articles/javascript-s-date-problem-finally-fixed-temporal-api-after/) -- Stage 4 but no Node.js yet (MEDIUM)

---
*Stack research for: AI-powered social media management platform (hospitality)*
*Researched: 2026-05-18*
