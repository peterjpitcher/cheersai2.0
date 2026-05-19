# Phase 2: Content Engine and AI Generation - Research

**Researched:** 2026-05-19
**Domain:** Content creation wizard, AI generation with OpenAI structured outputs, media library with Supabase Storage, scheduling UI, design system tokens
**Confidence:** HIGH

## Summary

Phase 2 builds the content creation engine: a 4-step wizard (brief, AI generate, media, schedule) for 5 content types, backed by OpenAI structured outputs with Zod validation, a Supabase Storage media library, and a planner calendar. The design system must be established first (tokens, dark mode, responsive layout) as every UI component depends on it.

The codebase has extensive v1 reference code that provides proven patterns for AI prompts, post-processing, scheduling conflicts, and recurring campaign materialisation. These patterns are well-tested and should be rebuilt cleanly (not copied) following the greenfield mandate, but the domain logic is sound and complete.

**Critical finding:** The project uses Zod 4.2.1, but OpenAI SDK 6.15.0 has known compatibility issues with Zod v4's `zodResponseFormat`. The SDK must be upgraded to 6.38+ (which declares `zod: '^3.25 || ^4.0'` as a peer dependency and includes Zod v4 fixes) before implementing structured outputs (AI-05). There are also known issues with discriminated unions in Zod 4.1.13+ emitting `oneOf` instead of `anyOf` -- keep response schemas flat with simple objects, not unions.

**Primary recommendation:** Build in 5 waves: (1) design system tokens and responsive shell, (2) content type schemas and server actions, (3) AI generation with structured outputs, (4) media library and Supabase Storage, (5) planner calendar and scheduling UI.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Multi-step wizard with 4 steps: 1) Pick type + write brief, 2) AI generates -- review/edit per platform, 3) Attach media, 4) Schedule + confirm
- **D-02:** Shared wizard for all 5 content types with type-specific fields at step 1 -- Event adds date/venue fields, Promotion adds coupon code, Weekly Recurring adds recurrence config. Same 4-step structure throughout.
- **D-03:** Auto-save draft to DB on each step change. If owner closes mid-flow, they can resume where they left off. Prevents lost work.
- **D-04:** Progressive disclosure for fine-tune controls. Sensible defaults with a collapsible "Advanced" panel. Most owners just click "Generate" -- power users expand to tweak tone/length/CTA/proof-points.
- **D-05:** Curated hospitality tones (5-6 named options): Friendly & Warm, Professional, Playful, Sophisticated, Community-focused. Industry-specific language, not generic sliders.
- **D-06:** Regenerate-with-modifier uses inline modifier chips below AI output: "Make shorter", "More formal", "Add emoji", "Stronger CTA". One click regenerates with that modifier applied. No free-text prompt editing.
- **D-07:** Per-platform AI output shown as side-by-side columns (Facebook, Instagram, GBP) for comparison. Columns stack vertically on mobile/tablet for responsiveness.
- **D-08:** Bold & branded visual feel -- strong brand colour presence, chunky elements, personality-driven.
- **D-09:** Dark mode supported from the start via CSS custom properties.
- **D-10:** Subtle micro-interactions using Framer Motion -- smooth page transitions, hover states, loading skeletons.
- **D-11:** Compact/dense card density in list views. Tight padding, 4-5 cards per row on desktop.
- **D-12:** Media upload panel combines drag-drop zone, "Browse" file picker, and "Library" tab showing previously uploaded media.
- **D-13:** Manual free-text tags on upload. Media automatically tagged with campaign name when attached.
- **D-14:** Media stored in Supabase Storage -- RLS-protected buckets, direct URL serving, image transforms via CDN.
- **D-15:** Media library accessible both as standalone `/library` page and as inline picker within the create wizard.

