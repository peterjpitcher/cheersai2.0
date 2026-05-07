# Review Pack: banner-overlay-ui

**Generated:** 2026-05-07
**Mode:** B (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/.claude/worktrees/loving-antonelli-8797d7`
**Base ref:** `8f67a9d`
**HEAD:** `ed894b8`
**Diff range:** `8f67a9d...HEAD`
**Stats:**  35 files changed, 1941 insertions(+), 2048 deletions(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
package.json
src/app/(app)/planner/actions.ts
src/app/(app)/settings/actions.ts
src/features/create/generated-content-review-list.tsx
src/features/link-in-bio/public/link-in-bio-public-page.tsx
src/features/planner/banner-controls.tsx
src/features/planner/banner-overlay-preview.tsx
src/features/planner/banner-overlay.test.tsx
src/features/planner/banner-overlay.tsx
src/features/planner/banner-rendered-preview.tsx
src/features/planner/planner-calendar.tsx
src/features/planner/planner-content-composer.tsx
src/features/planner/use-banner-prerender.ts
src/features/settings/posting-defaults-form.tsx
src/features/settings/schema.ts
src/lib/banner/config.ts
src/lib/create/service.ts
src/lib/link-in-bio/public.ts
src/lib/link-in-bio/types.ts
src/lib/planner/data.ts
src/lib/scheduling/banner-canvas.test.ts
src/lib/scheduling/banner-canvas.ts
src/lib/scheduling/banner-config.ts
src/lib/scheduling/banner-renderer.server.ts
src/lib/scheduling/campaign-timing.ts
src/lib/settings/data.ts
tests/app/internal/render-banner-route.test.ts
tests/features/settings/schema.test.ts
tests/lib/create/banner-override.test.ts
tests/lib/scheduling/banner-renderer.server.test.ts
tests/lib/scheduling/campaign-timing.test.ts
tests/publish-queue-banner-label.test.ts
tests/publish-queue.test.ts
tests/setup.ts
tests/supabase/publish-queue/banner-label.test.ts
```

## User Concerns

UI side of banner overlay impl. BannerOverlay SVG, planner data fetcher with override-column reads + posting_defaults, composer, calendar, link-in-bio public, simplified BannerControls (Zod server action), settings page banner-defaults form. Concerns: null-handling when label is null; resolver fallback semantics; legacy previews not imported; UI never bypasses the server action.

## Diff (`8f67a9d...HEAD`)

```diff
diff --git a/package.json b/package.json
index f5836d7..0190988 100644
--- a/package.json
+++ b/package.json
@@ -18,7 +18,6 @@
     "ops:invoke": "tsx scripts/ops/invoke-function.ts",
     "ops:link-auth-user": "tsx scripts/ops/link-auth-user.ts",
     "ops:regenerate-story-derivatives": "tsx scripts/ops/regenerate-story-derivatives.ts",
-    "ops:repair-banners": "tsx scripts/ops/repair-banner-overlays.ts",
     "ops:search-meta-interests": "tsx scripts/ops/search-meta-interests.ts"
   },
   "dependencies": {
@@ -53,6 +52,7 @@
   "devDependencies": {
     "@eslint/eslintrc": "^3",
     "@tailwindcss/postcss": "^4",
+    "@testing-library/jest-dom": "^6.9.1",
     "@testing-library/react": "^16.3.2",
     "@types/luxon": "^3.7.1",
     "@types/node": "^25",
diff --git a/src/app/(app)/planner/actions.ts b/src/app/(app)/planner/actions.ts
index 4190f58..a4d6748 100644
--- a/src/app/(app)/planner/actions.ts
+++ b/src/app/(app)/planner/actions.ts
@@ -1,6 +1,5 @@
 "use server";
 
-import crypto from "node:crypto";
 import { revalidatePath } from "next/cache";
 import { z } from "zod";
 
@@ -9,18 +8,11 @@ import { DateTime } from "luxon";
 import { enqueuePublishJob } from "@/lib/publishing/queue";
 import { getPublishReadinessIssues } from "@/lib/publishing/preflight";
 import { requireAuthContext } from "@/lib/auth/server";
-import { DEFAULT_TIMEZONE, MEDIA_BUCKET } from "@/lib/constants";
-import { BannerConfigSchema, BANNER_EDITABLE_STATUSES, parseBannerConfig, type BannerConfig } from "@/lib/scheduling/banner-config";
-import { renderBannerForContent, resetBannerStateForContent, resolveBannerLabel } from "@/lib/scheduling/banner-renderer.server";
-import { createServiceSupabaseClient } from "@/lib/supabase/service";
+import { DEFAULT_TIMEZONE } from "@/lib/constants";
+import { BANNER_EDITABLE_STATUSES } from "@/lib/scheduling/banner-config";
 
 const approveSchema = z.object({
   contentId: z.string().uuid(),
-  bannerStoragePath: z.string().optional(),
-  bannerLabel: z.string().optional(),
-  bannerScheduledAt: z.string().optional(),
-  bannerSourceMediaPath: z.string().optional(),
-  bannerRenderMetadata: z.record(z.string(), z.unknown()).optional(),
 });
 
 const dismissSchema = z.object({
@@ -101,7 +93,7 @@ export async function approveDraftContent(payload: unknown) {
 
   const { data: content, error } = await supabase
     .from("content_items")
-    .select("id, status, scheduled_for, account_id, placement, platform, prompt_context, campaign_id, campaigns(campaign_type, metadata)")
+    .select("id, status, scheduled_for, account_id, placement, platform")
     .eq("id", contentId)
     .eq("account_id", accountId)
     .maybeSingle<{
@@ -111,12 +103,6 @@ export async function approveDraftContent(payload: unknown) {
       account_id: string;
       placement: "feed" | "story" | null;
       platform: "facebook" | "instagram" | "gbp";
-      prompt_context: Record<string, unknown> | null;
-      campaign_id: string | null;
-      campaigns: {
-        campaign_type: string | null;
-        metadata: Record<string, unknown> | null;
-      } | null;
     }>();
 
   if (error) {
@@ -144,105 +130,6 @@ export async function approveDraftContent(payload: unknown) {
     return { error: readinessIssues.map((issue) => issue.message).join(" ") } as const;
   }
 
-  // --- Banner validation ---
-  const bannerConfig = parseBannerConfig(content.prompt_context);
-  let bannerState: string = "none";
-  let bannerUpdatePayload: Record<string, unknown> | null = null;
-
-  if (bannerConfig?.enabled) {
-    const { data: variantBanner, error: variantBannerError } = await supabase
-      .from("content_variants")
-      .select("id, banner_state, bannered_media_path")
-      .eq("content_item_id", contentId)
-      .order("updated_at", { ascending: false })
-      .limit(1)
-      .maybeSingle<{ id: string; banner_state: string | null; bannered_media_path: string | null }>();
-
-    if (variantBannerError) {
-      throw variantBannerError;
-    }
-
-    const expectedLabel = resolveBannerLabel({
-      bannerConfig,
-      scheduledFor: content.scheduled_for,
-      campaign: content.campaigns,
-    });
-
-    if (parsed.bannerStoragePath) {
-      // Validate path belongs to this content item
-      if (!parsed.bannerStoragePath.startsWith(`banners/${contentId}/`)) {
-        return { error: "Invalid banner storage path" } as const;
-      }
-
-      // Verify file exists in storage
-      const pathParts = parsed.bannerStoragePath.split("/");
-      const fileName = pathParts.pop();
-      const dirPath = pathParts.join("/");
-
-      const serviceClient = createServiceSupabaseClient();
-      const { data: fileList } = await serviceClient.storage
-        .from(MEDIA_BUCKET)
-        .list(dirPath, { search: fileName });
-
-      if (!fileList?.length) {
-        return { error: "Banner file not found in storage" } as const;
-      }
-
-      if (expectedLabel && parsed.bannerLabel !== expectedLabel) {
-        // Clean up the uploaded file
-        const cleanupClient = createServiceSupabaseClient();
-        await cleanupClient.storage.from(MEDIA_BUCKET).remove([parsed.bannerStoragePath]);
-        return { error: "Banner label is stale — re-render required" } as const;
-      }
-
-      bannerState = "rendered";
-      bannerUpdatePayload = {
-        banner_state: bannerState,
-        bannered_media_path: parsed.bannerStoragePath,
-        banner_label: parsed.bannerLabel ?? null,
-        banner_rendered_for_scheduled_at: parsed.bannerScheduledAt ?? null,
-        banner_source_media_path: parsed.bannerSourceMediaPath ?? null,
-        banner_render_metadata: parsed.bannerRenderMetadata ?? null,
-      };
-    } else if (expectedLabel) {
-      if (!variantBanner || variantBanner.banner_state !== "rendered" || !variantBanner.bannered_media_path) {
-        return { error: "Banner rendering required before approval" } as const;
-      }
-      bannerState = "rendered";
-    } else {
-      bannerState = "not_applicable";
-      if (variantBanner) {
-        bannerUpdatePayload = {
-          banner_state: bannerState,
-          bannered_media_path: null,
-          banner_label: null,
-          banner_rendered_for_scheduled_at: null,
-          banner_source_media_path: null,
-          banner_render_metadata: null,
-        };
-      }
-    }
-  }
-
-  if (bannerConfig?.enabled && bannerState === "rendered") {
-    const { data: renderedVariant, error: renderedError } = await supabase
-      .from("content_variants")
-      .select("id, banner_state, bannered_media_path")
-      .eq("content_item_id", contentId)
-      .eq("banner_state", "rendered")
-      .not("bannered_media_path", "is", null)
-      .limit(1)
-      .maybeSingle<{ id: string }>();
-
-    if (renderedError) {
-      throw renderedError;
-    }
-
-    if (!parsed.bannerStoragePath && !renderedVariant) {
-      return { error: "Banner rendering required before approval" } as const;
-    }
-  }
-
   const scheduledFor = content.scheduled_for ? new Date(content.scheduled_for) : null;
   const nowIso = new Date().toISOString();
 
@@ -255,19 +142,6 @@ export async function approveDraftContent(payload: unknown) {
     throw updateError;
   }
 
-  // Update content_variants with banner metadata only when approval produced new metadata
-  // or when the state must be normalised to not_applicable.
-  if (bannerUpdatePayload) {
-    const { error: bannerUpdateError } = await supabase
-      .from("content_variants")
-      .update({ ...bannerUpdatePayload, updated_at: nowIso })
-      .eq("content_item_id", contentId);
-
-    if (bannerUpdateError) {
-      throw bannerUpdateError;
-    }
-  }
-
   const { data: existingJob } = await supabase
     .from("publish_jobs")
     .select("id")
@@ -499,7 +373,8 @@ export async function updatePlannerContentMedia(payload: unknown) {
     throw updateError;
   }
 
-  await resetBannerStateForContent({ contentId, accountId, supabase });
+  // Banners are derived at publish time, so changing media no longer requires
+  // resetting any persisted banner state.
 
   revalidatePath(`/planner/${contentId}`);
   revalidatePath("/planner");
@@ -576,22 +451,6 @@ export async function restorePlannerContent(payload: unknown) {
 
       const scheduledFor = content.scheduled_for ? new Date(content.scheduled_for) : null;
 
-      try {
-        await renderBannerForContent({ contentId, variantId: variantRow.id, accountId, supabase });
-      } catch (error) {
-        await resetBannerStateForContent({ contentId, variantId: variantRow.id, accountId, supabase });
-        await supabase.from("notifications").insert({
-          account_id: accountId,
-          category: "banner_invalidated",
-          message: "Post restored but banner rendering is required before publish.",
-          metadata: {
-            contentId,
-            error: error instanceof Error ? error.message : String(error),
-          },
-        });
-        throw error;
-      }
-
       await enqueuePublishJob({
         contentItemId: contentId,
         variantId: variantRow.id,
@@ -966,43 +825,6 @@ export async function updatePlannerContentSchedule(payload: unknown) {
     throw updateError;
   }
 
-  try {
-    await renderBannerForContent({ contentId, accountId, supabase });
-  } catch (error) {
-    await resetBannerStateForContent({ contentId, accountId, supabase });
-    await supabase
-      .from("publish_jobs")
-      .update({
-        status: "failed",
-        next_attempt_at: null,
-        last_error: error instanceof Error ? error.message : String(error),
-        updated_at: nowIso,
-      })
-      .eq("content_item_id", contentId)
-      .in("status", ["queued"]);
-
-    if (content.status !== "draft") {
-      await supabase
-        .from("content_items")
-        .update({ status: "draft", updated_at: nowIso })
-        .eq("id", contentId);
-    }
-
-    await supabase.from("notifications").insert({
-      account_id: content.account_id,
-      category: "banner_invalidated",
-      message: "Schedule changed but banner rendering failed; post needs review before publish.",
-      metadata: {
-        contentId,
-        error: error instanceof Error ? error.message : String(error),
-      },
-    });
-
-    revalidatePath(`/planner/${contentId}`);
-    revalidatePath("/planner");
-    return { error: "Banner rendering failed; post left unqueued for review." } as const;
-  }
-
   const { data: jobRows, error: jobUpdateError } = await supabase
     .from("publish_jobs")
     .update({
@@ -1084,17 +906,31 @@ export async function createPlannerContent(payload: unknown) {
   };
 }
 
+const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;
+const BANNER_POSITION_ENUM = z.enum(["top", "bottom", "left", "right"]);
+
+const updateBannerSchema = z.object({
+  contentItemId: z.string().uuid(),
+  enabled: z.boolean().nullable(),
+  position: BANNER_POSITION_ENUM.nullable(),
+  bgColour: z.string().regex(HEX_COLOUR).nullable(),
+  textColour: z.string().regex(HEX_COLOUR).nullable(),
+  textOverride: z.string().max(20).nullable(),
+});
+
+export type UpdatePlannerBannerConfigInput = z.input<typeof updateBannerSchema>;
+
 export async function updatePlannerBannerConfig(
-  contentItemId: string,
-  config: BannerConfig,
+  input: unknown,
 ): Promise<{ success?: boolean; error?: string }> {
-  const parsed = BannerConfigSchema.parse(config);
+  const data = updateBannerSchema.parse(input);
   const { supabase, accountId } = await requireAuthContext();
 
+  // Ownership check: confirm content item belongs to this account and is editable.
   const { data: content, error: fetchError } = await supabase
     .from("content_items")
-    .select("id, account_id, status, prompt_context")
-    .eq("id", contentItemId)
+    .select("id, account_id, status")
+    .eq("id", data.contentItemId)
     .eq("account_id", accountId)
     .maybeSingle();
 
@@ -1110,91 +946,24 @@ export async function updatePlannerBannerConfig(
     return { error: "This post can no longer be edited." };
   }
 
-  // Safe JSON merge: preserve existing prompt_context keys, only set .banner
-  const existingContext =
-    content.prompt_context && typeof content.prompt_context === "object"
-      ? (content.prompt_context as Record<string, unknown>)
-      : {};
-
-  const updatedContext = {
-    ...existingContext,
-    banner: parsed,
-  };
-
-  const nowIso = new Date().toISOString();
-  const { error: updateError } = await supabase
-    .from("content_items")
-    .update({ prompt_context: updatedContext, updated_at: nowIso })
-    .eq("id", contentItemId);
-
-  if (updateError) {
-    return { error: updateError.message };
-  }
+  const { error } = await supabase
+    .from("content_variants")
+    .update({
+      banner_enabled: data.enabled,
+      banner_position: data.position,
+      banner_bg: data.bgColour,
+      banner_text_colour: data.textColour,
+      banner_text_override: data.textOverride,
+    })
+    .eq("content_item_id", data.contentItemId);
 
-  try {
-    await resetBannerStateForContent({ contentId: contentItemId, accountId, supabase });
-  } catch (error) {
-    return { error: error instanceof Error ? error.message : "Failed to invalidate banner state" };
+  if (error) {
+    return { error: error.message };
   }
 
   revalidatePath("/planner");
+  revalidatePath(`/planner/${data.contentItemId}`);
 
   return { success: true };
 }
 
-const bannerUploadSchema = z.object({
-  contentItemId: z.string().uuid(),
-});
-
-const renderBannerSchema = z.object({
-  contentId: z.string().uuid(),
-  variantId: z.string().uuid().optional(),
-});
-
-export async function renderPlannerContentBanner(payload: unknown) {
-  const parsed = renderBannerSchema.parse(payload);
-  const { accountId } = await requireAuthContext();
-
-  const result = await renderBannerForContent({
-    contentId: parsed.contentId,
-    variantId: parsed.variantId,
-    accountId,
-  });
-
-  revalidatePath(`/planner/${parsed.contentId}`);
-  revalidatePath("/planner");
-
-  return result;
-}
-
-export async function createBannerUploadUrl(
-  payload: unknown,
-): Promise<{ signedUrl: string; storagePath: string } | { error: string }> {
-  const { contentItemId } = bannerUploadSchema.parse(payload);
-  const { accountId } = await requireAuthContext();
-  const supabase = createServiceSupabaseClient();
-
-  // Verify user owns this content item
-  const { data: item, error: itemError } = await supabase
-    .from("content_items")
-    .select("id, account_id")
-    .eq("id", contentItemId)
-    .eq("account_id", accountId)
-    .maybeSingle();
-
-  if (itemError || !item) {
-    return { error: "Content item not found" };
-  }
-
-  const storagePath = `banners/${contentItemId}/${crypto.randomUUID()}.jpg`;
-
-  const { data, error: uploadError } = await supabase.storage
-    .from(MEDIA_BUCKET)
-    .createSignedUploadUrl(storagePath);
-
-  if (uploadError || !data?.signedUrl) {
-    return { error: "Failed to create upload URL" };
-  }
-
-  return { signedUrl: data.signedUrl, storagePath };
-}
diff --git a/src/app/(app)/settings/actions.ts b/src/app/(app)/settings/actions.ts
index f3fad9f..78c2f74 100644
--- a/src/app/(app)/settings/actions.ts
+++ b/src/app/(app)/settings/actions.ts
@@ -151,6 +151,10 @@ export async function updatePostingDefaults(formData: unknown) {
         gbp_cta_standard: parsed.gbpCtaDefaults.standard,
         gbp_cta_event: parsed.gbpCtaDefaults.event,
         gbp_cta_offer: parsed.gbpCtaDefaults.offer,
+        banners_enabled: parsed.bannerDefaults.bannersEnabled,
+        banner_position: parsed.bannerDefaults.bannerPosition,
+        banner_bg: parsed.bannerDefaults.bannerBg,
+        banner_text_colour: parsed.bannerDefaults.bannerTextColour,
       },
       { onConflict: "account_id" },
     )
diff --git a/src/features/create/generated-content-review-list.tsx b/src/features/create/generated-content-review-list.tsx
index b15e536..b9ec71d 100644
--- a/src/features/create/generated-content-review-list.tsx
+++ b/src/features/create/generated-content-review-list.tsx
@@ -21,8 +21,7 @@ import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils
 import { closeMediaSwapModalAndRefresh } from "@/features/create/media-swap-utils";
 import type { MediaAssetSummary } from "@/lib/library/data";
 import type { PlannerContentDetail } from "@/lib/planner/data";
-import { renderPlannerContentBanner, updatePlannerContentBody } from "@/app/(app)/planner/actions";
-import { parseBannerConfig } from "@/lib/scheduling/banner-config";
+import { updatePlannerContentBody } from "@/app/(app)/planner/actions";
 import { useToast } from "@/components/providers/toast-provider";
 
 type Platform = PlannerContentDetail["platform"];
@@ -399,11 +398,8 @@ function GeneratedContentCard({ item, accent, onRequestMedia, onRefresh, isRefre
                   await updatePlannerContentBody({ contentId: item.id, body: trimmed });
                   setIsDirty(false);
                 }
-
-                const bannerConfig = parseBannerConfig(item.promptContext);
-                if (bannerConfig?.enabled) {
-                  await renderPlannerContentBanner({ contentId: item.id });
-                }
+                // Banners are now rendered at publish time by the queue worker;
+                // approval no longer triggers a render.
               }}
             />
           )}
diff --git a/src/features/link-in-bio/public/link-in-bio-public-page.tsx b/src/features/link-in-bio/public/link-in-bio-public-page.tsx
index dbb2c06..80a2cc0 100644
--- a/src/features/link-in-bio/public/link-in-bio-public-page.tsx
+++ b/src/features/link-in-bio/public/link-in-bio-public-page.tsx
@@ -1,6 +1,6 @@
 import Image from "next/image";
 
-import { BannerOverlayPreview } from "@/features/planner/banner-overlay-preview";
+import { BannerOverlay } from "@/features/planner/banner-overlay";
 import type { PublicLinkInBioPageData } from "@/lib/link-in-bio/types";
 import { LinkInBioRefreshTimer } from "./link-in-bio-refresh-timer";
 
@@ -166,32 +166,34 @@ export function LinkInBioPublicPage({ data }: { data: PublicLinkInBioPageData })
             <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
               {data.campaigns.map((campaign) => {
                 const campaignDims = getMediaDimensions(campaign.media?.shape);
+                const resolvedConfig = campaign.bannerConfig ?? null;
                 const body = (
                   <>
                     <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-2">
                       {campaign.media ? (
-                        <Image
-                          src={campaign.media.url}
-                          alt={campaign.name}
-                          width={campaignDims.width}
-                          height={campaignDims.height}
-                          className="mx-auto h-auto w-full rounded-xl object-contain"
-                          unoptimized
-                          sizes="(min-width: 1024px) 320px, 100vw"
-                        />
+                        resolvedConfig && campaign.bannerLabel ? (
+                          <BannerOverlay
+                            mediaUrl={campaign.media.url}
+                            config={resolvedConfig}
+                            label={campaign.bannerLabel}
+                            className="mx-auto h-auto w-full rounded-xl"
+                          />
+                        ) : (
+                          <Image
+                            src={campaign.media.url}
+                            alt={campaign.name}
+                            width={campaignDims.width}
+                            height={campaignDims.height}
+                            className="mx-auto h-auto w-full rounded-xl object-contain"
+                            unoptimized
+                            sizes="(min-width: 1024px) 320px, 100vw"
+                          />
+                        )
                       ) : (
                         <div className="flex min-h-[160px] items-center justify-center rounded-2xl bg-white/10 text-base font-semibold text-white/70">
                           {campaign.name.slice(0, 2).toUpperCase()}
                         </div>
                       )}
-                      {campaign.bannerLabel && campaign.bannerPosition && campaign.bannerBgColour && campaign.bannerTextColour && (
-                        <BannerOverlayPreview
-                          label={campaign.bannerLabel}
-                          position={campaign.bannerPosition}
-                          bgColour={campaign.bannerBgColour}
-                          textColour={campaign.bannerTextColour}
-                        />
-                      )}
                     </div>
                     <div className="mt-3 text-left">
                       <p className="text-base font-semibold text-white">{campaign.name}</p>
diff --git a/src/features/planner/banner-controls.tsx b/src/features/planner/banner-controls.tsx
index 52ec85b..b7f3fa9 100644
--- a/src/features/planner/banner-controls.tsx
+++ b/src/features/planner/banner-controls.tsx
@@ -2,25 +2,22 @@
 
 import { useState } from "react";
 import { useToast } from "@/components/providers/toast-provider";
+import { BANNER_EDITABLE_STATUSES } from "@/lib/scheduling/banner-config";
 import {
-  BANNER_POSITIONS,
-  BANNER_COLOURS,
-  BANNER_COLOUR_HEX,
-  sanitiseCustomMessage,
-  BANNER_EDITABLE_STATUSES,
-  type BannerConfig,
+  bannerConfigResolver,
+  type AccountBannerDefaults,
   type BannerPosition,
-  type BannerColourId,
-} from "@/lib/scheduling/banner-config";
+  type PostBannerOverrides,
+  type ResolvedConfig,
+} from "@/lib/banner/config";
 import { updatePlannerBannerConfig } from "@/app/(app)/planner/actions";
 
-interface BannerControlsProps {
-  contentItemId: string;
-  status: string;
-  bannerConfig: BannerConfig | null;
-  autoLabel: string | null;
-  onUpdate?: (config: BannerConfig) => void;
-}
+const BANNER_POSITIONS: readonly BannerPosition[] = [
+  "top",
+  "bottom",
+  "left",
+  "right",
+];
 
 const POSITION_LABELS: Record<BannerPosition, string> = {
   top: "Top",
@@ -29,10 +26,31 @@ const POSITION_LABELS: Record<BannerPosition, string> = {
   right: "Right",
 };
 
+interface BannerControlsProps {
+  contentItemId: string;
+  status: string;
+  accountDefaults: AccountBannerDefaults;
+  overrides: PostBannerOverrides;
+  autoLabel: string | null;
+  onUpdate?: (config: ResolvedConfig) => void;
+}
+
+const HEX = /^#[0-9A-Fa-f]{6}$/;
+
+function sanitiseTextOverride(value: string): string | null {
+  // Strip control characters, trim, uppercase. Returns null when empty.
+  const cleaned = value
+    .replace(/[\n\r\t\x00-\x1f\x7f]/g, "")
+    .trim()
+    .toUpperCase();
+  return cleaned.length === 0 ? null : cleaned.slice(0, 20);
+}
+
 export function BannerControls({
   contentItemId,
   status,
-  bannerConfig,
+  accountDefaults,
+  overrides,
   autoLabel,
   onUpdate,
 }: BannerControlsProps): React.ReactElement {
@@ -41,40 +59,66 @@ export function BannerControls({
   const isEditable = (BANNER_EDITABLE_STATUSES as readonly string[]).includes(status);
   const isLocked = saving || !isEditable;
 
-  const config = bannerConfig ?? {
-    schemaVersion: 1 as const,
-    enabled: false,
-    position: "top" as const,
-    bgColour: "gold" as const,
-    textColour: "green" as const,
-  };
-
-  const [customMsg, setCustomMsg] = useState(config.customMessage ?? "");
+  // Local override state mirrors what's in the database; resolves through the
+  // shared resolver so the preview matches what BannerOverlay will render.
+  const [localOverrides, setLocalOverrides] = useState<PostBannerOverrides>(overrides);
+  const resolved = bannerConfigResolver(accountDefaults, localOverrides);
+  const [textOverrideDraft, setTextOverrideDraft] = useState<string>(
+    localOverrides.banner_text_override ?? "",
+  );
 
-  async function save(partial: Partial<BannerConfig>): Promise<void> {
+  async function persist(next: PostBannerOverrides): Promise<void> {
     if (isLocked) return;
-    const updated: BannerConfig = { ...config, ...partial, schemaVersion: 1 };
-    const previous = { ...config };
-    // Optimistic: update preview immediately
-    onUpdate?.(updated);
     setSaving(true);
+    const previous = localOverrides;
+    setLocalOverrides(next);
+    onUpdate?.(bannerConfigResolver(accountDefaults, next));
     try {
-      const result = await updatePlannerBannerConfig(contentItemId, updated);
+      const result = await updatePlannerBannerConfig({
+        contentItemId,
+        enabled: next.banner_enabled,
+        position: next.banner_position,
+        bgColour: next.banner_bg,
+        textColour: next.banner_text_colour,
+        textOverride: next.banner_text_override,
+      });
       if (result && "error" in result && result.error) {
         toast.error("Failed to save banner settings.");
-        // Revert optimistic update
-        onUpdate?.(previous);
+        setLocalOverrides(previous);
+        onUpdate?.(bannerConfigResolver(accountDefaults, previous));
       }
     } catch {
       toast.error("Failed to save banner settings.");
-      // Revert optimistic update
-      onUpdate?.(previous);
+      setLocalOverrides(previous);
+      onUpdate?.(bannerConfigResolver(accountDefaults, previous));
     } finally {
       setSaving(false);
     }
   }
 
-  const graphemeCount = customMsg.length;
+  function setEnabled(value: boolean): void {
+    void persist({ ...localOverrides, banner_enabled: value });
+  }
+
+  function setPosition(value: BannerPosition): void {
+    void persist({ ...localOverrides, banner_position: value });
+  }
+
+  function setBgColour(value: string): void {
+    if (!HEX.test(value)) return;
+    void persist({ ...localOverrides, banner_bg: value });
+  }
+
+  function setTextColour(value: string): void {
+    if (!HEX.test(value)) return;
+    void persist({ ...localOverrides, banner_text_colour: value });
+  }
+
+  function commitTextOverride(): void {
+    const sanitised = sanitiseTextOverride(textOverrideDraft);
+    setTextOverrideDraft(sanitised ?? "");
+    void persist({ ...localOverrides, banner_text_override: sanitised });
+  }
 
   return (
     <div className="space-y-3 rounded-lg border p-4">
@@ -83,17 +127,18 @@ export function BannerControls({
         <label className="flex items-center gap-2">
           <input
             type="checkbox"
-            checked={config.enabled}
+            checked={resolved.enabled}
             disabled={isLocked}
-            onChange={(e) => void save({ enabled: e.target.checked })}
+            onChange={(e) => setEnabled(e.target.checked)}
+            aria-label="Toggle proximity banner"
           />
           <span className="text-xs text-muted-foreground">
-            {config.enabled ? "On" : "Off"}
+            {resolved.enabled ? "On" : "Off"}
           </span>
         </label>
       </div>
 
-      {config.enabled && (
+      {resolved.enabled ? (
         <>
           {/* Position picker */}
           <div>
@@ -105,11 +150,11 @@ export function BannerControls({
                   type="button"
                   disabled={isLocked}
                   className={`rounded px-3 py-1 text-xs font-medium ${
-                    config.position === pos
+                    resolved.position === pos
                       ? "bg-primary text-primary-foreground"
                       : "bg-muted text-muted-foreground"
                   }`}
-                  onClick={() => void save({ position: pos })}
+                  onClick={() => setPosition(pos)}
                 >
                   {POSITION_LABELS[pos]}
                 </button>
@@ -117,49 +162,39 @@ export function BannerControls({
             </div>
           </div>
 
-          {/* Background colour */}
+          {/* Background colour picker */}
           <div>
             <span className="text-xs text-muted-foreground">Background</span>
-            <div className="mt-1 flex gap-1">
-              {BANNER_COLOURS.map((colour) => (
-                <button
-                  key={colour.id}
-                  type="button"
-                  disabled={isLocked}
-                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
-                    config.bgColour === colour.id ? "ring-2 ring-primary ring-offset-1" : ""
-                  }`}
-                  style={{
-                    backgroundColor: colour.hex,
-                    borderColor: colour.id === "white" ? "#d1d5db" : colour.hex,
-                  }}
-                  title={colour.label}
-                  onClick={() => void save({ bgColour: colour.id as BannerColourId })}
-                />
-              ))}
+            <div className="mt-1 flex items-center gap-2">
+              <input
+                type="color"
+                value={resolved.bgColour}
+                disabled={isLocked}
+                onChange={(e) => setBgColour(e.target.value)}
+                aria-label="Banner background colour"
+                className="h-8 w-12 cursor-pointer rounded border"
+              />
+              <span className="text-xs uppercase tracking-wide text-muted-foreground">
+                {resolved.bgColour}
+              </span>
             </div>
           </div>
 
