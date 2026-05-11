# Review Pack: instant-post-cleanup-impl

**Generated:** 2026-05-10
**Mode:** B (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CheersAI2.0`
**Base ref:** `74c9308`
**HEAD:** `ba08d75`
**Diff range:** `74c9308...HEAD`
**Stats:**  7 files changed, 1092 insertions(+), 15 deletions(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
src/app/actions/tournament.ts
src/app/api/create/generate-stream/route.ts
src/features/create/instant-post-form.tsx
src/lib/create/schema.ts
src/lib/create/service.ts
tests/api/generate-stream-route.test.ts
tests/lib/create/service.test.ts
```

## User Concerns

Reviewing IMPLEMENTED 5-commit fix for instant-post-cleanup (commits c51ce0c..ba08d75): banner picker + story OpenAI waste. Spec at tasks/instant-post-cleanup/SPEC.md was reviewed adversarially before implementation. This is the second-stage code review. Some unrelated tournament commits are interleaved in the base range — please ignore tournament-* file changes; focus on src/lib/create/, src/features/create/, src/app/api/create/, and tests/.

## Diff (`74c9308...HEAD`)

```diff
diff --git a/src/app/actions/tournament.ts b/src/app/actions/tournament.ts
index 92779c8..faf4762 100644
--- a/src/app/actions/tournament.ts
+++ b/src/app/actions/tournament.ts
@@ -706,3 +706,174 @@ export async function deleteTournament(
     return { success: false, error: err instanceof Error ? err.message : String(err) };
   }
 }
+
+// ---------------------------------------------------------------------------
+// getFixturePreview
+// ---------------------------------------------------------------------------
+
+export interface PreviewItem {
+  platform: string;
+  placement: string;
+  status: string;
+  scheduledFor: string | null;
+  imageUrl: string;
+  captionText: string | null;
+}
+
+export async function getFixturePreview(
+  tournamentId: string,
+  fixtureId: string,
+): Promise<{ success: boolean; items?: PreviewItem[]; error?: string }> {
+  try {
+    const { supabase, accountId } = await requireAuthContext();
+
+    const tournament = await getTournamentById(supabase, tournamentId, accountId);
+    if (!tournament) return { success: false, error: 'Tournament not found' };
+
+    const { data: contentItems, error: fetchError } = await supabase
+      .from('content_items')
+      .select('id, platform, placement, status, scheduled_for, caption_text, prompt_context')
+      .eq('account_id', accountId)
+      .contains('prompt_context', { tournament_fixture_id: fixtureId, source: 'tournament' });
+
+    if (fetchError) return { success: false, error: fetchError.message };
+    if (!contentItems?.length) return { success: true, items: [] };
+
+    const itemIds = contentItems.map((i) => i.id as string);
+    const { data: variants } = await supabase
+      .from('content_variants')
+      .select('content_item_id, media_ids')
+      .in('content_item_id', itemIds);
+
+    const allMediaIds = new Set<string>();
+    const itemMediaMap = new Map<string, string[]>();
+    for (const v of variants ?? []) {
+      const ids = (v as Record<string, unknown>).media_ids as string[] | null;
+      const contentItemId = (v as Record<string, unknown>).content_item_id as string;
+      if (ids?.length) {
+        itemMediaMap.set(contentItemId, ids);
+        ids.forEach((id) => allMediaIds.add(id));
+      }
+    }
+
+    const urlMap = new Map<string, string>();
+    if (allMediaIds.size) {
+      const { data: assets } = await supabase
+        .from('media_assets')
+        .select('id, storage_path')
+        .in('id', [...allMediaIds]);
+
+      const paths = (assets ?? []).map((a) => (a as Record<string, unknown>).storage_path as string);
+      if (paths.length) {
+        const { data: signed } = await supabase.storage
+          .from(MEDIA_BUCKET)
+          .createSignedUrls(paths, 3600);
+
+        if (signed) {
+          for (let i = 0; i < (assets ?? []).length; i++) {
+            const asset = assets![i];
+            const signedEntry = signed.find((s) => s.path === (asset as Record<string, unknown>).storage_path);
+            if (signedEntry?.signedUrl && !signedEntry.error) {
+              urlMap.set((asset as Record<string, unknown>).id as string, signedEntry.signedUrl);
+            }
+          }
+        }
+      }
+    }
+
+    const items: PreviewItem[] = contentItems.map((item) => {
+      const mediaIds = itemMediaMap.get(item.id as string) ?? [];
+      const imageUrl = mediaIds.length ? (urlMap.get(mediaIds[0]) ?? '') : '';
+
+      return {
+        platform: item.platform as string,
+        placement: item.placement as string,
+        status: item.status as string,
+        scheduledFor: (item.scheduled_for as string) ?? null,
+        imageUrl,
+        captionText: (item.caption_text as string) ?? null,
+      };
+    });
+
+    return { success: true, items };
+  } catch (err) {
+    return { success: false, error: err instanceof Error ? err.message : String(err) };
+  }
+}
+
+// ---------------------------------------------------------------------------
+// importFixtures
+// ---------------------------------------------------------------------------
+
+export interface ImportError {
+  row: number;
+  error: string;
+}
+
+export async function importFixtures(
+  tournamentId: string,
+  fixtures: Array<{
+    matchNumber: number;
+    round: string;
+    groupName: string | null;
+    teamA: string;
+    teamB: string;
+    kickOffAt: string;
+    venueCity: string | null;
+    showing: boolean;
+  }>,
+): Promise<{ success: boolean; imported: number; skipped: number; errors: ImportError[] }> {
+  try {
+    const { supabase, accountId } = await requireAuthContext();
+
+    const tournament = await getTournamentById(supabase, tournamentId, accountId);
+    if (!tournament) return { success: false, imported: 0, skipped: 0, errors: [{ row: 0, error: 'Tournament not found' }] };
+
+    if (fixtures.length > 500) {
+      return { success: false, imported: 0, skipped: 0, errors: [{ row: 0, error: 'Maximum 500 fixtures per import' }] };
+    }
+
+    let imported = 0;
+    const skipped = 0;
+    const errors: ImportError[] = [];
+
+    for (let i = 0; i < fixtures.length; i++) {
+      const row = fixtures[i];
+      try {
+        const teamsConfirmed = areBothTeamsConfirmed(row.teamA, row.teamB);
+
+        const { error: upsertError } = await supabase
+          .from('tournament_fixtures')
+          .upsert(
+            {
+              tournament_id: tournamentId,
+              match_number: row.matchNumber,
+              round: row.round,
+              group_name: row.groupName,
+              team_a: row.teamA,
+              team_b: row.teamB,
+              teams_confirmed: teamsConfirmed,
+              kick_off_at: row.kickOffAt,
+              venue_city: row.venueCity,
+              showing: row.showing,
+            },
+            { onConflict: 'tournament_id,match_number' },
+          );
+
+        if (upsertError) {
+          errors.push({ row: i + 1, error: upsertError.message });
+        } else {
+          imported++;
+        }
+      } catch (err) {
+        errors.push({ row: i + 1, error: err instanceof Error ? err.message : String(err) });
+      }
+    }
+
+    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
+
+    return { success: true, imported, skipped, errors };
+  } catch (err) {
+    return { success: false, imported: 0, skipped: 0, errors: [{ row: 0, error: err instanceof Error ? err.message : String(err) }] };
+  }
+}
diff --git a/src/app/api/create/generate-stream/route.ts b/src/app/api/create/generate-stream/route.ts
index 4e5f878..b19c259 100644
--- a/src/app/api/create/generate-stream/route.ts
+++ b/src/app/api/create/generate-stream/route.ts
@@ -36,6 +36,7 @@ type StreamEvent =
   | { type: "platform_start"; platform: string }
   | { type: "chunk"; platform: string; text: string }
   | { type: "platform_done"; platform: string }
+  | { type: "story_no_caption"; platform: string }
   | { type: "done"; contentItemIds: string[] }
   | { type: "error"; message: string };
 
@@ -101,6 +102,9 @@ export async function POST(request: NextRequest): Promise<Response> {
       (formValues.publishMode === "schedule" && formValues.scheduledFor
         ? DateTime.fromISO(formValues.scheduledFor, { zone: DEFAULT_TIMEZONE }).toJSDate()
         : undefined),
+    // Carry the optional banner override through to createInstantPost so the
+    // service layer can write an explicit banner_enabled to the variant row.
+    banner: formValues.banner,
   });
 
   // --- Build the SSE stream ---
@@ -116,10 +120,18 @@ export async function POST(request: NextRequest): Promise<Response> {
         // Load settings once — needed to build prompts
         const { brand, venueName } = await getOwnerSettings();
 
-        const openai = getOpenAIClient();
-
-        // Stream a preview for each platform (OpenAI call #1 per platform)
+        // Stream a preview for each platform (OpenAI call #1 per platform).
+        //
+        // Stories are image-only on Facebook and Instagram — the providers
+        // discard any caption at publish time. Skip OpenAI entirely for them
+        // (including the client factory) so a story-only submission works
+        // even when OPENAI_API_KEY is missing or the factory throws.
         for (const platform of input.platforms) {
+          if (input.placement === "story") {
+            send({ type: "story_no_caption", platform });
+            continue;
+          }
+
           send({ type: "platform_start", platform });
 
           const prompt = buildInstantPostPrompt({
@@ -130,7 +142,7 @@ export async function POST(request: NextRequest): Promise<Response> {
             scheduledFor: input.scheduledFor ?? null,
           });
 
-          const responseStream = openai.responses.stream({
+          const responseStream = getOpenAIClient().responses.stream({
             model: "gpt-4.1-mini",
             input: [
               { role: "system", content: prompt.system },
@@ -152,7 +164,9 @@ export async function POST(request: NextRequest): Promise<Response> {
           send({ type: "platform_done", platform });
         }
 
-        // Persist (OpenAI call #2 — full generation + save via existing service)
+        // Persist (OpenAI call #2 — full generation + save via existing service).
+        // Runs for BOTH story and feed flows so the form can render the saved
+        // drafts via the final `done` event.
         const result = await createInstantPost(input);
 
         send({ type: "done", contentItemIds: result.contentItemIds });
diff --git a/src/features/create/instant-post-form.tsx b/src/features/create/instant-post-form.tsx
index 2ba63cb..9d3dd88 100644
--- a/src/features/create/instant-post-form.tsx
+++ b/src/features/create/instant-post-form.tsx
@@ -31,10 +31,17 @@ import { StreamingPreview } from "@/features/create/streaming-preview";
 import { MediaAttachmentSelector } from "@/features/create/media-attachment-selector";
 import { StageAccordion, type StageAccordionControls } from "@/features/create/stage-accordion";
 import { TemplateSelector } from "@/features/create/template-selector";
+import { BannerDefaultsPicker } from "@/features/create/banner-defaults-picker";
+import { DEFAULT_BANNER_DEFAULTS, type BannerDefaults } from "@/lib/scheduling/banner-config";
 import { Button } from "@/components/ui/button";
 import { Input } from "@/components/ui/input";
 import { Label } from "@/components/ui/label";
 
+interface BannerSelection {
+  enabled: boolean;
+  defaults?: BannerDefaults;
+}
+
 const PLATFORM_LABELS: Record<InstantPostInput["platforms"][number], string> = {
   facebook: "Facebook",
   instagram: "Instagram",
@@ -81,6 +88,12 @@ export function InstantPostForm({ mediaLibrary, ownerTimezone, onLibraryUpdate,
   const abortControllerRef = useRef<AbortController | null>(null);
   const [generatedItems, setGeneratedItems] = useState<PlannerContentDetail[]>([]);
   const [library, setLibrary] = useState<MediaAssetSummary[]>(mediaLibrary);
+  // Banner overlay opt-in. Defaults to OFF so instant posts never publish a
+  // banner unless the user explicitly enables it in this stage. The choice
+  // flows through the submit payload to /api/create/generate-stream and on to
+  // createInstantPost which writes an explicit banner_enabled value to the
+  // variant — replacing the previous silent "use account default" behaviour.
+  const [banner, setBanner] = useState<BannerSelection>({ enabled: false });
 
   useEffect(() => {
     setLibrary(mediaLibrary);
@@ -215,7 +228,7 @@ export function InstantPostForm({ mediaLibrary, ownerTimezone, onLibraryUpdate,
       const response = await fetch("/api/create/generate-stream", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
-        body: JSON.stringify(values),
+        body: JSON.stringify({ ...values, banner }),
         signal: controller.signal,
       });
 
@@ -299,6 +312,7 @@ export function InstantPostForm({ mediaLibrary, ownerTimezone, onLibraryUpdate,
         proofPointsSelected: [],
         proofPointIntentTags: [],
       });
+      setBanner({ enabled: false });
     } catch (error) {
       if (error instanceof Error && error.name === "AbortError") {
         // User navigated away or re-submitted; silently ignore
@@ -660,6 +674,53 @@ export function InstantPostForm({ mediaLibrary, ownerTimezone, onLibraryUpdate,
         );
       },
     },
+    {
+      id: "banner",
+      title: "Banner overlay",
+      description: "Optional countdown overlay on the hero image. Off by default.",
+      content: (controls: StageAccordionControls) => (
+        <>
+          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
+            <label className="inline-flex items-start gap-2 text-sm text-slate-700">
+              <input
+                type="checkbox"
+                className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-teal focus:ring-2 focus:ring-brand-teal focus:ring-offset-1"
+                checked={banner.enabled}
+                aria-expanded={banner.enabled}
+                onChange={(event) => {
+                  if (event.target.checked) {
+                    setBanner({ enabled: true, defaults: banner.defaults ?? DEFAULT_BANNER_DEFAULTS });
+                  } else {
+                    setBanner({ enabled: false });
+                  }
+                }}
+              />
+              <span>
+                <span className="font-semibold text-slate-900">Add a banner overlay</span>
+                <span className="block text-xs text-slate-500">
+                  Overlays a short countdown label (e.g. TODAY, TOMORROW) on the hero image. You can edit each post&rsquo;s banner later in the planner.
+                </span>
+              </span>
+            </label>
+
+            {banner.enabled ? (
+              <div className="rounded-xl border border-slate-200 bg-white p-3">
+                <BannerDefaultsPicker
+                  value={banner.defaults ?? DEFAULT_BANNER_DEFAULTS}
+                  onChange={(next) => setBanner({ enabled: true, defaults: next })}
+                />
+              </div>
+            ) : null}
+          </div>
+
+          <div className="flex justify-end pt-2">
+            <Button type="button" onClick={() => controls.goToNext()}>
+              Next
+            </Button>
+          </div>
+        </>
+      ),
+    },
     {
       id: "generate",
       title: "Generate & review",
@@ -676,12 +737,22 @@ export function InstantPostForm({ mediaLibrary, ownerTimezone, onLibraryUpdate,
               : placement === "story" ? "Create story" : "Generate post"}
           </Button>
 
-          {/* Real-time streaming preview — visible while generation is active */}
-          <StreamingPreview
-            platforms={streamingPlatforms}
-            streamingText={streamingText}
-            active={progressActive}
-          />
+          {/* Stories publish without a caption — show a friendly note instead of
+              the streaming preview, which would otherwise sit empty for stories
+              now that the route skips OpenAI for story placements. */}
+          {placement === "story" ? (
+            (progressActive || result) ? (
+              <p className="text-sm text-slate-500">
+                Stories don&rsquo;t need a caption — your image is the post.
+              </p>
+            ) : null
+          ) : (
+            <StreamingPreview
+              platforms={streamingPlatforms}
+              streamingText={streamingText}
+              active={progressActive}
+            />
+          )}
 
           {/* Status bar — shows current stage message while generating */}
           {progressActive ? (
diff --git a/src/lib/create/schema.ts b/src/lib/create/schema.ts
index 6da5cf3..2db356f 100644
--- a/src/lib/create/schema.ts
+++ b/src/lib/create/schema.ts
@@ -51,6 +51,22 @@ export const advancedOptionsSchema = z.object({
   ctaStyle: ctaStyleEnum.default("default"),
 });
 
+/**
+ * Optional per-post banner override for the instant-post path.
+ *
+ * `enabled` is the user's explicit on/off choice; when `enabled` is true the
+ * caller may also supply `defaults` (position + colours) from the
+ * BannerDefaultsPicker. The form defaults this to `{ enabled: false }` so the
+ * service layer can persist `banner_enabled = false` rather than NULL —
+ * fixing the silent-default banner bug for instant posts.
+ */
+export const bannerInputSchema = z
+  .object({
+    enabled: z.boolean(),
+    defaults: BannerDefaultsSchema.optional(),
+  })
+  .optional();
+
 export const instantPostSchema = z
   .object({
     title: z.string().min(1, "Title is required"),
@@ -68,6 +84,7 @@ export const instantPostSchema = z
     includeEmojis: z.boolean().default(true),
     ctaStyle: ctaStyleEnum.default("default"),
     placement: placementEnum.default("feed"),
+    banner: bannerInputSchema,
   })
   .merge(proofPointOptionsSchema)
   .superRefine((data, ctx) => {
@@ -130,6 +147,7 @@ export const instantPostFormSchema = z
     includeEmojis: z.boolean().default(true),
     ctaStyle: ctaStyleEnum.default("default"),
     placement: placementEnum.default("feed"),
+    banner: bannerInputSchema,
   })
   .merge(proofPointOptionsSchema)
   .superRefine((data, ctx) => {
diff --git a/src/lib/create/service.ts b/src/lib/create/service.ts
index ddfce10..4ce5529 100644
--- a/src/lib/create/service.ts
+++ b/src/lib/create/service.ts
@@ -85,6 +85,53 @@ export function computeBannerOverride(
   return Object.keys(override).length === 0 ? null : override;
 }
 
+/**
+ * Per-variant banner override for the INSTANT-POST path only.
+ *
+ * Differs from {@link BannerOverrideRow} in that it ALWAYS includes an explicit
+ * `banner_enabled` (true or false). This forces instant posts off the silent
+ * "NULL means inherit account default" path that surprised users with unwanted
+ * banner overlays.
+ *
+ * Campaign callers continue to use `BannerOverrideRow` + `computeBannerOverride`
+ * and inherit account defaults — unchanged behaviour.
+ */
+export type InstantBannerOverride = {
+  banner_enabled: boolean;
+  banner_position?: BannerDefaults["position"];
+  banner_bg?: string;
+  banner_text_colour?: string;
+};
+
+/**
+ * Build an {@link InstantBannerOverride} from the form-provided `banner` input.
+ *
+ * - When `banner` is undefined or `banner.enabled` is false, the override
+ *   carries `banner_enabled: false` and no other fields. The variant insert
+ *   then writes an explicit false to `content_variants.banner_enabled`.
+ * - When `banner.enabled` is true, the override carries `banner_enabled: true`
+ *   plus the position and colours derived from `banner.defaults`. Missing
+ *   colour entries in {@link BANNER_COLOUR_HEX} are skipped — the publish-time
+ *   resolver then falls back to the account default for that colour only.
+ */
+export function buildInstantBannerOverride(
+  banner: { enabled: boolean; defaults?: BannerDefaults } | undefined,
+): InstantBannerOverride {
+  if (!banner || !banner.enabled) {
+    return { banner_enabled: false };
+  }
+  const override: InstantBannerOverride = { banner_enabled: true };
+  const defaults = banner.defaults;
+  if (defaults) {
+    override.banner_position = defaults.position;
+    const bgHex = BANNER_COLOUR_HEX[defaults.bgColour];
+    if (bgHex) override.banner_bg = bgHex;
+    const textHex = BANNER_COLOUR_HEX[defaults.textColour];
+    if (textHex) override.banner_text_colour = textHex;
+  }
+  return override;
+}
+
 /** In-memory batch state for hook + pillar variety tracking. */
 interface CopyEngagement {
   recentHooks: string[];
@@ -640,6 +687,8 @@ export async function createInstantPost(input: InstantPostInput) {
     },
   ];
 
+  const bannerOverride = buildInstantBannerOverride(input.banner);
+
   return createCampaignFromPlans({
     supabase,
     accountId,
@@ -666,6 +715,7 @@ export async function createInstantPost(input: InstantPostInput) {
       autoSchedule: false,
     },
     linkInBioUrl: input.linkInBioUrl ?? null,
+    bannerOverride,
   });
 }
 
@@ -1351,6 +1401,7 @@ async function createCampaignFromPlans({
   options,
   linkInBioUrl,
   bannerDefaults,
+  bannerOverride,
 }: {
   supabase: SupabaseClient;
   accountId: string;
@@ -1366,6 +1417,13 @@ async function createCampaignFromPlans({
   };
   linkInBioUrl?: string | null;
   bannerDefaults?: BannerDefaults;
+  /**
+   * Optional instant-only override that ALWAYS writes an explicit
+   * `banner_enabled` (true or false). When omitted (the campaign-flow
+   * default), variant rows behave exactly as today — banner_* columns are
+   * left NULL and inherit account defaults at publish time.
+   */
+  bannerOverride?: InstantBannerOverride;
 }) {
   if (!plans.length) {
     throw new Error("Cannot create campaign without plans");
@@ -1398,7 +1456,7 @@ async function createCampaignFromPlans({
   // Per-campaign banner overrides written directly to content_variants.
   // Banners are rendered at publish time by the publish-queue worker; no
   // pre-render or banner_state lifecycle is needed.
-  const bannerOverride = computeBannerOverride(bannerDefaults);
+  const sharedBannerFields = computeBannerOverride(bannerDefaults);
 
   const contentRows = variants.map((variant) => {
     const baseContext = { ...variant.promptContext, planIndex: variant.planIndex };
@@ -1435,6 +1493,11 @@ async function createCampaignFromPlans({
       body: variant?.body ?? "",
       media_ids: variant?.mediaIds.length ? variant?.mediaIds : null,
       validation: variant?.validation ?? null,
+      ...(sharedBannerFields ?? {}),
+      // Instant-only override wins over the shared per-field overrides so
+      // an explicit banner_enabled (true/false) is always persisted on the
+      // instant-post path. Campaign callers omit this and behaviour is
+      // identical to before.
       ...(bannerOverride ?? {}),
     };
   });
diff --git a/tests/api/generate-stream-route.test.ts b/tests/api/generate-stream-route.test.ts
new file mode 100644
index 0000000..5a98395
--- /dev/null
+++ b/tests/api/generate-stream-route.test.ts
@@ -0,0 +1,326 @@
+/**
+ * Tests for POST /api/create/generate-stream — Bug B regression suite.
+ *
+ * These tests lock the contract for the streaming preview route:
+ *
+ *  - Test 4: a story-placement request must NOT call OpenAI (neither the
+ *    client factory nor `responses.stream`). The route must still emit a
+ *    final `done` SSE event carrying `contentItemIds` so the form can
+ *    render the saved drafts.
+ *
+ *  - Test 5: lazy-init guard. If the OpenAI client factory throws (e.g.
+ *    the API key is missing), a story-only request must still succeed —
+ *    the factory must be called only on the feed branch.
+ *
+ *  - Test 6: regression guard for the feed path. A feed request must
+ *    continue to call OpenAI exactly as today and emit `done` with
+ *    contentItemIds.
+ *
+ * The route handler streams Server-Sent Events; we collect the stream into
+ * an array of decoded events for assertion.
+ */
+import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
+
+process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
+  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "https://example.com/key";
+process.env.NEXT_PUBLIC_SUPABASE_URL =
+  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
+process.env.SUPABASE_SERVICE_ROLE_KEY =
+  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "supabase-service-role-key";
+
+// --- Hoisted mocks -----------------------------------------------------------
+const {
+  createServerSupabaseClientMock,
+  getOwnerSettingsMock,
+  getOpenAIClientMock,
+  createInstantPostMock,
+  responsesStreamMock,
+} = vi.hoisted(() => ({
+  createServerSupabaseClientMock: vi.fn(),
+  getOwnerSettingsMock: vi.fn(),
+  getOpenAIClientMock: vi.fn(),
+  createInstantPostMock: vi.fn(),
+  responsesStreamMock: vi.fn(),
+}));
+
+vi.mock("@/lib/supabase/server", () => ({
+  createServerSupabaseClient: createServerSupabaseClientMock,
+}));
+
+vi.mock("@/lib/settings/data", () => ({
+  getOwnerSettings: getOwnerSettingsMock,
+}));
+
+vi.mock("@/lib/ai/client", () => ({
+  getOpenAIClient: getOpenAIClientMock,
+}));
+
+vi.mock("@/lib/create/service", () => ({
+  createInstantPost: createInstantPostMock,
+}));
+
+import { POST } from "@/app/api/create/generate-stream/route";
+
+// --- Helpers ----------------------------------------------------------------
+function buildAuthSupabaseMock(user: { id: string } | null = { id: "user-1" }) {
+  return {
+    auth: {
+      getUser: () =>
+        Promise.resolve({
+          data: { user },
+          error: user ? null : new Error("no user"),
+        }),
+    },
+  };
+}
+
+function buildBrandFixture() {
+  return {
+    toneFormal: 0.5,
+    tonePlayful: 0.5,
+    keyPhrases: [] as string[],
+    bannedTopics: [] as string[],
+    bannedPhrases: [] as string[],
+    defaultHashtags: [] as string[],
+    defaultEmojis: [] as string[],
+    instagramSignature: undefined,
+    facebookSignature: undefined,
+    gbpCta: "LEARN_MORE",
+  };
+}
+
+function buildPostingFixture() {
+  return {
+    timezone: "Europe/London",
+    facebookLocationId: undefined,
+    instagramLocationId: undefined,
+    gbpLocationId: undefined,
+    defaultPostingTime: undefined,
+    venueLocation: undefined,
+    venueLatitude: undefined,
+    venueLongitude: undefined,
+    notifications: { emailFailures: false, emailTokenExpiring: false },
+    gbpCtaDefaults: {
+      standard: "LEARN_MORE" as const,
+      event: "LEARN_MORE" as const,
+      offer: "LEARN_MORE" as const,
+    },
+    bannerDefaults: {
+      bannersEnabled: true,
+      bannerPosition: "right" as const,
+      bannerBg: "#a57626",
+      bannerTextColour: "#ffffff",
+    },
+  };
+}
+
+function buildAsyncIterableStream(deltas: string[]) {
+  return (async function* () {
+    for (const delta of deltas) {
+      yield {
+        type: "response.output_text.delta",
+        delta,
+      } as const;
+    }
+  })();
+}
+
+async function readSseEvents(response: Response): Promise<unknown[]> {
+  // Reads the SSE body into individual `data: ...` JSON payloads.
+  if (!response.body) return [];
+  const reader = response.body.getReader();
+  const decoder = new TextDecoder();
+  let buffer = "";
+  const events: unknown[] = [];
+  while (true) {
+    const { done, value } = await reader.read();
+    if (done) break;
+    buffer += decoder.decode(value, { stream: true });
+    let separatorIndex: number;
+    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
+      const block = buffer.slice(0, separatorIndex);
+      buffer = buffer.slice(separatorIndex + 2);
+      const dataLine = block
+        .split("\n")
+        .find((line) => line.startsWith("data: "));
+      if (!dataLine) continue;
+      const json = dataLine.slice("data: ".length);
+      try {
+        events.push(JSON.parse(json));
+      } catch {
+        // ignore parse errors on partial chunks
+      }
+    }
+  }
+  buffer += decoder.decode();
+  if (buffer.trim().length > 0) {
+    const dataLine = buffer
+      .split("\n")
+      .find((line) => line.startsWith("data: "));
+    if (dataLine) {
+      try {
+        events.push(JSON.parse(dataLine.slice("data: ".length)));
+      } catch {
+        // noop
+      }
+    }
+  }
+  return events;
+}
+
+function buildRequest(body: unknown): Request {
+  return new Request("http://localhost/api/create/generate-stream", {
+    method: "POST",
+    headers: { "Content-Type": "application/json" },
+    body: JSON.stringify(body),
+  });
+}
+
+const STORY_BODY = {
+  title: "Sunset story",
+  prompt: "",
+  publishMode: "now" as const,
+  platforms: ["instagram"],
+  media: [{ assetId: "asset-1", mediaType: "image", fileName: "hero.jpg" }],
+  placement: "story" as const,
+  toneAdjust: "default" as const,
+  lengthPreference: "standard" as const,
+  includeHashtags: false,
+  includeEmojis: false,
+  ctaStyle: "default" as const,
+  proofPointMode: "off" as const,
+  proofPointsSelected: [],
+  proofPointIntentTags: [],
+};
+
+const FEED_BODY = {
+  title: "Tonight at the pub",
+  prompt: "Live music tonight, doors at 8.",
+  publishMode: "now" as const,
+  platforms: ["facebook"],
+  media: [{ assetId: "asset-1", mediaType: "image", fileName: "hero.jpg" }],
+  placement: "feed" as const,
+  toneAdjust: "default" as const,
+  lengthPreference: "standard" as const,
+  includeHashtags: false,
+  includeEmojis: false,
+  ctaStyle: "default" as const,
+  proofPointMode: "off" as const,
+  proofPointsSelected: [],
+  proofPointIntentTags: [],
+};
+
+// --- Tests ------------------------------------------------------------------
+describe("POST /api/create/generate-stream — Bug B regression suite", () => {
+  beforeEach(() => {
+    vi.clearAllMocks();
+    createServerSupabaseClientMock.mockResolvedValue(buildAuthSupabaseMock());
+    getOwnerSettingsMock.mockResolvedValue({
+      brand: buildBrandFixture(),
+      posting: buildPostingFixture(),
+      venueName: "The Anchor",
+      venueLocation: "Stanwell Moor",
+    });
+    createInstantPostMock.mockResolvedValue({
+      campaignId: "cam-1",
+      contentItemIds: ["content-1"],
+      status: "queued",
+      scheduledFor: null,
+    });
+    responsesStreamMock.mockImplementation(() =>
+      buildAsyncIterableStream(["Hello ", "world"]),
+    );
+    getOpenAIClientMock.mockReturnValue({
+      responses: {
+        stream: responsesStreamMock,
+      },
+    });
+  });
+
+  afterEach(() => {
+    vi.clearAllMocks();
+  });
+
+  it("[Test 4] story-only POST emits done with contentItemIds and never calls OpenAI", async () => {
+    const response = await POST(buildRequest(STORY_BODY) as never);
+
+    expect(response.status).toBe(200);
+    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
+
+    const events = await readSseEvents(response);
+
+    // Bug B guard: getOpenAIClient is at module top of the route today, so
+    // it WILL be called pre-fix. After Wave 2 it must be lazy and skipped
+    // for story-only requests.
+    expect(getOpenAIClientMock).not.toHaveBeenCalled();
+    // And the actual streaming call must never happen for stories.
+    expect(responsesStreamMock).not.toHaveBeenCalled();
+
+    // The route must still emit a final `done` event with content IDs so
+    // the form can render the saved drafts.
+    const doneEvent = events.find(
+      (event): event is { type: "done"; contentItemIds: string[] } =>
+        typeof event === "object" &&
+        event !== null &&
+        (event as Record<string, unknown>).type === "done",
+    );
+    expect(doneEvent).toBeDefined();
+    expect(doneEvent?.contentItemIds.length).toBeGreaterThan(0);
+  });
+
+  it("[Test 5] story request still succeeds when getOpenAIClient throws (lazy-init guard)", async () => {
+    getOpenAIClientMock.mockImplementation(() => {
+      throw new Error("Missing OPENAI_API_KEY");
+    });
+
+    const response = await POST(buildRequest(STORY_BODY) as never);
+
+    // Lazy-init guard: route must NOT touch the OpenAI client factory at
+    // all when the placement is "story". Today the factory is called
+    // before the platform loop, so this throws and the SSE stream emits
+    // an `error` instead of `done` — failing this assertion.
+    expect(response.status).toBe(200);
+
+    const events = await readSseEvents(response);
+    const doneEvent = events.find(
+      (event): event is { type: "done"; contentItemIds: string[] } =>
+        typeof event === "object" &&
+        event !== null &&
+        (event as Record<string, unknown>).type === "done",
+    );
+    expect(doneEvent).toBeDefined();
+    expect(doneEvent?.contentItemIds.length).toBeGreaterThan(0);
+
+    // The route must not have surfaced an `error` event for this case.
+    const errorEvent = events.find(
+      (event) =>
+        typeof event === "object" &&
+        event !== null &&
+        (event as Record<string, unknown>).type === "error",
+    );
+    expect(errorEvent).toBeUndefined();
+  });
+
+  it("[Test 6] feed POST still calls OpenAI and emits done — regression guard for the feed path", async () => {
+    const response = await POST(buildRequest(FEED_BODY) as never);
+
+    expect(response.status).toBe(200);
+
+    const events = await readSseEvents(response);
+
+    // The feed path must continue to call the client factory and stream
+    // a generation. We assert at least one call to each so a future
+    // refactor that accidentally short-circuits feed too would fail loudly.
+    expect(getOpenAIClientMock).toHaveBeenCalled();
+    expect(responsesStreamMock).toHaveBeenCalled();
+
+    const doneEvent = events.find(
+      (event): event is { type: "done"; contentItemIds: string[] } =>
+        typeof event === "object" &&
+        event !== null &&
+        (event as Record<string, unknown>).type === "done",
+    );
+    expect(doneEvent).toBeDefined();
+    expect(doneEvent?.contentItemIds.length).toBeGreaterThan(0);
+  });
+});
diff --git a/tests/lib/create/service.test.ts b/tests/lib/create/service.test.ts
index 43a8bfa..aa63f29 100644
--- a/tests/lib/create/service.test.ts
+++ b/tests/lib/create/service.test.ts
@@ -1,6 +1,7 @@
-import { describe, expect, it } from "vitest";
+import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
+import { DateTime } from "luxon";
 
-import type { InstantPostInput } from "@/lib/create/schema";
+import type { EventCampaignInput, InstantPostInput } from "@/lib/create/schema";
 
 process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
   process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "https://example.com/key";
@@ -9,7 +10,192 @@ process.env.NEXT_PUBLIC_SUPABASE_URL =
 process.env.SUPABASE_SERVICE_ROLE_KEY =
   process.env.SUPABASE_SERVICE_ROLE_KEY ?? "supabase-service-role-key";
 
+// --- Hoisted mocks -----------------------------------------------------------
+//
+// These mocks intercept the auth, settings, OpenAI, scheduling, and publishing
+// modules so the create-service tests below can exercise the real DB-write
+// path (campaigns → content_items → content_variants) without standing up a
+// real Supabase or OpenAI client. The chainable `supabaseMock` builder
+// captures the variant upsert payload so we can assert the exact columns
+// written for each of the banner-handling cases.
+const {
+  requireAuthContextMock,
+  getOwnerSettingsMock,
+  enqueuePublishJobMock,
+  deconflictCampaignPlansMock,
+  variantUpsertCallsRef,
+} = vi.hoisted(() => ({
+  requireAuthContextMock: vi.fn(),
+  getOwnerSettingsMock: vi.fn(),
+  enqueuePublishJobMock: vi.fn(),
+  deconflictCampaignPlansMock: vi.fn(),
+  variantUpsertCallsRef: { calls: [] as Array<unknown[]> },
+}));
+
+vi.mock("@/lib/auth/server", async () => {
+  const actual = await vi.importActual<typeof import("@/lib/auth/server")>(
+    "@/lib/auth/server",
+  );
+  return {
+    ...actual,
+    requireAuthContext: requireAuthContextMock,
+  };
+});
+
+vi.mock("@/lib/settings/data", () => ({
+  getOwnerSettings: getOwnerSettingsMock,
+}));
+
+vi.mock("@/lib/publishing/queue", () => ({
+  enqueuePublishJob: enqueuePublishJobMock,
+}));
+
+vi.mock("@/lib/scheduling/deconflict", () => ({
+  deconflictCampaignPlans: deconflictCampaignPlansMock,
+}));
+
 const { __testables } = await import("@/lib/create/service");
+const { createInstantPost, createEventCampaign } = await import(
+  "@/lib/create/service"
+);
+
+// --- Supabase chain mock builder --------------------------------------------
+//
+// The service queries multiple tables via a fluent .from(table)... chain. This
+// builder returns a thenable per-call object that handles the read paths
+// (content_items history, schedule lookups) and the write paths (campaigns,
+// content_items, content_variants), capturing the variant upsert payload into
+// `variantUpsertCallsRef.calls` for the tests to inspect.
+function buildSupabaseMock(): {
+  client: { from: (table: string) => unknown };
+  variantUpserts: Array<unknown[]>;
+} {
+  variantUpsertCallsRef.calls = [];
+  let contentItemCounter = 0;
+
+  function makeChain(table: string) {
+    const state: { lastUpsert?: unknown[] } = {};
+
+    const chain: Record<string, (...args: unknown[]) => unknown> = {};
+
+    // No-op chainable methods that return the same chain
+    for (const method of [
+      "select",
+      "eq",
+      "neq",
+      "in",
+      "is",
+      "gte",
+      "lte",
+      "order",
+      "limit",
+      "match",
+    ]) {
+      chain[method] = () => chain;
+    }
+
+    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
+    chain.single = () => {
+      if (table === "campaigns") {
+        return Promise.resolve({ data: { id: "cam-test-1" }, error: null });
+      }
+      return Promise.resolve({ data: null, error: null });
+    };
+
+    chain.insert = (rows: unknown) => {
+      if (table === "campaigns") {
+        // Caller pattern: .insert(row).select("id").single()
+        return chain;
+      }
+      if (table === "content_items") {
+        const items = Array.isArray(rows) ? rows : [rows];
+        const inserted = items.map((row) => {
+          contentItemCounter += 1;
+          const platform =
+            (row as Record<string, unknown>).platform ?? "facebook";
+          return {
+            id: `content-${contentItemCounter}`,
+            platform,
+          };
+        });
+        // Caller pattern: .insert(rows).select("id, platform")
+        const itemsChain: Record<string, unknown> = {
+          select: () => Promise.resolve({ data: inserted, error: null }),
+        };
+        return itemsChain;
+      }
+      // Default: nothing to capture
+      return Promise.resolve({ data: null, error: null });
+    };
+
+    chain.upsert = (rows: unknown) => {
+      const items = Array.isArray(rows) ? rows : [rows];
+      if (table === "content_variants") {
+        variantUpsertCallsRef.calls.push(items as unknown[]);
+        state.lastUpsert = items as unknown[];
+        const inserted = (items as Array<Record<string, unknown>>).map(
+          (row, index) => ({
+            id: `variant-${index + 1}`,
+            content_item_id: row.content_item_id,
+          }),
+        );
+        const upsertChain: Record<string, unknown> = {
+          select: () => Promise.resolve({ data: inserted, error: null }),
+        };
+        return upsertChain;
+      }
+      return Promise.resolve({ data: null, error: null });
+    };
+
+    return chain;
+  }
+
+  const client = {
+    from: (table: string) => makeChain(table),
+  };
+
+  return { client, variantUpserts: variantUpsertCallsRef.calls };
+}
+
+function buildBrandFixture() {
+  return {
+    toneFormal: 0.5,
+    tonePlayful: 0.5,
+    keyPhrases: [] as string[],
+    bannedTopics: [] as string[],
+    bannedPhrases: [] as string[],
+    defaultHashtags: [] as string[],
+    defaultEmojis: [] as string[],
+    instagramSignature: undefined,
+    facebookSignature: undefined,
+    gbpCta: "LEARN_MORE",
+  };
+}
+
+function buildPostingFixture() {
+  return {
+    timezone: "Europe/London",
+    facebookLocationId: undefined,
+    instagramLocationId: undefined,
+    gbpLocationId: undefined,
+    defaultPostingTime: undefined,
+    venueLocation: undefined,
+    venueLatitude: undefined,
+    venueLongitude: undefined,
+    notifications: { emailFailures: false, emailTokenExpiring: false },
+    gbpCtaDefaults: {
+      standard: "LEARN_MORE" as const,
+      event: "LEARN_MORE" as const,
+      offer: "LEARN_MORE" as const,
+    },
+    bannerDefaults: {
+      bannersEnabled: true,
+      bannerPosition: "right" as const,
+      bannerBg: "#a57626",
+      bannerTextColour: "#ffffff",
+    },
+  };
+}
 
 function buildInstantInput(overrides: Partial<InstantPostInput> = {}): InstantPostInput {
   return {
@@ -231,3 +417,231 @@ describe("describeEventTimingCue", () => {
     expect(result.label).toBeTruthy();
   });
 });
+
+// --- Bug A: instant-post banner override regression suite -------------------
+//
+// These tests lock the contract for `createInstantPost` and the shared
+// `createCampaignFromPlans` helper:
+//
+//  - Test 1 + 2: when `createInstantPost` is invoked, the variant insert
+//    payload MUST always include an explicit `banner_enabled` (true or
+//    false). NULL is no longer acceptable because at publish time NULL means
+//    "inherit account default", which silently rendered banners on instant
+//    posts the user never opted into.
+//
+//  - Test 3 (regression guard): the shared `createCampaignFromPlans` helper
+//    MUST keep its existing behaviour for callers that do not pass the new
+//    instant-only `bannerOverride`. Today's campaign callers omit
+//    `bannerDefaults` only when the user did not customise the picker — and
+//    they must continue to write NO banner_* columns so account defaults
+//    win at publish time. We exercise this through `createEventCampaign`,
+//    the cleanest production caller of the shared helper.
+//
+// All three tests use `placement: "story"` (or `placements: ["story"]` for
+// the campaign) so that `buildVariants` short-circuits without an OpenAI
+// call — story placements always persist `body: ""`. Stories also bypass
+// `resolveScheduleConflicts`, keeping the supabase mock surface small.
+
+function buildBaseInstantInput(
+  overrides: Partial<InstantPostInput> = {},
+): InstantPostInput {
+  return {
+    title: "Sunset Story",
+    prompt: "",
+    publishMode: "now",
+    scheduledFor: undefined,
+    platforms: ["facebook"],
+    media: [
+      { assetId: "asset-1", mediaType: "image", fileName: "hero.jpg" },
+    ],
+    ctaUrl: undefined,
+    ctaLabel: undefined,
+    linkInBioUrl: undefined,
+    toneAdjust: "default",
+    lengthPreference: "standard",
+    includeHashtags: false,
+    includeEmojis: false,
+    ctaStyle: "default",
+    placement: "story",
+    proofPointMode: "off",
+    proofPointsSelected: [],
+    proofPointIntentTags: [],
+    ...overrides,
+  } as InstantPostInput;
+}
+
+function buildBaseEventInput(
+  overrides: Partial<EventCampaignInput> = {},
+): EventCampaignInput {
+  const startDate = DateTime.now()
+    .setZone("Europe/London")
+    .plus({ months: 6 })
+    .startOf("day")
+    .toJSDate();
+  return {
+    name: "Test Event",
+    description: "A regression-guard event used for banner-override testing.",
+    startDate,
+    startTime: "19:00",
+    timezone: "Europe/London",
+    prompt: undefined,
+    platforms: ["facebook"],
+    placements: ["story"],
+    heroMedia: [
+      { assetId: "asset-1", mediaType: "image", fileName: "hero.jpg" },
+    ],
+    ctaUrl: undefined,
+    ctaLabel: undefined,
+    linkInBioUrl: undefined,
+    toneAdjust: "default",
+    lengthPreference: "standard",
+    includeHashtags: false,
+    includeEmojis: false,
+    ctaStyle: "default",
+    proofPointMode: "off",
+    proofPointsSelected: [],
+    proofPointIntentTags: [],
+    scheduleOffsets: [{ label: "Event day", offsetHours: 0 }],
+    customSchedule: undefined,
+    bannerDefaults: undefined,
+    ...overrides,
+  } as EventCampaignInput;
+}
+
+describe("createInstantPost — banner override (Bug A)", () => {
+  beforeEach(() => {
+    vi.clearAllMocks();
+    const mock = buildSupabaseMock();
+    requireAuthContextMock.mockResolvedValue({
+      supabase: mock.client,
+      accountId: "acc-test-1",
+      user: { id: "user-test-1", email: "test@example.com" },
+    });
+    getOwnerSettingsMock.mockResolvedValue({
+      brand: buildBrandFixture(),
+      posting: buildPostingFixture(),
+      venueName: "The Anchor",
+      venueLocation: "Stanwell Moor",
+    });
+    enqueuePublishJobMock.mockResolvedValue(undefined);
+    deconflictCampaignPlansMock.mockImplementation(
+      async (
+        _supabase: unknown,
+        _accountId: unknown,
+        plans: unknown,
+      ) => plans,
+    );
+  });
+
+  afterEach(() => {
+    vi.clearAllMocks();
+  });
+
+  it("writes banner_enabled=false explicitly when input.banner is undefined", async () => {
+    const input = buildBaseInstantInput({ banner: undefined });
+
+    await createInstantPost(input);
+
+    expect(variantUpsertCallsRef.calls.length).toBeGreaterThan(0);
+    const variantPayload = variantUpsertCallsRef.calls[0]?.[0] as
+      | Record<string, unknown>
+      | undefined;
+    expect(variantPayload).toBeDefined();
+    // Bug A guard: must be an explicit false, not null and not absent.
+    expect(variantPayload).toHaveProperty("banner_enabled", false);
+  });
+
+  it("writes banner_enabled=false explicitly when input.banner.enabled is false", async () => {
+    const input = buildBaseInstantInput({ banner: { enabled: false } });
+
+    await createInstantPost(input);
+
+    const variantPayload = variantUpsertCallsRef.calls[0]?.[0] as
+      | Record<string, unknown>
+      | undefined;
+    expect(variantPayload).toBeDefined();
+    expect(variantPayload).toHaveProperty("banner_enabled", false);
+  });
+
+  it("writes banner_enabled=true plus the picker colours and position when banner.enabled is true", async () => {
+    const input = buildBaseInstantInput({
+      banner: {
+        enabled: true,
+        defaults: {
+          position: "right",
+          bgColour: "gold",
+          textColour: "white",
+        },
+      },
+    });
+
+    await createInstantPost(input);
+
+    const variantPayload = variantUpsertCallsRef.calls[0]?.[0] as
+      | Record<string, unknown>
+      | undefined;
+    expect(variantPayload).toBeDefined();
+    // BANNER_COLOUR_HEX maps gold → #a57626 and white → #ffffff. Compare in
+    // a case-insensitive manner because the brief quotes #FFFFFF (upper case)
+    // while the source map uses the lower-case #ffffff form.
+    expect(variantPayload).toMatchObject({
+      banner_enabled: true,
+      banner_position: "right",
+      banner_bg: "#a57626",
+    });
+    const textColour = String(variantPayload?.banner_text_colour ?? "");
+    expect(textColour.toLowerCase()).toBe("#ffffff");
+  });
+});
+
+describe("createCampaignFromPlans — campaign caller regression guard (Bug A, test 3)", () => {
+  beforeEach(() => {
+    vi.clearAllMocks();
+    const mock = buildSupabaseMock();
+    requireAuthContextMock.mockResolvedValue({
+      supabase: mock.client,
+      accountId: "acc-test-1",
+      user: { id: "user-test-1", email: "test@example.com" },
+    });
+    getOwnerSettingsMock.mockResolvedValue({
+      brand: buildBrandFixture(),
+      posting: buildPostingFixture(),
+      venueName: "The Anchor",
+      venueLocation: "Stanwell Moor",
+    });
+    enqueuePublishJobMock.mockResolvedValue(undefined);
+    deconflictCampaignPlansMock.mockImplementation(
+      async (
+        _supabase: unknown,
+        _accountId: unknown,
+        plans: unknown,
+      ) => plans,
+    );
+  });
+
+  afterEach(() => {
+    vi.clearAllMocks();
+  });
+
+  it("writes NO banner_enabled column for campaign callers that omit bannerDefaults", async () => {
+    // Today's campaign caller: `bannerDefaults` undefined → variant payload
+    // must contain none of the banner_* columns so the publish-queue worker
+    // resolves them from the account default (banners_enabled=true today).
+    // This is the exact behaviour the Backend Implementer in Wave 2 must
+    // preserve when they add the new `bannerOverride` parameter.
+    const input = buildBaseEventInput({ bannerDefaults: undefined });
+
+    await createEventCampaign(input);
+
+    expect(variantUpsertCallsRef.calls.length).toBeGreaterThan(0);
+    const variantPayload = variantUpsertCallsRef.calls[0]?.[0] as
+      | Record<string, unknown>
+      | undefined;
+    expect(variantPayload).toBeDefined();
+    // The critical assertion: no banner_enabled key whatsoever.
+    expect(variantPayload).not.toHaveProperty("banner_enabled");
+    expect(variantPayload).not.toHaveProperty("banner_position");
+    expect(variantPayload).not.toHaveProperty("banner_bg");
+    expect(variantPayload).not.toHaveProperty("banner_text_colour");
+  });
+});
```

## Changed File Contents

### `src/app/actions/tournament.ts`

```
'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { MEDIA_BUCKET } from '@/lib/constants';
import {
  tournamentCreateSchema,
  tournamentUpdateSchema,
  fixtureCreateSchema,
  fixtureUpdateSchema,
  checkTournamentPreconditions,
} from '@/lib/tournament/validation';
import {
  getTournamentById,
  getFixtureById,
  getFixturesByTournament,
} from '@/lib/tournament/queries';
import {
  generateFixtureContent,
  bulkGenerateContent,
  deleteFixtureContentItems,
} from '@/lib/tournament/generate';
import { areBothTeamsConfirmed } from '@/lib/tournament/placeholder';
import { enqueuePublishJob } from '@/lib/publishing/queue';
import type { Tournament } from '@/types/tournament';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function buildConnectionsMap(
  accountId: string,
  platforms: string[],
): Promise<Record<string, boolean>> {
  const supabase = createServiceSupabaseClient();
  const connections: Record<string, boolean> = {};
  for (const platform of platforms) {
    const { data: conn } = await supabase
      .from('social_connections')
      .select('id')
      .eq('account_id', accountId)
      .eq('provider', platform)
      .limit(1);
    connections[platform] = (conn?.length ?? 0) > 0;
  }
  return connections;
}

// ---------------------------------------------------------------------------
// createTournament
// ---------------------------------------------------------------------------

export async function createTournament(
  input: unknown,
): Promise<{ success: boolean; error?: string; tournamentId?: string }> {
  try {
    const parsed = tournamentCreateSchema.parse(input);
    const { supabase, accountId } = await requireAuthContext();

    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('tournaments')
      .insert({
        account_id: accountId,
        name: parsed.name,
        slug: parsed.slug,
        post_template: parsed.postTemplate,
        house_rules_text: parsed.houseRulesText ?? null,
        platforms: parsed.platforms,
        post_lead_hours: parsed.postLeadHours,
        status: 'draft',
        updated_at: nowIso,
      })
      .select('id')
      .single();

    if (error) {
      // Unique constraint violation — duplicate slug for this account
      if (error.code === '23505') {
        return { success: false, error: 'A tournament with this slug already exists.' };
      }
      return { success: false, error: error.message };
    }

    revalidatePath('/dashboard/tournaments');

    return { success: true, tournamentId: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// updateTournament
// ---------------------------------------------------------------------------

export async function updateTournament(
  tournamentId: string,
  input: unknown,
): Promise<{ success: boolean; error?: string }> {
  try {
    const parsed = tournamentUpdateSchema.parse(input);
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (parsed.name !== undefined) updates.name = parsed.name;
    if (parsed.slug !== undefined) updates.slug = parsed.slug;
    if (parsed.postTemplate !== undefined) updates.post_template = parsed.postTemplate;
    if (parsed.houseRulesText !== undefined) updates.house_rules_text = parsed.houseRulesText;
    if (parsed.platforms !== undefined) updates.platforms = parsed.platforms;
    if (parsed.postLeadHours !== undefined) updates.post_lead_hours = parsed.postLeadHours;

    const { error } = await supabase
      .from('tournaments')
      .update(updates)
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'A tournament with this slug already exists.' };
      }
      return { success: false, error: error.message };
    }

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    revalidatePath('/dashboard/tournaments');

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// updateTournamentStatus
// ---------------------------------------------------------------------------

export async function updateTournamentStatus(
  tournamentId: string,
  status: Tournament['status'],
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const { error } = await supabase
      .from('tournaments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) return { success: false, error: error.message };

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    revalidatePath('/dashboard/tournaments');

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// updateTournamentBaseImages
// ---------------------------------------------------------------------------

export async function updateTournamentBaseImages(
  tournamentId: string,
  squareImageId: string | null,
  storyImageId: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    // Validate each image belongs to this account with correct properties
    const idsToValidate: Array<{ id: string; expectedAspect: string }> = [];
    if (squareImageId) idsToValidate.push({ id: squareImageId, expectedAspect: 'square' });
    if (storyImageId) idsToValidate.push({ id: storyImageId, expectedAspect: 'story' });

    for (const { id, expectedAspect } of idsToValidate) {
      const { data: asset, error: assetError } = await supabase
        .from('media_assets')
        .select('id, account_id, media_type, aspect_class, hidden_at')
        .eq('id', id)
        .maybeSingle();

      if (assetError || !asset) {

[truncated at line 200 — original has 879 lines]
```

### `src/app/api/create/generate-stream/route.ts`

```
/**
 * POST /api/create/generate-stream
 *
 * Streaming route handler for instant post generation.
 *
 * Design: OpenAI is called once per platform for the streaming preview, then
 * `createInstantPost()` is called once at the end to do the real save. This
 * results in two OpenAI API calls per generation (one for preview, one for
 * save). We accept that trade-off because replicating the full generate+save
 * pipeline here would duplicate a large amount of complex business logic that
 * lives in service.ts, and the UX improvement from real streaming is
 * significant.
 */

import { NextRequest } from "next/server";
import { DateTime } from "luxon";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveAccountId } from "@/lib/auth/server";
import { getOpenAIClient } from "@/lib/ai/client";
import { buildInstantPostPrompt } from "@/lib/ai/prompts";
import { getOwnerSettings } from "@/lib/settings/data";
import { createInstantPost } from "@/lib/create/service";
import { resolveStoryScheduledFor } from "@/lib/create/story-schedule";
import {
  instantPostFormSchema,
  instantPostSchema,
  type InstantPostInput,
} from "@/lib/create/schema";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

export const dynamic = "force-dynamic";

// SSE event types emitted by this handler
type StreamEvent =
  | { type: "platform_start"; platform: string }
  | { type: "chunk"; platform: string; text: string }
  | { type: "platform_done"; platform: string }
  | { type: "story_no_caption"; platform: string }
  | { type: "done"; contentItemIds: string[] }
  | { type: "error"; message: string };

function encode(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: NextRequest): Promise<Response> {
  // --- Auth ---
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const accountId = resolveAccountId(user);
  if (!accountId) {
    return new Response(JSON.stringify({ error: "Account not found" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Parse body ---
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let formValues: ReturnType<typeof instantPostFormSchema.parse>;
  try {
    formValues = instantPostFormSchema.parse(rawBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve to the domain input type (same transform as the server action)
  const storyScheduledFor =
    formValues.placement === "story"
      ? resolveStoryScheduledFor(formValues.scheduledFor ?? new Date(), DEFAULT_TIMEZONE)
      : null;
  const input: InstantPostInput = instantPostSchema.parse({
    ...formValues,
    publishMode: storyScheduledFor ? "schedule" : formValues.publishMode,
    scheduledFor:
      storyScheduledFor ??
      (formValues.publishMode === "schedule" && formValues.scheduledFor
        ? DateTime.fromISO(formValues.scheduledFor, { zone: DEFAULT_TIMEZONE }).toJSDate()
        : undefined),
    // Carry the optional banner override through to createInstantPost so the
    // service layer can write an explicit banner_enabled to the variant row.
    banner: formValues.banner,
  });

  // --- Build the SSE stream ---
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(encode(event)));
      };

      try {
        // Load settings once — needed to build prompts
        const { brand, venueName } = await getOwnerSettings();

        // Stream a preview for each platform (OpenAI call #1 per platform).
        //
        // Stories are image-only on Facebook and Instagram — the providers
        // discard any caption at publish time. Skip OpenAI entirely for them
        // (including the client factory) so a story-only submission works
        // even when OPENAI_API_KEY is missing or the factory throws.
        for (const platform of input.platforms) {
          if (input.placement === "story") {
            send({ type: "story_no_caption", platform });
            continue;
          }

          send({ type: "platform_start", platform });

          const prompt = buildInstantPostPrompt({
            brand,
            venueName,
            input,
            platform,
            scheduledFor: input.scheduledFor ?? null,
          });

          const responseStream = getOpenAIClient().responses.stream({
            model: "gpt-4.1-mini",
            input: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            temperature: 0.7,
          });

          for await (const event of responseStream) {
            if (
              event.type === "response.output_text.delta" &&
              typeof event.delta === "string" &&
              event.delta.length > 0
            ) {
              send({ type: "chunk", platform, text: event.delta });
            }
          }

          send({ type: "platform_done", platform });
        }

        // Persist (OpenAI call #2 — full generation + save via existing service).
        // Runs for BOTH story and feed flows so the form can render the saved
        // drafts via the final `done` event.
        const result = await createInstantPost(input);

        send({ type: "done", contentItemIds: result.contentItemIds });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Content generation failed.";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

### `src/features/create/instant-post-form.tsx`

```
"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useForm, type Resolver, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DateTime } from "luxon";

import {
  fetchGeneratedContentDetails,
} from "@/app/(app)/create/actions";
import {
  instantPostFormSchema,
  type InstantPostFormValues,
  type InstantPostInput,
  type MediaAssetInput,
} from "@/lib/create/schema";
import { DEFAULT_POST_TIME, STORY_POST_TIME } from "@/lib/constants";
import { formatStoryScheduleInputValue } from "@/lib/create/story-schedule";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerContentDetail } from "@/lib/planner/data";
import { GeneratedContentReviewList } from "@/features/create/generated-content-review-list";
import { GenerationProgress } from "@/features/create/generation-progress";
import { StreamingPreview } from "@/features/create/streaming-preview";
import { MediaAttachmentSelector } from "@/features/create/media-attachment-selector";
import { StageAccordion, type StageAccordionControls } from "@/features/create/stage-accordion";
import { TemplateSelector } from "@/features/create/template-selector";
import { BannerDefaultsPicker } from "@/features/create/banner-defaults-picker";
import { DEFAULT_BANNER_DEFAULTS, type BannerDefaults } from "@/lib/scheduling/banner-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface BannerSelection {
  enabled: boolean;
  defaults?: BannerDefaults;
}