### Claude's Discretion
- Exact spacing token values (4px scale implementation)
- Typography scale and heading hierarchy
- Loading skeleton designs per view
- Error state UI patterns
- Platform preview mockup fidelity in review step
- Dark mode colour palette specifics (derived from brand colours)
- Exact modifier chip set (beyond the 4 examples above)
- Banner/overlay image generation approach

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONT-01 | Instant Post creation | Wizard step 1 with `instantPostSchema` pattern from v1; server action with `requireAuthContext()` |
| CONT-02 | Story creation | Wizard step 1 variant with single-image constraint; platform limited to FB/IG |
| CONT-03 | Event Campaign creation | Wizard step 1 with date/venue fields, schedule offsets; `eventCampaignSchema` from v1 |
| CONT-04 | Promotion Campaign creation | Wizard step 1 with coupon code, date range; `promotionCampaignSchema` from v1 |
| CONT-05 | Weekly Recurring creation | Wizard step 1 with day-of-week, recurrence config; `weeklyCampaignSchema` from v1 |
| CONT-06 | Platform-specific editor with per-tab previews | D-07 side-by-side columns; v1 `generated-content-review-list.tsx` pattern |
| CONT-07 | Media library with search, tagging, campaign filters | Supabase Storage buckets + `media_library` table with tags; D-12/D-13/D-14/D-15 |
| CONT-08 | `next/image` replacing all bare `<img>` tags | 6 files currently use bare `<img>` -- replace during component builds |
| AI-01 | AI generates platform-specific copy from single brief | v1 `buildInstantPostPrompt()` generates per-platform; rebuild with structured output |
| AI-02 | Fine-tune toggle with progressive disclosure | D-04 collapsible Advanced panel; v1 `advancedOptionsSchema` has tone/length/CTA/proof-points |
| AI-03 | Regenerate-with-modifier | D-06 modifier chips; server action re-calls OpenAI with modifier appended to prompt |
| AI-04 | Per-campaign-type and per-platform temperature settings | Configuration map: content_type x platform -> temperature (0.6-0.9 range) |
| AI-05 | Structured output schema with Zod validation | `zodResponseFormat` from `openai/helpers/zod`; requires OpenAI SDK upgrade to 6.38+ |
| AI-06 | Content post-processing: banned phrases, emoji/hashtag clamping | v1 `postprocess.ts` and `voice.ts` have complete implementation -- rebuild cleanly |
| AI-07 | Brand voice model: tone, per-platform signatures | v1 `voice.ts` TONE_PROFILE, BANNED_PHRASES, PREFERRED_PHRASES; `profiles` table has brand voice fields |
| AI-08 | GBP CTA lint rule | Post-generation check: warn when platform=gbp and CTA is null and no brand default |
| AI-09 | 30-second timeout on OpenAI calls | `AbortController` with 30s timeout; graceful error UI not hanging spinner |
| SCHED-01 | Planner calendar: 6-week grid with status chips | v1 `planner-calendar.tsx` reference; status chips from design handoff tokens |
| SCHED-02 | Conflict detection in scheduling UI | v1 `conflicts.ts` resolveConflicts() with 30-min window; surface in step 4 |
| SCHED-03 | Weekly recurring materialiser | v1 `materialise.ts` with cadence + spread_evenly modes; rebuild with service-role client |
| SCHED-05 | Europe/London timezone in scheduling | `DEFAULT_TIMEZONE` constant + Luxon `DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE })` |
| UX-01 | Design tokens: semantic colours, 4px spacing, platform colours | Design handoff `tokens.css` provides full token set; bridge to Tailwind v4 `@theme inline` |
| UX-02 | Responsive layout: bottom nav mobile, icon sidebar tablet, expanded sidebar desktop | Design handoff shell pattern; breakpoints at 640px (mobile), 768px (tablet), 1024px (desktop) |
| UX-03 | Create flows: bottom sheet mobile, slide-over tablet, modal desktop | Radix Dialog + Sheet already in `src/components/ui/`; conditional rendering by breakpoint |
| UX-04 | Status chips: draft/scheduled/queued/publishing/succeeded/failed | Design handoff Status component with dot+label pattern; 6 states with distinct colours |
| UX-05 | Mobile touch targets >= 44x44px | WCAG minimum; enforce via min-h-11 min-w-11 on interactive elements |
| UX-06 | WCAG 2.1 AA contrast ratios | Verify all token combinations pass 4.5:1 (text) and 3:1 (large text/UI) |
| UX-07 | Keyboard navigation for all interactive elements | Radix primitives handle this; custom components need tabIndex and onKeyDown |
| UX-08 | Modal dialogs trap focus and close on Escape | Radix Dialog provides this by default; verify on Sheet and custom overlays |
| UX-09 | Single Sidebar implementation | Replace any v1 parallel nav files with one Sidebar component |
| UX-10 | Post detail on desktop: side drawer | Radix Sheet anchored right; not a page navigation |
</phase_requirements>

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.0 | App Router, server actions, server components | Project framework |
| React | 19.2.3 | UI rendering | Project framework |
| OpenAI SDK | 6.15.0 -> **6.38+** | AI content generation, structured outputs | **Must upgrade for Zod v4 compatibility** |
| Zod | 4.2.1 | Schema validation for forms and AI responses | Already installed, used throughout |
| React Hook Form | 7.69.0 | Form state management | Already installed |
| @hookform/resolvers | 5.2.2 | Zod integration with RHF | Already installed |
| TanStack React Query | 5.90.x | Server state, caching, optimistic updates | Already installed |
| Framer Motion | 12.23.26 | Micro-interactions, page transitions (D-10) | Already installed |
| Luxon | 3.7.2 | Timezone-aware date handling (Europe/London) | Already installed |
| Radix UI | 1.1.x-2.x | Dialog, Sheet, Tooltip, Label | Already installed |
| Supabase JS | 2.89.0 | Database + Auth + Storage client | Already installed |
| CVA | 0.7.1 | Component variant management | Already installed |
| Lucide React | 0.562.0 | Icon library | Already installed |

