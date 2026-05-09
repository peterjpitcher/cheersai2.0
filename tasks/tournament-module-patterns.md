# Tournament Content Module — Existing Pattern Reference

Gathered 2026-05-09 for implementation planning.

---

## 1. Publishing Queue Helper

**File:** `src/lib/publishing/queue.ts`

```ts
interface EnqueuePublishJobOptions {
  contentItemId: string;
  variantId?: string | null;
  placement?: "feed" | "story";
  scheduledFor: Date | null;
}

export async function enqueuePublishJob(opts: EnqueuePublishJobOptions): Promise<void>
```

- Uses `createServiceSupabaseClient()` (service-role, bypasses RLS).
- If `placement` or `variantId` omitted, resolves from `content_items` / `content_variants` tables.
- Inserts into `publish_jobs` table: `content_item_id`, `variant_id`, `status: "queued"`, `next_attempt_at`, `placement`.
- Also exports `markContentScheduled(contentItemIds, status)` to batch-update `content_items.status`.

---

## 2. Preflight Validation

**File:** `src/lib/publishing/preflight.ts`

```ts
interface PublishReadinessParams {
  supabase: SupabaseClient;
  accountId: string;
  contentId: string;
  platform: Provider;   // "facebook" | "instagram" | "gbp"
  placement: Placement; // "feed" | "story"
}

interface PublishReadinessIssue {
  code: string;
  message: string;
}

export async function getPublishReadinessIssues(params: PublishReadinessParams): Promise<PublishReadinessIssue[]>
export async function assertPublishReadiness(params: PublishReadinessParams): Promise<void>
```

**Checks performed (in order):**
1. Connection exists for platform + accountId (`social_connections` table)
2. Connection status is not `needs_action`
3. Access token is present and not expired
4. Connection metadata is complete (platform-specific IDs)
5. Placement validity (stories not supported on GBP)
6. Content lint check (`lintContent()`)
7. Body not empty for feed posts
8. Media IDs present (at least one)
9. Story-specific: exactly 1 image, must be image type, must have `story` derived variant

**Internal helpers query:** `content_variants` (body, media_ids), `content_items` (prompt_context, scheduled_for), `media_assets` (media_type, processed_status, derived_variants).

---

## 3. Server Action Pattern

**File:** `src/app/(app)/create/actions.ts` (representative)

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthContext } from "@/lib/auth/server";
// ...service imports