const PLATFORM_LABELS: Record<InstantPostInput["platforms"][number], string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  gbp: "Google Business Profile",
};

const LINK_GOAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Learn more (default)" },
  { value: "Find out more", label: "Find out more" },
  { value: "Book now", label: "Book now" },
  { value: "Reserve a table", label: "Reserve a table" },
  { value: "View menu", label: "View menu" },
  { value: "Call now", label: "Call now" },
];

interface InstantPostFormProps {
  mediaLibrary: MediaAssetSummary[];
  ownerTimezone: string;
  onLibraryUpdate?: Dispatch<SetStateAction<MediaAssetSummary[]>>;
  initialDate?: Date;
  initialMedia?: MediaAssetSummary[];
  onSuccess?: () => void;
}

// Shape of SSE events emitted by POST /api/create/generate-stream
interface StreamEvent {
  type: string;
  platform?: string;
  text?: string;
  contentItemIds?: string[];
  message?: string;
}

export function InstantPostForm({ mediaLibrary, ownerTimezone, onLibraryUpdate, initialDate, initialMedia, onSuccess }: InstantPostFormProps) {
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<{ status: string; scheduledFor: string | null } | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [progressActive, setProgressActive] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  // Streaming preview state: accumulated text per platform key
  const [streamingText, setStreamingText] = useState<Record<string, string>>({});
  const [streamingPlatforms, setStreamingPlatforms] = useState<string[]>([]);
  // AbortController for the in-flight SSE fetch
  const abortControllerRef = useRef<AbortController | null>(null);
  const [generatedItems, setGeneratedItems] = useState<PlannerContentDetail[]>([]);
  const [library, setLibrary] = useState<MediaAssetSummary[]>(mediaLibrary);
  // Banner overlay opt-in. Defaults to OFF so instant posts never publish a
  // banner unless the user explicitly enables it in this stage. The choice
  // flows through the submit payload to /api/create/generate-stream and on to
  // createInstantPost which writes an explicit banner_enabled value to the
  // variant — replacing the previous silent "use account default" behaviour.
  const [banner, setBanner] = useState<BannerSelection>({ enabled: false });

  useEffect(() => {
    setLibrary(mediaLibrary);
  }, [mediaLibrary]);

  useEffect(() => () => {
    // Abort any in-flight stream on unmount
    abortControllerRef.current?.abort();
  }, []);

  const handleLibraryUpdate: Dispatch<SetStateAction<MediaAssetSummary[]>> = (updater) => {
    setLibrary((prev) => (typeof updater === "function" ? (updater as (value: MediaAssetSummary[]) => MediaAssetSummary[])(prev) : updater));
    if (onLibraryUpdate) {
      onLibraryUpdate(updater);
    }
  };

  const form = useForm<InstantPostFormValues>({
    resolver: zodResolver(instantPostFormSchema) as Resolver<InstantPostFormValues>,
    defaultValues: {
      title: "",
      prompt: "",
      publishMode: initialDate ? "schedule" : "now",
      scheduledFor: initialDate
        ? DateTime.fromJSDate(initialDate)
            .setZone(ownerTimezone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : undefined,
      platforms: ["facebook", "instagram"],
      media: initialMedia?.map(m => ({
        assetId: m.id,
        mediaType: m.mediaType,
        fileName: m.fileName
      })) ?? [],
      ctaUrl: "",
      ctaLabel: "",
      linkInBioUrl: "",
      toneAdjust: "default",
      lengthPreference: "standard",
      includeHashtags: true,
      includeEmojis: true,
      ctaStyle: "default",
      placement: "feed",
      proofPointMode: "off",
      proofPointsSelected: [],
      proofPointIntentTags: [],
    },
  });

  const publishMode = form.watch("publishMode");
  const selectedMedia = form.watch("media") ?? [];
  const placement = form.watch("placement");
  const scheduledForValue = form.watch("scheduledFor");
  const storyDateValue = scheduledForValue?.slice(0, 10) ?? "";

  const setStoryScheduledDate = useCallback((value: string | Date | null | undefined) => {
    const resolved = formatStoryScheduleInputValue(value ?? new Date(), ownerTimezone);
    if (!resolved) return;
    form.setValue("scheduledFor", resolved, { shouldDirty: true, shouldValidate: true });
  }, [form, ownerTimezone]);

  useEffect(() => {
    if (publishMode !== "schedule") return;
    const current = form.getValues("scheduledFor");
    if (current) return;

    const now = DateTime.now().setZone(ownerTimezone);
    let next = now.set({
      hour: Number(DEFAULT_POST_TIME.split(":")[0]),
      minute: Number(DEFAULT_POST_TIME.split(":")[1]),
      second: 0,
      millisecond: 0,
    });
    if (next <= now) {
      next = next.plus({ days: 1 });
    }
    form.setValue("scheduledFor", next.toFormat("yyyy-MM-dd'T'HH:mm"), { shouldDirty: true });
  }, [form, ownerTimezone, publishMode]);

  useEffect(() => {
    if (placement === "story") {
      if (form.getValues("publishMode") !== "schedule") {
        form.setValue("publishMode", "schedule", { shouldDirty: true });
      }
      setStoryScheduledDate(form.getValues("scheduledFor") ?? new Date());

      const currentPlatforms = form.getValues("platforms") ?? [];
      const filtered = currentPlatforms.filter(
        (platform): platform is InstantPostInput["platforms"][number] => platform !== "gbp",
      );
      const nextPlatforms: InstantPostInput["platforms"] = filtered.length ? filtered : ["instagram"];
      if (filtered.length !== currentPlatforms.length || filtered.length === 0) {
        form.setValue("platforms", nextPlatforms, { shouldDirty: true });
      }
    }
  }, [placement, form, setStoryScheduledDate]);

  const startProgress = (message: string) => {
    setProgressMessage(message);
    setProgressActive(true);
  };

  const stopProgress = () => {
    setProgressActive(false);

[truncated at line 200 — original has 821 lines]
```

### `src/lib/create/schema.ts`

```
import { z } from "zod";

import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { BannerDefaultsSchema } from "@/lib/scheduling/banner-config";

export const platformEnum = z.enum(["facebook", "instagram", "gbp"]);
export const placementEnum = z.enum(["feed", "story"]);

const mediaAssetSchema = z.object({
  assetId: z.string(),
  mediaType: z.enum(["image", "video"]),
  fileName: z.string().optional(),
});

const optionalUrlFormField = z
  .union([z.string().trim().url("Enter a valid URL"), z.literal("")])
  .transform((value) => (value ? value : undefined))
  .optional();

const optionalCtaLabelFormField = z
  .union([z.literal(""), z.string().trim().min(1, "Select a link goal").max(30, "Keep link goals concise")])
  .transform((value) => (value ? value : undefined))
  .optional();


export const toneAdjustEnum = z.enum([
  "default",
  "more_formal",
  "more_casual",
  "more_serious",
  "more_playful",
]);

export const lengthPreferenceEnum = z.enum(["standard", "short", "detailed"]);

export const ctaStyleEnum = z.enum(["default", "direct", "urgent"]);

export const proofPointModeEnum = z.enum(["off", "auto", "selected"]);

const proofPointOptionsSchema = z.object({
  proofPointMode: proofPointModeEnum.default("off"),
  proofPointsSelected: z.array(z.string().trim().min(1)).default([]),
  proofPointIntentTags: z.array(z.string().trim().min(1)).default([]),
});

export const advancedOptionsSchema = z.object({
  toneAdjust: toneAdjustEnum.default("default"),
  lengthPreference: lengthPreferenceEnum.default("standard"),
  includeHashtags: z.boolean().default(true),
  includeEmojis: z.boolean().default(true),
  ctaStyle: ctaStyleEnum.default("default"),
});

/**
 * Optional per-post banner override for the instant-post path.
 *
 * `enabled` is the user's explicit on/off choice; when `enabled` is true the
 * caller may also supply `defaults` (position + colours) from the
 * BannerDefaultsPicker. The form defaults this to `{ enabled: false }` so the
 * service layer can persist `banner_enabled = false` rather than NULL —
 * fixing the silent-default banner bug for instant posts.
 */
export const bannerInputSchema = z
  .object({
    enabled: z.boolean(),
    defaults: BannerDefaultsSchema.optional(),
  })
  .optional();

export const instantPostSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    prompt: z.string().default(""),
    publishMode: z.enum(["now", "schedule"]),
    scheduledFor: z.date().optional(),
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    media: z.array(mediaAssetSchema).optional(),
    ctaUrl: z.string().url("Enter a valid URL").optional(),
    ctaLabel: z.string().trim().min(1, "Select a link goal").max(30, "Keep link goals concise").optional(),
    linkInBioUrl: z.string().url("Enter a valid URL").optional(),
    toneAdjust: toneAdjustEnum.default("default"),
    lengthPreference: lengthPreferenceEnum.default("standard"),
    includeHashtags: z.boolean().default(true),
    includeEmojis: z.boolean().default(true),
    ctaStyle: ctaStyleEnum.default("default"),
    placement: placementEnum.default("feed"),
    banner: bannerInputSchema,
  })
  .merge(proofPointOptionsSchema)
  .superRefine((data, ctx) => {
    if (data.publishMode === "schedule" && (!data.media || data.media.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Scheduled posts require at least one media asset.",
        path: ["media"],
      });
    }

    if (data.placement === "feed" && !data.prompt.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide prompt information for feed posts.",
        path: ["prompt"],
      });
    }

    if (data.placement === "story") {
      if (!data.media || data.media.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stories require exactly one media asset.",
          path: ["media"],
        });
      } else if (data.media[0]?.mediaType !== "image") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stories support images only.",
          path: ["media"],
        });
      }

      const disallowedPlatform = data.platforms.find((platform) => platform === "gbp");
      if (disallowedPlatform) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stories are only supported on Facebook and Instagram.",
          path: ["platforms"],
        });
      }
    }
  });