### Supporting (may need adding)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@supabase/supabase-js` (Storage API) | 2.89.0 | File upload to Supabase Storage | Already included in supabase-js; no separate install |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Supabase Storage | AWS S3 / Cloudflare R2 | Supabase Storage is locked decision (D-14); keeps stack simple, RLS-protected |
| zodResponseFormat | Manual JSON schema | zodResponseFormat is type-safe and auto-validates; manual is error-prone |
| Luxon | date-fns | Luxon already established for timezone handling; switching would break patterns |

**Installation / Upgrade:**
```bash
npm install openai@latest
```

**Version verification:** OpenAI SDK must be >= 6.38.0 for Zod v4 structured output support.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   ├── (app)/
│   │   ├── create/           # Create wizard route
│   │   │   └── page.tsx      # Server component, Suspense boundary
│   │   ├── library/          # Media library standalone page
│   │   │   └── page.tsx
│   │   ├── planner/          # Planner calendar route
│   │   │   └── page.tsx
│   │   └── layout.tsx        # App shell (sidebar, responsive nav)
│   ├── actions/
│   │   ├── content.ts        # Content CRUD server actions
│   │   ├── ai-generate.ts    # AI generation server action
│   │   └── media.ts          # Media upload/delete server actions
│   └── globals.css           # Design tokens (extended)
├── components/
│   ├── ui/                   # Existing Radix primitives (extend)
│   │   ├── status-chip.tsx   # NEW: Status badge component (UX-04)
│   │   ├── platform-dot.tsx  # NEW: Platform indicator
│   │   └── ...existing
│   └── providers/
│       └── theme-provider.tsx # NEW: Dark mode toggle provider
├── features/
│   ├── create/               # Create wizard (rebuild from v1 reference)
│   │   ├── create-wizard.tsx          # 4-step wizard container
│   │   ├── steps/
│   │   │   ├── brief-step.tsx         # Step 1: type + brief
│   │   │   ├── generate-step.tsx      # Step 2: AI generate + review
│   │   │   ├── media-step.tsx         # Step 3: attach media
│   │   │   └── schedule-step.tsx      # Step 4: schedule + confirm
│   │   ├── forms/
│   │   │   ├── instant-post-fields.tsx
│   │   │   ├── event-fields.tsx
│   │   │   ├── promotion-fields.tsx
│   │   │   ├── story-fields.tsx
│   │   │   └── weekly-recurring-fields.tsx
│   │   ├── ai-review/
│   │   │   ├── platform-columns.tsx   # Side-by-side platform preview
│   │   │   └── modifier-chips.tsx     # Regenerate-with-modifier (D-06)
│   │   ├── media/
│   │   │   ├── media-upload-panel.tsx  # Drag-drop + browse + library tab
│   │   │   └── media-picker.tsx       # Inline library picker
│   │   └── schemas/
│   │       └── content-schemas.ts     # Zod schemas for all 5 types
│   ├── library/              # Media library feature
│   │   ├── media-grid.tsx
│   │   ├── media-filters.tsx
│   │   └── media-detail.tsx
│   └── planner/              # Planner calendar (rebuild from v1 reference)
│       ├── planner-calendar.tsx
│       ├── calendar-cell.tsx
│       ├── status-filters.tsx
│       └── post-drawer.tsx    # Side drawer for post detail (UX-10)
├── lib/
│   ├── ai/                   # AI generation (rebuild from v1)
│   │   ├── client.ts         # OpenAI client singleton (exists)
│   │   ├── generate.ts       # NEW: Generation with structured outputs
│   │   ├── prompts.ts        # Platform-specific prompt builder (rebuild)
│   │   ├── voice.ts          # Brand voice, banned phrases (rebuild)
│   │   ├── postprocess.ts    # Post-processing pipeline (rebuild)
│   │   └── schemas.ts        # NEW: Zod schemas for AI response format
│   ├── media/                # NEW: Media library logic
│   │   ├── upload.ts         # Supabase Storage upload helper
│   │   └── queries.ts        # Media library data access
│   ├── scheduling/           # Scheduling logic (rebuild from v1)
│   │   ├── conflicts.ts      # Conflict detection (rebuild)
│   │   └── materialise.ts    # Recurring materialiser (rebuild)
│   └── content/              # NEW: Content domain logic
│       ├── draft-autosave.ts # Auto-save draft on step change (D-03)
│       └── queries.ts        # Content data access
└── types/
    ├── content.ts            # NEW: Content item types
    └── media.ts              # NEW: Media library types