export async function handleInstantPostSubmission(rawValues: unknown) {
  // 1. Zod parse input
  const formValues = instantPostFormSchema.parse(rawValues);
  // 2. Transform/resolve values
  // 3. Call service function (which internally calls requireAuthContext)
  const result = await createInstantPost(parsed);
  // 4. Revalidate relevant paths
  revalidatePath("/planner");
  revalidatePath("/library");
  return result;
}
```

**Auth pattern** (from `src/lib/auth/server.ts`):

```ts
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function requireAuthContext() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  // Redirects to /login if no session
  const accountId = resolveAccountId(user);
  await ensureAccountRecord(accountId, user.email ?? null, supabase);
  return { supabase, user, accountId } as const;
}
```

- `accountId` is resolved from `user.app_metadata.account_id` (preferred) or fallback to `user.id`.
- **Two-client pattern**: `createServerSupabaseClient()` for cookie-based RLS-scoped ops; `createServiceSupabaseClient()` for admin/system ops.

---

## 4. Media Assets

**File:** `src/app/(app)/library/actions.ts`

### Upload Flow
1. `requestMediaUpload({ fileName, mimeType, size })` — creates a signed upload URL via Supabase Storage, returns `{ assetId, uploadUrl, storagePath, derivativeUploadUrls, mediaType }`.
2. Client uploads file to signed URL.
3. `finaliseMediaUpload({ assetId, fileName, mimeType, size, storagePath, derivedVariants, aspectClass })` — inserts/upserts into `media_assets` table.

### media_assets Columns (inferred from upsert)
| Column | Type |
|--------|------|
| `id` | uuid |
| `account_id` | uuid |
| `storage_path` | text |
| `file_name` | text |
| `media_type` | "image" \| "video" |
| `mime_type` | text |
| `size_bytes` | integer |
| `processed_status` | "pending" \| "processing" \| "ready" \| "failed" \| "skipped" |
| `processed_at` | timestamptz |
| `derived_variants` | jsonb (`{ original, square, story, landscape }` — storage paths) |
| `aspect_class` | "square" \| "story" \| "landscape" |
| `tags` | text[] |
| `uploaded_at` | timestamptz |
| `hidden_at` | timestamptz (nullable, for soft-hide) |

---

## 5. Content Items / Content Variants

**File:** `src/lib/create/service.ts` (lines 1403-1448)

### content_items Insert Shape
```ts
{
  campaign_id: string,
  account_id: string,
  platform: "facebook" | "instagram" | "gbp",
  placement: "feed" | "story",
  scheduled_for: string (ISO),
  status: "draft" | "scheduled" | "queued",
  prompt_context: Record<string, unknown>,
  auto_generated: boolean,
  hook_strategy: string | null,
  content_pillar: string | null,
}
```

Additional known columns from queries elsewhere: `deleted_at`, `created_at`.

### content_variants Upsert Shape
```ts
{
  content_item_id: string,
  body: string,
  media_ids: string[] | null,
  validation: object | null,
  // Optional banner overrides:
  banner_position?: "top" | "bottom" | "left" | "right",
  banner_bg?: string,
  banner_text_colour?: string,
}
```

Additional known columns: `updated_at`, `banner_enabled`, `banner_text_override` (from preflight).

### Campaign Creation Flow
1. Insert into `campaigns` table (account_id, name, campaign_type, status, metadata, link_in_bio_url).
2. Batch insert `content_items` (one per platform per plan).
3. Upsert `content_variants` (one per content_item, on conflict `content_item_id`).
4. Enqueue publish jobs for each content item.
5. Return `{ campaignId, contentItemIds, status, scheduledFor }`.

---

## 6. Dashboard Layout

**File:** `src/app/(app)/layout.tsx`

```tsx
export default async function AppLayout({ children }: AppLayoutProps) {
  const user = await getCurrentUser();
  return (
    <AuthProvider value={user}>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
```

**AppShell** (`src/components/layout/AppShell.tsx`):
- `<div className="flex min-h-screen">` — horizontal flex
- `<Sidebar />` — left sidebar (260px, collapsible to 80px)
- Main area: `<Topbar />` + `<main className="flex-1 p-6 md:p-8 lg:p-10">`

**Sidebar** (`src/components/layout/Sidebar.tsx`):
- Framer Motion animated width
- NAV_ITEMS: Planner, Create, Library, Campaigns, Reviews, Connections, Settings
- Active state via `usePathname()` comparison
- Design tokens: `bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-primary`

---

## 7. Banner/Overlay System

**Directory:** `src/lib/banner/`

| File | Exports |
|------|---------|
| `config.ts` | `BannerPosition` type, `AccountBannerDefaults` type, `PostBannerOverrides` type, `ResolvedConfig` type, `bannerConfigResolver()` |
| `palette.ts` | `BannerPaletteId` type, `BANNER_PALETTES` const, `paletteFromColours()`, `BANNER_LABEL_REPEAT_COUNT`, `BANNER_LABEL_SEPARATOR`, `buildRepeatedBannerLabel()` |
| `render-server.ts` | `renderBannerServer(source: Buffer, config: ResolvedConfig, label: string): Promise<Buffer>` |
| `config.test.ts` | Tests for config resolver |
| `palette.test.ts` | Tests for palette utilities |
| `render-server.test.ts` | Tests for server renderer |
| `assets/font-data.ts` | `BANNER_FONT_FAMILY`, `BANNER_FONT_TTF_BASE64` |
| `assets/noto-sans-latin-700.ttf` | Bundled font binary |

**Key detail for non-conflict:** The banner system overlays a coloured strip (top/bottom/left/right) onto images at publish time using Sharp SVG compositing. It reads from `posting_defaults` (account-level) and `content_variants` (per-post overrides). A Tournament module can coexist by either: (a) using the same banner_override columns, or (b) implementing a separate overlay pipeline.

---

## 8. fromDb Utility

**Not found.** This project does NOT use a `fromDb()` snake_case-to-camelCase conversion helper. Instead:

- DB queries use raw snake_case column names directly.
- Manual mapping is done inline (e.g. `mapToSummary()` in library/actions.ts maps `file_name` to `fileName`).
- The CLAUDE.md mentions `fromDb` as a convention, but this project maps manually per query.

---

## 9. Supabase Client Helpers

### Cookie-Based Auth Client (respects RLS)
**File:** `src/lib/supabase/server.ts`
```ts
import { createServerSupabaseClient } from "@/lib/supabase/server";
// Uses @supabase/ssr createServerClient with cookie-based auth
```

### Service-Role Admin Client (bypasses RLS)
**File:** `src/lib/supabase/service.ts`
```ts
import { createServiceSupabaseClient } from "@/lib/supabase/service";
// Uses createClient with env.server.SUPABASE_SERVICE_ROLE_KEY
// persistSession: false
```
Also exports: `isServiceSupabaseConfigured(): boolean`, `tryCreateServiceSupabaseClient(): SupabaseClient | null`.

### Auth Context (wraps both)
**File:** `src/lib/auth/server.ts`
```ts
import { requireAuthContext } from "@/lib/auth/server";
// Returns { supabase: SupabaseClient, user: User, accountId: string }
// supabase here is the cookie-based client (RLS-scoped)
```

---

## 10. Satori / Sharp Usage

- **Satori**: NOT used. Not in package.json, no imports found.
- **Sharp**: YES — `"sharp": "^0.34.5"` in package.json. Used in `src/lib/banner/render-server.ts` for image compositing (SVG overlay onto JPEG via `sharp().composite()`). Produces JPEG output at quality 92.

---

## Summary: Key Import Paths for New Module

```ts
// Auth + account scoping
import { requireAuthContext } from "@/lib/auth/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

// Publishing
import { enqueuePublishJob } from "@/lib/publishing/queue";
import { getPublishReadinessIssues } from "@/lib/publishing/preflight";

// Image processing
import sharp from "sharp";

// Banner system (if reusing)
import { bannerConfigResolver, type ResolvedConfig } from "@/lib/banner/config";
import { renderBannerServer } from "@/lib/banner/render-server";

// Constants
import { MEDIA_BUCKET, DEFAULT_TIMEZONE } from "@/lib/constants";

// Validation
import { z } from "zod";
import { revalidatePath } from "next/cache";
```