-          {/* Text colour */}
+          {/* Text colour picker */}
           <div>
             <span className="text-xs text-muted-foreground">Text</span>
-            <div className="mt-1 flex gap-1">
-              {BANNER_COLOURS.map((colour) => (
-                <button
-                  key={colour.id}
-                  type="button"
-                  disabled={isLocked}
-                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
-                    config.textColour === colour.id ? "ring-2 ring-primary ring-offset-1" : ""
-                  }`}
-                  style={{
-                    backgroundColor: colour.hex,
-                    borderColor: colour.id === "white" ? "#d1d5db" : colour.hex,
-                  }}
-                  title={colour.label}
-                  onClick={() => void save({ textColour: colour.id as BannerColourId })}
-                />
-              ))}
+            <div className="mt-1 flex items-center gap-2">
+              <input
+                type="color"
+                value={resolved.textColour}
+                disabled={isLocked}
+                onChange={(e) => setTextColour(e.target.value)}
+                aria-label="Banner text colour"
+                className="h-8 w-12 cursor-pointer rounded border"
+              />
+              <span className="text-xs uppercase tracking-wide text-muted-foreground">
+                {resolved.textColour}
+              </span>
             </div>
           </div>
 
@@ -169,11 +204,11 @@ export function BannerControls({
             <div
               className="flex h-6 items-center rounded px-3 text-[10px] font-bold uppercase tracking-wider"
               style={{
-                backgroundColor: BANNER_COLOUR_HEX[config.bgColour],
-                color: BANNER_COLOUR_HEX[config.textColour],
+                backgroundColor: resolved.bgColour,
+                color: resolved.textColour,
               }}
             >
-              {customMsg || autoLabel || "SAMPLE"}
+              {resolved.textOverride || autoLabel || "SAMPLE"}
             </div>
           </div>
 
@@ -187,23 +222,19 @@ export function BannerControls({
                 type="text"
                 maxLength={20}
                 placeholder={autoLabel ?? "Auto-generated"}
-                value={customMsg}
+                value={textOverrideDraft}
                 disabled={isLocked}
                 className="flex-1 rounded border px-2 py-1 text-sm uppercase"
-                onChange={(e) => setCustomMsg(e.target.value)}
-                onBlur={() => {
-                  const sanitised = sanitiseCustomMessage(customMsg);
-                  setCustomMsg(sanitised ?? "");
-                  void save({ customMessage: sanitised });
-                }}
+                onChange={(e) => setTextOverrideDraft(e.target.value)}
+                onBlur={commitTextOverride}
               />
               <span className="self-center text-xs text-muted-foreground">
-                {graphemeCount}/20
+                {textOverrideDraft.length}/20
               </span>
             </div>
           </div>
         </>
-      )}
+      ) : null}
     </div>
   );
 }
diff --git a/src/features/planner/banner-overlay-preview.tsx b/src/features/planner/banner-overlay-preview.tsx
deleted file mode 100644
index d58a9a8..0000000
--- a/src/features/planner/banner-overlay-preview.tsx
+++ /dev/null
@@ -1,65 +0,0 @@
-"use client";
-
-import { resolveColours, type BannerColourId, type BannerPosition } from "@/lib/scheduling/banner-config";
-
-interface BannerOverlayPreviewProps {
-  label: string;
-  position: BannerPosition;
-  bgColour: BannerColourId;
-  textColour: BannerColourId;
-  className?: string;
-}
-
-/** Repeat label with separators to fill the bar edge-to-edge */
-function continuousLabel(label: string, count: number = 8): string {
-  return Array(count).fill(label).join("  ·  ");
-}
-
-export function BannerOverlayPreview({ label, position, bgColour, textColour, className = "" }: BannerOverlayPreviewProps): React.ReactElement {
-  const colours = resolveColours({ bgColour, textColour });
-  const isVertical = position === "left" || position === "right";
-
-  const barStyle: React.CSSProperties = {
-    position: "absolute",
-    backgroundColor: colours.bg,
-    color: colours.text,
-    display: "flex",
-    alignItems: "center",
-    fontWeight: 800,
-    textTransform: "uppercase",
-    letterSpacing: "0.12em",
-    zIndex: 10,
-    overflow: "hidden",
-    boxSizing: "border-box",
-    ...(isVertical
-      ? {
-          top: -2,
-          bottom: -2,
-          width: "8%",
-          minWidth: 28,
-          justifyContent: "flex-start",
-          writingMode: "vertical-rl" as const,
-          ...(position === "left"
-            ? { left: -2, transform: "rotate(180deg)" }
-            : { right: -2 }),
-          fontSize: "0.7rem",
-        }
-      : {
-          left: -2,
-          right: -2,
-          height: "8%",
-          minHeight: 24,
-          justifyContent: "flex-start",
-          ...(position === "top" ? { top: -2 } : { bottom: -2 }),
-          fontSize: "0.8rem",
-        }),
-  };
-
-  return (
-    <div style={barStyle} className={className}>
-      <span style={{ whiteSpace: "nowrap" }}>
-        {continuousLabel(label)}
-      </span>
-    </div>
-  );
-}
diff --git a/src/features/planner/banner-overlay.test.tsx b/src/features/planner/banner-overlay.test.tsx
new file mode 100644
index 0000000..1e80493
--- /dev/null
+++ b/src/features/planner/banner-overlay.test.tsx
@@ -0,0 +1,71 @@
+// @vitest-environment jsdom
+// src/features/planner/banner-overlay.test.tsx
+import { describe, it, expect } from 'vitest';
+import { render, screen } from '@testing-library/react';
+import { BannerOverlay } from '@/features/planner/banner-overlay';
+
+const baseConfig = {
+  enabled: true,
+  position: 'bottom' as const,
+  bgColour: '#000000',
+  textColour: '#FFFFFF',
+  textOverride: null,
+};
+
+describe('<BannerOverlay />', () => {
+  it('renders nothing when config.enabled is false', () => {
+    const { container } = render(
+      <BannerOverlay
+        mediaUrl="/x.jpg"
+        config={{ ...baseConfig, enabled: false }}
+        label="THIS WEDNESDAY"
+      />,
+    );
+    expect(container.querySelector('[data-banner-overlay]')).toBeNull();
+  });
+
+  it('renders nothing when label is null and no override', () => {
+    const { container } = render(
+      <BannerOverlay
+        mediaUrl="/x.jpg"
+        config={baseConfig}
+        label={null}
+      />,
+    );
+    expect(container.querySelector('[data-banner-overlay]')).toBeNull();
+  });
+
+  it('renders override text when set even with null label', () => {
+    render(
+      <BannerOverlay
+        mediaUrl="/x.jpg"
+        config={{ ...baseConfig, textOverride: 'BANK HOLIDAY' }}
+        label={null}
+      />,
+    );
+    expect(screen.getByText('BANK HOLIDAY')).toBeInTheDocument();
+  });
+
+  it('renders computed label when override is empty', () => {
+    render(
+      <BannerOverlay
+        mediaUrl="/x.jpg"
+        config={baseConfig}
+        label="THIS WEDNESDAY"
+      />,
+    );
+    expect(screen.getByText('THIS WEDNESDAY')).toBeInTheDocument();
+  });
+
+  it('positions strip at top when position=top', () => {
+    render(
+      <BannerOverlay
+        mediaUrl="/x.jpg"
+        config={{ ...baseConfig, position: 'top' }}
+        label="TODAY"
+      />,
+    );
+    const strip = screen.getByText('TODAY').closest('[data-banner-overlay]')!;
+    expect(strip).toHaveAttribute('data-position', 'top');
+  });
+});
diff --git a/src/features/planner/banner-overlay.tsx b/src/features/planner/banner-overlay.tsx
new file mode 100644
index 0000000..7de608c
--- /dev/null
+++ b/src/features/planner/banner-overlay.tsx
@@ -0,0 +1,48 @@
+// src/features/planner/banner-overlay.tsx
+'use client';
+
+import type { ResolvedConfig } from '@/lib/banner/config';
+
+type Props = {
+  mediaUrl: string;
+  config: ResolvedConfig;
+  label: string | null;
+  className?: string;
+};
+
+const positionClasses: Record<ResolvedConfig['position'], string> = {
+  top: 'top-0 left-0 right-0 h-[8%] flex-row',
+  bottom: 'bottom-0 left-0 right-0 h-[8%] flex-row',
+  left: 'top-0 bottom-0 left-0 w-[8%] flex-col',
+  right: 'top-0 bottom-0 right-0 w-[8%] flex-col',
+};
+
+export function BannerOverlay({ mediaUrl, config, label, className }: Props) {
+  const text =
+    config.textOverride && config.textOverride.length > 0
+      ? config.textOverride
+      : label;
+  const visible = config.enabled && text != null && text.length > 0;
+
+  return (
+    <div className={`relative ${className ?? ''}`}>
+      {/* eslint-disable-next-line @next/next/no-img-element */}
+      <img src={mediaUrl} alt="" className="block w-full h-full object-cover" />
+      {visible ? (
+        <div
+          data-banner-overlay
+          data-position={config.position}
+          className={`absolute ${positionClasses[config.position]} flex items-center justify-center`}
+          style={{ backgroundColor: config.bgColour, color: config.textColour }}
+        >
+          <span
+            className="font-bold tracking-wide text-[clamp(0.75rem,2.5vw,1.5rem)]"
+            aria-label={text!}
+          >
+            {text}
+          </span>
+        </div>
+      ) : null}
+    </div>
+  );
+}
diff --git a/src/features/planner/banner-rendered-preview.tsx b/src/features/planner/banner-rendered-preview.tsx
deleted file mode 100644
index 372b48d..0000000
--- a/src/features/planner/banner-rendered-preview.tsx
+++ /dev/null
@@ -1,145 +0,0 @@
-"use client";
-
-import { useEffect, useRef, useState } from "react";
-
-import { renderBannerCanvas, type BannerCanvasInput } from "@/lib/scheduling/banner-canvas";
-import type { BannerColourId, BannerPosition } from "@/lib/scheduling/banner-config";
-
-interface BannerRenderedPreviewProps {
-  imageUrl: string | null;
-  position: BannerPosition;
-  bgColour: BannerColourId;
-  textColour: BannerColourId;
-  labelText: string | null;
-  className?: string;
-}
-
-const DEBOUNCE_MS = 300;
-
-export function BannerRenderedPreview({
-  imageUrl,
-  position,
-  bgColour,
-  textColour,
-  labelText,
-  className,
-}: BannerRenderedPreviewProps): React.ReactElement | null {
-  const [blobUrl, setBlobUrl] = useState<string | null>(null);
-  const [isLoading, setIsLoading] = useState(false);
-  const [error, setError] = useState<string | null>(null);
-
-  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
-  const currentBlobRef = useRef<string | null>(null);
-
-  // Clean up a blob URL and clear the ref
-  const revokeCurrent = (): void => {
-    if (currentBlobRef.current) {
-      URL.revokeObjectURL(currentBlobRef.current);
-      currentBlobRef.current = null;
-    }
-  };
-
-  useEffect(() => {
-    // Nothing to render — reset state
-    if (!imageUrl || !labelText) {
-      revokeCurrent();
-      queueMicrotask(() => {
-        setBlobUrl(null);
-        setIsLoading(false);
-        setError(null);
-      });
-      return;
-    }
-
-    // Clear any pending debounce
-    if (debounceRef.current) {
-      clearTimeout(debounceRef.current);
-    }
-
-    // eslint-disable-next-line react-hooks/set-state-in-effect
-    setIsLoading(true);
-    setError(null);
-
-    debounceRef.current = setTimeout(() => {
-      const input: BannerCanvasInput = {
-        imageUrl,
-        position,
-        bgColour,
-        textColour,
-        labelText,
-      };
-
-      let cancelled = false;
-
-      renderBannerCanvas(input)
-        .then((blob) => {
-          if (cancelled) return;
-          revokeCurrent();
-          const url = URL.createObjectURL(blob);
-          currentBlobRef.current = url;
-          setBlobUrl(url);
-          setIsLoading(false);
-        })
-        .catch((err) => {
-          if (cancelled) return;
-          revokeCurrent();
-          setBlobUrl(null);
-          setError(err instanceof Error ? err.message : "Banner rendering failed");
-          setIsLoading(false);
-        });
-
-      // Cleanup for this specific render attempt
-      return () => {
-        cancelled = true;
-      };
-    }, DEBOUNCE_MS);
-
-    // Cleanup on effect re-run or unmount
-    return () => {
-      if (debounceRef.current) {
-        clearTimeout(debounceRef.current);
-        debounceRef.current = null;
-      }
-    };
-  }, [imageUrl, position, bgColour, textColour, labelText]);
-
-  // Clean up blob URL on unmount
-  useEffect(() => {
-    return () => {
-      revokeCurrent();
-    };
-  }, []);
-
-  if (!imageUrl || !labelText) return null;
-
-  if (isLoading) {
-    return (
-      <div className={className}>
-        <div className="flex items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-6">
-          <p className="text-sm text-slate-500">Rendering banner&hellip;</p>
-        </div>
-      </div>
-    );
-  }
-
-  if (error) {
-    return (
-      <div className={className}>
-        <div className="flex items-center justify-center rounded-md border border-dashed border-rose-300 bg-rose-50 p-6">
-          <p className="text-sm text-rose-600">{error}</p>
-        </div>
-      </div>
-    );
-  }
-
-  if (!blobUrl) return null;
-
-  return (
-    // eslint-disable-next-line @next/next/no-img-element
-    <img
-      src={blobUrl}
-      alt="Banner preview"
-      className={className}
-    />
-  );
-}
diff --git a/src/features/planner/planner-calendar.tsx b/src/features/planner/planner-calendar.tsx
index 7b0d6ee..9a4578a 100644
--- a/src/features/planner/planner-calendar.tsx
+++ b/src/features/planner/planner-calendar.tsx
@@ -20,7 +20,7 @@ import {
 import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
 import { PlannerViewToggle } from "./planner-view-toggle";
 import { AddToCalendarButton, CreateWeeklyPlanButton } from "@/features/planner/planner-interaction-components";
-import { BannerOverlayPreview } from "@/features/planner/banner-overlay-preview";
+import { BannerOverlay } from "@/features/planner/banner-overlay";
 
 const PLATFORM_STYLES: Record<string, string> = {
   facebook: "bg-brand-blue/10 text-brand-blue border border-brand-blue/30",
@@ -264,13 +264,11 @@ export async function PlannerCalendar({ month, statusFilters, showImages = true
                               {showImages && item.mediaPreview ? (
                                 <div className={`relative w-full overflow-hidden border-b border-brand-mist/40 bg-brand-mist/10 ${item.placement === "story" ? "aspect-[9/16]" : "aspect-square"}`}>
                                   {item.mediaPreview.mediaType === "image" ? (
-                                    // eslint-disable-next-line @next/next/no-img-element
-                                    <img
-                                      src={item.mediaPreview.url}
-                                      alt="Scheduled media preview"
-                                      className="pointer-events-none h-full w-full object-contain"
-                                      loading="lazy"
-                                      draggable={false}
+                                    <BannerOverlay
+                                      mediaUrl={item.mediaPreview.url}
+                                      config={item.bannerConfig}
+                                      label={item.bannerLabel}
+                                      className="pointer-events-none h-full w-full"
                                     />
                                   ) : (
                                     <video
@@ -280,14 +278,6 @@ export async function PlannerCalendar({ month, statusFilters, showImages = true
                                       muted
                                     />
                                   )}
-                                  {item.bannerLabel && item.bannerPosition && item.bannerBgColour && item.bannerTextColour && (
-                                    <BannerOverlayPreview
-                                      label={item.bannerLabel}
-                                      position={item.bannerPosition}
-                                      bgColour={item.bannerBgColour}
-                                      textColour={item.bannerTextColour}
-                                    />
-                                  )}
                                   <span className="absolute left-2 top-2 z-20 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-brand-teal shadow">
                                     {occursLabel}
                                   </span>
diff --git a/src/features/planner/planner-content-composer.tsx b/src/features/planner/planner-content-composer.tsx
index bad0004..4bfaf48 100644
--- a/src/features/planner/planner-content-composer.tsx
+++ b/src/features/planner/planner-content-composer.tsx
@@ -23,16 +23,18 @@ import {
 
 import { updatePlannerContentBody } from "@/app/(app)/planner/actions";
 import { ApproveDraftButton } from "@/features/planner/approve-draft-button";
-import { BannerRenderedPreview } from "@/features/planner/banner-rendered-preview";
-import { useBannerPrerender } from "./use-banner-prerender";
+import { BannerOverlay } from "@/features/planner/banner-overlay";
 import { BannerControls } from "@/features/planner/banner-controls";
+// useBannerPrerender removed: <BannerOverlay /> renders the strip live; the
+// publish worker composes the final image at send time via renderBannerServer.
 import { PlannerContentMediaEditor } from "@/features/planner/content-media-editor";
 import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
 import { useToast } from "@/components/providers/toast-provider";
 import { Button } from "@/components/ui/button";
 import type { MediaAssetSummary } from "@/lib/library/data";
 import type { PlannerContentDetail } from "@/lib/planner/data";
-import { parseBannerConfig, type BannerConfig } from "@/lib/scheduling/banner-config";
+import type { ResolvedConfig } from "@/lib/banner/config";
+import { useNowMinute } from "@/lib/hooks/use-now-minute";
 import { extractCampaignTiming } from "@/lib/scheduling/campaign-timing";
 import { getProximityLabel } from "@/lib/scheduling/proximity-label";
 
@@ -87,7 +89,6 @@ export function PlannerContentComposer({ detail, ownerTimezone, mediaLibrary }:
   const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
   const [isSavingCopy, startSaveCopyTransition] = useTransition();
   const [isRefreshing, startRefreshTransition] = useTransition();
-  const { prerenderBanner } = useBannerPrerender();
 
   useEffect(() => {
     if (!isMediaModalOpen) return;
@@ -115,26 +116,29 @@ export function PlannerContentComposer({ detail, ownerTimezone, mediaLibrary }:
   const primaryMedia = detail.media[0] ?? null;
 
   // --- Banner config & proximity label ---
-  const [bannerOverride, setBannerOverride] = useState<BannerConfig | null>(null);
-  const bannerConfig = bannerOverride ?? parseBannerConfig(detail.promptContext);
+  // Re-render every minute so the live label refreshes on minute/hour/day boundaries.
+  const nowMinute = useNowMinute();
+  const [bannerOverride, setBannerOverride] = useState<ResolvedConfig | null>(null);
+  const bannerConfig: ResolvedConfig = bannerOverride ?? detail.bannerConfig;
 
   const bannerLabel = useMemo(() => {
-    if (!bannerConfig?.enabled) return null;
-    if (bannerConfig.customMessage) return bannerConfig.customMessage;
-    if (!detail.campaign?.campaignType || !detail.campaign?.metadata) return null;
+    if (!bannerConfig.enabled) return null;
+    if (!detail.campaign?.campaignType || !detail.campaign?.metadata) {
+      return detail.bannerLabel;
+    }
     try {
       const timing = extractCampaignTiming({
         campaign_type: detail.campaign.campaignType,
         metadata: detail.campaign.metadata,
       });
       const refAt = detail.scheduledFor
-        ? DateTime.fromISO(detail.scheduledFor, { zone: "utc" })
-        : DateTime.now();
+        ? DateTime.fromISO(detail.scheduledFor, { zone: "Europe/London" })
+        : DateTime.fromJSDate(nowMinute).setZone("Europe/London");
       return getProximityLabel({ referenceAt: refAt, campaignTiming: timing });
     } catch {
-      return null;
+      return detail.bannerLabel;
     }
-  }, [bannerConfig, detail.campaign, detail.scheduledFor]);
+  }, [bannerConfig.enabled, detail.campaign, detail.scheduledFor, detail.bannerLabel, nowMinute]);
 
   const mediaAspectClass = isStory
     ? "mx-auto max-w-[360px] aspect-[9/16]"
@@ -225,11 +229,11 @@ export function PlannerContentComposer({ detail, ownerTimezone, mediaLibrary }:
           <div className={clsx("relative overflow-hidden rounded-2xl border", theme.frame, mediaAspectClass)}>
             {primaryMedia ? (
               primaryMedia.mediaType === "image" ? (
-                // eslint-disable-next-line @next/next/no-img-element
-                <img
-                  src={primaryMedia.url}
-                  alt={primaryMedia.fileName ?? "Post media"}
-                  className="h-full w-full object-contain"
+                <BannerOverlay
+                  mediaUrl={primaryMedia.url}
+                  config={bannerConfig}
+                  label={bannerLabel}
+                  className="h-full w-full"
                 />
               ) : (
                 <video
@@ -247,17 +251,6 @@ export function PlannerContentComposer({ detail, ownerTimezone, mediaLibrary }:
               </div>
             )}
 
-            {bannerConfig?.enabled && bannerLabel && primaryMedia?.url ? (
-              <BannerRenderedPreview
-                imageUrl={primaryMedia.url}
-                position={bannerConfig.position}
-                bgColour={bannerConfig.bgColour}
-                textColour={bannerConfig.textColour}
-                labelText={bannerLabel}
-                className="absolute inset-0 z-10 h-full w-full rounded-md object-cover"
-              />
-            ) : null}
-
             <div className="absolute right-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-2">
               <span className="shrink-0 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 shadow-sm">
                 {detail.media.length} asset{detail.media.length === 1 ? "" : "s"}
@@ -279,7 +272,8 @@ export function PlannerContentComposer({ detail, ownerTimezone, mediaLibrary }:
           <BannerControls
             contentItemId={detail.id}
             status={status}
-            bannerConfig={bannerConfig}
+            accountDefaults={detail.accountBannerDefaults}
+            overrides={detail.bannerOverrides}
             autoLabel={bannerLabel}
             onUpdate={setBannerOverride}
           />
@@ -384,26 +378,8 @@ export function PlannerContentComposer({ detail, ownerTimezone, mediaLibrary }:
                       setBaseline(trimmed);
                       setBody(trimmed);
                     }
-
-                    // --- Banner pre-render before approval ---
-                    if (bannerConfig?.enabled) {
-                      const bannerResult = await prerenderBanner({
-                        contentItemId: detail.id,
-                        bannerConfig,
-                        scheduledFor: detail.scheduledFor,
-                        campaign: detail.campaign ? {
-                          campaignType: detail.campaign.campaignType,
-                          metadata: detail.campaign.metadata,
-                        } : null,
-                        sourceImageUrl: detail.media[0]?.url ?? null,
-                        sourceMediaPath: null,
-                        placement: detail.placement,
-                      });
-
-                      if (bannerResult && typeof bannerResult === "object" && "error" in bannerResult) {
-                        throw new Error(bannerResult.error);
-                      }
-                    }
+                    // No banner pre-render — the publish worker composes the
+                    // final image at send time via renderBannerServer.
                   }}
                 />
               ) : (
diff --git a/src/features/planner/use-banner-prerender.ts b/src/features/planner/use-banner-prerender.ts
deleted file mode 100644
index b912d76..0000000
--- a/src/features/planner/use-banner-prerender.ts
+++ /dev/null
@@ -1,75 +0,0 @@
-"use client";
-
-import { useCallback, useRef, useState } from "react";
-import type { BannerConfig } from "@/lib/scheduling/banner-config";
-import { renderPlannerContentBanner } from "@/app/(app)/planner/actions";
-
-export interface PrerenderedBanner {
-  storagePath: string;
-  label: string;
-  scheduledAt: string;
-  sourceMediaPath: string;
-  renderMetadata: Record<string, unknown>;
-}
-
-export interface PrerenderInput {
-  contentItemId: string;
-  bannerConfig: BannerConfig | null;
-  scheduledFor: string | null;
-  campaign: {
-    campaignType: string | null;
-    metadata: Record<string, unknown> | null;
-  } | null;
-  sourceImageUrl: string | null;
-  sourceMediaPath: string | null;
-  placement: "feed" | "story";
-}
-
-export function useBannerPrerender(): {
-  prerenderBanner: (input: PrerenderInput) => Promise<PrerenderedBanner | "not_applicable" | { error: string }>;
-  isRendering: boolean;
-} {
-  const renderingRef = useRef(false);
-  const [isRendering, setIsRendering] = useState(false);
-
-  const prerenderBanner = useCallback(
-    async (input: PrerenderInput): Promise<PrerenderedBanner | "not_applicable" | { error: string }> => {
-      if (renderingRef.current) {
-        return { error: "Banner render already in progress" };
-      }
-
-      const { contentItemId, bannerConfig } = input;
-
-      // No banner configured
-      if (!bannerConfig?.enabled) {
-        return "not_applicable";
-      }
-
-      renderingRef.current = true;
-      setIsRendering(true);
-
-      try {
-        const result = await renderPlannerContentBanner({ contentId: contentItemId });
-        if (result.status === "not_applicable" || result.status === "skipped") {
-          return "not_applicable";
-        }
-
-        return {
-          storagePath: result.storagePath,
-          label: result.label,
-          scheduledAt: result.scheduledAt ?? new Date().toISOString(),
-          sourceMediaPath: result.sourceMediaPath,
-          renderMetadata: result.renderMetadata,
-        };
-      } catch (error) {
-        return { error: error instanceof Error ? error.message : "Banner render failed" };
-      } finally {
-        renderingRef.current = false;
-        setIsRendering(false);
-      }
-    },
-    [],
-  );
-
-  return { prerenderBanner, isRendering };
-}
diff --git a/src/features/settings/posting-defaults-form.tsx b/src/features/settings/posting-defaults-form.tsx
index 763a254..4f43105 100644
--- a/src/features/settings/posting-defaults-form.tsx
+++ b/src/features/settings/posting-defaults-form.tsx
@@ -41,6 +41,7 @@ export function PostingDefaultsForm({ data }: PostingDefaultsFormProps) {
       venueLongitude: data.venueLongitude?.toString() ?? "",
       notifications: data.notifications,
       gbpCtaDefaults: data.gbpCtaDefaults,
+      bannerDefaults: data.bannerDefaults,
     },
   });
 
@@ -248,6 +249,134 @@ export function PostingDefaultsForm({ data }: PostingDefaultsFormProps) {
           />
         </div>
       </fieldset>
+      <fieldset className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
+        <legend className="text-lg font-semibold text-slate-900">
+          Banner defaults
+        </legend>
+        <p className="mb-4 text-sm text-slate-500">
+          Account-wide defaults for the proximity banner that appears over post
+          imagery. Per-post overrides take precedence when set.
+        </p>
+        <div className="grid gap-4 md:grid-cols-2">
+          <Controller
+            control={form.control}

[diff truncated at line 1500 — total was 4964 lines. Consider scoping the review to fewer files.]
```

## Changed File Contents

### `package.json`

```
{
  "name": "cheersai-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build --webpack",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest",
    "lint:ci": "eslint --max-warnings=0",
    "typecheck": "tsc --noEmit",
    "test:ci": "CI=1 vitest run",
    "ci:verify": "npm run lint:ci && npm run typecheck && npm run test:ci && npm run build",
    "ops:backfill-connections": "tsx scripts/ops/backfill-connections.ts",
    "ops:repair-gbp-location-ids": "tsx scripts/ops/repair-gbp-location-ids.ts",
    "ops:backfill-link-in-bio-url": "tsx scripts/ops/backfill-link-in-bio-url.ts",
    "ops:invoke": "tsx scripts/ops/invoke-function.ts",
    "ops:link-auth-user": "tsx scripts/ops/link-auth-user.ts",
    "ops:regenerate-story-derivatives": "tsx scripts/ops/regenerate-story-derivatives.ts",
    "ops:search-meta-interests": "tsx scripts/ops/search-meta-interests.ts"
  },
  "dependencies": {
    "@hookform/resolvers": "^5.2.2",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-label": "^2.1.8",
    "@radix-ui/react-separator": "^1.1.8",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-tooltip": "^1.2.8",
    "@supabase/ssr": "^0.8.0",
    "@supabase/supabase-js": "^2.89.0",
    "@tanstack/react-query": "^5.90.12",
    "@tanstack/react-query-devtools": "^5.91.1",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "dotenv": "^17.2.3",
    "framer-motion": "^12.23.26",
    "lucide-react": "^0.562.0",
    "luxon": "^3.7.2",
    "next": "16.1.0",
    "openai": "^6.15.0",
    "p-limit": "^7.3.0",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-hook-form": "^7.69.0",
    "resend": "^6.6.0",
    "sharp": "^0.34.5",
    "tailwind-merge": "^3.4.0",
    "tailwindcss-animate": "^1.0.7",
    "zod": "^4.2.1"
  },
  "devDependencies": {
    "@eslint/eslintrc": "^3",
    "@tailwindcss/postcss": "^4",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/luxon": "^3.7.1",
    "@types/node": "^25",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.1.0",
    "jsdom": "^29.1.1",
    "tailwindcss": "^4",
    "tsx": "^4.21.0",
    "typescript": "^5",
    "vitest": "^4.0.16"
  },
  "optionalDependencies": {
    "lightningcss-darwin-arm64": "^1.30.2"
  }
}
```

### `src/app/(app)/planner/actions.ts`

```
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { DateTime } from "luxon";

import { enqueuePublishJob } from "@/lib/publishing/queue";
import { getPublishReadinessIssues } from "@/lib/publishing/preflight";
import { requireAuthContext } from "@/lib/auth/server";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { BANNER_EDITABLE_STATUSES } from "@/lib/scheduling/banner-config";

const approveSchema = z.object({
  contentId: z.string().uuid(),
});

const dismissSchema = z.object({
  notificationId: z.string().uuid(),
});

const deleteSchema = z.object({
  contentId: z.string().uuid(),
});

const restoreSchema = z.object({
  contentId: z.string().uuid(),
});

const permanentDeleteSchema = z.object({
  contentId: z.string().uuid(),
});

const permanentDeleteAllSchema = z.object({});

const updateMediaSchema = z.object({
  contentId: z.string().uuid(),
  media: z
    .array(
      z.object({
        assetId: z.string().uuid(),
      }),
    )
    .min(1, "At least one media asset required"),
});

const updateBodySchema = z.object({
  contentId: z.string().uuid(),
  body: z.string().max(10_000, "Keep the post under 10k characters"),
});

const updateScheduleSchema = z.object({
  contentId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Provide a date in YYYY-MM-DD format"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Provide a time in HH:MM format"),
});

const createSchema = z.object({
  platform: z.enum(["facebook", "instagram", "gbp"]),
  placement: z.enum(["feed", "story"]),
});

const SLOT_INCREMENT_MINUTES = 30;
const MINUTES_PER_DAY = 24 * 60;

function reservePlannerSlotOnSameDay({
  desiredSlot,
  timezone,
  occupiedMinutes,
}: {
  desiredSlot: DateTime;
  timezone: string;
  occupiedMinutes: Set<number>;
}) {
  const startOfDay = desiredSlot.setZone(timezone).startOf("day");
  let minuteOfDay = desiredSlot.hour * 60 + desiredSlot.minute;

  while (occupiedMinutes.has(minuteOfDay)) {
    minuteOfDay += SLOT_INCREMENT_MINUTES;
    if (minuteOfDay >= MINUTES_PER_DAY) {
      throw new Error("No open 30-minute slots remain on that day for this channel.");
    }
  }

  return startOfDay.plus({ minutes: minuteOfDay }).startOf("minute");
}


export async function approveDraftContent(payload: unknown) {
  const parsed = approveSchema.parse(payload);
  const { contentId } = parsed;
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error } = await supabase
    .from("content_items")
    .select("id, status, scheduled_for, account_id, placement, platform")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle<{
      id: string;
      status: string;
      scheduled_for: string | null;
      account_id: string;
      placement: "feed" | "story" | null;
      platform: "facebook" | "instagram" | "gbp";
    }>();

  if (error) {
    throw error;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  if (content.status !== "draft") {
    revalidatePath("/planner");
    return { status: content.status, scheduledFor: content.scheduled_for ?? null } as const;
  }

  const readinessIssues = await getPublishReadinessIssues({
    supabase,
    accountId,
    contentId,
    platform: content.platform,
    placement: content.placement ?? "feed",
  });

  if (readinessIssues.length) {
    return { error: readinessIssues.map((issue) => issue.message).join(" ") } as const;
  }

  const scheduledFor = content.scheduled_for ? new Date(content.scheduled_for) : null;
  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("content_items")
    .update({ status: "scheduled", updated_at: nowIso })
    .eq("id", contentId);

  if (updateError) {
    throw updateError;
  }

  const { data: existingJob } = await supabase
    .from("publish_jobs")
    .select("id")
    .eq("content_item_id", contentId)
    .limit(1)
    .maybeSingle();

  if (!existingJob) {
    const { data: variantRow, error: variantError } = await supabase
      .from("content_variants")
      .select("id")
      .eq("content_item_id", contentId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (variantError) {
      throw variantError;
    }

    if (!variantRow) {
      throw new Error("Variant missing for content item");
    }

    await enqueuePublishJob({
      contentItemId: contentId,
      variantId: variantRow.id,
      placement: content.placement ?? undefined,
      scheduledFor,
    });
  }

  const scheduledIso = scheduledFor ? scheduledFor.toISOString() : null;

  const { error: notificationError } = await supabase
    .from("notifications")
    .insert({
      account_id: accountId,
      category: "content_approved",
      message: scheduledIso
        ? `Draft approved and scheduled for ${new Date(scheduledIso).toLocaleString()}`
        : "Draft approved and queued to publish",
      metadata: {
        contentId,
        scheduledFor: scheduledIso,
      },
    });

  if (notificationError) {
    console.error("[planner] failed to insert approval notification", notificationError);
  }

  revalidatePath("/planner");

  return {
    status: "scheduled" as const,

[truncated at line 200 — original has 969 lines]
```

### `src/app/(app)/settings/actions.ts`

```
"use server";

import { revalidatePath } from "next/cache";

import {
  brandProfileFormSchema,
  managementConnectionFormSchema,
  postingDefaultsFormSchema,
  linkInBioProfileFormSchema,
  linkInBioTileFormSchema,
  linkInBioTileReorderSchema,
} from "@/features/settings/schema";
import { requireAuthContext } from "@/lib/auth/server";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  createLinkInBioTile,
  deleteLinkInBioTile,
  reorderLinkInBioTiles,
  updateLinkInBioTile,
  upsertLinkInBioProfile,
} from "@/lib/link-in-bio/profile";
import { listManagementEvents, ManagementApiError } from "@/lib/management-app/client";
import {
  getManagementConnectionConfig,
  saveManagementConnection,
  updateManagementConnectionTestResult,
} from "@/lib/management-app/data";

export async function updateBrandProfile(formData: unknown) {
  const parsed = brandProfileFormSchema.parse(formData);
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  await supabase
    .from("brand_profile")
    .upsert(
      {
        account_id: accountId,
        tone_formal: parsed.toneFormal,
        tone_playful: parsed.tonePlayful,
        key_phrases: parsed.keyPhrases,
        banned_topics: parsed.bannedTopics,
        banned_phrases: parsed.bannedPhrases,
        default_hashtags: parsed.defaultHashtags,
        default_emojis: parsed.defaultEmojis,
        instagram_signature: parsed.instagramSignature,
        facebook_signature: parsed.facebookSignature,
        gbp_cta: parsed.gbpCta,
      },
      { onConflict: "account_id" },
    )
    .throwOnError();

  revalidatePath("/settings");
}

export async function updateLinkInBioProfileSettings(formData: unknown) {
  const parsed = linkInBioProfileFormSchema.parse(formData);

  await upsertLinkInBioProfile({
    slug: parsed.slug,
    displayName: parsed.displayName ?? null,
    bio: parsed.bio ?? null,
    heroMediaId: parsed.heroMediaId ?? null,
    theme: {
      primaryColor: parsed.theme.primaryColor,
      secondaryColor: parsed.theme.secondaryColor,
    },
    phoneNumber: parsed.phoneNumber ?? null,
    whatsappNumber: parsed.whatsappNumber ?? null,
    bookingUrl: parsed.bookingUrl ?? null,
    menuUrl: parsed.menuUrl ?? null,
    parkingUrl: parsed.parkingUrl ?? null,
    directionsUrl: parsed.directionsUrl ?? null,
    facebookUrl: parsed.facebookUrl ?? null,
    instagramUrl: parsed.instagramUrl ?? null,
    websiteUrl: parsed.websiteUrl ?? null,
  });

  revalidatePath("/settings");
}

export async function upsertLinkInBioTileSettings(formData: unknown) {
  const parsed = linkInBioTileFormSchema.parse(formData);

  if (parsed.id) {
    await updateLinkInBioTile(parsed.id, {
      title: parsed.title,
      subtitle: parsed.subtitle ?? null,
      ctaLabel: parsed.ctaLabel,
      ctaUrl: parsed.ctaUrl,
      mediaAssetId: parsed.mediaAssetId ?? null,
      enabled: parsed.enabled,
    });
  } else {
    await createLinkInBioTile({
      title: parsed.title,
      subtitle: parsed.subtitle ?? null,
      ctaLabel: parsed.ctaLabel,
      ctaUrl: parsed.ctaUrl,
      mediaAssetId: parsed.mediaAssetId ?? null,
      enabled: parsed.enabled,
    });
  }

  revalidatePath("/settings");
}

export async function removeLinkInBioTile(tileId: string) {
  await deleteLinkInBioTile(tileId);
  revalidatePath("/settings");
}

export async function reorderLinkInBioTilesSettings(formData: unknown) {
  const parsed = linkInBioTileReorderSchema.parse(formData);
  await reorderLinkInBioTiles({ tileIdsInOrder: parsed.tileIds });
  revalidatePath("/settings");
}

export async function updatePostingDefaults(formData: unknown) {
  const parsed = postingDefaultsFormSchema.parse(formData);
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();
  const venueLocation = parsed.venueLocation?.trim() || null;
  const venueLatitude = parseOptionalCoordinate(parsed.venueLatitude);
  const venueLongitude = parseOptionalCoordinate(parsed.venueLongitude);

  await supabase
    .from("accounts")
    .update({ timezone: DEFAULT_TIMEZONE })
    .eq("id", accountId)
    .throwOnError();

  await supabase
    .from("posting_defaults")
    .upsert(
      {
        account_id: accountId,
        facebook_location_id: parsed.facebookLocationId ?? null,
        instagram_location_id: parsed.instagramLocationId ?? null,
        gbp_location_id: parsed.gbpLocationId ?? null,
        default_posting_time: parsed.defaultPostingTime ?? null,
        venue_location: venueLocation,
        venue_latitude: venueLatitude,
        venue_longitude: venueLongitude,
        notifications: {
          emailFailures: parsed.notifications.emailFailures,
          emailTokenExpiring: parsed.notifications.emailTokenExpiring,
        },
        gbp_cta_standard: parsed.gbpCtaDefaults.standard,
        gbp_cta_event: parsed.gbpCtaDefaults.event,
        gbp_cta_offer: parsed.gbpCtaDefaults.offer,
        banners_enabled: parsed.bannerDefaults.bannersEnabled,
        banner_position: parsed.bannerDefaults.bannerPosition,
        banner_bg: parsed.bannerDefaults.bannerBg,
        banner_text_colour: parsed.bannerDefaults.bannerTextColour,
      },
      { onConflict: "account_id" },
    )
    .throwOnError();

  revalidatePath("/settings");
}

function parseOptionalCoordinate(value: string | null | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function updateManagementConnectionSettings(formData: unknown) {
  const parsed = managementConnectionFormSchema.parse(formData);
  const summary = await saveManagementConnection({
    baseUrl: parsed.baseUrl,
    apiKey: parsed.apiKey,
    enabled: parsed.enabled,
  });

  revalidatePath("/settings");
  return summary;
}

export async function testManagementConnectionSettings() {
  try {
    const config = await getManagementConnectionConfig();
    await listManagementEvents(config, { limit: 1 });
    const summary = await updateManagementConnectionTestResult({
      status: "ok",
      message: "Connection test succeeded.",
    });

    revalidatePath("/settings");
    return {
      ok: true as const,
      message: "Connection test succeeded.",
      summary,
    };
  } catch (error) {

[truncated at line 200 — original has 242 lines]
```

### `src/features/create/generated-content-review-list.tsx`

```
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { DateTime } from "luxon";
import clsx from "clsx";
import { Bookmark, CalendarDays, CheckCircle2, Clock3, Heart, Layers, Loader2, MessageCircle, RefreshCw, Undo2, X } from "lucide-react";

import { ApproveDraftButton } from "@/features/planner/approve-draft-button";
import { PlannerContentMediaEditor } from "@/features/planner/content-media-editor";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
import { closeMediaSwapModalAndRefresh } from "@/features/create/media-swap-utils";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerContentDetail } from "@/lib/planner/data";
import { updatePlannerContentBody } from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";

type Platform = PlannerContentDetail["platform"];

const PLATFORM_ORDER: Platform[] = ["facebook", "instagram", "gbp"];

const PLATFORM_ACCENTS: Record<Platform, { badge: string; dot: string }> = {
  facebook: { badge: "bg-[#E8F1FF] text-[#1B4DB1]", dot: "bg-[#1B4DB1]" },
  instagram: { badge: "bg-[#FEE7F8] text-[#C2338B]", dot: "bg-[#C2338B]" },
  gbp: { badge: "bg-[#EAF8ED] text-[#1C7C43]", dot: "bg-[#1C7C43]" },
};

interface GeneratedContentReviewListProps {
  items: PlannerContentDetail[];
  ownerTimezone: string;
  mediaLibrary: MediaAssetSummary[];
  onLibraryUpdate: Dispatch<SetStateAction<MediaAssetSummary[]>>;
  onRefreshItem: (contentId: string) => Promise<void>;
}

interface ReviewRow {
  key: string;
  dateTime: DateTime | null;
  campaigns: string[];
  items: Partial<Record<Platform, PlannerContentDetail>>;
}

export function GeneratedContentReviewList({
  items,
  ownerTimezone,
  mediaLibrary,
  onLibraryUpdate,
  onRefreshItem,
}: GeneratedContentReviewListProps) {
  const [pendingContentId, setPendingContentId] = useState<string | null>(null);
  const [mediaTarget, setMediaTarget] = useState<PlannerContentDetail | null>(null);

  const rows = useMemo<ReviewRow[]>(() => {
    const map = new Map<string, ReviewRow>();

    items.forEach((item) => {
      const scheduled = item.scheduledFor
        ? DateTime.fromISO(item.scheduledFor, { zone: "utc" }).setZone(ownerTimezone)
        : null;

      // Group by campaign + planIndex (stable plan identity).
      // Fallback chain for older content without planIndex:
      //   promptContext.slot / phase / occurrenceIndex → day → item id
      const campaignId = item.campaign?.id ?? "no-campaign";
      const ctx = item.promptContext as Record<string, unknown> | null;
      const planIndex = ctx?.planIndex;
      const legacySlot = ctx?.slot ?? ctx?.phase ?? ctx?.occurrenceIndex ?? ctx?.slotIndex;
      const planKey = planIndex != null
        ? `${campaignId}:plan-${planIndex}`
        : legacySlot != null
          ? `${campaignId}:slot-${legacySlot}`
          : scheduled
            ? `${campaignId}:day-${scheduled.startOf("day").toISODate()}`
            : `draft-${item.id}`;

      const existing = map.get(planKey) ?? {
        key: planKey,
        dateTime: scheduled,
        campaigns: [],
        items: {},
      };

      // Use the earliest scheduled time for the row header
      if (scheduled && (!existing.dateTime || scheduled.toMillis() < existing.dateTime.toMillis())) {
        existing.dateTime = scheduled;
      }

      existing.items[item.platform] = item;
      if (item.campaign?.name && !existing.campaigns.includes(item.campaign.name)) {
        existing.campaigns.push(item.campaign.name);
      }

      map.set(planKey, existing);
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.dateTime && b.dateTime) {
        return a.dateTime.toMillis() - b.dateTime.toMillis();
      }
      if (a.dateTime && !b.dateTime) {
        return -1;
      }
      if (!a.dateTime && b.dateTime) {
        return 1;
      }
      return a.key.localeCompare(b.key);
    });
  }, [items, ownerTimezone]);

  const handleRefresh = useCallback(
    async (contentId: string) => {
      setPendingContentId(contentId);
      try {
        await onRefreshItem(contentId);
      } finally {
        setPendingContentId((current) => (current === contentId ? null : current));
      }
    },
    [onRefreshItem],
  );

  if (!rows.length) {
    return null;
  }

  const ownerTimezoneLabel = ownerTimezone.replace(/_/g, " ");

  const activePlatforms = PLATFORM_ORDER.filter((platform) =>
    items.some((item) => item.platform === platform),
  );

  const gridColumnsClass = clsx("grid gap-4", {
    "md:grid-cols-2": activePlatforms.length >= 2,
    "xl:grid-cols-3": activePlatforms.length >= 3,
    "2xl:grid-cols-4": activePlatforms.length >= 4,
  });

  return (
    <>
      <section className="space-y-6">
        {rows.map((row) => {
          const posts = activePlatforms.map((platform) => row.items[platform]).filter((value): value is PlannerContentDetail => Boolean(value));
          const postsCount = posts.length;
          const scheduledLabel = row.dateTime
            ? row.dateTime.toFormat("cccc d LLLL yyyy · HH:mm")
            : "Awaiting schedule";
          const relativeLabel = row.dateTime
            ? row.dateTime.toRelative({ base: DateTime.now().setZone(ownerTimezone) })
            : null;
          const campaignSummary = row.campaigns.join(" · ");

          return (
            <article
              key={row.key}
              className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:p-6"
            >
              <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{scheduledLabel}</p>
                  <p className="text-xs text-slate-500">Timezone: {ownerTimezoneLabel}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 font-medium">
                    <CalendarDays className="h-3 w-3" /> {postsCount} draft{postsCount === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 font-medium">
                    <Layers className="h-3 w-3" /> {activePlatforms.length} platform{activePlatforms.length === 1 ? "" : "s"}
                  </span>
                  {campaignSummary ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 font-medium">
                      {campaignSummary}
                    </span>
                  ) : null}
                  {relativeLabel ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-700">
                      <Clock3 className="h-3 w-3" /> {relativeLabel}
                    </span>
                  ) : null}
                </div>
              </header>
              <div className={gridColumnsClass}>
                {activePlatforms.map((platform) => {
                  const item = row.items[platform];

                  if (!item) {
                    return (
                      <div
                        key={platform}
                        className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-400"
                      >
                        No draft for {formatPlatformLabel(platform)} on this date.

[truncated at line 200 — original has 530 lines]
```

### `src/features/link-in-bio/public/link-in-bio-public-page.tsx`

```
import Image from "next/image";

import { BannerOverlay } from "@/features/planner/banner-overlay";
import type { PublicLinkInBioPageData } from "@/lib/link-in-bio/types";
import { LinkInBioRefreshTimer } from "./link-in-bio-refresh-timer";

function normalisePhone(value: string) {
  return value.replace(/[^0-9+]/g, "");
}

function buildWhatsappUrl(raw: string) {
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length ? `https://wa.me/${digits}` : null;
}

const CTA_ORDER: Array<{
  key: keyof PublicLinkInBioPageData["profile"] | "phone" | "whatsapp";
  label: string;
  renderHref: (profile: PublicLinkInBioPageData["profile"]) => string | null;
}> = [
  {
    key: "phone",
    label: "Call us",
    renderHref: (profile) => {
      if (!profile.phoneNumber) return null;
      const phone = normalisePhone(profile.phoneNumber);
      return phone.length ? `tel:${phone}` : null;
    },
  },
  {
    key: "directionsUrl",
    label: "Find us",
    renderHref: (profile) => profile.directionsUrl ?? null,
  },
  {
    key: "whatsapp",
    label: "WhatsApp us",
    renderHref: (profile) => {
      if (!profile.whatsappNumber) return null;
      return buildWhatsappUrl(profile.whatsappNumber);
    },
  },
  {
    key: "bookingUrl",
    label: "Book a table",
    renderHref: (profile) => profile.bookingUrl ?? null,
  },
  {
    key: "menuUrl",
    label: "See our menu",
    renderHref: (profile) => profile.menuUrl ?? null,
  },
  {
    key: "parkingUrl",
    label: "Book parking",
    renderHref: (profile) => profile.parkingUrl ?? null,
  },
  {
    key: "facebookUrl",
    label: "Facebook",
    renderHref: (profile) => profile.facebookUrl ?? null,
  },
  {
    key: "instagramUrl",
    label: "Instagram",
    renderHref: (profile) => profile.instagramUrl ?? null,
  },
  {
    key: "websiteUrl",
    label: "Visit website",
    renderHref: (profile) => profile.websiteUrl ?? null,
  },
];

const SOCIAL_KEYS = new Set<keyof PublicLinkInBioPageData["profile"] | "phone" | "whatsapp">([
  "facebookUrl",
  "instagramUrl",
  "websiteUrl",
]);

function getMediaDimensions(shape: "square" | "story" | null | undefined) {
  if (shape === "story") {
    return { width: 720, height: 1280 };
  }
  return { width: 1200, height: 900 };
}

export function LinkInBioPublicPage({ data }: { data: PublicLinkInBioPageData }) {
  const primaryColor = typeof data.profile.theme?.primaryColor === "string" && data.profile.theme.primaryColor.length
    ? (data.profile.theme.primaryColor as string)
    : "#005131";
  const secondaryColor = typeof data.profile.theme?.secondaryColor === "string" && data.profile.theme.secondaryColor.length
    ? (data.profile.theme.secondaryColor as string)
    : "#a57626";
  const logoPath = `/brands/${data.profile.slug}/logo.png`;
  const heroMediaDims = data.heroMedia ? getMediaDimensions(data.heroMedia.shape) : null;

  const ctas = CTA_ORDER.map((entry) => {
    const href = entry.renderHref(data.profile);
    if (!href) return null;
    return { key: entry.key, label: entry.label, href };
  }).filter(Boolean) as Array<{ key: typeof CTA_ORDER[number]["key"]; label: string; href: string }>;

  const primaryCtas = ctas.filter((cta) => !SOCIAL_KEYS.has(cta.key));
  const socialCtas = ctas.filter((cta) => SOCIAL_KEYS.has(cta.key));

  return (
    <div
      className="min-h-screen px-6 pb-16 pt-12"
      style={{ backgroundColor: primaryColor }}
    >
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-10 text-center text-white">
        <div className="flex flex-col items-center gap-4">
          <Image
            src={logoPath}
            alt={`${data.profile.displayName ?? data.profile.slug} logo`}
            width={540}
            height={540}
            className="h-auto w-60 object-contain sm:w-80"
            priority
            unoptimized
          />
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/80">Eat. Drink. Enjoy. Together.</p>
          {data.profile.bio ? (
            <p className="text-center text-sm text-white/80">{data.profile.bio}</p>
          ) : null}
        </div>

        {primaryCtas.length ? (
          <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
            {primaryCtas.map((cta) => (
              <a
                key={cta.label}
                href={cta.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-full px-6 py-3 text-sm font-semibold shadow-lg transition hover:translate-y-[-1px]"
                style={{ backgroundColor: secondaryColor }}
              >
                {cta.label}
              </a>
            ))}
          </div>
        ) : null}

        {data.heroMedia && heroMediaDims ? (
          <div className="w-full overflow-hidden rounded-3xl border border-white/20 bg-white/5 p-3">
            <Image
              src={data.heroMedia.url}
              alt="Venue highlight"
              width={heroMediaDims.width}
              height={heroMediaDims.height}
              className="mx-auto h-auto w-full rounded-2xl object-contain"
              unoptimized
              sizes="(min-width: 1024px) 640px, 100vw"
            />
          </div>
        ) : null}

        <section className="w-full space-y-4">
          <div className="flex items-center justify-between text-left">
            <h2 className="text-xl font-semibold">Campaigns</h2>
            <span className="text-xs font-medium uppercase tracking-wide text-white/60">Upcoming first</span>
          </div>
          {data.campaigns.length ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.campaigns.map((campaign) => {
                const campaignDims = getMediaDimensions(campaign.media?.shape);
                const resolvedConfig = campaign.bannerConfig ?? null;
                const body = (
                  <>
                    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-2">
                      {campaign.media ? (
                        resolvedConfig && campaign.bannerLabel ? (
                          <BannerOverlay
                            mediaUrl={campaign.media.url}
                            config={resolvedConfig}
                            label={campaign.bannerLabel}
                            className="mx-auto h-auto w-full rounded-xl"
                          />
                        ) : (
                          <Image
                            src={campaign.media.url}
                            alt={campaign.name}
                            width={campaignDims.width}
                            height={campaignDims.height}
                            className="mx-auto h-auto w-full rounded-xl object-contain"
                            unoptimized
                            sizes="(min-width: 1024px) 320px, 100vw"
                          />
                        )
                      ) : (
                        <div className="flex min-h-[160px] items-center justify-center rounded-2xl bg-white/10 text-base font-semibold text-white/70">
                          {campaign.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="mt-3 text-left">
                      <p className="text-base font-semibold text-white">{campaign.name}</p>
                    </div>

[truncated at line 200 — original has 299 lines]
```

### `src/features/planner/banner-controls.tsx`

```
"use client";

import { useState } from "react";
import { useToast } from "@/components/providers/toast-provider";
import { BANNER_EDITABLE_STATUSES } from "@/lib/scheduling/banner-config";
import {
  bannerConfigResolver,
  type AccountBannerDefaults,
  type BannerPosition,
  type PostBannerOverrides,
  type ResolvedConfig,
} from "@/lib/banner/config";
import { updatePlannerBannerConfig } from "@/app/(app)/planner/actions";

const BANNER_POSITIONS: readonly BannerPosition[] = [
  "top",
  "bottom",
  "left",
  "right",
];

const POSITION_LABELS: Record<BannerPosition, string> = {
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};

interface BannerControlsProps {
  contentItemId: string;
  status: string;
  accountDefaults: AccountBannerDefaults;
  overrides: PostBannerOverrides;
  autoLabel: string | null;
  onUpdate?: (config: ResolvedConfig) => void;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

function sanitiseTextOverride(value: string): string | null {
  // Strip control characters, trim, uppercase. Returns null when empty.
  const cleaned = value
    .replace(/[\n\r\t\x00-\x1f\x7f]/g, "")
    .trim()
    .toUpperCase();
  return cleaned.length === 0 ? null : cleaned.slice(0, 20);
}

export function BannerControls({
  contentItemId,
  status,
  accountDefaults,
  overrides,
  autoLabel,
  onUpdate,
}: BannerControlsProps): React.ReactElement {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const isEditable = (BANNER_EDITABLE_STATUSES as readonly string[]).includes(status);
  const isLocked = saving || !isEditable;

  // Local override state mirrors what's in the database; resolves through the
  // shared resolver so the preview matches what BannerOverlay will render.
  const [localOverrides, setLocalOverrides] = useState<PostBannerOverrides>(overrides);
  const resolved = bannerConfigResolver(accountDefaults, localOverrides);
  const [textOverrideDraft, setTextOverrideDraft] = useState<string>(
    localOverrides.banner_text_override ?? "",
  );

  async function persist(next: PostBannerOverrides): Promise<void> {
    if (isLocked) return;
    setSaving(true);
    const previous = localOverrides;
    setLocalOverrides(next);
    onUpdate?.(bannerConfigResolver(accountDefaults, next));
    try {
      const result = await updatePlannerBannerConfig({
        contentItemId,
        enabled: next.banner_enabled,
        position: next.banner_position,
        bgColour: next.banner_bg,
        textColour: next.banner_text_colour,
        textOverride: next.banner_text_override,
      });
      if (result && "error" in result && result.error) {
        toast.error("Failed to save banner settings.");
        setLocalOverrides(previous);
        onUpdate?.(bannerConfigResolver(accountDefaults, previous));
      }
    } catch {
      toast.error("Failed to save banner settings.");
      setLocalOverrides(previous);
      onUpdate?.(bannerConfigResolver(accountDefaults, previous));
    } finally {
      setSaving(false);
    }
  }

  function setEnabled(value: boolean): void {
    void persist({ ...localOverrides, banner_enabled: value });
  }

  function setPosition(value: BannerPosition): void {
    void persist({ ...localOverrides, banner_position: value });
  }

  function setBgColour(value: string): void {
    if (!HEX.test(value)) return;
    void persist({ ...localOverrides, banner_bg: value });
  }

  function setTextColour(value: string): void {
    if (!HEX.test(value)) return;
    void persist({ ...localOverrides, banner_text_colour: value });
  }

  function commitTextOverride(): void {
    const sanitised = sanitiseTextOverride(textOverrideDraft);
    setTextOverrideDraft(sanitised ?? "");
    void persist({ ...localOverrides, banner_text_override: sanitised });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Proximity Banner</span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={resolved.enabled}
            disabled={isLocked}
            onChange={(e) => setEnabled(e.target.checked)}
            aria-label="Toggle proximity banner"
          />
          <span className="text-xs text-muted-foreground">
            {resolved.enabled ? "On" : "Off"}
          </span>
        </label>
      </div>

      {resolved.enabled ? (
        <>
          {/* Position picker */}
          <div>
            <span className="text-xs text-muted-foreground">Position</span>
            <div className="mt-1 flex gap-1">
              {BANNER_POSITIONS.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  disabled={isLocked}
                  className={`rounded px-3 py-1 text-xs font-medium ${
                    resolved.position === pos
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                  onClick={() => setPosition(pos)}
                >
                  {POSITION_LABELS[pos]}
                </button>
              ))}
            </div>
          </div>

          {/* Background colour picker */}
          <div>
            <span className="text-xs text-muted-foreground">Background</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={resolved.bgColour}
                disabled={isLocked}
                onChange={(e) => setBgColour(e.target.value)}
                aria-label="Banner background colour"
                className="h-8 w-12 cursor-pointer rounded border"
              />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {resolved.bgColour}
              </span>
            </div>
          </div>

          {/* Text colour picker */}
          <div>
            <span className="text-xs text-muted-foreground">Text</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={resolved.textColour}
                disabled={isLocked}
                onChange={(e) => setTextColour(e.target.value)}
                aria-label="Banner text colour"
                className="h-8 w-12 cursor-pointer rounded border"
              />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {resolved.textColour}
              </span>
            </div>
          </div>


[truncated at line 200 — original has 240 lines]
```

### `src/features/planner/banner-overlay-preview.tsx`

_(deleted or missing from working tree)_

### `src/features/planner/banner-overlay.test.tsx`

```
// @vitest-environment jsdom
// src/features/planner/banner-overlay.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BannerOverlay } from '@/features/planner/banner-overlay';

const baseConfig = {
  enabled: true,
  position: 'bottom' as const,
  bgColour: '#000000',
  textColour: '#FFFFFF',
  textOverride: null,
};

describe('<BannerOverlay />', () => {
  it('renders nothing when config.enabled is false', () => {
    const { container } = render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, enabled: false }}
        label="THIS WEDNESDAY"
      />,
    );
    expect(container.querySelector('[data-banner-overlay]')).toBeNull();
  });

  it('renders nothing when label is null and no override', () => {
    const { container } = render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={baseConfig}
        label={null}
      />,
    );
    expect(container.querySelector('[data-banner-overlay]')).toBeNull();
  });

  it('renders override text when set even with null label', () => {
    render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, textOverride: 'BANK HOLIDAY' }}
        label={null}
      />,
    );
    expect(screen.getByText('BANK HOLIDAY')).toBeInTheDocument();
  });

  it('renders computed label when override is empty', () => {
    render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={baseConfig}
        label="THIS WEDNESDAY"
      />,
    );
    expect(screen.getByText('THIS WEDNESDAY')).toBeInTheDocument();
  });

  it('positions strip at top when position=top', () => {
    render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, position: 'top' }}
        label="TODAY"
      />,
    );
    const strip = screen.getByText('TODAY').closest('[data-banner-overlay]')!;
    expect(strip).toHaveAttribute('data-position', 'top');
  });
});
```

### `src/features/planner/banner-overlay.tsx`

```
// src/features/planner/banner-overlay.tsx
'use client';

import type { ResolvedConfig } from '@/lib/banner/config';

type Props = {
  mediaUrl: string;
  config: ResolvedConfig;
  label: string | null;
  className?: string;
};

const positionClasses: Record<ResolvedConfig['position'], string> = {
  top: 'top-0 left-0 right-0 h-[8%] flex-row',
  bottom: 'bottom-0 left-0 right-0 h-[8%] flex-row',
  left: 'top-0 bottom-0 left-0 w-[8%] flex-col',
  right: 'top-0 bottom-0 right-0 w-[8%] flex-col',
};

export function BannerOverlay({ mediaUrl, config, label, className }: Props) {
  const text =
    config.textOverride && config.textOverride.length > 0
      ? config.textOverride
      : label;
  const visible = config.enabled && text != null && text.length > 0;

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mediaUrl} alt="" className="block w-full h-full object-cover" />
      {visible ? (
        <div
          data-banner-overlay
          data-position={config.position}
          className={`absolute ${positionClasses[config.position]} flex items-center justify-center`}
          style={{ backgroundColor: config.bgColour, color: config.textColour }}
        >
          <span
            className="font-bold tracking-wide text-[clamp(0.75rem,2.5vw,1.5rem)]"
            aria-label={text!}
          >
            {text}
          </span>
        </div>
      ) : null}
    </div>
  );
}
```

### `src/features/planner/banner-rendered-preview.tsx`

_(deleted or missing from working tree)_

### `src/features/planner/planner-calendar.tsx`

```
import Link from "next/link";
import { DateTime } from "luxon";

import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { PlannerOverview } from "@/lib/planner/data";
import { getPlannerOverview } from "@/lib/planner/data";
import { getOwnerSettings } from "@/lib/settings/data";
import { DeleteContentButton } from "@/features/planner/delete-content-button";
import { PlannerStatusFilters } from "@/features/planner/planner-status-filters";
import {
  type PlannerItemStatus,
  STATUS_FILTER_VALUE_TO_STATUS,
  type PlannerStatusFilterValue,
} from "@/features/planner/status-filter-options";
import {
  PermanentlyDeleteAllTrashButton,
  PermanentlyDeleteContentButton,
  RestoreContentButton,
} from "@/features/planner/restore-content-button";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
import { PlannerViewToggle } from "./planner-view-toggle";
import { AddToCalendarButton, CreateWeeklyPlanButton } from "@/features/planner/planner-interaction-components";
import { BannerOverlay } from "@/features/planner/banner-overlay";

const PLATFORM_STYLES: Record<string, string> = {
  facebook: "bg-brand-blue/10 text-brand-blue border border-brand-blue/30",
  instagram: "bg-brand-rose/12 text-brand-rose border border-brand-rose/30",
  gbp: "bg-brand-teal/12 text-brand-teal border border-brand-teal/30",
};

const STATUS_TEXT_CLASSES: Record<string, string> = {
  draft: "text-brand-caramel",
  scheduled: "text-brand-blue",
  queued: "text-brand-blue",
  publishing: "text-brand-blue",
  posted: "text-brand-teal",
  failed: "text-brand-rose",
};

const STATUS_ACCENT_CLASSES: Record<string, string> = {
  draft: "border-l-brand-caramel/70 bg-brand-caramel/10",
  scheduled: "border-l-brand-blue/70 bg-brand-blue/10",
  queued: "border-l-brand-blue/70 bg-brand-blue/10",
  publishing: "border-l-brand-blue/70 bg-brand-blue/15",
  posted: "border-l-brand-teal/70 bg-brand-teal/10",
  failed: "border-l-brand-rose/70 bg-brand-rose/10",
};

type CalendarItem = PlannerOverview["items"][number] & { occursAt: DateTime };

interface PlannerCalendarProps {
  month?: string;
  statusFilters?: PlannerStatusFilterValue[];
  showImages?: boolean;
}

export async function PlannerCalendar({ month, statusFilters, showImages = true }: PlannerCalendarProps) {
  const ownerSettings = await getOwnerSettings();

  const timezone = ownerSettings.posting.timezone ?? DEFAULT_TIMEZONE;
  const timezoneLabel = timezone.replace(/_/g, " ");

  const now = DateTime.now().setZone(timezone);
  const desiredMonth = month
    ? DateTime.fromFormat(month, "yyyy-MM", { zone: timezone })
    : now;
  const isMonthOverride = Boolean(month) && desiredMonth.isValid;
  const referenceMonth = desiredMonth.isValid ? desiredMonth : now;

  const monthStart = referenceMonth.startOf("month");
  const calendarStart = isMonthOverride ? monthStart.startOf("week") : now.startOf("week");
  const calendarEnd = calendarStart.plus({ weeks: 6 }).minus({ days: 1 });

  const overview = await getPlannerOverview({
    rangeStart: calendarStart.toUTC().toJSDate(),
    rangeEnd: calendarEnd.endOf("day").toUTC().toJSDate(),
    includeActivity: false,
  });

  const selectedStatuses = statusFilters?.length
    ? new Set(
      statusFilters
        .flatMap((value) => STATUS_FILTER_VALUE_TO_STATUS[value] ?? [])
        .filter((status): status is PlannerItemStatus => Boolean(status)),
    )
    : null;

  const scheduledItems: CalendarItem[] = overview.items
    .map((item) => {
      const occursAtUtc = DateTime.fromISO(item.scheduledFor, { zone: "utc" });
      if (!occursAtUtc.isValid) return null;
      return {
        ...item,
        occursAt: occursAtUtc.setZone(timezone),
      } satisfies CalendarItem;
    })
    .filter((entry): entry is CalendarItem => Boolean(entry))
    .filter((item) => {
      if (!selectedStatuses) return true;
      return selectedStatuses.has(item.status);
    })
    .sort((a, b) => a.occursAt.toMillis() - b.occursAt.toMillis());

  const itemsByDate = new Map<string, CalendarItem[]>();
  for (const item of scheduledItems) {
    const key = item.occursAt.toISODate();
    if (!key) continue;
    const bucket = itemsByDate.get(key) ?? [];
    bucket.push(item);
    itemsByDate.set(key, bucket);
  }

  const totalDays = 42; // 6 weeks grid
  const days: Array<{
    date: DateTime;
    isCurrentMonth: boolean;
    isToday: boolean;
    items: CalendarItem[];
  }> = [];

  let cursor = calendarStart;
  for (let i = 0; i < totalDays; i += 1) {
    const isoDate = cursor.toISODate();
    days.push({
      date: cursor,
      isCurrentMonth: cursor.month === monthStart.month,
      isToday: cursor.hasSame(now, "day"),
      items: isoDate ? itemsByDate.get(isoDate) ?? [] : [],
    });
    cursor = cursor.plus({ days: 1 });
  }

  const weeks: typeof days[] = [];
  for (let i = 0; i < 6; i += 1) {
    weeks.push(days.slice(i * 7, (i + 1) * 7));
  }

  const trashedItems = overview.trash.map((item) => {
    const deletedAt = DateTime.fromISO(item.deletedAt, { zone: timezone });
    const scheduledFor = item.scheduledFor ? DateTime.fromISO(item.scheduledFor, { zone: "utc" }).setZone(timezone) : null;
    return {
      ...item,
      deletedAt,
      scheduledFor,
      deletedRelative: deletedAt.isValid ? deletedAt.toRelative({ base: now }) : null,
    };
  });

  const monthLabel = monthStart.toFormat("LLLL yyyy");
  const prevMonthParam = monthStart.minus({ months: 1 }).toFormat("yyyy-MM");
  const nextMonthParam = monthStart.plus({ months: 1 }).toFormat("yyyy-MM");

  const buildMonthHref = (value?: string) => {
    const params = new URLSearchParams();
    if (value) {
      params.set("month", value);
    }
    if (statusFilters?.length) {
      params.set("status", statusFilters.join(","));
    }
    if (!showImages) {
      params.set("show_images", "false");
    }
    const query = params.toString();
    return query ? `/planner?${query}` : "/planner";
  };

  const hasStatusFilters = Boolean(statusFilters?.length);

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold text-brand-navy">{monthLabel}</h3>
          <p className="text-sm text-brand-navy/70">Timezone: {timezoneLabel}</p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildMonthHref(prevMonthParam)}
              className="rounded-full bg-primary border border-transparent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
            >
              Previous month
            </Link>
            <Link
              href={buildMonthHref()}
              className="rounded-full bg-primary border border-transparent px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
            >
              Today
            </Link>
            <Link
              href={buildMonthHref(nextMonthParam)}
              className="rounded-full bg-primary border border-transparent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
            >
              Next month
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <PlannerViewToggle />
            <PlannerStatusFilters selected={statusFilters ?? []} />

[truncated at line 200 — original has 453 lines]
```

### `src/features/planner/planner-content-composer.tsx`

```
"use client";

import { useEffect, useMemo, useState, useTransition, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import clsx from "clsx";
import {
  Bookmark,
  CheckCircle2,
  Globe,
  Heart,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Send,
  Share2,
  ThumbsUp,
  X,
} from "lucide-react";

import { updatePlannerContentBody } from "@/app/(app)/planner/actions";
import { ApproveDraftButton } from "@/features/planner/approve-draft-button";
import { BannerOverlay } from "@/features/planner/banner-overlay";
import { BannerControls } from "@/features/planner/banner-controls";
// useBannerPrerender removed: <BannerOverlay /> renders the strip live; the
// publish worker composes the final image at send time via renderBannerServer.
import { PlannerContentMediaEditor } from "@/features/planner/content-media-editor";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerContentDetail } from "@/lib/planner/data";
import type { ResolvedConfig } from "@/lib/banner/config";
import { useNowMinute } from "@/lib/hooks/use-now-minute";
import { extractCampaignTiming } from "@/lib/scheduling/campaign-timing";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";

const EDITABLE_STATUSES = new Set<PlannerContentDetail["status"]>([
  "draft",
  "scheduled",
  "queued",
  "failed",
]);

const PLATFORM_THEME: Record<
  PlannerContentDetail["platform"],
  {
    shell: string;
    badge: string;
    frame: string;
    subheader: string;
  }
> = {
  facebook: {
    shell: "border-[#D7E6FF] bg-[#F8FBFF]",
    badge: "bg-[#E8F1FF] text-[#1B4DB1]",
    frame: "border-[#D7E6FF] bg-white",
    subheader: "text-[#1B4DB1]/75",
  },
  instagram: {
    shell: "border-[#F5D8EA] bg-[#FFF8FC]",
    badge: "bg-[#FEE7F8] text-[#C2338B]",
    frame: "border-[#F5D8EA] bg-white",
    subheader: "text-[#C2338B]/75",
  },
  gbp: {
    shell: "border-[#D5EEDD] bg-[#F7FCF8]",
    badge: "bg-[#EAF8ED] text-[#1C7C43]",
    frame: "border-[#D5EEDD] bg-white",
    subheader: "text-[#1C7C43]/75",
  },
};

interface PlannerContentComposerProps {
  detail: PlannerContentDetail;
  ownerTimezone: string;
  mediaLibrary: MediaAssetSummary[];
}

export function PlannerContentComposer({ detail, ownerTimezone, mediaLibrary }: PlannerContentComposerProps) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState(detail.body ?? "");
  const [baseline, setBaseline] = useState(detail.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [isSavingCopy, startSaveCopyTransition] = useTransition();
  const [isRefreshing, startRefreshTransition] = useTransition();

  useEffect(() => {
    if (!isMediaModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMediaModalOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [isMediaModalOpen]);

  const theme = PLATFORM_THEME[detail.platform];
  const status = detail.status;
  const isStory = detail.placement === "story";
  const canEdit = EDITABLE_STATUSES.has(status);
  const canEditCopy = canEdit && !isStory;
  const isDirty = body.trim() !== baseline.trim();
  const isBusy = isSavingCopy || isRefreshing;
  const primaryMedia = detail.media[0] ?? null;

  // --- Banner config & proximity label ---
  // Re-render every minute so the live label refreshes on minute/hour/day boundaries.
  const nowMinute = useNowMinute();
  const [bannerOverride, setBannerOverride] = useState<ResolvedConfig | null>(null);
  const bannerConfig: ResolvedConfig = bannerOverride ?? detail.bannerConfig;

  const bannerLabel = useMemo(() => {
    if (!bannerConfig.enabled) return null;
    if (!detail.campaign?.campaignType || !detail.campaign?.metadata) {
      return detail.bannerLabel;
    }
    try {
      const timing = extractCampaignTiming({
        campaign_type: detail.campaign.campaignType,
        metadata: detail.campaign.metadata,
      });
      const refAt = detail.scheduledFor
        ? DateTime.fromISO(detail.scheduledFor, { zone: "Europe/London" })
        : DateTime.fromJSDate(nowMinute).setZone("Europe/London");
      return getProximityLabel({ referenceAt: refAt, campaignTiming: timing });
    } catch {
      return detail.bannerLabel;
    }
  }, [bannerConfig.enabled, detail.campaign, detail.scheduledFor, detail.bannerLabel, nowMinute]);

  const mediaAspectClass = isStory
    ? "mx-auto max-w-[360px] aspect-[9/16]"
    : "mx-auto w-full max-w-[520px] aspect-square";

  const timezoneLabel = ownerTimezone.replace(/_/g, " ");
  const scheduledLabel = useMemo(() => {
    if (!detail.scheduledFor) return "Pending";
    const local = DateTime.fromISO(detail.scheduledFor, { zone: "utc" }).setZone(ownerTimezone);
    if (!local.isValid) return "Pending";
    return `${local.toFormat("cccc d LLLL yyyy · HH:mm")} (${timezoneLabel})`;
  }, [detail.scheduledFor, ownerTimezone, timezoneLabel]);

  const handleCopyReset = () => {
    setBody(baseline);
    setError(null);
  };

  const handleCopyChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setBody(event.target.value);
    if (error) setError(null);
  };

  const handleCopySave = () => {
    if (!canEditCopy || isBusy) return;
    const trimmed = body.trim();
    if (!trimmed.length) {
      setError("Write something before saving.");
      return;
    }

    setError(null);
    startSaveCopyTransition(async () => {
      try {
        await updatePlannerContentBody({ contentId: detail.id, body: trimmed });
        setBaseline(trimmed);
        setBody(trimmed);
        toast.success("Post copy updated", {
          description: "Your changes were saved.",
        });
        startRefreshTransition(() => {
          router.refresh();
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to save post copy.";
        setError(message);
        toast.error("Save failed", { description: message });
      }
    });
  };

  const handleApproved = (result: { status: string; scheduledFor: string | null }) => {
    if (!result.status && !result.scheduledFor) return;
    startRefreshTransition(() => {
      router.refresh();
    });
  };

  const handleMediaUpdated = () => {

[truncated at line 200 — original has 442 lines]
```

### `src/features/planner/use-banner-prerender.ts`

_(deleted or missing from working tree)_

### `src/features/settings/posting-defaults-form.tsx`

```
"use client";

import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { PostingDefaults } from "@/lib/settings/data";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import {
  PostingDefaultsFormValues,
  postingDefaultsFormSchema,
} from "@/features/settings/schema";
import { updatePostingDefaults } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";

interface PostingDefaultsFormProps {
  data: PostingDefaults;
}

const TIMEZONE_OPTIONS = [DEFAULT_TIMEZONE];

const CTA_LABELS = {
  LEARN_MORE: "Learn more",
  BOOK: "Book",
  CALL: "Call",
  REDEEM: "Redeem",
} as const;

export function PostingDefaultsForm({ data }: PostingDefaultsFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<PostingDefaultsFormValues>({
    resolver: zodResolver(postingDefaultsFormSchema),
    defaultValues: {
      timezone: data.timezone,
      facebookLocationId: data.facebookLocationId,
      instagramLocationId: data.instagramLocationId,
      gbpLocationId: data.gbpLocationId,
      venueLocation: data.venueLocation ?? "",
      venueLatitude: data.venueLatitude?.toString() ?? "",
      venueLongitude: data.venueLongitude?.toString() ?? "",
      notifications: data.notifications,
      gbpCtaDefaults: data.gbpCtaDefaults,
      bannerDefaults: data.bannerDefaults,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      await updatePostingDefaults(values);
    });
  });

  return (
    <form className="space-y-8" onSubmit={onSubmit} id="posting-defaults">
      <fieldset className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <legend className="text-lg font-semibold text-slate-900">
          Scheduling & timezone
        </legend>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-slate-700">Timezone</label>
            <select
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
              {...form.register("timezone")}
              disabled
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Fixed to London time (Europe/London) for consistent scheduling.
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Venue location</label>
            <input
              type="text"
              placeholder="123 High Street, Leatherhead"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("venueLocation")}
            />
            <p className="mt-1 text-xs text-slate-500">
              Used in generated copy. Enter the venue name, address, or town.
            </p>
            {form.formState.errors.venueLocation?.message ? (
              <p className="mt-1 text-xs text-red-600">
                {form.formState.errors.venueLocation.message}
              </p>
            ) : null}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-slate-700">Meta Ads latitude</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="51.4625"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("venueLatitude")}
            />
            <p className="mt-1 text-xs text-slate-500">
              Used with longitude as the exact centre point for paid ads radius targeting.
            </p>
            {form.formState.errors.venueLatitude?.message ? (
              <p className="mt-1 text-xs text-red-600">
                {form.formState.errors.venueLatitude.message}
              </p>
            ) : null}
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Meta Ads longitude</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="-0.5021"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("venueLongitude")}
            />
            <p className="mt-1 text-xs text-slate-500">
              Coordinates avoid Meta city lookup failures for full addresses and postcodes.
            </p>
            {form.formState.errors.venueLongitude?.message ? (
              <p className="mt-1 text-xs text-red-600">
                {form.formState.errors.venueLongitude.message}
              </p>
            ) : null}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-slate-700">Default GBP location ID</label>
            <input
              type="text"
              placeholder="locations/123"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("gbpLocationId")}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Facebook Page ID</label>
            <input
              type="text"
              placeholder="1234567890"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("facebookLocationId")}
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-slate-700">Instagram Business ID</label>
            <input
              type="text"
              placeholder="1784..."
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("instagramLocationId")}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <legend className="text-lg font-semibold text-slate-900">
          GBP CTA defaults
        </legend>
        <div className="grid gap-4 md:grid-cols-3">
          {([
            ["standard", "Standard posts"],
            ["event", "Event posts"],
            ["offer", "Offer posts"],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <p className="text-sm font-medium text-slate-700">{label}</p>
              <Controller
                control={form.control}
                name={`gbpCtaDefaults.${key}` as const}
                render={({ field }) => (
                  <select
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                  >
                    {Object.entries(CTA_LABELS).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                )}
              />
            </div>
          ))}
        </div>
      </fieldset>


[truncated at line 200 — original has 387 lines]
```

### `src/features/settings/schema.ts`

```
import { z } from "zod";

export const brandProfileFormSchema = z.object({
  toneFormal: z.number().min(0).max(1),
  tonePlayful: z.number().min(0).max(1),
  keyPhrases: z.array(z.string()).max(10),
  bannedTopics: z.array(z.string()).max(10),
  bannedPhrases: z.array(z.string()).max(20),
  defaultHashtags: z.array(z.string()).max(15),
  defaultEmojis: z.array(z.string()).max(10),
  instagramSignature: z.string().optional(),
  facebookSignature: z.string().optional(),
  gbpCta: z.string().optional(),
});

export type BrandProfileFormValues = z.infer<typeof brandProfileFormSchema>;

const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;
const BANNER_POSITION_ENUM = z.enum(["top", "bottom", "left", "right"]);

export const postingDefaultsFormSchema = z.object({
  timezone: z.string(),
  facebookLocationId: z.string().optional(),
  instagramLocationId: z.string().optional(),
  gbpLocationId: z.string().optional(),
  defaultPostingTime: z.string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:mm format")
    .optional()
    .nullable(),
  venueLocation: z.string()
    .trim()
    .max(100)
    .refine(
      (value) => value === "" || /^[\p{L}\p{N}\s,.\-']+$/u.test(value),
      "Only letters, numbers, spaces, commas, full stops, hyphens, and apostrophes",
    )
    .optional()
    .nullable(),
  venueLatitude: z.string()
    .trim()
    .optional()
    .nullable(),
  venueLongitude: z.string()
    .trim()
    .optional()
    .nullable(),
  notifications: z.object({
    emailFailures: z.boolean(),
    emailTokenExpiring: z.boolean(),
  }),
  gbpCtaDefaults: z.object({
    standard: z.enum(["LEARN_MORE", "BOOK", "CALL"]),
    event: z.enum(["LEARN_MORE", "BOOK", "CALL"]),
    offer: z.enum(["REDEEM", "CALL", "LEARN_MORE"]),
  }),
  bannerDefaults: z.object({
    bannersEnabled: z.boolean(),
    bannerPosition: BANNER_POSITION_ENUM,
    bannerBg: z.string().regex(HEX_COLOUR, "Enter a HEX colour e.g. #005131"),
    bannerTextColour: z.string().regex(HEX_COLOUR, "Enter a HEX colour e.g. #ffffff"),
  }),
}).superRefine((value, ctx) => {
  validateCoordinateField(ctx, value.venueLatitude, "venueLatitude", 49, 61, "UK latitude");
  validateCoordinateField(ctx, value.venueLongitude, "venueLongitude", -9, 2, "UK longitude");

  const hasLatitude = Boolean(value.venueLatitude?.trim());
  const hasLongitude = Boolean(value.venueLongitude?.trim());
  if (hasLatitude !== hasLongitude) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: hasLatitude ? ["venueLongitude"] : ["venueLatitude"],
      message: "Enter both latitude and longitude for Meta Ads targeting.",
    });
  }
});

export type PostingDefaultsFormValues = z.infer<typeof postingDefaultsFormSchema>;

function validateCoordinateField(
  ctx: z.RefinementCtx,
  value: string | null | undefined,
  path: "venueLatitude" | "venueLongitude",
  min: number,
  max: number,
  label: string,
) {
  const trimmed = value?.trim();
  if (!trimmed) return;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path],
      message: `${label} must be a number between ${min} and ${max}.`,
    });
  }
}

export const managementConnectionFormSchema = z.object({
  baseUrl: z.string().trim().url("Enter a valid base URL"),
  apiKey: z
    .union([z.literal(""), z.string().trim().min(1, "Enter an API key")])
    .transform((value) => (value ? value : undefined))
    .optional(),
  enabled: z.boolean().default(true),
});

export type ManagementConnectionFormValues = z.infer<typeof managementConnectionFormSchema>;

const slugPattern = /^[a-z0-9-]+$/;

const optionalUrlField = z
  .union([z.literal(""), z.string().trim().url("Enter a valid URL")])
  .transform((value) => (value ? value : undefined))
  .optional();

const optionalPhoneField = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .regex(/^[0-9+()\-\s]+$/, "Use digits, spaces, parentheses, + or -"),
  ])
  .transform((value) => (value ? value : undefined))
  .optional();

const optionalColourField = z
  .union([
    z.literal(""),
    z.string().trim().regex(/^#([0-9a-fA-F]{6})$/, "Enter a HEX colour e.g. #005131"),
  ])
  .transform((value) => (value ? value.toLowerCase() : undefined))
  .optional();

export const linkInBioProfileFormSchema = z.object({
  slug: z
    .string()
    .min(3, "Enter at least 3 characters")
    .max(64, "Keep the slug under 64 characters")
    .regex(slugPattern, "Use lowercase letters, numbers, and hyphens"),
  displayName: z.union([z.string().trim().max(120), z.literal("")]).transform((value) => (value ? value : undefined)).optional(),
  bio: z.union([z.string().trim().max(280), z.literal("")]).transform((value) => (value ? value : undefined)).optional(),
  heroMediaId: z.union([z.string(), z.literal("")]).transform((value) => (value ? value : undefined)).optional(),
  theme: z
    .object({
      primaryColor: optionalColourField,
      secondaryColor: optionalColourField,
    })
    .default({}),
  phoneNumber: optionalPhoneField,
  whatsappNumber: optionalPhoneField,
  bookingUrl: optionalUrlField,
  menuUrl: optionalUrlField,
  parkingUrl: optionalUrlField,
  directionsUrl: optionalUrlField,
  facebookUrl: optionalUrlField,
  instagramUrl: optionalUrlField,
  websiteUrl: optionalUrlField,
});

export type LinkInBioProfileFormValues = z.infer<typeof linkInBioProfileFormSchema>;

export const linkInBioTileFormSchema = z.object({
  id: z
    .union([z.string().uuid(), z.literal("")])
    .transform((value) => (value ? value : undefined))
    .optional(),
  title: z.string().trim().min(1, "Add a title").max(80, "Keep titles under 80 characters"),
  subtitle: z
    .union([z.string().trim().max(140), z.literal("")])
    .transform((value) => (value ? value : undefined))
    .optional(),
  ctaLabel: z.string().trim().min(1, "Add a CTA label").max(30, "Keep CTA labels concise"),
  ctaUrl: z.string().trim().url("Enter a valid URL"),
  mediaAssetId: z.union([z.string(), z.literal("")]).transform((value) => (value ? value : undefined)).optional(),
  enabled: z.boolean().default(true),
});

export type LinkInBioTileFormValues = z.infer<typeof linkInBioTileFormSchema>;

export const linkInBioTileReorderSchema = z.object({
  tileIds: z.array(z.string().uuid()),
});

export type LinkInBioTileReorderValues = z.infer<typeof linkInBioTileReorderSchema>;
```

### `src/lib/banner/config.ts`

```
// src/lib/banner/config.ts
//
// SCOPE: publish-time banner resolution. Owns the contract between raw DB
// rows (posting_defaults + content_variants override columns) and the
// ResolvedConfig consumed by the renderer and the planner overlay preview.
//
// DO NOT confuse with `src/lib/scheduling/banner-config.ts` — that module
// owns the brand colour-id → hex map, the Zod schemas used by campaign and
// settings forms, and the BANNER_EDITABLE_STATUSES list. Forms speak
// colour ids; this module speaks resolved hex strings + booleans.
export type BannerPosition = 'top' | 'bottom' | 'left' | 'right';

export type AccountBannerDefaults = {
  banners_enabled: boolean;
  banner_position: BannerPosition;
  banner_bg: string;
  banner_text_colour: string;
};

export type PostBannerOverrides = {
  banner_enabled: boolean | null;
  banner_text_override: string | null;
  banner_position: BannerPosition | null;
  banner_bg: string | null;
  banner_text_colour: string | null;
};

export type ResolvedConfig = {
  enabled: boolean;
  position: BannerPosition;
  bgColour: string;
  textColour: string;
  textOverride: string | null;
};

export function bannerConfigResolver(
  accountDefaults: AccountBannerDefaults,
  postOverrides: PostBannerOverrides,
): ResolvedConfig {
  return {
    enabled: postOverrides.banner_enabled ?? accountDefaults.banners_enabled,
    position: postOverrides.banner_position ?? accountDefaults.banner_position,
    bgColour: postOverrides.banner_bg ?? accountDefaults.banner_bg,
    textColour: postOverrides.banner_text_colour ?? accountDefaults.banner_text_colour,
    textOverride: postOverrides.banner_text_override,
  };
}
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
  StorySeriesInput,
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
import { formatFriendlyTime } from "@/lib/utils/date";
import { resolveStoryScheduledFor } from "@/lib/create/story-schedule";
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
 * F4: BannerDefaults from the campaign creation form does NOT include a
 * bannersEnabled toggle — only position/bgColour/textColour. So:
 *  - If the user did not customise the banner appearance, return null. The
 *    variant inherits account defaults (including the account's enabled
 *    flag) at publish time via bannerConfigResolver.
 *  - If the user did customise at least one field, write only the changed
 *    appearance columns. Do NOT set banner_enabled — the account-level
 *    setting still governs whether banners render. Forcing banner_enabled
 *    true here would silently override an account-level "off".
 */
export function computeBannerOverride(bannerDefaults?: BannerDefaults): {
  banner_position: BannerDefaults["position"];
  banner_bg: string | null;
  banner_text_colour: string | null;
} | null {
  if (!bannerDefaults) return null;
  const customised =
    bannerDefaults.position !== DEFAULT_BANNER_DEFAULTS.position
    || bannerDefaults.bgColour !== DEFAULT_BANNER_DEFAULTS.bgColour
    || bannerDefaults.textColour !== DEFAULT_BANNER_DEFAULTS.textColour;
  if (!customised) return null;
  return {
    banner_position: bannerDefaults.position,
    banner_bg: BANNER_COLOUR_HEX[bannerDefaults.bgColour] ?? null,
    banner_text_colour: BANNER_COLOUR_HEX[bannerDefaults.textColour] ?? null,
  };
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
  platform: Platform;
  body: string;
  validation?: BuiltVariant["validation"];
}

interface BuiltVariant {
  platform: Platform;
  body: string;
  scheduledFor: Date | null;
  promptContext: Record<string, unknown>;
  mediaIds: string[];
  options: InstantPostAdvancedOptions;
  linkInBioUrl?: string | null;
  placement: "feed" | "story";
  hookStrategy?: string;
  contentPillar?: string;
  planIndex: number;
  validation?: {
    lintPass: boolean;
    issues: Array<{ code: string; message: string }>;
    repairsApplied: string[];
    metrics: Record<string, unknown>;
    timestamp: string;
  };
}

const DEFAULT_ADVANCED_OPTIONS: InstantPostAdvancedOptions = {
  toneAdjust: "default",
  lengthPreference: "standard",
  includeHashtags: true,
  includeEmojis: true,
  ctaStyle: "default",
};

const MIN_SCHEDULE_OFFSET_MS = 15 * 60 * 1000;
const INSTAGRAM_WORD_LIMIT = 80;
const SLOT_INCREMENT_MINUTES = 30;
const MINUTES_PER_DAY = 24 * 60;

function resolveAdvancedOptions(
  overrides?: Partial<InstantPostAdvancedOptions>,
): InstantPostAdvancedOptions {
  return {
    ...DEFAULT_ADVANCED_OPTIONS,
    ...(overrides ?? {}),
  };
}

function extractAdvancedOptions(
  source: {
    toneAdjust?: InstantPostAdvancedOptions["toneAdjust"];
    lengthPreference?: InstantPostAdvancedOptions["lengthPreference"];
    includeHashtags?: boolean;
    includeEmojis?: boolean;
    ctaStyle?: InstantPostAdvancedOptions["ctaStyle"];
  },
): InstantPostAdvancedOptions {
  return resolveAdvancedOptions({
    toneAdjust: source.toneAdjust,
    lengthPreference: source.lengthPreference,
    includeHashtags: source.includeHashtags,
    includeEmojis: source.includeEmojis,
    ctaStyle: source.ctaStyle,
  });
}

function composePrompt(baseSections: string[], userNotes?: string | null) {

[truncated at line 200 — original has 2043 lines]
```

### `src/lib/link-in-bio/public.ts`

```
import { DateTime } from "luxon";

import { DEFAULT_TIMEZONE, MEDIA_BUCKET } from "@/lib/constants";
import { normaliseStoragePath, resolvePreviewCandidates, type PreviewCandidate } from "@/lib/library/data";
import {
  bannerConfigResolver,
  type AccountBannerDefaults,
  type BannerPosition,
  type PostBannerOverrides,
} from "@/lib/banner/config";
import { extractCampaignTiming } from "@/lib/scheduling/campaign-timing";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";
import { isSchemaMissingError } from "@/lib/supabase/errors";

import type {
  LinkInBioProfile,
  PublicCampaignCard,
  PublicLinkInBioPageData,
  PublicLinkInBioTile,
} from "./types";

interface LinkInBioProfileRow {
  account_id: string;
  slug: string;
  display_name: string | null;
  bio: string | null;
  hero_media_id: string | null;
  theme: Record<string, unknown> | null;
  phone_number: string | null;
  whatsapp_number: string | null;
  booking_url: string | null;
  menu_url: string | null;
  parking_url: string | null;
  directions_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  website_url: string | null;
  created_at: string;
  updated_at: string;
}

interface LinkInBioTileRow {
  id: string;
  account_id: string;
  title: string;
  subtitle: string | null;
  cta_label: string;
  cta_url: string;
  media_asset_id: string | null;
  position: number | null;
  enabled: boolean | null;
  created_at: string;
  updated_at: string;
}

interface CampaignVariantRow {
  media_ids: string[] | null;
  banner_enabled: boolean | null;
  banner_text_override: string | null;
  banner_position: BannerPosition | null;
  banner_bg: string | null;
  banner_text_colour: string | null;
}

interface CampaignContentRow {
  id: string;
  campaign_id: string | null;
  scheduled_for: string | null;
  status: string;
  placement: "feed" | "story";
  prompt_context: Record<string, unknown> | null;
  content_variants: CampaignVariantRow[] | CampaignVariantRow | null;
  platform: "facebook" | "instagram" | "gbp";
  campaigns: {
    id: string;
    name: string | null;
    campaign_type: string;
    link_in_bio_url: string | null;
    account_id: string;
    metadata: Record<string, unknown> | null;
  } | null;
}

interface PostingDefaultsRow {
  banners_enabled: boolean;
  banner_position: BannerPosition;
  banner_bg: string;
  banner_text_colour: string;
}

interface MediaAssetRow {
  id: string;
  media_type: "image" | "video";
  storage_path: string;
  derived_variants: Record<string, string> | null;
}

interface AccountRow {
  timezone: string | null;
}

interface CampaignEntry {
  scheduled: DateTime;
  slotLabel: string | null;
  mediaId: string | null;
  platform: CampaignContentRow["platform"];
  promptContext: Record<string, unknown> | null;
  bannerOverrides: PostBannerOverrides;
}

interface CampaignAggregate {
  id: string;
  name: string;
  linkUrl: string;
  campaignType: string;
  campaignMetadata: Record<string, unknown>;
  earliest: DateTime | null;
  latest: DateTime | null;
  entries: CampaignEntry[];
}

function shapeProfile(row: LinkInBioProfileRow): LinkInBioProfile {
  return {
    accountId: row.account_id,
    slug: row.slug,
    displayName: row.display_name,
    bio: row.bio,
    heroMediaId: row.hero_media_id,
    theme: row.theme ?? {},
    phoneNumber: row.phone_number,
    whatsappNumber: row.whatsapp_number,
    bookingUrl: row.booking_url,
    menuUrl: row.menu_url,
    parkingUrl: row.parking_url,
    directionsUrl: row.directions_url,
    facebookUrl: row.facebook_url,
    instagramUrl: row.instagram_url,
    websiteUrl: row.website_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies LinkInBioProfile;
}

function resolveCampaignLinkUrl(campaign: NonNullable<CampaignContentRow["campaigns"]>): string {
  const direct = campaign.link_in_bio_url?.trim();
  if (direct) return direct;

  const metadata = campaign.metadata ?? {};
  const fallback = typeof metadata.linkInBioUrl === "string" ? metadata.linkInBioUrl.trim() : "";
  if (fallback) return fallback;

  const ctaUrl = typeof metadata.ctaUrl === "string" ? metadata.ctaUrl.trim() : "";
  return ctaUrl;
}

export async function getPublicLinkInBioPageData(slug: string): Promise<PublicLinkInBioPageData | null> {
  const supabase = tryCreateServiceSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase service credentials are not configured");
  }

  try {
    const { data: profileRow, error: profileError } = await supabase
      .from("link_in_bio_profiles")
      .select(
        "account_id, slug, display_name, bio, hero_media_id, theme, phone_number, whatsapp_number, booking_url, menu_url, parking_url, directions_url, facebook_url, instagram_url, website_url, created_at, updated_at",
      )
      .eq("slug", slug)
      .maybeSingle<LinkInBioProfileRow>();

    if (profileError) {
      if (isSchemaMissingError(profileError)) {
        return null;
      }
      throw profileError;
    }

    if (!profileRow) {
      return null;
    }

    const profile = shapeProfile(profileRow);
    const accountId = profile.accountId;

    const [
      { data: accountRow, error: accountError },
      { data: tileRows, error: tileError },
      { data: postingDefaultsRow, error: postingDefaultsError },
    ] = await Promise.all([
      supabase
        .from("accounts")
        .select("timezone")
        .eq("id", accountId)
        .maybeSingle<AccountRow>(),
      supabase
        .from("link_in_bio_tiles")
        .select("id, account_id, title, subtitle, cta_label, cta_url, media_asset_id, position, enabled, created_at, updated_at")
        .eq("account_id", accountId)
        .eq("enabled", true)

[truncated at line 200 — original has 535 lines]
```

### `src/lib/link-in-bio/types.ts`

```
import type { ResolvedConfig } from "@/lib/banner/config";
import type { MediaAssetSummary } from "@/lib/library/data";

export interface LinkInBioProfile {
  accountId: string;
  slug: string;
  displayName: string | null;
  bio: string | null;
  heroMediaId: string | null;
  theme: Record<string, unknown>;
  phoneNumber: string | null;
  whatsappNumber: string | null;
  bookingUrl: string | null;
  menuUrl: string | null;
  parkingUrl: string | null;
  directionsUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  websiteUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LinkInBioTile {
  id: string;
  accountId: string;
  title: string;
  subtitle: string | null;
  ctaLabel: string;
  ctaUrl: string;
  mediaAssetId: string | null;
  position: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LinkInBioTileWithMedia extends LinkInBioTile {
  media?: MediaAssetSummary | null;
}

export interface PublicLinkInBioTile {
  id: string;
  title: string;
  subtitle: string | null;
  ctaLabel: string;
  ctaUrl: string;
  media?: {
    url: string;
    shape: "square" | "story";
  } | null;
}

export interface PublicCampaignCard {
  id: string;
  campaignId: string;
  name: string;
  scheduledFor: string;
  endAt: string;
  linkUrl: string;
  slotLabel: string | null;
  media?: {
    url: string;
    mediaType: "image" | "video";
    shape: "square" | "story";
  } | null;
  /** Resolved banner config + label for the publish-time render. Null when no
   * banner is due (account-disabled, no proximity label, etc.). */
  bannerConfig?: ResolvedConfig | null;
  bannerLabel?: string | null;
}

export interface PublicLinkInBioPageData {
  profile: LinkInBioProfile;
  tiles: PublicLinkInBioTile[];
  campaigns: PublicCampaignCard[];
  heroMedia?: {
    url: string;
    shape: "square" | "story";
  } | null;
}

export interface UpdateLinkInBioProfileInput {
  slug: string;
  displayName?: string | null;
  bio?: string | null;
  heroMediaId?: string | null;
  theme?: Record<string, unknown>;
  phoneNumber?: string | null;
  whatsappNumber?: string | null;
  bookingUrl?: string | null;
  menuUrl?: string | null;
  parkingUrl?: string | null;
  directionsUrl?: string | null;
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  websiteUrl?: string | null;
}

export interface UpsertLinkInBioTileInput {
  id?: string;
  title: string;
  subtitle?: string | null;
  ctaLabel: string;
  ctaUrl: string;
  mediaAssetId?: string | null;
  enabled?: boolean;
}

export interface ReorderLinkInBioTilesInput {
  tileIdsInOrder: string[];
}

export interface LinkInBioProfileWithTiles {
  profile: LinkInBioProfile | null;
  tiles: LinkInBioTile[];
}
```

### `src/lib/planner/data.ts`

```
import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { requireAuthContext } from "@/lib/auth/server";
import { MEDIA_BUCKET } from "@/lib/constants";
import { isSchemaMissingError } from "@/lib/supabase/errors";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";
import { resolvePreviewCandidates, normaliseStoragePath, type PreviewCandidate } from "@/lib/library/data";
import {
  bannerConfigResolver,
  type AccountBannerDefaults,
  type BannerPosition,
  type PostBannerOverrides,
  type ResolvedConfig,
} from "@/lib/banner/config";
import { extractCampaignTiming } from "@/lib/scheduling/campaign-timing";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";

const DEFAULT_ACCOUNT_BANNER_DEFAULTS: AccountBannerDefaults = {
  banners_enabled: false,
  banner_position: "bottom",
  banner_bg: "#000000",
  banner_text_colour: "#FFFFFF",
};

type PostingDefaultsBannerRow = {
  banners_enabled: boolean | null;
  banner_position: BannerPosition | null;
  banner_bg: string | null;
  banner_text_colour: string | null;
};

async function loadAccountBannerDefaults({
  supabase,
  accountId,
}: {
  supabase: SupabaseClient;
  accountId: string;
}): Promise<AccountBannerDefaults> {
  const { data, error } = await supabase
    .from("posting_defaults")
    .select("banners_enabled, banner_position, banner_bg, banner_text_colour")
    .eq("account_id", accountId)
    .maybeSingle<PostingDefaultsBannerRow>();

  if (error) {
    if (isSchemaMissingError(error)) {
      return DEFAULT_ACCOUNT_BANNER_DEFAULTS;
    }
    throw error;
  }

  if (!data) {
    return DEFAULT_ACCOUNT_BANNER_DEFAULTS;
  }

  return {
    banners_enabled: data.banners_enabled ?? DEFAULT_ACCOUNT_BANNER_DEFAULTS.banners_enabled,
    banner_position: data.banner_position ?? DEFAULT_ACCOUNT_BANNER_DEFAULTS.banner_position,
    banner_bg: data.banner_bg ?? DEFAULT_ACCOUNT_BANNER_DEFAULTS.banner_bg,
    banner_text_colour: data.banner_text_colour ?? DEFAULT_ACCOUNT_BANNER_DEFAULTS.banner_text_colour,
  };
}

/**
 * Batch-sign storage paths into short-lived URLs.
 * Called fresh on every render — signed URLs are time-sensitive (600s TTL)
 * and must not be served stale via the Data Cache.
 */
async function fetchSignedUrlsBatch(paths: string[]): Promise<Record<string, string>> {
  const service = tryCreateServiceSupabaseClient();
  if (!service) return {};
  const { data, error } = await service.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(paths, 600);
  if (error) {
    console.error("[planner] signed URLs: failed to sign", error);
    return {};
  }
  const result: Record<string, string> = {};
  for (const entry of data ?? []) {
    if (entry?.path && entry.signedUrl && !entry.error) {
      result[entry.path] = entry.signedUrl;
    }
  }
  return result;
}

type ContentPlacement = "feed" | "story";

interface PlannerItem {
  id: string;
  platform: "facebook" | "instagram" | "gbp";
  placement: ContentPlacement;
  scheduledFor: string;
  campaignName: string;
  status: "draft" | "scheduled" | "queued" | "publishing" | "posted" | "failed";
  autoGenerated: boolean;
  mediaPreview?: {
    url: string;
    mediaType: "image" | "video";
  } | null;
  bannerConfig: ResolvedConfig;
  bannerLabel: string | null;
}

export interface TrashedPlannerItem {
  id: string;
  platform: "facebook" | "instagram" | "gbp";
  placement: ContentPlacement;
  status: PlannerItem["status"];
  scheduledFor: string | null;
  deletedAt: string;
  campaignName: string | null;
  autoGenerated: boolean;
  mediaPreview?: {
    url: string;
    mediaType: "image" | "video";
    fileName: string | null;
  } | null;
  bodyPreview: string | null;
}

interface PlannerActivity {
  id: string;
  message: string;
  timestamp: string;
  level: "info" | "warning" | "error";
  category?: string | null;
  metadata?: Record<string, unknown> | null;
  readAt?: string | null;
}

export interface PlannerOverview {
  items: PlannerItem[];
  activity: PlannerActivity[];
  trash: TrashedPlannerItem[];
}

export interface PlannerContentDetail {
  id: string;
  platform: "facebook" | "instagram" | "gbp";
  placement: ContentPlacement;
  status: PlannerItem["status"];
  scheduledFor: string | null;
  body: string;
  mediaIds: string[];
  campaign: {
    id: string | null;
    name: string | null;
    campaignType: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
  autoGenerated: boolean;
  promptContext: Record<string, unknown> | null;
  media: Array<{
    id: string;
    url: string;
    mediaType: "image" | "video";
    fileName: string | null;
  }>;
  lastError: string | null;
  lastAttemptedAt: string | null;
  providerResponse: Record<string, unknown> | null;
  bannerConfig: ResolvedConfig;
  bannerLabel: string | null;
  bannerOverrides: PostBannerOverrides;
  accountBannerDefaults: AccountBannerDefaults;
}

type ContentVariantRow = {
  media_ids: string[] | null;
  body?: string | null;
  banner_enabled?: boolean | null;
  banner_text_override?: string | null;
  banner_position?: BannerPosition | null;
  banner_bg?: string | null;
  banner_text_colour?: string | null;
};

type ContentRow = {
  id: string;
  platform: "facebook" | "instagram" | "gbp";
  placement: ContentPlacement;
  scheduled_for: string | null;
  status: PlannerItem["status"];
  auto_generated: boolean | null;
  prompt_context: Record<string, unknown> | null;
  campaigns: {
    name: string | null;
    campaign_type: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
  content_variants: ContentVariantRow[] | ContentVariantRow | null;
};

type ContentDetailVariantRow = {
  body: string | null;
  media_ids: string[] | null;
  banner_enabled?: boolean | null;
  banner_text_override?: string | null;

[truncated at line 200 — original has 954 lines]
```

### `src/lib/scheduling/banner-canvas.test.ts`

_(deleted or missing from working tree)_

### `src/lib/scheduling/banner-canvas.ts`

_(deleted or missing from working tree)_

### `src/lib/scheduling/banner-config.ts`

```
// src/lib/scheduling/banner-config.ts
//
// SCOPE: brand colour-id → hex map, form-side types and Zod schemas, default
// values, and the BANNER_EDITABLE_STATUSES list used by planner controls.
// This module is consumed by campaign creation forms and settings forms.
//
// DO NOT confuse with `src/lib/banner/config.ts` — that module owns the
// resolver (account_defaults + post_overrides → ResolvedConfig) and the
// types that wrap raw DB rows. The two modules are intentionally separate:
// this one represents UX surface concepts (colour ids, default presets,
// validation), the other represents publish-time resolution.
import { z } from "zod";

// --- Types ---

export const BANNER_POSITIONS = ["top", "bottom", "left", "right"] as const;
export type BannerPosition = (typeof BANNER_POSITIONS)[number];

/** The four brand colours available for banner bg and text */
export const BANNER_COLOURS = [
  { id: "gold", hex: "#a57626", label: "Gold" },
  { id: "green", hex: "#005131", label: "Green" },
  { id: "black", hex: "#1a1a1a", label: "Black" },
  { id: "white", hex: "#ffffff", label: "White" },
] as const;

export type BannerColourId = (typeof BANNER_COLOURS)[number]["id"];

export const BANNER_COLOUR_HEX: Record<BannerColourId, string> = {
  gold: "#a57626",
  green: "#005131",
  black: "#1a1a1a",
  white: "#ffffff",
};

export interface BannerConfig {
  schemaVersion: 1;
  enabled: boolean;
  position: BannerPosition;
  bgColour: BannerColourId;
  textColour: BannerColourId;
  customMessage?: string;
}

export interface BannerDefaults {
  position: BannerPosition;
  bgColour: BannerColourId;
  textColour: BannerColourId;
}

// --- Resolve hex colours from config ---

export function resolveColours(config: Pick<BannerConfig, "bgColour" | "textColour">): { bg: string; text: string } {
  return {
    bg: BANNER_COLOUR_HEX[config.bgColour] ?? BANNER_COLOUR_HEX.gold,
    text: BANNER_COLOUR_HEX[config.textColour] ?? BANNER_COLOUR_HEX.green,
  };
}

// --- Validation Helpers ---

function graphemeLength(str: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(str)].length;
}

export function sanitiseCustomMessage(
  msg: string | undefined | null
): string | undefined {
  if (msg == null) return undefined;
  const cleaned = msg.replace(/[\n\r\t\x00-\x1f\x7f]/g, "").trim().toUpperCase();
  return cleaned.length === 0 ? undefined : cleaned;
}

// --- Zod Schemas ---

const bannerColourIds = ["gold", "green", "black", "white"] as const;

export const BannerConfigSchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  position: z.enum(BANNER_POSITIONS),
  bgColour: z.enum(bannerColourIds),
  textColour: z.enum(bannerColourIds),
  customMessage: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (val == null || val.length === 0) return true;
        return graphemeLength(val) <= 20;
      },
      { message: "Custom message must be 20 characters or fewer" }
    ),
});

export const BannerDefaultsSchema = z.object({
  position: z.enum(BANNER_POSITIONS),
  bgColour: z.enum(bannerColourIds),
  textColour: z.enum(bannerColourIds),
});

// --- Defaults ---

export const DEFAULT_BANNER_DEFAULTS: BannerDefaults = {
  position: "right",
  bgColour: "gold",
  textColour: "white",
};

export const DEFAULT_BANNER_CONFIG: BannerConfig = {
  schemaVersion: 1,
  enabled: true,
  position: "right",
  bgColour: "gold",
  textColour: "white",
};

/**
 * Safely parse banner config from prompt_context JSONB.
 * Returns null if invalid or missing.
 */
export function parseBannerConfig(raw: unknown): BannerConfig | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const result = BannerConfigSchema.safeParse(obj.banner ?? obj);
  return result.success ? result.data : null;
}

/**
 * Build a BannerConfig from campaign defaults.
 */
export function bannerConfigFromDefaults(defaults?: BannerDefaults): BannerConfig {
  const d = defaults ?? DEFAULT_BANNER_DEFAULTS;
  return {
    schemaVersion: 1,
    enabled: true,
    position: d.position,
    bgColour: d.bgColour,
    textColour: d.textColour,
  };
}

/** Editable statuses — banner config can only be changed on these */
export const BANNER_EDITABLE_STATUSES = ["draft", "scheduled", "queued", "failed"] as const;
```

### `src/lib/scheduling/banner-renderer.server.ts`

_(deleted or missing from working tree)_

### `src/lib/scheduling/campaign-timing.ts`

```
// src/lib/scheduling/campaign-timing.ts
import { DateTime } from "luxon";

const DEFAULT_TZ = "Europe/London";

/**
 * Convert a JS getDay() weekday (0=Sunday..6=Saturday) — the format used by
 * weekly campaign metadata — into a Luxon weekday (1=Monday..7=Sunday).
 * Falls back to 1 (Monday) for non-numeric input.
 */
function jsDayToLuxonWeekday(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  if (n < 0 || n > 6) return 1;
  // JS: 0=Sun..6=Sat → Luxon: 7=Sun, 1=Mon, ..., 6=Sat
  return n === 0 ? 7 : n;
}

export interface CampaignTiming {
  campaignType: "event" | "promotion" | "weekly" | "story_series";
  startAt: DateTime;
  endAt?: DateTime;
  startTime?: string; // "HH:MM"
  weeklyDayOfWeek?: number; // 1=Mon..7=Sun (Luxon weekday)
  timezone: string;
}

/**
 * Extract canonical timing from a campaign's metadata.
 * Handles both current metadata shapes and legacy eventStart ISO strings.
 */
export function extractCampaignTiming(campaign: {
  campaign_type: string;
  metadata: unknown;
}): CampaignTiming {
  const meta = (campaign.metadata ?? {}) as Record<string, unknown>;
  const tz = DEFAULT_TZ;

  if (campaign.campaign_type === "weekly") {
    // metadata.dayOfWeek is stored in JS getDay() format (0=Sunday..6=Saturday)
    // — see src/lib/create/schema.ts:weeklyCampaignSchema.dayOfWeek and
    // supabase/functions/materialise-weekly/utils.ts:clampDay. We translate
    // to Luxon weekday (1=Monday..7=Sunday) here so getNextWeeklyOccurrence
    // and downstream banner-label code use the correct weekday math.
    return {
      campaignType: "weekly",
      startAt: DateTime.now().setZone(tz), // placeholder — weekly uses dayOfWeek
      weeklyDayOfWeek: jsDayToLuxonWeekday(meta.dayOfWeek),
      startTime: typeof meta.time === "string" ? meta.time : undefined,
      timezone: tz,
    };
  }

  // Parse startAt from metadata
  let startAt: DateTime;
  if (typeof meta.startDate === "string") {
    startAt = DateTime.fromISO(meta.startDate, { zone: tz });
  } else if (typeof meta.eventStart === "string") {
    // Legacy: full ISO timestamp
    startAt = DateTime.fromISO(meta.eventStart, { zone: tz });
  } else {
    startAt = DateTime.now().setZone(tz);
  }

  // Extract startTime from metadata or from parsed ISO
  let startTime: string | undefined;
  if (typeof meta.startTime === "string") {
    startTime = meta.startTime;
  } else if (typeof meta.eventStart === "string") {
    const parsed = DateTime.fromISO(meta.eventStart, { zone: tz });
    if (parsed.isValid) {
      startTime = parsed.toFormat("HH:mm");
    }
  }

  if (campaign.campaign_type === "promotion") {
    const endAt = typeof meta.endDate === "string"
      ? DateTime.fromISO(meta.endDate, { zone: tz })
      : undefined;

    return {
      campaignType: "promotion",
      startAt,
      endAt,
      startTime,
      timezone: tz,
    };
  }

  const resolvedType = campaign.campaign_type === "story_series" ? "story_series" : "event";

  return {
    campaignType: resolvedType,
    startAt,
    startTime,
    timezone: tz,
  };
}

/**
 * Calculate the next occurrence of a weekly event day relative to referenceAt.
 * If referenceAt is on or before the day this week, returns this week's occurrence.
 * If referenceAt is after the day this week, returns next week's occurrence.
 */
export function getNextWeeklyOccurrence(
  referenceAt: DateTime,
  dayOfWeek: number,
  timezone: string
): DateTime {
  const ref = referenceAt.setZone(timezone).startOf("day");
  const currentWeekday = ref.weekday; // 1=Mon..7=Sun

  let daysUntil = dayOfWeek - currentWeekday;
  if (daysUntil < 0) {
    daysUntil += 7;
  }

  return ref.plus({ days: daysUntil });
}
```

### `src/lib/settings/data.ts`

```
import { requireAuthContext } from "@/lib/auth/server";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { isSchemaMissingError } from "@/lib/supabase/errors";
import type { BannerPosition } from "@/lib/banner/config";

export interface BrandProfile {
  toneFormal: number;
  tonePlayful: number;
  keyPhrases: string[];
  bannedTopics: string[];
  bannedPhrases: string[];
  defaultHashtags: string[];
  defaultEmojis: string[];
  instagramSignature?: string;
  facebookSignature?: string;
  gbpCta?: string;
}

export interface PostingDefaults {
  timezone: string;
  facebookLocationId?: string;
  instagramLocationId?: string;
  gbpLocationId?: string;
  defaultPostingTime?: string;
  venueLocation?: string;
  venueLatitude?: number;
  venueLongitude?: number;
  notifications: {
    emailFailures: boolean;
    emailTokenExpiring: boolean;
  };
  gbpCtaDefaults: {
    standard: "LEARN_MORE" | "BOOK" | "CALL";
    event: "LEARN_MORE" | "BOOK" | "CALL";
    offer: "REDEEM" | "CALL" | "LEARN_MORE";
  };
  bannerDefaults: {
    bannersEnabled: boolean;
    bannerPosition: BannerPosition;
    bannerBg: string;
    bannerTextColour: string;
  };
}

export interface OwnerSettings {
  brand: BrandProfile;
  posting: PostingDefaults;
  venueName?: string;
  venueLocation?: string;
}

type BrandProfileRow = {
  tone_formal: number | null;
  tone_playful: number | null;
  key_phrases: string[] | null;
  banned_topics: string[] | null;
  banned_phrases: string[] | null;
  default_hashtags: string[] | null;
  default_emojis: string[] | null;
  instagram_signature: string | null;
  facebook_signature: string | null;
  gbp_cta: string | null;
};

type PostingDefaultsRow = {
  facebook_location_id: string | null;
  instagram_location_id: string | null;
  gbp_location_id: string | null;
  default_posting_time: string | null;
  venue_location: string | null;
  venue_latitude: number | string | null;
  venue_longitude: number | string | null;
  notifications: Record<string, boolean> | null;
  gbp_cta_standard: string;
  gbp_cta_event: string;
  gbp_cta_offer: string;
  banners_enabled: boolean | null;
  banner_position: BannerPosition | null;
  banner_bg: string | null;
  banner_text_colour: string | null;
};

type AccountRow = {
  timezone: string | null;
  display_name: string | null;
};

export async function getOwnerSettings(): Promise<OwnerSettings> {
  const { supabase, accountId } = await requireAuthContext();

  const defaultBrand: BrandProfile = {
    toneFormal: 0.5,
    tonePlayful: 0.5,
    keyPhrases: [],
    bannedTopics: [],
    bannedPhrases: [],
    defaultHashtags: [],
    defaultEmojis: [],
    instagramSignature: undefined,
    facebookSignature: undefined,
    gbpCta: "LEARN_MORE",
  };

  try {
    const [accountResult, linkInBioResult] = await Promise.all([
      supabase
        .from("accounts")
        .select("timezone, display_name")
        .eq("id", accountId)
        .maybeSingle<AccountRow>(),
      supabase
        .from("link_in_bio_profiles")
        .select("display_name")
        .eq("account_id", accountId)
        .maybeSingle<{ display_name: string | null }>(),
    ]);

    const { data: accountRow, error: accountError } = accountResult;
    const { data: linkInBioRow } = linkInBioResult;

    if (accountError && !isSchemaMissingError(accountError)) {
      throw accountError;
    }

    const timezone = DEFAULT_TIMEZONE;
    // Prioritize Link in Bio display name, fall back to account display name
    const venueName =
      linkInBioRow?.display_name?.trim() || accountRow?.display_name?.trim() || undefined;
    const defaultPosting = createDefaultPosting(timezone);

    const { data: brandRow, error: brandError } = await supabase
      .from("brand_profile")
      .select(
        "tone_formal, tone_playful, key_phrases, banned_topics, banned_phrases, default_hashtags, default_emojis, instagram_signature, facebook_signature, gbp_cta",
      )
      .eq("account_id", accountId)
      .maybeSingle<BrandProfileRow>();

    if (brandError) {
      if (isSchemaMissingError(brandError)) {
        return { brand: defaultBrand, posting: defaultPosting, venueName };
      }
      throw brandError;
    }

    const { data: postingRow, error: postingError } = await supabase
      .from("posting_defaults")
      .select(
        "facebook_location_id, instagram_location_id, gbp_location_id, default_posting_time, venue_location, venue_latitude, venue_longitude, notifications, gbp_cta_standard, gbp_cta_event, gbp_cta_offer, banners_enabled, banner_position, banner_bg, banner_text_colour",
      )
      .eq("account_id", accountId)
      .maybeSingle<PostingDefaultsRow>();

    if (postingError) {
      if (isSchemaMissingError(postingError)) {
        return { brand: defaultBrand, posting: defaultPosting, venueName };
      }
      throw postingError;
    }

    const notifications = postingRow?.notifications ?? defaultPosting.notifications;

    const brand: BrandProfile = {
      toneFormal: brandRow?.tone_formal ?? defaultBrand.toneFormal,
      tonePlayful: brandRow?.tone_playful ?? defaultBrand.tonePlayful,
      keyPhrases: brandRow?.key_phrases ?? defaultBrand.keyPhrases,
      bannedTopics: brandRow?.banned_topics ?? defaultBrand.bannedTopics,
      bannedPhrases: brandRow?.banned_phrases ?? defaultBrand.bannedPhrases,
      defaultHashtags: brandRow?.default_hashtags ?? defaultBrand.defaultHashtags,
      defaultEmojis: brandRow?.default_emojis ?? defaultBrand.defaultEmojis,
      instagramSignature: brandRow?.instagram_signature ?? defaultBrand.instagramSignature,
      facebookSignature: brandRow?.facebook_signature ?? defaultBrand.facebookSignature,
      gbpCta: brandRow?.gbp_cta ?? defaultBrand.gbpCta,
    };

    const posting: PostingDefaults = {
      timezone,
      facebookLocationId: postingRow?.facebook_location_id ?? undefined,
      instagramLocationId: postingRow?.instagram_location_id ?? undefined,
      gbpLocationId: postingRow?.gbp_location_id ?? undefined,
      defaultPostingTime: postingRow?.default_posting_time ?? undefined,
      venueLocation: postingRow?.venue_location ?? undefined,
      venueLatitude: normaliseOptionalNumber(postingRow?.venue_latitude),
      venueLongitude: normaliseOptionalNumber(postingRow?.venue_longitude),
      notifications: {
        emailFailures: Boolean(notifications?.emailFailures ?? defaultPosting.notifications.emailFailures),
        emailTokenExpiring: Boolean(notifications?.emailTokenExpiring ?? defaultPosting.notifications.emailTokenExpiring),
      },
      gbpCtaDefaults: {
        standard:
          (postingRow?.gbp_cta_standard as PostingDefaults["gbpCtaDefaults"]["standard"]) ?? defaultPosting.gbpCtaDefaults.standard,
        event:
          (postingRow?.gbp_cta_event as PostingDefaults["gbpCtaDefaults"]["event"]) ?? defaultPosting.gbpCtaDefaults.event,
        offer:
          (postingRow?.gbp_cta_offer as PostingDefaults["gbpCtaDefaults"]["offer"]) ?? defaultPosting.gbpCtaDefaults.offer,
      },
      bannerDefaults: {
        bannersEnabled: postingRow?.banners_enabled ?? defaultPosting.bannerDefaults.bannersEnabled,
        bannerPosition: postingRow?.banner_position ?? defaultPosting.bannerDefaults.bannerPosition,
        bannerBg: postingRow?.banner_bg ?? defaultPosting.bannerDefaults.bannerBg,

[truncated at line 200 — original has 246 lines]
```

### `tests/app/internal/render-banner-route.test.ts`

```
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { renderBannerServerMock } = vi.hoisted(() => ({
    renderBannerServerMock: vi.fn(),
}));

vi.mock("@/lib/banner/render-server", () => ({
    renderBannerServer: renderBannerServerMock,
}));

import { POST } from "@/app/api/internal/render-banner/route";

const VALID_CONFIG = {
    enabled: true,
    position: "bottom" as const,
    bgColour: "#000000",
    textColour: "#FFFFFF",
    textOverride: null,
};

// Setup pins NEXT_PUBLIC_SUPABASE_URL to https://mock.supabase.co — match it.
const ALLOWED_URL = "https://mock.supabase.co/storage/v1/object/sign/media/source.jpg";

function buildRequest(opts: {
    body?: unknown;
    headers?: Record<string, string>;
    rawBody?: string;
}): Request {
    const headers = new Headers(opts.headers ?? {});
    if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
    }
    const body = opts.rawBody !== undefined
        ? opts.rawBody
        : opts.body !== undefined
            ? JSON.stringify(opts.body)
            : undefined;
    return new Request("http://localhost/api/internal/render-banner", {
        method: "POST",
        headers,
        body,
    });
}

function buildAllowedSourceResponse(bytes: Uint8Array): Response {
    // Cast to BodyInit — Uint8Array is accepted by the Response constructor at
    // runtime in Node 20+ but the lib.dom typings only list ArrayBuffer/Blob/etc.
    return new Response(bytes as unknown as BodyInit, {
        status: 200,
        headers: { "content-length": String(bytes.byteLength) },
    });
}

describe("POST /api/internal/render-banner", () => {
    const originalCronSecret = process.env.CRON_SECRET;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        process.env.CRON_SECRET = "test-cron-secret";
        renderBannerServerMock.mockReset();
    });

    afterEach(() => {
        if (originalCronSecret === undefined) {
            delete process.env.CRON_SECRET;
        } else {
            process.env.CRON_SECRET = originalCronSecret;
        }
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("returns 500 when CRON_SECRET is not configured", async () => {
        delete process.env.CRON_SECRET;

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer anything" },
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json).toEqual({ error: "CRON_SECRET not configured" });
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 401 when authorization header is missing", async () => {
        const response = await POST(buildRequest({
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(401);
        const json = await response.json();
        expect(json).toEqual({ error: "Unauthorized" });
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 401 when authorization header is wrong", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer wrong-secret" },
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(401);
        const json = await response.json();
        expect(json).toEqual({ error: "Unauthorized" });
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid JSON body", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            rawBody: "{not json",
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "Invalid JSON body" });
    });

    it("returns 400 when body fields are missing or invalid", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG },
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "Invalid request body" });
    });

    it("returns 400 when config has invalid position", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: {
                sourceMediaUrl: ALLOWED_URL,
                config: { ...VALID_CONFIG, position: "centre" },
                label: "TONIGHT",
            },
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "Invalid request body" });
    });

    it("rejects sources on a non-allowlisted host", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "https://evil.example.com/x.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.error).toMatch(/^BANNER_RENDER_FAILED: source media host not allowed/);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("rejects non-https schemes", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "http://mock.supabase.co/x.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.error).toMatch(/^BANNER_RENDER_FAILED: source media URL scheme not allowed/);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("rejects relative or invalid URLs", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "/relative/path.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.error).toMatch(/^BANNER_RENDER_FAILED: source media URL is not a valid absolute URL/);
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("rejects sources missing Content-Length", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
        );

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();

[truncated at line 200 — original has 312 lines]
```

### `tests/features/settings/schema.test.ts`

```
import { describe, expect, it } from "vitest";

import { postingDefaultsFormSchema } from "@/features/settings/schema";

const basePostingDefaults = {
  timezone: "Europe/London",
  notifications: {
    emailFailures: true,
    emailTokenExpiring: true,
  },
  gbpCtaDefaults: {
    standard: "LEARN_MORE",
    event: "LEARN_MORE",
    offer: "REDEEM",
  },
  bannerDefaults: {
    bannersEnabled: false,
    bannerPosition: "bottom",
    bannerBg: "#000000",
    bannerTextColour: "#ffffff",
  },
} as const;

describe("postingDefaultsFormSchema", () => {
  it("trims a visible venue location for paid ads targeting", () => {
    const parsed = postingDefaultsFormSchema.parse({
      ...basePostingDefaults,
      venueLocation: "  123 High Street, Leatherhead  ",
    });

    expect(parsed.venueLocation).toBe("123 High Street, Leatherhead");
  });

  it("allows the venue location field to be left blank", () => {
    const parsed = postingDefaultsFormSchema.parse({
      ...basePostingDefaults,
      venueLocation: "",
    });

    expect(parsed.venueLocation).toBe("");
  });

  it("accepts valid Meta Ads coordinates", () => {
    const parsed = postingDefaultsFormSchema.parse({
      ...basePostingDefaults,
      venueLatitude: "51.4625",
      venueLongitude: "-0.5021",
    });

    expect(parsed.venueLatitude).toBe("51.4625");
    expect(parsed.venueLongitude).toBe("-0.5021");
  });

  it("requires latitude and longitude to be entered together", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...basePostingDefaults,
      venueLatitude: "51.4625",
      venueLongitude: "",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("both latitude and longitude");
  });

  it("rejects out-of-range coordinates", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...basePostingDefaults,
      venueLatitude: "151.4625",
      venueLongitude: "-0.5021",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("UK latitude");
  });

  it("rejects likely swapped coordinates", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...basePostingDefaults,
      venueLatitude: "-0.5021",
      venueLongitude: "51.4625",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).join(" ")).toContain("UK latitude");
  });
});
```

### `tests/lib/create/banner-override.test.ts`

```
// F4: when the user has not customised the banner appearance on the
// campaign-creation form (BannerDefaults exactly matches the form's initial
// state), no override columns may be written — the variant must inherit the
// account-level configuration including banners_enabled. Forcing banner_enabled
// true would silently override account-level "off".
import { describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "https://example.com/key";
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "supabase-service-role-key";

const { computeBannerOverride } = await import("@/lib/create/service");
const { DEFAULT_BANNER_DEFAULTS } = await import("@/lib/scheduling/banner-config");

describe("computeBannerOverride [F4]", () => {
  it("returns null when bannerDefaults is undefined", () => {
    expect(computeBannerOverride(undefined)).toBeNull();
  });

  it("returns null when bannerDefaults exactly matches DEFAULT_BANNER_DEFAULTS", () => {
    // The user opened the form, didn't touch the banner picker, submitted.
    // The variant must inherit account defaults — including banners_enabled.
    expect(computeBannerOverride({ ...DEFAULT_BANNER_DEFAULTS })).toBeNull();
  });

  it("never sets banner_enabled — only appearance columns", () => {
    const override = computeBannerOverride({
      position: "top",
      bgColour: "black",
      textColour: "white",
    });

    expect(override).not.toBeNull();
    expect(override).not.toHaveProperty("banner_enabled");
  });

  it("returns the customised position when only position differs", () => {
    const override = computeBannerOverride({
      ...DEFAULT_BANNER_DEFAULTS,
      position: "top",
    });

    expect(override).toEqual({
      banner_position: "top",
      banner_bg: expect.any(String),
      banner_text_colour: expect.any(String),
    });
  });

  it("returns customised colours when only bgColour differs", () => {
    const override = computeBannerOverride({
      ...DEFAULT_BANNER_DEFAULTS,
      bgColour: "black",
    });

    expect(override).not.toBeNull();
    expect(override?.banner_bg).toBe("#1a1a1a");
  });

  it("returns customised text colour when only textColour differs", () => {
    const override = computeBannerOverride({
      ...DEFAULT_BANNER_DEFAULTS,
      textColour: "green",
    });

    expect(override).not.toBeNull();
    expect(override?.banner_text_colour).toBe("#005131");
  });
});
```

### `tests/lib/scheduling/banner-renderer.server.test.ts`

_(deleted or missing from working tree)_

### `tests/lib/scheduling/campaign-timing.test.ts`

```
// tests/lib/scheduling/campaign-timing.test.ts
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  extractCampaignTiming,
  getNextWeeklyOccurrence,
} from "@/lib/scheduling/campaign-timing";

const TZ = "Europe/London";

describe("extractCampaignTiming", () => {
  it("should extract event campaign timing", () => {
    const campaign = {
      campaign_type: "event",
      metadata: {
        startDate: "2026-05-06",
        startTime: "19:00",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.campaignType).toBe("event");
    expect(result.startAt.toISODate()).toBe("2026-05-06");
    expect(result.startTime).toBe("19:00");
    expect(result.endAt).toBeUndefined();
    expect(result.timezone).toBe(TZ);
  });

  it("should extract promotion campaign timing with end date", () => {
    const campaign = {
      campaign_type: "promotion",
      metadata: {
        startDate: "2026-05-01",
        endDate: "2026-05-15",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.campaignType).toBe("promotion");
    expect(result.startAt.toISODate()).toBe("2026-05-01");
    expect(result.endAt?.toISODate()).toBe("2026-05-15");
    expect(result.startTime).toBeUndefined();
  });

  it("should extract weekly campaign timing", () => {
    const campaign = {
      campaign_type: "weekly",
      metadata: {
        dayOfWeek: 4, // Thursday — same value in JS and Luxon
        time: "19:30",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.campaignType).toBe("weekly");
    expect(result.weeklyDayOfWeek).toBe(4);
    expect(result.startTime).toBe("19:30");
  });

  // F6: metadata.dayOfWeek is stored as JS getDay() (0=Sun..6=Sat). The
  // CampaignTiming.weeklyDayOfWeek field must be expressed as a Luxon
  // weekday (1=Mon..7=Sun) so getNextWeeklyOccurrence works correctly.
  // 0 (Sunday in JS) must convert to 7 (Sunday in Luxon).
  it("should translate Sunday (JS 0) to Luxon Sunday (7)", () => {
    const campaign = {
      campaign_type: "weekly",
      metadata: {
        dayOfWeek: 0, // Sunday in JS getDay
        time: "12:00",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.weeklyDayOfWeek).toBe(7);
  });

  it("should leave Monday (JS 1) as Luxon 1", () => {
    const campaign = {
      campaign_type: "weekly",
      metadata: { dayOfWeek: 1, time: "12:00" },
    };
    expect(extractCampaignTiming(campaign).weeklyDayOfWeek).toBe(1);
  });

  it("should leave Saturday (JS 6) as Luxon 6", () => {
    const campaign = {
      campaign_type: "weekly",
      metadata: { dayOfWeek: 6, time: "12:00" },
    };
    expect(extractCampaignTiming(campaign).weeklyDayOfWeek).toBe(6);
  });

  it("should handle event with eventStart ISO string (legacy metadata)", () => {
    const campaign = {
      campaign_type: "event",
      metadata: {
        eventStart: "2026-05-06T19:00:00.000Z",
      },
    };
    const result = extractCampaignTiming(campaign);
    expect(result.campaignType).toBe("event");
    expect(result.startAt).toBeDefined();
  });
});

describe("getNextWeeklyOccurrence", () => {
  it("should return this week's day if before it", () => {
    // Monday referencing Thursday (dayOfWeek=4)
    const ref = DateTime.fromISO("2026-05-04T10:00:00", { zone: TZ }); // Monday
    const result = getNextWeeklyOccurrence(ref, 4, TZ);
    expect(result.weekday).toBe(4);
    expect(result.toISODate()).toBe("2026-05-07"); // Thursday same week
  });

  it("should return next week's day if after it", () => {
    // Friday referencing Thursday (dayOfWeek=4)
    const ref = DateTime.fromISO("2026-05-08T10:00:00", { zone: TZ }); // Friday
    const result = getNextWeeklyOccurrence(ref, 4, TZ);
    expect(result.weekday).toBe(4);
    expect(result.toISODate()).toBe("2026-05-14"); // Thursday next week
  });

  it("should return today if same day and time not yet passed", () => {
    // Thursday morning referencing Thursday
    const ref = DateTime.fromISO("2026-05-07T08:00:00", { zone: TZ }); // Thursday
    const result = getNextWeeklyOccurrence(ref, 4, TZ);
    expect(result.toISODate()).toBe("2026-05-07");
  });
});
```

### `tests/publish-queue-banner-label.test.ts`

```
// F3: this file lives separately so we can vi.mock the banner-label module
// (the worker imports it with a .ts extension) without disrupting the rest
// of the publish-queue test suite. The fix being verified:
// when extractCampaignTiming or getProximityLabel throws, the error must NOT
// be swallowed — it must rethrow as BANNER_RENDER_FAILED so the job fails
// without invoking any platform.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Hoist mocks so the worker import below sees them.
const { extractCampaignTimingMock, getProximityLabelMock } = vi.hoisted(() => ({
    extractCampaignTimingMock: vi.fn(),
    getProximityLabelMock: vi.fn(),
}));

vi.mock("../supabase/functions/publish-queue/banner-label.ts", () => ({
    extractCampaignTiming: extractCampaignTimingMock,
    getProximityLabel: getProximityLabelMock,
}));

import { PublishQueueWorker, createDefaultConfig } from "../supabase/functions/publish-queue/worker";
import type { ProviderPlatform, ProviderPublishRequest, ProviderPublishResult } from "../supabase/functions/publish-queue/providers/types";

// Minimal mock supabase shape — we only call .from() returning chainable thenables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSupabase: any = {
    from: vi.fn(),
    storage: { from: vi.fn() },
    rpc: vi.fn(),
};

class TestWorker extends PublishQueueWorker {
    async publishByPlatform(platform: ProviderPlatform, request: ProviderPublishRequest): Promise<ProviderPublishResult> {
        return super.publishByPlatform(platform, request);
    }
    async recoverStuckJobs() {
        return;
    }
    protected async recordHeartbeat() {
        return;
    }
    protected async ensureJobsForScheduledContent() {
        return;
    }
}

describe("PublishQueueWorker — F3 label compute throw", () => {
    let worker: TestWorker;
    const config = createDefaultConfig();

    beforeEach(() => {
        vi.clearAllMocks();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        worker = new TestWorker(config, mockSupabase as any);
        mockSupabase.rpc.mockResolvedValue({ data: { context: "test" }, error: null });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("rethrows label-compute errors as BANNER_RENDER_FAILED and never publishes", async () => {
        const job = {
            id: "job-label-throw",
            content_item_id: "content-label-throw",
            variant_id: "variant-label-throw",
            status: "queued",
            attempt: 0,
            placement: "feed" as const,
        };

        // Make the label compute throw mid-flight. This is the precise condition
        // that the F3 fix turns from a silent swallow into a hard failure.
        getProximityLabelMock.mockImplementation(() => {
            throw new Error("boom");
        });
        extractCampaignTimingMock.mockReturnValue({
            campaignType: "event",
            startAt: { setZone: () => ({}) },
            timezone: "Europe/London",
        });

        // 1. Jobs fetch
        mockSupabase.from.mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
        });
        // 2. Lock
        mockSupabase.from.mockReturnValueOnce({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: job.id }, error: null }),
        });
        // 3. Content (with a campaign so the label code runs)
        mockSupabase.from.mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: {
                    id: job.content_item_id,
                    account_id: "acc",
                    platform: "facebook",
                    placement: "feed",
                    scheduled_for: "2026-04-29T08:00:00.000+01:00",
                    prompt_context: {},
                    campaigns: {
                        campaign_type: "event",
                        metadata: { startDate: "2026-04-29", startTime: "18:00" },
                    },
                },
                error: null,
            }),
        });
        // 4. Variant
        mockSupabase.from.mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: {
                    id: job.variant_id,
                    content_item_id: job.content_item_id,
                    body: "x",
                    media_ids: ["media-1"],
                    banner_enabled: null,
                    banner_text_override: null,
                    banner_position: null,
                    banner_bg: null,
                    banner_text_colour: null,
                },
                error: null,
            }),
        });
        // 5. Connection
        mockSupabase.from.mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: {
                    id: "conn",
                    provider: "facebook",
                    status: "active",
                    access_token: "t",
                    metadata: { pageId: "p" },
                },
                error: null,
            }),
        });
        // 6. markContentStatus(publishing)
        mockSupabase.from.mockReturnValueOnce({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
        });
        // 7. posting_defaults — return defaults so banner is enabled and we
        //    enter the label-compute path that we forced to throw.
        mockSupabase.from.mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: {
                    banners_enabled: true,
                    banner_position: "bottom",
                    banner_bg: "#000000",
                    banner_text_colour: "#FFFFFF",
                },
                error: null,
            }),
        });

        // 8/9/10 — handleFailure path: publish_jobs.update, content.status, notification
        mockSupabase.from.mockReturnValueOnce({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
        });
        mockSupabase.from.mockReturnValueOnce({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
        });
        const notificationInsert = vi.fn().mockResolvedValue({ error: null });
        mockSupabase.from.mockReturnValueOnce({ insert: notificationInsert });

        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const publishSpy = vi.spyOn(worker, "publishByPlatform");

        const result = await worker.processDueJobs();
        expect(result.processed).toBe(1);
        expect(publishSpy).not.toHaveBeenCalled();
        // The render endpoint should never be reached when label compute fails.
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(notificationInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                metadata: expect.objectContaining({
                    error: expect.stringContaining("BANNER_RENDER_FAILED: label computation failed"),
                }),
            }),
        );
    });
});
```

### `tests/publish-queue.test.ts`

```
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PublishQueueWorker, createDefaultConfig } from "../supabase/functions/publish-queue/worker";
import type { ProviderPlatform, ProviderPublishRequest, ProviderPublishResult } from "../supabase/functions/publish-queue/providers/types";

// Mock Supabase Client
const mockSupabase = {
    from: vi.fn(),
    storage: {
        from: vi.fn(),
    },
    rpc: vi.fn(),
};

// Test-specific Worker subclass to override protected methods
class TestWorker extends PublishQueueWorker {
    // Spy on this method to inject responses
    async publishByPlatform(platform: ProviderPlatform, request: ProviderPublishRequest): Promise<ProviderPublishResult> {
        return super.publishByPlatform(platform, request);
    }

    // Stub recovery to avoid breaking existing test mocks
    async recoverStuckJobs() {
        return;
    }

    protected async recordHeartbeat() {
        return;
    }

    protected async ensureJobsForScheduledContent() {
        return;
    }

    // Expose real implementation for testing
    public async testEnsureJobsForScheduledContent(windowIso: string, nowIso: string) {
        return PublishQueueWorker.prototype["ensureJobsForScheduledContent"].call(this, windowIso, nowIso);
    }
}

describe("PublishQueueWorker", () => {
    let worker: TestWorker;
    const config = createDefaultConfig();

    beforeEach(() => {
        vi.clearAllMocks();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        worker = new TestWorker(config, mockSupabase as any);

        // Default mocks
        mockSupabase.rpc.mockResolvedValue({ data: { context: "test" }, error: null });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("processDueJobs", () => {
        it("handles empty queue gracefully", async () => {
            mockSupabase.from.mockReturnValue({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            });

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(0);
        });

        it("processes a valid facebook job successfully", async () => {
            // 1. Mock jobs fetch
            const job = {
                id: "job-1",
                content_item_id: "content-1",
                variant_id: "variant-1",
                status: "queued",
                attempt: 0,
                placement: "feed",
            };

            mockSupabase.from.mockReturnValueOnce({ // select jobs
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
            });

            // 2. Mock lockJob
            mockSupabase.from.mockReturnValueOnce({ // update status=in_progress
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }),
            });

            // 3. Mock loadContent
            mockSupabase.from.mockReturnValueOnce({ // select content
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "content-1",
                        account_id: "acc-1",
                        platform: "facebook",
                        placement: "feed",
                        prompt_context: {},
                        campaigns: null
                    },
                    error: null
                }),
            });

            // 4. Mock loadVariant — banner override columns all null (banner disabled by default since no posting_defaults loaded)
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "variant-1",
                        content_item_id: "content-1",
                        body: "Hello World",
                        media_ids: [],
                        banner_enabled: null,
                        banner_text_override: null,
                        banner_position: null,
                        banner_bg: null,
                        banner_text_colour: null,
                    },
                    error: null,
                }),
            });

            // 5. Mock loadConnection
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "conn-1",
                        provider: "facebook",
                        status: "active",
                        access_token: "token",
                        metadata: { pageId: "123" }
                    },
                    error: null
                }),
            });

            // 6. Mock markContentStatus (publishing)
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) });

            // 7. Mock posting_defaults lookup (banner preflight): no row → renderBannerPreflight short-circuits.
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            });

            // 8. Mock publishByPlatform (Stub the response)
            const publishSpy = vi.spyOn(worker, 'publishByPlatform').mockResolvedValue({
                platform: 'facebook',
                externalId: 'post-123',
                payloadPreview: 'Hello World',
                publishedAt: new Date().toISOString()
            });

            // 9. Mock markJobSucceeded
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) });
            // 10. Mock markContentStatus (posted)
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) });
            // 11. Mock insertNotification
            mockSupabase.from.mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: null }) });

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(1);
            expect(publishSpy).toHaveBeenCalled();
        });

        it("handles retry logic on network failure", async () => {
            // 1. Mock jobs fetch
            const job = { id: "job-2", content_item_id: "content-2", variant_id: "variant-2", status: "queued", attempt: 0, placement: "feed" };
            mockSupabase.from.mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [job], error: null }) });

            // 2. Lock
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "job-2" }, error: null }) });

            // 3. Content
            mockSupabase.from.mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "content-2", account_id: "acc-1", platform: "facebook", placement: "feed" }, error: null }) });
            // 4. Variant — banner override columns all null
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "variant-2",
                        content_item_id: "content-2",
                        body: "Retry me",
                        media_ids: [],

[truncated at line 200 — original has 826 lines]
```

### `tests/setup.ts`

```

import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Disable Framer Motion animations in tests to prevent timing issues.
// The node test environment has no DOM, so we return simple passthrough stubs.
vi.mock('framer-motion', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  motion: new Proxy({}, { get: (_, __) => (props: Record<string, unknown>) => props['children'] ?? null }),
  AnimatePresence: ({ children }: { children: unknown }) => children,
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn(), set: vi.fn() }),
  useMotionValue: (initial: number) => ({ get: () => initial, set: vi.fn() }),
  useTransform: () => ({ get: () => 0 }),
  useSpring: (initial: number) => ({ get: () => initial, set: vi.fn() }),
}));

// Set env vars required by src/env.ts for tests that import modules using the env singleton.
// These are mock values — no real services are called in tests.
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'mock-anon-key';
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://mock.supabase.co';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'mock-openai-key';
process.env.CRON_SECRET = process.env.CRON_SECRET ?? 'mock-cron-secret';
process.env.BANNER_RENDER_URL = process.env.BANNER_RENDER_URL ?? 'http://localhost/api/internal/render-banner';

// Mock Deno global if it doesn't exist
// @ts-expect-error - implicit any on globalThis
if (!globalThis.Deno) {
    // @ts-expect-error - overriding global fetch for tests
    globalThis.Deno = {
        env: {
            get: (key: string) => {
                const env: Record<string, string> = {
                    NEXT_PUBLIC_SUPABASE_URL: "https://mock.supabase.co",
                    SUPABASE_SERVICE_ROLE_KEY: "mock-key",
                    MEDIA_BUCKET: "media",
                    ALERT_EMAIL: "test@example.com",
                    META_GRAPH_VERSION: "v19.0",
                    CRON_SECRET: "mock-cron-secret",
                    BANNER_RENDER_URL: "http://localhost/api/internal/render-banner",
                };
                return env[key] || process.env[key];
            },
            toObject: () => process.env,
        },
    };
}
```

### `tests/supabase/publish-queue/banner-label.test.ts`

```
// F6: the publish-queue worker copy of extractCampaignTiming must convert
// JS getDay() weekday (0=Sun..6=Sat — the format stored in campaign metadata)
// into a Luxon weekday (1=Mon..7=Sun) so the downstream label code uses the
// correct weekday math. The bug only manifested at the Sunday boundary.
import { describe, expect, it } from "vitest";
import { extractCampaignTiming } from "../../../supabase/functions/publish-queue/banner-label";

describe("supabase/publish-queue/banner-label extractCampaignTiming [F6]", () => {
    it("translates Sunday (JS 0) to Luxon Sunday (7)", () => {
        const result = extractCampaignTiming({
            campaign_type: "weekly",
            metadata: { dayOfWeek: 0, time: "12:00" },
        });
        expect(result.weeklyDayOfWeek).toBe(7);
    });

    it("leaves Monday (JS 1) as Luxon 1", () => {
        const result = extractCampaignTiming({
            campaign_type: "weekly",
            metadata: { dayOfWeek: 1, time: "12:00" },
        });
        expect(result.weeklyDayOfWeek).toBe(1);
    });

    it("leaves Saturday (JS 6) as Luxon 6", () => {
        const result = extractCampaignTiming({
            campaign_type: "weekly",
            metadata: { dayOfWeek: 6, time: "12:00" },
        });
        expect(result.weeklyDayOfWeek).toBe(6);
    });

    it("falls back to 1 (Monday) for non-numeric input", () => {
        const result = extractCampaignTiming({
            campaign_type: "weekly",
            metadata: { dayOfWeek: "not-a-number", time: "12:00" },
        });
        expect(result.weeklyDayOfWeek).toBe(1);
    });
});
```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
.agents/skills/obsidian-docs/SKILL.md
.agents/skills/obsidian-docs/references/change-request-protocol.md
.agents/skills/obsidian-docs/references/templates.md
.claude/skills/obsidian-docs/SKILL.md
.claude/skills/obsidian-docs/references/change-request-protocol.md
.claude/skills/obsidian-docs/references/templates.md
.github/workflows/ci.yml
.gitignore
.superpowers/brainstorm/18776-1777198840/content/edge-banners.html
.superpowers/brainstorm/47462-1777194875/content/edge-banners.html
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

---

_End of pack._