```

### Pattern 1: Server Action with Auth + Zod Validation
**What:** All content mutations go through server actions with auth re-verification
**When to use:** Every create/update/delete operation on content_items, media_library
**Example:**
```typescript
// Source: established pattern from src/lib/auth/server.ts
'use server';

import { requireAuthContext } from '@/lib/auth/server';
import { contentBriefSchema } from '@/features/create/schemas/content-schemas';

export async function createDraft(
  formData: unknown
): Promise<{ success?: boolean; error?: string; id?: string }> {
  const { user, supabase, accountId } = await requireAuthContext();
  const parsed = contentBriefSchema.safeParse(formData);
  if (!parsed.success) return { error: parsed.error.message };

  const { data, error } = await supabase
    .from('content_items')
    .insert({
      account_id: accountId,
      content_type: parsed.data.contentType,
      status: 'draft',
      title: parsed.data.title,
      body_draft: parsed.data,
    })
    .select('id')
    .single();

  if (error) return { error: error.message };
  return { success: true, id: data.id };
}
```

### Pattern 2: AI Generation with Structured Outputs (AI-05)
**What:** OpenAI call returns typed, Zod-validated response matching a defined schema
**When to use:** All AI content generation calls
**Example:**
```typescript
// Source: openai/helpers/zod documentation
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { getOpenAIClient } from '@/lib/ai/client';

const PlatformCopySchema = z.object({
  facebook: z.object({
    body: z.string(),
    cta: z.string().optional(),
    hashtags: z.array(z.string()).optional(),
  }),
  instagram: z.object({
    body: z.string(),
    hashtags: z.array(z.string()).optional(),
  }),
  gbp: z.object({
    body: z.string(),
    cta_action: z.string().optional(),
  }),
});

export async function generatePlatformCopy(
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.7,
): Promise<z.infer<typeof PlatformCopySchema>> {
  const client = getOpenAIClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000); // AI-09

  try {
    const completion = await client.chat.completions.parse({
      model: 'gpt-4o-mini',
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: zodResponseFormat(PlatformCopySchema, 'platform_copy'),
    }, { signal: controller.signal });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) throw new Error('No parsed response from AI');
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}
```

### Pattern 3: Supabase Storage Upload (D-14)
**What:** Upload media files to RLS-protected Supabase Storage bucket
**When to use:** Media upload in wizard step 3 and standalone library
**Example:**
```typescript
// Source: Supabase Storage documentation
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