export const instantPostFormSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    prompt: z.string().default(""),
    publishMode: z.enum(["now", "schedule"]),
    scheduledFor: z.string().optional(),
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    media: z.array(mediaAssetSchema).optional(),
    ctaUrl: optionalUrlFormField,
    ctaLabel: optionalCtaLabelFormField,
    linkInBioUrl: optionalUrlFormField,
    toneAdjust: toneAdjustEnum.default("default"),
    lengthPreference: lengthPreferenceEnum.default("standard"),
    includeHashtags: z.boolean().default(true),
    includeEmojis: z.boolean().default(true),
    ctaStyle: ctaStyleEnum.default("default"),
    placement: placementEnum.default("feed"),
    banner: bannerInputSchema,
  })
  .merge(proofPointOptionsSchema)
  .superRefine((data, ctx) => {
    if (data.publishMode === "schedule" && (!data.media || data.media.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add media before scheduling.",
        path: ["media"],
      });
    }

    if (data.placement === "feed" && !data.prompt.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tell us what to post.",
        path: ["prompt"],
      });
    }

    if (data.placement === "story") {
      if (!data.media || data.media.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stories require exactly one media asset.",
          path: ["media"],
        });
      } else if (data.media[0]?.mediaType !== "image") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stories support images only.",
          path: ["media"],
        });
      }

      const disallowedPlatform = data.platforms.find((platform) => platform === "gbp");
      if (disallowedPlatform) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stories are only supported on Facebook and Instagram.",
          path: ["platforms"],
        });
      }
    }
  });

const eventBaseSchema = z
  .object({
    name: z.string().min(1, "Event name is required"),
    description: z.string().min(1, "Give us some detail"),
    startDate: z.date(),

[truncated at line 200 — original has 508 lines]
```

### `src/lib/create/service.ts`

```
import { DateTime } from "luxon";
import pLimit from "p-limit";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthContext } from "@/lib/auth/server";
import type {
  EventCampaignInput,
  InstantPostAdvancedOptions,
  InstantPostInput,
  MediaAssetInput,
  PromotionCampaignInput,
  WeeklyCampaignInput,
} from "@/lib/create/schema";
import { buildInstantPostPrompt } from "@/lib/ai/prompts";
import { postProcessGeneratedCopy } from "@/lib/ai/postprocess";
import { applyChannelRules, lintContent } from "@/lib/ai/content-rules";
import { getOpenAIClient } from "@/lib/ai/client";
import { getOwnerSettings } from "@/lib/settings/data";
import { enqueuePublishJob } from "@/lib/publishing/queue";
import { isSchemaMissingError } from "@/lib/supabase/errors";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { resolveStoryScheduledFor } from "@/lib/create/story-schedule";
import { formatFriendlyTime } from "@/lib/utils/date";
import { buildSpreadEvenlySlots, getEngagementOptimisedHour, isSameCalendarDay } from "@/lib/scheduling/spread";
import { deconflictCampaignPlans } from "@/lib/scheduling/deconflict";
import { selectHookStrategy, getHookInstruction } from "@/lib/ai/hooks";
import type { HookStrategy } from "@/lib/ai/hooks";
import { inferContentPillar, buildPillarNudge } from "@/lib/ai/pillars";
import type { ContentPillar } from "@/lib/ai/pillars";
import { BANNER_COLOUR_HEX, DEFAULT_BANNER_DEFAULTS } from "@/lib/scheduling/banner-config";
import type { BannerDefaults } from "@/lib/scheduling/banner-config";


const DEBUG_CONTENT_GENERATION = process.env.DEBUG_CONTENT_GENERATION === "true";

/**
 * Per-campaign banner override columns to write to content_variants.
 *
 * F4 + G3: BannerDefaults from the campaign creation form does NOT include a
 * bannersEnabled toggle — only position/bgColour/textColour. So:
 *  - If the user did not customise any field, return null. The variant
 *    inherits account defaults (including the account's enabled flag) at
 *    publish time via bannerConfigResolver.
 *  - If the user customised at least one field, write ONLY the changed
 *    appearance columns. Each column independently inherits the account
 *    default at resolve time when omitted. Do NOT set banner_enabled — the
 *    account-level setting still governs whether banners render. Forcing
 *    banner_enabled true here would silently override an account-level
 *    "off".
 *
 * Per-field overrides are critical: writing all three columns whenever any
 * one differs would freeze appearance to specific values, defeating the
 * spec's per-column fallback (e.g. an account-level colour change must apply
 * to a post that only customised position).
 */
export type BannerOverrideRow = {
  banner_position?: BannerDefaults["position"];
  banner_bg?: string;
  banner_text_colour?: string;
};

export function computeBannerOverride(
  bannerDefaults?: BannerDefaults,
): BannerOverrideRow | null {
  if (!bannerDefaults) return null;

  const override: BannerOverrideRow = {};

  if (bannerDefaults.position !== DEFAULT_BANNER_DEFAULTS.position) {
    override.banner_position = bannerDefaults.position;
  }
  if (bannerDefaults.bgColour !== DEFAULT_BANNER_DEFAULTS.bgColour) {
    const bgHex = BANNER_COLOUR_HEX[bannerDefaults.bgColour];
    if (bgHex) {
      override.banner_bg = bgHex;
    }
  }
  if (bannerDefaults.textColour !== DEFAULT_BANNER_DEFAULTS.textColour) {
    const textHex = BANNER_COLOUR_HEX[bannerDefaults.textColour];
    if (textHex) {
      override.banner_text_colour = textHex;
    }
  }

  return Object.keys(override).length === 0 ? null : override;
}

/**
 * Per-variant banner override for the INSTANT-POST path only.
 *
 * Differs from {@link BannerOverrideRow} in that it ALWAYS includes an explicit
 * `banner_enabled` (true or false). This forces instant posts off the silent
 * "NULL means inherit account default" path that surprised users with unwanted
 * banner overlays.
 *
 * Campaign callers continue to use `BannerOverrideRow` + `computeBannerOverride`
 * and inherit account defaults — unchanged behaviour.
 */
export type InstantBannerOverride = {
  banner_enabled: boolean;
  banner_position?: BannerDefaults["position"];
  banner_bg?: string;
  banner_text_colour?: string;
};

/**
 * Build an {@link InstantBannerOverride} from the form-provided `banner` input.
 *
 * - When `banner` is undefined or `banner.enabled` is false, the override
 *   carries `banner_enabled: false` and no other fields. The variant insert
 *   then writes an explicit false to `content_variants.banner_enabled`.
 * - When `banner.enabled` is true, the override carries `banner_enabled: true`
 *   plus the position and colours derived from `banner.defaults`. Missing
 *   colour entries in {@link BANNER_COLOUR_HEX} are skipped — the publish-time
 *   resolver then falls back to the account default for that colour only.
 */
export function buildInstantBannerOverride(
  banner: { enabled: boolean; defaults?: BannerDefaults } | undefined,
): InstantBannerOverride {
  if (!banner || !banner.enabled) {
    return { banner_enabled: false };
  }
  const override: InstantBannerOverride = { banner_enabled: true };
  const defaults = banner.defaults;
  if (defaults) {
    override.banner_position = defaults.position;
    const bgHex = BANNER_COLOUR_HEX[defaults.bgColour];
    if (bgHex) override.banner_bg = bgHex;
    const textHex = BANNER_COLOUR_HEX[defaults.textColour];
    if (textHex) override.banner_text_colour = textHex;
  }
  return override;
}

/** In-memory batch state for hook + pillar variety tracking. */
interface CopyEngagement {
  recentHooks: string[];
  recentPillars: string[];
}

/**
 * Fetch the last 5 hook_strategy and content_pillar values for this account.
 * Runs ONCE per campaign creation, not per plan.
 * Returns arrays seeded for in-memory batch tracking.
 */
async function fetchRecentCopyHistory(
  supabase: SupabaseClient,
  accountId: string,
): Promise<CopyEngagement> {
  const { data, error } = await supabase
    .from("content_items")
    .select("hook_strategy, content_pillar")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    // Non-fatal — fall back to empty history if columns don't exist yet
    console.warn("[create] fetchRecentCopyHistory failed, using empty history:", error.message);
    return { recentHooks: [], recentPillars: [] };
  }

  const recentHooks: string[] = [];
  const recentPillars: string[] = [];

  for (const row of data ?? []) {
    if (typeof row.hook_strategy === "string" && row.hook_strategy) {
      recentHooks.push(row.hook_strategy);
    }
    if (typeof row.content_pillar === "string" && row.content_pillar) {
      recentPillars.push(row.content_pillar);
    }
  }

  // DB query returns newest-first (DESC). Reverse so newest items are at the
  // end of each array — selectHookStrategy uses slice(-3) and buildPillarNudge
  // uses slice(-2) to read the most recent entries from the tail.
  return { recentHooks: recentHooks.reverse(), recentPillars: recentPillars.reverse() };
}