const BUCKET_NAME = 'media';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function uploadMedia(
  file: File,
  accountId: string,
): Promise<{ url: string; path: string } | { error: string }> {
  if (file.size > MAX_FILE_SIZE) {
    return { error: 'File must be under 10MB' };
  }

  const supabase = getSupabaseBrowserClient();
  const ext = file.name.split('.').pop();
  const path = `${accountId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
    });

  if (error) return { error: error.message };

  const { data: urlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(path, {
      transform: { width: 800, quality: 80 },
    });

  return { url: urlData.publicUrl, path };
}
```

### Pattern 4: Auto-Save Draft (D-03)
**What:** Persist wizard state to content_items on each step transition
**When to use:** Every time the wizard advances or goes back a step
**Example:**
```typescript
// Debounced auto-save using React Query mutation
import { useMutation } from '@tanstack/react-query';
import { saveDraft } from '@/app/actions/content';

export function useAutoSaveDraft(contentId: string | null) {
  const mutation = useMutation({
    mutationFn: (data: DraftData) => saveDraft(contentId, data),
    // No onSuccess needed -- silent save
  });

  // Call on step change
  const save = useCallback(
    (data: DraftData) => {
      mutation.mutate(data);
    },
    [mutation]
  );

  return { save, isSaving: mutation.isPending };
}
```

### Pattern 5: Responsive Create Flow (UX-03)
**What:** Wizard renders as bottom sheet (mobile), slide-over (tablet), or modal (desktop)
**When to use:** Create wizard container
**Example:**
```typescript
// Use existing Radix Dialog + Sheet with breakpoint detection
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';

export function CreateFlowContainer({ children, open, onOpenChange }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[90vh]">
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: modal dialog
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        {children}
      </DialogContent>
    </Dialog>
  );
}
```

### Anti-Patterns to Avoid
- **Copying v1 code directly:** v1 is reference only. Rebuild cleanly following v2 patterns (greenfield mandate).
- **Skipping auto-save:** If the wizard doesn't save drafts, users lose work on accidental close. Use D-03 pattern.
- **Using `getSession()` for auth:** Must use `getUser()` per Phase 1 decision. `getSession()` does not re-validate JWT.
- **Dynamic Tailwind classes:** Never construct `bg-${color}-500`. Always use complete static class names.
- **Bare `<img>` tags:** Always use `next/image` (CONT-08). Currently 6 files have bare `<img>`.
- **Ignoring Zod v4/OpenAI SDK incompatibility:** Must upgrade OpenAI SDK before implementing AI-05.
- **Union types in AI response schemas:** Zod v4.1.13+ emits `oneOf` for discriminated unions which OpenAI strict mode rejects. Use flat object schemas instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Form state management | Custom useState chain | React Hook Form + Zod resolver | Multi-step wizard state, validation, dirty tracking |
| AI response parsing | Manual JSON.parse + type assertion | OpenAI `zodResponseFormat` + `.parse()` | Type-safe, auto-validates, handles refusals |
| File upload to cloud | Custom S3/multipart upload | Supabase Storage `.upload()` | RLS-protected, CDN transforms, single dependency |
| Date/timezone handling | `new Date()` + manual offsets | Luxon `DateTime.fromJSDate(d, { zone })` | BST/GMT transitions handled correctly |
| Conflict detection | Custom scheduling overlap check | Rebuild v1 `resolveConflicts()` with same algorithm | 30-min window + resolution offsets already proven |
| Focus trapping in modals | Custom focus trap | Radix Dialog/Sheet primitives | Handles edge cases (nested modals, shadow DOM) |
| Dark mode toggle | Manual class toggling | CSS `prefers-color-scheme` + optional toggle provider | Already started in globals.css; CSS-first approach |
| Component variants | Ternary chains in className | CVA (class-variance-authority) | Already installed; type-safe variant definitions |

**Key insight:** The v1 codebase has working implementations for every complex domain problem in this phase (AI prompts, post-processing, conflict detection, recurring materialisation). The task is rebuilding them cleanly with v2 patterns (structured outputs, proper auth, Zod v4 schemas), not inventing new algorithms.

## Common Pitfalls

### Pitfall 1: OpenAI SDK / Zod v4 Incompatibility
**What goes wrong:** `zodResponseFormat` throws type errors or runtime exceptions with Zod v4
**Why it happens:** OpenAI SDK 6.15.0 vendored `zod-to-json-schema` expects Zod v3 internals (`ZodFirstPartyTypeKind`)
**How to avoid:** Upgrade OpenAI SDK to 6.38+ before implementing AI-05. Keep AI response schemas as flat objects (no discriminated unions).
**Warning signs:** TypeScript errors on `zodResponseFormat()` call, runtime `ZodFirstPartyTypeKind is not exported` error

### Pitfall 2: Wizard State Loss on Navigation
**What goes wrong:** Owner accidentally navigates away mid-wizard, loses all progress
**Why it happens:** React state is ephemeral; no persistence layer
**How to avoid:** Implement D-03 auto-save: persist to `content_items.body_draft` (JSONB) on every step change. On wizard open, check for existing draft and offer to resume.
**Warning signs:** No `saveDraft` call in step transition handlers

### Pitfall 3: Timezone Bugs in Scheduling
**What goes wrong:** Content scheduled for "6pm" publishes at wrong time during BST/GMT transition
**Why it happens:** Using `new Date()` or `Date.toISOString()` without explicit timezone
**How to avoid:** Always use Luxon with `{ zone: DEFAULT_TIMEZONE }`. Store `scheduled_at` as `timestamptz` (already in schema). Never use raw JavaScript Date for display.
**Warning signs:** Code using `new Date().toISOString()` for user-facing dates

### Pitfall 4: Media Upload Without Bucket RLS
**What goes wrong:** Any authenticated user can access/delete another account's media
**Why it happens:** Supabase Storage bucket created without RLS policies
**How to avoid:** Create Storage bucket with RLS policies scoped to `account_id` path prefix. File paths must be `{account_id}/{uuid}.{ext}`. RLS policy: `(storage.foldername(name))[1] = auth.uid()::text` or use account-scoped path check.
**Warning signs:** No `CREATE POLICY` on `storage.objects` for the media bucket

### Pitfall 5: AI Generation Without Timeout (AI-09)
**What goes wrong:** OpenAI call hangs indefinitely, user sees infinite spinner
**Why it happens:** No `AbortController` timeout on the API call
**How to avoid:** Always wrap OpenAI calls with `AbortController` and 30-second timeout. Show graceful error message ("Generation took too long -- please try again") instead of hanging.
**Warning signs:** No `signal` parameter in OpenAI API call, no timeout handling in UI

### Pitfall 6: Design Token Mismatch Between globals.css and Design Handoff
**What goes wrong:** Design handoff uses orange/corporate palette; current globals.css uses blue/premium palette
**Why it happens:** Two different design directions exist -- the handoff `tokens.css` and the current `globals.css`
**How to avoid:** The design handoff `tokens.css` represents the intended v2 design direction. Reconcile during the design system wave: adopt the handoff token naming and values, mapping them into the existing Tailwind v4 `@theme inline` structure. The current blue palette was a Phase 1 placeholder.
**Warning signs:** Components using hardcoded hex values instead of CSS custom properties

### Pitfall 7: Supabase Storage Bucket Setup Missing
**What goes wrong:** Upload calls fail with "bucket not found"
**Why it happens:** Storage bucket must be created via Supabase dashboard or migration before uploads work
**How to avoid:** Create the `media` bucket as part of a migration or setup script. Set to private (RLS-protected). Add RLS policies for account-scoped access.
**Warning signs:** No Storage bucket creation in migration files or setup documentation

## Code Examples

### AI Response Schema (AI-05)
```typescript
// Source: OpenAI structured outputs documentation + project patterns
import { z } from 'zod';

/**
 * AI generation response schema.
 * IMPORTANT: Keep flat -- no discriminated unions (Zod v4 emits oneOf
 * which OpenAI strict mode rejects).
 */
export const AiGenerationResponseSchema = z.object({
  facebook: z.object({
    body: z.string().describe('Facebook post body copy'),
    cta_text: z.string().optional().describe('Call-to-action text'),
    hashtags: z.array(z.string()).optional().describe('Relevant hashtags'),
  }),
  instagram: z.object({
    body: z.string().describe('Instagram caption'),
    hashtags: z.array(z.string()).optional().describe('Up to 10 hashtags'),
    link_in_bio_line: z.string().optional().describe('Link-in-bio CTA line'),
  }),
  gbp: z.object({
    body: z.string().describe('Google Business Profile update text'),
    cta_action: z.string().optional().describe('CTA action type: LEARN_MORE, BOOK, etc.'),
  }),
});

export type AiGenerationResponse = z.infer<typeof AiGenerationResponseSchema>;
```

### Content Type Discriminated Schema
```typescript
// Source: v1 create/schema.ts patterns, rebuilt for v2
import { z } from 'zod';

const baseContentSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  prompt: z.string().default(''),
  platforms: z.array(z.enum(['facebook', 'instagram', 'gbp'])).min(1, 'Select at least one platform'),
  toneAdjust: z.enum(['default', 'more_formal', 'more_casual', 'more_serious', 'more_playful']).default('default'),
  lengthPreference: z.enum(['standard', 'short', 'detailed']).default('standard'),
  includeHashtags: z.boolean().default(true),
  includeEmojis: z.boolean().default(true),
  ctaStyle: z.enum(['default', 'direct', 'urgent']).default('default'),
});

export const instantPostBriefSchema = baseContentSchema.extend({
  contentType: z.literal('instant_post'),
  publishMode: z.enum(['now', 'schedule']),
  scheduledFor: z.date().optional(),
});

export const eventBriefSchema = baseContentSchema.extend({
  contentType: z.literal('event'),
  eventName: z.string().min(1, 'Event name is required'),
  eventDate: z.date(),
  eventTime: z.string().regex(/^\d{2}:\d{2}$/),
  venue: z.string().optional(),
});

export const promotionBriefSchema = baseContentSchema.extend({
  contentType: z.literal('promotion'),
  offerSummary: z.string().min(1, 'Describe the offer'),
  couponCode: z.string().optional(),
  endDate: z.date(),
});

export const weeklyCampaignBriefSchema = baseContentSchema.extend({
  contentType: z.literal('weekly_recurring'),
  dayOfWeek: z.number().int().min(0).max(6),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  weeksAhead: z.number().int().min(1).max(12).default(4),
});

export const storyBriefSchema = baseContentSchema.extend({
  contentType: z.literal('story'),
  platforms: z.array(z.enum(['facebook', 'instagram'])).min(1, 'Stories are FB/IG only'),
});
```

### Design Token Bridge (globals.css extension)
```css
/* Source: design handoff tokens.css mapped to Tailwind v4 @theme inline */
:root {
  /* Status tokens (UX-04) */
  --status-draft-fg: #475467;
  --status-draft-bg: #F2F4F7;
  --status-scheduled-fg: #344054;
  --status-scheduled-bg: #EAECF0;
  --status-publishing-fg: #B54708;
  --status-publishing-bg: #FEF0C7;
  --status-posted-fg: #027A48;
  --status-posted-bg: #D1FADF;
  --status-failed-fg: #B42318;
  --status-failed-bg: #FEE4E2;

  /* Platform tokens */
  --platform-fb: #1B4DB1;
  --platform-fb-bg: #DDE7F5;
  --platform-ig: #B72A6B;
  --platform-ig-bg: #F8DEEA;
  --platform-gbp: #1C7C43;
  --platform-gbp-bg: #DCEDE2;

  /* 4px spacing scale (UX-01) -- 14 named tokens */
  --space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
  --space-5: 20px;  --space-6: 24px;  --space-8: 32px;  --space-10: 40px;
  --space-12: 48px; --space-16: 64px; --space-20: 80px; --space-24: 96px;
}
```

### Modifier Chip Pattern (D-06)
```typescript
// Source: D-06 locked decision
const MODIFIER_CHIPS = [
  { id: 'shorter', label: 'Make shorter', modifier: 'Make the copy shorter and more concise.' },
  { id: 'formal', label: 'More formal', modifier: 'Increase formality while keeping warmth.' },
  { id: 'emoji', label: 'Add emoji', modifier: 'Add relevant emojis to enhance the message.' },
  { id: 'cta', label: 'Stronger CTA', modifier: 'Strengthen the call-to-action with more urgency.' },
  { id: 'casual', label: 'More casual', modifier: 'Make the tone more relaxed and conversational.' },
  { id: 'longer', label: 'More detail', modifier: 'Add more specific details and description.' },
] as const;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual JSON parsing of AI responses | OpenAI structured outputs with `zodResponseFormat` | 2024 Q3 | Type-safe, validated responses; no regex/JSON parsing |
| Zod v3 schemas | Zod v4 | 2025 Q2 | Breaking change for OpenAI SDK; must use SDK 6.38+ |
| `prefers-color-scheme` only | CSS custom properties + optional toggle | Ongoing | Better control; design handoff tokens support both modes |
| Supabase Storage v1 | Supabase Storage v2 with transforms | 2024 | CDN image transforms (resize, quality) built in |

**Deprecated/outdated:**
- OpenAI `functions` parameter: replaced by `response_format` with structured outputs
- Zod v3 `ZodFirstPartyTypeKind`: removed in v4; affects OpenAI SDK internals
- v1 `OWNER_ACCOUNT_ID` constant: v2 uses `requireAuthContext().accountId` (multi-account ready)

## Open Questions

1. **Design Handoff vs Current globals.css**
   - What we know: Design handoff uses orange/corporate palette with IBM Plex Sans; current globals.css uses blue/premium palette with Plus Jakarta Sans + Sora
   - What's unclear: Whether the design handoff is the final approved direction or a proposal
   - Recommendation: Treat design handoff as the reference direction per D-08 ("bold & branded"). Reconcile tokens in Wave 1 -- the planner should include a task to map handoff tokens into the Tailwind structure. If fonts need changing (Plus Jakarta -> IBM Plex), that's a single globals.css + layout.tsx change.

2. **Supabase Storage Bucket Creation**
   - What we know: `media_library` table exists in schema; Supabase Storage needs a bucket
   - What's unclear: Whether to create bucket via SQL migration, Supabase dashboard, or seed script
   - Recommendation: Create via Supabase dashboard (Storage buckets are not managed by SQL migrations). Document the bucket name and RLS policies as a manual step in the plan. Add RLS policies via migration on `storage.objects`.

3. **OpenAI Model Selection for Structured Outputs**
   - What we know: `gpt-4o-mini` supports structured outputs and is cost-effective; `gpt-4o` is higher quality
   - What's unclear: Which model gives acceptable hospitality copy quality at scale
   - Recommendation: Default to `gpt-4o-mini` for development/testing. Make model configurable via environment variable. Allow upgrade to `gpt-4o` per-account if quality doesn't meet bar.

4. **Wizard URL Strategy**
   - What we know: D-03 requires auto-save and resume capability
   - What's unclear: Whether wizard should be a route (`/create/[id]`) or a modal overlay
   - Recommendation: Use modal overlay (D-07 shows side-by-side columns in a dialog context, UX-03 specifies modal/sheet/bottom-sheet). Persist draft ID in URL query param (`?draft=uuid`) so refresh works. The `/create` route renders the wizard modal.

## Sources

### Primary (HIGH confidence)
- v1 codebase reference: `src/lib/ai/`, `src/lib/create/schema.ts`, `src/lib/scheduling/`, `src/features/create/`, `src/features/planner/` -- domain patterns verified
- Database schema: `supabase/migrations/00000000000001_content.sql` -- content_items, media_library, content_media_attachments tables verified
- Auth patterns: `src/lib/auth/server.ts` -- `requireAuthContext()`, `getCurrentUser()` verified
- Design handoff: `tokens.css`, `components.jsx` -- full token set and component patterns
- Package.json: dependency versions verified against installed packages

### Secondary (MEDIUM confidence)
- [OpenAI Structured Outputs Guide](https://platform.openai.com/docs/guides/structured-outputs) -- zodResponseFormat API
- [OpenAI Node SDK helpers](https://github.com/openai/openai-node/blob/master/helpers.md) -- Zod integration docs
- [Supabase Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control) -- RLS on storage.objects
- [Supabase Storage Upload](https://supabase.com/docs/reference/javascript/storage-from-upload) -- JavaScript upload API

### Tertiary (LOW confidence)
- [Zod v4 + OpenAI SDK compatibility issues](https://github.com/openai/openai-node/issues/1540) -- Zod v4 support issue, fix merged but union issues remain in 4.1.13+
- [Zod union schema conversion issue](https://github.com/openai/openai-node/issues/1709) -- discriminated unions emit oneOf, incompatible with strict mode

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all dependencies already installed, versions verified against package.json
- Architecture: HIGH -- v1 reference code provides complete domain patterns; rebuild is well-scoped
- Pitfalls: HIGH -- Zod v4/OpenAI incompatibility verified via GitHub issues and npm version check; timezone pitfalls proven from v1 experience
- Design system: MEDIUM -- design handoff exists but unclear if it's the final approved direction vs. current globals.css

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (stable domain; OpenAI SDK compatibility may improve sooner)