type Platform = InstantPostInput["platforms"][number];

interface VariantPlan {
  title: string;
  prompt: string;
  scheduledFor: Date | null;
  platforms: Platform[];
  media?: MediaAssetInput[];
  promptContext?: Record<string, unknown>;
  options?: InstantPostAdvancedOptions;
  ctaUrl?: string | null;
  linkInBioUrl?: string | null;
  placement: "feed" | "story";
  /** When true, deconflict will not shift this plan to a different day. */
  pinned?: boolean;
  /** Stable index identifying which campaign plan produced this variant. */
  planIndex: number;
}

interface GeneratedVariantResult {

[truncated at line 200 — original has 2133 lines]
```

### `tests/api/generate-stream-route.test.ts`

```
/**
 * Tests for POST /api/create/generate-stream — Bug B regression suite.
 *
 * These tests lock the contract for the streaming preview route:
 *
 *  - Test 4: a story-placement request must NOT call OpenAI (neither the
 *    client factory nor `responses.stream`). The route must still emit a
 *    final `done` SSE event carrying `contentItemIds` so the form can
 *    render the saved drafts.
 *
 *  - Test 5: lazy-init guard. If the OpenAI client factory throws (e.g.
 *    the API key is missing), a story-only request must still succeed —
 *    the factory must be called only on the feed branch.
 *
 *  - Test 6: regression guard for the feed path. A feed request must
 *    continue to call OpenAI exactly as today and emit `done` with
 *    contentItemIds.
 *
 * The route handler streams Server-Sent Events; we collect the stream into
 * an array of decoded events for assertion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "https://example.com/key";
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "supabase-service-role-key";

// --- Hoisted mocks -----------------------------------------------------------
const {
  createServerSupabaseClientMock,
  getOwnerSettingsMock,
  getOpenAIClientMock,
  createInstantPostMock,
  responsesStreamMock,
} = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
  getOwnerSettingsMock: vi.fn(),
  getOpenAIClientMock: vi.fn(),
  createInstantPostMock: vi.fn(),
  responsesStreamMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

vi.mock("@/lib/settings/data", () => ({
  getOwnerSettings: getOwnerSettingsMock,
}));

vi.mock("@/lib/ai/client", () => ({
  getOpenAIClient: getOpenAIClientMock,
}));

vi.mock("@/lib/create/service", () => ({
  createInstantPost: createInstantPostMock,
}));

import { POST } from "@/app/api/create/generate-stream/route";

// --- Helpers ----------------------------------------------------------------
function buildAuthSupabaseMock(user: { id: string } | null = { id: "user-1" }) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user },
          error: user ? null : new Error("no user"),
        }),
    },
  };
}

function buildBrandFixture() {
  return {
    toneFormal: 0.5,
    tonePlayful: 0.5,
    keyPhrases: [] as string[],
    bannedTopics: [] as string[],
    bannedPhrases: [] as string[],
    defaultHashtags: [] as string[],
    defaultEmojis: [] as string[],
    instagramSignature: undefined,
    facebookSignature: undefined,
    gbpCta: "LEARN_MORE",
  };
}

function buildPostingFixture() {
  return {
    timezone: "Europe/London",
    facebookLocationId: undefined,
    instagramLocationId: undefined,
    gbpLocationId: undefined,
    defaultPostingTime: undefined,
    venueLocation: undefined,
    venueLatitude: undefined,
    venueLongitude: undefined,
    notifications: { emailFailures: false, emailTokenExpiring: false },
    gbpCtaDefaults: {
      standard: "LEARN_MORE" as const,
      event: "LEARN_MORE" as const,
      offer: "LEARN_MORE" as const,
    },
    bannerDefaults: {
      bannersEnabled: true,
      bannerPosition: "right" as const,
      bannerBg: "#a57626",
      bannerTextColour: "#ffffff",
    },
  };
}

function buildAsyncIterableStream(deltas: string[]) {
  return (async function* () {
    for (const delta of deltas) {
      yield {
        type: "response.output_text.delta",
        delta,
      } as const;
    }
  })();
}

async function readSseEvents(response: Response): Promise<unknown[]> {
  // Reads the SSE body into individual `data: ...` JSON payloads.
  if (!response.body) return [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: unknown[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const dataLine = block
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const json = dataLine.slice("data: ".length);
      try {
        events.push(JSON.parse(json));
      } catch {
        // ignore parse errors on partial chunks
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    const dataLine = buffer
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (dataLine) {
      try {
        events.push(JSON.parse(dataLine.slice("data: ".length)));
      } catch {
        // noop
      }
    }
  }
  return events;
}

function buildRequest(body: unknown): Request {
  return new Request("http://localhost/api/create/generate-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const STORY_BODY = {
  title: "Sunset story",
  prompt: "",
  publishMode: "now" as const,
  platforms: ["instagram"],
  media: [{ assetId: "asset-1", mediaType: "image", fileName: "hero.jpg" }],
  placement: "story" as const,
  toneAdjust: "default" as const,
  lengthPreference: "standard" as const,
  includeHashtags: false,
  includeEmojis: false,
  ctaStyle: "default" as const,
  proofPointMode: "off" as const,
  proofPointsSelected: [],
  proofPointIntentTags: [],
};

const FEED_BODY = {
  title: "Tonight at the pub",
  prompt: "Live music tonight, doors at 8.",
  publishMode: "now" as const,
  platforms: ["facebook"],

[truncated at line 200 — original has 326 lines]
```

### `tests/lib/create/service.test.ts`

```
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";

import type { EventCampaignInput, InstantPostInput } from "@/lib/create/schema";

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "https://example.com/key";
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "supabase-service-role-key";

// --- Hoisted mocks -----------------------------------------------------------
//
// These mocks intercept the auth, settings, OpenAI, scheduling, and publishing
// modules so the create-service tests below can exercise the real DB-write
// path (campaigns → content_items → content_variants) without standing up a
// real Supabase or OpenAI client. The chainable `supabaseMock` builder
// captures the variant upsert payload so we can assert the exact columns
// written for each of the banner-handling cases.
const {
  requireAuthContextMock,
  getOwnerSettingsMock,
  enqueuePublishJobMock,
  deconflictCampaignPlansMock,
  variantUpsertCallsRef,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  getOwnerSettingsMock: vi.fn(),
  enqueuePublishJobMock: vi.fn(),
  deconflictCampaignPlansMock: vi.fn(),
  variantUpsertCallsRef: { calls: [] as Array<unknown[]> },
}));

vi.mock("@/lib/auth/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/server")>(
    "@/lib/auth/server",
  );
  return {
    ...actual,
    requireAuthContext: requireAuthContextMock,
  };
});

vi.mock("@/lib/settings/data", () => ({
  getOwnerSettings: getOwnerSettingsMock,
}));

vi.mock("@/lib/publishing/queue", () => ({
  enqueuePublishJob: enqueuePublishJobMock,
}));

vi.mock("@/lib/scheduling/deconflict", () => ({
  deconflictCampaignPlans: deconflictCampaignPlansMock,
}));

const { __testables } = await import("@/lib/create/service");
const { createInstantPost, createEventCampaign } = await import(
  "@/lib/create/service"
);

// --- Supabase chain mock builder --------------------------------------------
//
// The service queries multiple tables via a fluent .from(table)... chain. This
// builder returns a thenable per-call object that handles the read paths
// (content_items history, schedule lookups) and the write paths (campaigns,
// content_items, content_variants), capturing the variant upsert payload into
// `variantUpsertCallsRef.calls` for the tests to inspect.
function buildSupabaseMock(): {
  client: { from: (table: string) => unknown };
  variantUpserts: Array<unknown[]>;
} {
  variantUpsertCallsRef.calls = [];
  let contentItemCounter = 0;

  function makeChain(table: string) {
    const state: { lastUpsert?: unknown[] } = {};

    const chain: Record<string, (...args: unknown[]) => unknown> = {};

    // No-op chainable methods that return the same chain
    for (const method of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "gte",
      "lte",
      "order",
      "limit",
      "match",
    ]) {
      chain[method] = () => chain;
    }

    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.single = () => {
      if (table === "campaigns") {
        return Promise.resolve({ data: { id: "cam-test-1" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };

    chain.insert = (rows: unknown) => {
      if (table === "campaigns") {
        // Caller pattern: .insert(row).select("id").single()
        return chain;
      }
      if (table === "content_items") {
        const items = Array.isArray(rows) ? rows : [rows];
        const inserted = items.map((row) => {
          contentItemCounter += 1;
          const platform =
            (row as Record<string, unknown>).platform ?? "facebook";
          return {
            id: `content-${contentItemCounter}`,
            platform,
          };
        });
        // Caller pattern: .insert(rows).select("id, platform")
        const itemsChain: Record<string, unknown> = {
          select: () => Promise.resolve({ data: inserted, error: null }),
        };
        return itemsChain;
      }
      // Default: nothing to capture
      return Promise.resolve({ data: null, error: null });
    };

    chain.upsert = (rows: unknown) => {
      const items = Array.isArray(rows) ? rows : [rows];
      if (table === "content_variants") {
        variantUpsertCallsRef.calls.push(items as unknown[]);
        state.lastUpsert = items as unknown[];
        const inserted = (items as Array<Record<string, unknown>>).map(
          (row, index) => ({
            id: `variant-${index + 1}`,
            content_item_id: row.content_item_id,
          }),
        );
        const upsertChain: Record<string, unknown> = {
          select: () => Promise.resolve({ data: inserted, error: null }),
        };
        return upsertChain;
      }
      return Promise.resolve({ data: null, error: null });
    };

    return chain;
  }

  const client = {
    from: (table: string) => makeChain(table),
  };

  return { client, variantUpserts: variantUpsertCallsRef.calls };
}

function buildBrandFixture() {
  return {
    toneFormal: 0.5,
    tonePlayful: 0.5,
    keyPhrases: [] as string[],
    bannedTopics: [] as string[],
    bannedPhrases: [] as string[],
    defaultHashtags: [] as string[],
    defaultEmojis: [] as string[],
    instagramSignature: undefined,
    facebookSignature: undefined,
    gbpCta: "LEARN_MORE",
  };
}

function buildPostingFixture() {
  return {
    timezone: "Europe/London",
    facebookLocationId: undefined,
    instagramLocationId: undefined,
    gbpLocationId: undefined,
    defaultPostingTime: undefined,
    venueLocation: undefined,
    venueLatitude: undefined,
    venueLongitude: undefined,
    notifications: { emailFailures: false, emailTokenExpiring: false },
    gbpCtaDefaults: {
      standard: "LEARN_MORE" as const,
      event: "LEARN_MORE" as const,
      offer: "LEARN_MORE" as const,
    },
    bannerDefaults: {
      bannersEnabled: true,
      bannerPosition: "right" as const,
      bannerBg: "#a57626",
      bannerTextColour: "#ffffff",
    },
  };
}

function buildInstantInput(overrides: Partial<InstantPostInput> = {}): InstantPostInput {

[truncated at line 200 — original has 647 lines]
```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
.agents/skills/obsidian-docs/SKILL.md
.agents/skills/obsidian-docs/references/templates.md
.claude/schema.md
.claude/skills/obsidian-docs/SKILL.md
.claude/skills/obsidian-docs/references/templates.md
AGENTS.md
CLAUDE.md
Obsidian/OJ-CheersAI2.0/API/Route Handlers.md
Obsidian/OJ-CheersAI2.0/API/_API MOC.md
Obsidian/OJ-CheersAI2.0/Architecture/Auth & Security.md
```

## Workspace Conventions (`Cursor/CLAUDE.md`)

```markdown
# CLAUDE.md — Workspace Standards

Shared guidance for Claude Code across all projects. Project-level `CLAUDE.md` files take precedence over this one — always read them first.

## Default Stack

Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS, Supabase (PostgreSQL + Auth + RLS), deployed on Vercel.

## Workspace Architecture

21 projects across three brands, plus shared tooling:

| Prefix | Brand | Examples |
|--------|-------|----------|
| `OJ-` | Orange Jelly | AnchorManagementTools, CheersAI2.0, Planner2.0, MusicBingo, CashBingo, QuizNight, The-Anchor.pub, DukesHeadLeatherhead.com, OrangeJelly.co.uk, WhatsAppVideoCreator |
| `GMI-` | GMI | MixerAI2.0 (canonical auth reference), TheCookbook, ThePantry |
| `BARONS-` | Barons | CareerHub, EventHub, BrunchLaunchAtTheStar, StPatricksDay, DigitalExperienceMockUp, WebsiteContent |
| (none) | Shared / test | Test, oj-planner-app |

## Core Principles

**How to think:**
- **Simplicity First** — make every change as simple as possible; minimal code impact
- **No Laziness** — find root causes; no temporary fixes; senior developer standards
- **Minimal Impact** — only touch what's necessary; avoid introducing bugs

**How to act:**
1. **Do ONLY what is asked** — no unsolicited improvements
2. **Ask ONE clarifying question maximum** — if unclear, proceed with safest minimal implementation
3. **Record EVERY assumption** — document in PR/commit messages
4. **One concern per changeset** — if a second concern emerges, park it
5. **Fail safely** — when in doubt, stop and request human approval

### Source of Truth Hierarchy

1. Project-level CLAUDE.md
2. Explicit task instructions
3. Existing code patterns in the project
4. This workspace CLAUDE.md
5. Industry best practices / framework defaults

## Ethics & Safety

AI MUST stop and request explicit approval before:
- Any operation that could DELETE user data or drop DB columns/tables
- Disabling authentication/authorisation or removing encryption
- Logging, sending, or storing PII in new locations
- Changes that could cause >1 minute downtime
- Using GPL/AGPL code in proprietary projects

## Communication

- When the user asks to "remove" or "clean up" something, clarify whether they mean a code change or a database/data cleanup before proceeding
- Ask ONE clarifying question maximum — if still unclear, proceed with the safest interpretation

## Debugging & Bug Fixes

- When fixing bugs, check the ENTIRE application for related issues, not just the reported area — ask: "Are there other places this same pattern exists?"
- When given a bug report: just fix it — don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Code Changes

- Before suggesting new environment variables or database columns, check existing ones first — use `grep` to find existing env vars and inspect the current schema before proposing additions
- One logical change per commit; one concern per changeset

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### 3. Task Tracking
- Write plan to `tasks/todo.md` with checkable items before starting
- Mark items complete as you go; document results when done

### 4. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake; review lessons at session start

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Run tests, check logs, demonstrate correctness
- Ask yourself: "Would a staff engineer approve this?"
- For non-trivial changes: pause and ask "is there a more elegant way?"

### 6. Codex Integration Hook
Uses OpenAI Codex CLI to audit, test and simulate — catches what Claude misses.

```
when: "running tests OR auditing OR simulating"
do:
  - run_skill(codex-review, target=current_task)
  - compare_outputs(claude_result, codex_result)
  - flag_discrepancies(threshold=medium)
  - merge_best_solution()
```

The full multi-specialist QA review skill lives in `~/.claude/skills/codex-qa-review/`. Trigger with "QA review", "codex review", "second opinion", or "check my work". Deploys four specialist agents (Bug Hunter, Security Auditor, Performance Analyst, Standards Enforcer) into a single prioritised report.

## Common Commands

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run lint      # ESLint (zero warnings enforced)
npm test          # Run tests (Vitest unless noted otherwise)
npm run typecheck # TypeScript type checking (npx tsc --noEmit)
npx supabase db push   # Apply pending migrations (Supabase projects)
```

## Coding Standards

### TypeScript
- No `any` types unless absolutely justified with a comment
- Explicit return types on all exported functions
- Props interfaces must be named (not inline anonymous objects for complex props)
- Use `Promise<{ success?: boolean; error?: string }>` for server action return types

### Frontend / Styling
- Use design tokens only — no hardcoded hex colours in components
- Always consider responsive breakpoints (`sm:`, `md:`, `lg:`)
- No conflicting or redundant class combinations
- Design tokens should live in `globals.css` via `@theme inline` (Tailwind v4) or `tailwind.config.ts`
- **Never use dynamic Tailwind class construction** (e.g., `bg-${color}-500`) — always use static, complete class names due to Tailwind's purge behaviour

### Date Handling
- Always use the project's `dateUtils` (typically `src/lib/dateUtils.ts`) for display
- Never use raw `new Date()` or `.toISOString()` for user-facing dates
- Default timezone: Europe/London
- Key utilities: `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()`

### Phone Numbers
- Always normalise to E.164 format (`+44...`) using `libphonenumber-js`

## Server Actions Pattern

All mutations use `'use server'` functions (typically in `src/app/actions/` or `src/actions/`):

```typescript
'use server';
export async function doSomething(params): Promise<{ success?: boolean; error?: string }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };
  // ... permission check, business logic, audit log ...
  revalidatePath('/path');
  return { success: true };
}
```

## Database / Supabase

See `.claude/rules/supabase.md` for detailed patterns. Key rules:
- DB columns are `snake_case`; TypeScript types are `camelCase`
- Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)
- RLS is always on — use service role client only for system/cron operations
- Two client patterns: cookie-based auth client and service-role admin client

### Before Any Database Work
Before making changes to queries, migrations, server actions, or any code that touches the database, query the live schema for all tables involved:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('relevant_table') ORDER BY ordinal_position;
```
Also check for views referencing those tables — they will break silently if columns change:
```sql
SELECT table_name FROM information_schema.view_table_usage
WHERE table_name IN ('relevant_table');
```

### Migrations
- Always verify migrations don't conflict with existing timestamps
- Test the connection string works before pushing
- PostgreSQL views freeze their column lists — if underlying tables change, views must be recreated
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval

## Git Conventions

See `.claude/rules/pr-and-git-standards.md` for full PR templates, branch naming, and reviewer checklists. Key rules:
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Never force-push to `main`
- One logical change per commit
- Meaningful commit messages explaining "why" not just "what"

## Rules Reference

Core rules (always loaded from `.claude/rules/`):

| File | Read when… |
|------|-----------|
| `ui-patterns.md` | Building or modifying UI components, forms, buttons, navigation, or accessibility |
| `testing.md` | Adding, modifying, or debugging tests; setting up test infrastructure |
| `definition-of-ready.md` | Starting any new feature — check requirements are clear before coding |
| `definition-of-done.md` | Finishing any feature — verify all quality gates pass |
| `complexity-and-incremental-dev.md` | Scoping a task that touches 4+ files or involves schema changes |
| `pr-and-git-standards.md` | Creating branches, writing commit messages, or opening PRs |
| `verification-pipeline.md` | Before pushing — run the full lint → typecheck → test → build pipeline |
| `supabase.md` | Any database query, migration, RLS policy, or client usage |

Domain rules (auto-injected from `.claude/docs/` when you edit relevant files):

| File | Domain |
|------|--------|
| `auth-standard.md` | Auth, sessions, middleware, RBAC, CSRF, password reset, invites |
| `background-jobs.md` | Async job queues, Vercel Cron, retry logic |
| `api-key-auth.md` | External API key generation, validation, rotation |
| `file-export.md` | PDF, DOCX, CSV generation and download |
| `rate-limiting.md` | Upstash rate limiting, 429 responses |
| `qr-codes.md` | QR code generation (client + server) |
| `toast-notifications.md` | Sonner toast patterns |
| `email-notifications.md` | Resend email, templates, audit logging |
| `ai-llm.md` | LLM client, prompts, token tracking, vision |
| `payment-processing.md` | Stripe/PayPal two-phase payment flows |
| `data-tables.md` | TanStack React Table v8 patterns |

## Quality Gates

A feature is only complete when it passes the full Definition of Done checklist (`.claude/rules/definition-of-done.md`). At minimum: builds, lints, type-checks, tests pass, no hardcoded secrets, auth checks in place, code commented where complex.
```

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — CheersAI 2.0

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.2
- **Test runner**: Vitest
- **Database**: Supabase (PostgreSQL + RLS)
- **Key integrations**: OpenAI, Resend Email, Framer Motion animations, React Query, Social media APIs (Instagram, Facebook, Google My Business)
- **Size**: ~158 files in src/

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check (max-warnings=0 in CI)
npm run test             # Vitest run (single pass)
npm run test:watch       # Vitest watch mode
npm run typecheck        # TypeScript check (tsc --noEmit)
npm run ci:verify        # Full CI pipeline: lint + typecheck + test + build
npm run ops:*            # Operational scripts (backfill, link-auth, regenerate derivatives)
```

## Architecture

**Route Structure**: App Router with next.js 16 conventions. Key sections:
- `/auth` — Sign in, sign up, password reset (Supabase JWT + cookies)
- `/dashboard` — Main workspace for authenticated users
- `/api/` — Webhooks and integrations (Instagram, Facebook callbacks)

**Auth**: Supabase Auth with JWT + HTTP-only cookies. Auth context in `src/lib/auth/` provides user state and permissions. All server actions re-verify auth server-side.

**Database**: Supabase PostgreSQL with RLS enabled. Service-role operations for system tasks only (backfills, crons). Client operations use anon-key client.

**Key Integrations**:
- **OpenAI**: `src/lib/` — content generation and AI features
- **Social APIs**: Instagram (webhooks), Facebook (Graph API), Google My Business integrations
- **Resend**: Email notifications and transactional email
- **React Query**: Data fetching with custom hooks in `src/lib/`
- **Framer Motion**: Page transitions and animations

**Data Flow**: Server actions handle mutations (auth, content operations). Client components use React Query for fetching. All responses validated with Zod.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | TypeScript definitions (database, API contracts) |
| `src/lib/auth/` | Authentication, server-side auth helpers, rate limiting |
| `src/lib/publishing/` | Publishing queue and preflight checks |
| `src/lib/scheduling/` | Event conflict detection, scheduling logic |
| `src/lib/planner/` | Data fetching for planner features |
| `src/lib/settings/` | Settings data and user preferences |
| `src/env.ts` | Environment variable validation (Zod) |
| `src/app/api/` | Webhooks (Instagram, Facebook, email) |
| `src/features/` | Feature-specific components and logic |
| `supabase/migrations/` | Database schema migrations |
| `vitest.config.ts` | Vitest configuration |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `OPENAI_API_KEY` | OpenAI API key for content generation |
| `RESEND_API_KEY` | Resend email service key |
| `RESEND_FROM` | Email sender address |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `NEXT_PUBLIC_SITE_URL` | App base URL for redirects/links |
| `FACEBOOK_APP_ID` | Facebook app ID (public) |
| `FACEBOOK_APP_SECRET` | Facebook app secret (server-only) |
| `INSTAGRAM_APP_ID` | Instagram app ID (public) |
| `INSTAGRAM_APP_SECRET` | Instagram app secret (server-only) |
| `INSTAGRAM_VERIFY_TOKEN` | Instagram webhook verification token |
| `GOOGLE_MY_BUSINESS_CLIENT_ID` | Google My Business OAuth client ID |
| `GOOGLE_MY_BUSINESS_CLIENT_SECRET` | Google My Business OAuth secret |
| `ALERTS_SECRET` | Internal webhook secret for alerts |
| `CRON_SECRET` | Internal webhook secret for cron jobs |
| `ENABLE_CONNECTION_DIAGNOSTICS` | Enable debug logging for integrations |
| `VERCEL_OIDC_TOKEN` | Vercel deployment OIDC (for Vercel functions) |

## Project-Specific Rules / Gotchas

### Env Validation
- `src/env.ts` uses Zod to validate all environment variables at startup
- Missing required vars will throw at build/start time
- Always add new vars to `src/env.ts` before using in code

### Social Media Integrations
- Instagram, Facebook, Google My Business require OAuth tokens and refresh logic
- Webhook verification tokens must match config exactly
- Rate limits enforced per platform — check `src/lib/auth/rate-limit.ts`

### Publishing Queue
- `src/lib/publishing/preflight.ts` validates posts before scheduling
- `src/lib/publishing/queue.ts` manages async publishing
- Always check preflight results before queuing posts

### Scheduling Logic
- `src/lib/scheduling/conflicts.ts` prevents double-booking
- `src/lib/scheduling/materialise.ts` expands recurring events
- Timezone handling uses Luxon library (see workspace CLAUDE.md)

### Testing with Vitest
- Test files coexist with source: `src/**/*.test.ts(x)`
- Mock external services (OpenAI, Resend, Supabase)
- Use factories for test data, not inline object literals
- Minimum 80% coverage on business logic

### Framer Motion Usage
- Used for page transitions and micro-interactions
- Keep animations performant (prefer transform, opacity)
- Test animations disabled in unit tests

### Supabase RLS
- All queries respect RLS — use service-role only for system operations
- Service-role operations documented with comments: `// admin operation: [reason]`
- Never disable RLS "temporarily"

### Resend Email
- All transactional email goes through Resend
- Email templates should be tested with `RESEND_API_KEY` set
- From address format: `"Name (email@domain)"`

### Operational Scripts
- `ops:backfill-connections` — sync social connections
- `ops:backfill-link-in-bio-url` — update profile links
- `ops:link-auth-user` — link Supabase auth to business profile
- `ops:regenerate-story-derivatives` — rebuild cached story variants
- Run in test environment first, then production with caution

### CI Pipeline
- `npm run ci:verify` runs full suite: lint → typecheck → test → build
- All four steps must pass before merge
- No console warnings allowed in CI

### Next.js 16 Specifics
- Using latest App Router patterns
- Server actions with 'use server' directive
- Streaming responses supported but not heavily used
- Build optimization enabled by default
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/definition-of-done.md`

```markdown
# Definition of Done (DoD)

A feature is ONLY complete when ALL applicable items pass. This extends the Quality Gates in the root CLAUDE.md.

## Code Quality

- [ ] Builds successfully — `npm run build` with zero errors
- [ ] Linting passes — `npm run lint` with zero warnings
- [ ] Type checks pass — `npx tsc --noEmit` clean (or project equivalent)
- [ ] No `any` types unless justified with a comment
- [ ] No hardcoded secrets or API keys
- [ ] No hardcoded hex colours — use design tokens
- [ ] Server action return types explicitly typed

## Testing

- [ ] All existing tests pass
- [ ] New tests written for business logic (happy path + at least 1 error case)
- [ ] Coverage meets project minimum (default: 80% on business logic)
- [ ] External services mocked — never hit real APIs in tests
- [ ] If no test suite exists yet, note this in the PR as tech debt

## Security

- [ ] Auth checks in place — server actions re-verify server-side
- [ ] Permission checks present — RBAC enforced on both UI and server
- [ ] Input validation complete — all user inputs sanitised (Zod or equivalent)
- [ ] No new PII logging, sending, or storing without approval
- [ ] RLS verified (Supabase projects) — queries respect row-level security

## Accessibility

- [ ] Interactive elements have visible focus styles
- [ ] Colour is not the sole indicator of state
- [ ] Modal dialogs trap focus and close on Escape
- [ ] Tables have proper `<thead>`, `<th scope>` markup
- [ ] Images have meaningful `alt` text
- [ ] Keyboard navigation works for all interactive elements

## Documentation

- [ ] Complex logic commented — future developers can understand "why"
- [ ] README updated if new setup, config, or env vars are needed
- [ ] Environment variables documented in `.env.example`
- [ ] Breaking changes noted in PR description

## Deployment

- [ ] Database migrations tested locally before pushing
- [ ] Rollback plan documented for schema changes
- [ ] No console.log or debug statements left in production code
- [ ] Verification pipeline passes (see `verification-pipeline.md`)
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/supabase.md`

```markdown
# Supabase Conventions

## Client Patterns

Two Supabase client patterns — always use the correct one:

```typescript
// Server-side auth (anon key + cookie session) — use for auth checks:
const supabase = await getSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();

// Server-side data (service-role, bypasses RLS) — use for system/cron operations:
const db = await getDb(); // or createClient() with service role
const { data } = await db.from("table").select("*").eq("id", id).single();

// Browser-only (client components):
const supabase = getSupabaseBrowserClient();
```

ESLint rules should prevent importing the admin/service-role client in client components.

## snake_case ↔ camelCase Conversion

DB columns are always `snake_case`; TypeScript types are `camelCase` with Date objects. Always wrap DB results:

```typescript
import { fromDb } from "@/lib/utils";
const record = fromDb<MyType>(dbRow); // converts snake_case keys + ISO strings → Date
```

All type definitions should live in a central types file (e.g. `src/types/database.ts`).

## Row Level Security (RLS)

- RLS is always enabled on all tables
- Use the anon-key client for user-scoped operations (respects RLS)
- Use the service-role client only for system operations, crons, and webhooks
- Never disable RLS "temporarily" — create a proper service-role path instead

## Migrations

```bash
npx supabase db push          # Apply pending migrations
npx supabase migration new    # Create a new migration file
```

- Migrations live in `supabase/migrations/`
- Full schema reference in `supabase/schema.sql` (paste into SQL Editor for fresh setup)
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval
- Test migrations locally with `npx supabase db push --dry-run` before pushing (see `verification-pipeline.md`)

### Dropping columns or tables — mandatory function audit

When a migration drops a column or table, you MUST search for every function and trigger that references it and update them in the same migration. Failing to do so leaves silent breakage: PL/pgSQL functions that reference a dropped column/table throw an exception at runtime, and if any of those functions have an `EXCEPTION WHEN OTHERS THEN` handler, the error is swallowed and returned as a generic blocked/failure state — making the bug invisible until someone notices the feature is broken.

**Before writing any `DROP COLUMN` or `DROP TABLE`:**

```sql
-- Find all functions that reference the column or table
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_definition ILIKE '%column_or_table_name%'
  AND routine_type = 'FUNCTION';
```

Or search the migrations directory:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -l
```

For each function found: update it in the same migration to remove or replace the reference. Never leave a function referencing infrastructure that no longer exists.

This also applies to **triggers** — check trigger functions separately:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -n
```

## Auth

- Supabase Auth with JWT + HTTP-only cookies
- Auth checks happen in layout files or middleware
- Server actions must always re-verify auth server-side (never rely on UI hiding)
- Public routes must be explicitly allowlisted

## Audit Logging

All mutations (create, update, delete) in server actions must call `logAuditEvent()`:

```typescript
await logAuditEvent({
  user_id: user.id,
  operation_type: 'update',
  resource_type: 'thing',
  operation_status: 'success'
});
```
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/testing.md`

```markdown
# Testing Conventions

## Framework

- **Vitest** is the default test runner (not Jest)
- Test files live alongside source: `src/**/*.test.ts` or in a dedicated `tests/` directory
- **Playwright** for end-to-end testing where configured

## Commands

```bash
npm test              # Run tests once
npm run test:watch    # Watch mode (Vitest)
npm run test:ci       # With coverage report
npx vitest run src/lib/some-module.test.ts  # Run a single test file
```

## Patterns

- Use `describe` blocks grouped by function/component
- Test naming: `it('should [expected behaviour] when [condition]')`
- Prefer testing behaviour over implementation details
- Mock external services (Supabase, OpenAI, Twilio) — never hit real APIs in tests
- Use factories or fixtures for test data, not inline object literals

## Test Prioritisation

When adding tests to a feature, prioritise in this order:
1. **Server actions and business logic** — highest value, most likely to catch real bugs
2. **Data transformation utilities** — date formatting, snake_case conversion, parsers
3. **API route handlers** — input validation, error responses, auth checks
4. **Complex UI interactions** — forms, multi-step flows, conditional rendering
5. **Simple UI wrappers** — lowest priority, skip if time-constrained

Minimum per feature: happy path + at least 1 error/edge case.

## Mock Strategy

- **Always mock**: Supabase client, OpenAI/Azure OpenAI, Twilio, Stripe, PayPal, Microsoft Graph, external HTTP
- **Never mock**: Internal utility functions, date formatting, type conversion helpers
- **Use `vi.mock()`** for module-level mocks; `vi.spyOn()` for targeted function mocks
- Reset mocks between tests: `beforeEach(() => { vi.clearAllMocks() })`

## Coverage

- Business logic and server actions: target 90%
- API routes and data layers: target 80%
- UI components: target 70% (focus on interactive behaviour, not rendering)
- Don't chase coverage on trivial wrappers, type definitions, or config files

## Playwright (E2E)

- Local dev: uses native browser
- Production/CI: uses `BROWSERLESS_URL` env var for remote browser
- E2E tests should be independent (no shared state between tests)
- Use page object models for complex flows
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/ui-patterns.md`

```markdown
# UI Patterns & Component Standards

## Server vs Client Components

- Default to **Server Components** — only add `'use client'` when you need interactivity, hooks, or browser APIs
- Server Components can fetch data directly (no useEffect/useState for data loading)
- Client Components should receive data as props from server parents where possible

## Data Fetching & Display

Every data-driven UI must handle all three states:
1. **Loading** — skeleton loaders or spinners (not blank screens)
2. **Error** — user-facing error message or error boundary
3. **Empty** — meaningful empty state component (not just no content)

## Forms

- Use React Hook Form + Zod for validation where configured
- Validation errors displayed inline, not just console logs
- Required field indicators visible
- Loading/disabled state during submission (prevent double-submit)
- Server action errors surfaced to user via toast or inline message
- Form reset after successful submission where appropriate

## Buttons

Check every button for:
- Consistent variant usage (primary, secondary, destructive, ghost) — no ad-hoc Tailwind-only buttons
- Loading states on async actions (spinner/disabled during server action calls)
- Disabled states when form is invalid or submission in progress
- `type="button"` to prevent accidental form submission (use `type="submit"` only on submit buttons)
- Confirmation dialogs on destructive actions (delete, archive, bulk operations)
- `aria-label` on icon-only buttons

## Navigation

- Breadcrumbs on nested pages
- Active state on current nav item
- Back/cancel navigation returns to correct parent page
- New sections added to project navigation with correct permission gating
- Mobile responsiveness of all nav elements

## Permissions (RBAC)

- Every authenticated page must check permissions via the project's permission helper
- UI elements (edit, delete, create buttons) conditionally rendered based on permissions
- Server actions must re-check permissions server-side (never rely on UI hiding alone)

## Accessibility Baseline

These items are also enforced in the Definition of Done (`definition-of-done.md`):

- Interactive elements have visible focus styles
- Colour is not the only indicator of state
- Modal dialogs trap focus and close on Escape
- Tables use proper `<thead>`, `<th scope>` markup
- Images have meaningful `alt` text
- Keyboard navigation works for all interactive elements
```

---

_End of pack._
