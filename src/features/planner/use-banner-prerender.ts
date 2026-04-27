"use client";

import { useCallback, useRef, useState } from "react";
import { renderBannerCanvas } from "@/lib/scheduling/banner-canvas";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import { extractCampaignTiming } from "@/lib/scheduling/campaign-timing";
import type { BannerConfig } from "@/lib/scheduling/banner-config";
import { createBannerUploadUrl } from "@/app/(app)/planner/actions";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { MEDIA_BUCKET } from "@/lib/constants";
import { DateTime } from "luxon";

export interface PrerenderedBanner {
  storagePath: string;
  label: string;
  scheduledAt: string;
  sourceMediaPath: string;
  renderMetadata: Record<string, unknown>;
}

export interface PrerenderInput {
  contentItemId: string;
  bannerConfig: BannerConfig | null;
  scheduledFor: string | null;
  campaign: {
    campaignType: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
  sourceImageUrl: string | null;
  sourceMediaPath: string | null;
  placement: "feed" | "story";
}

export function useBannerPrerender(): {
  prerenderBanner: (input: PrerenderInput) => Promise<PrerenderedBanner | "not_applicable" | { error: string }>;
  isRendering: boolean;
} {
  const renderingRef = useRef(false);
  const [isRendering, setIsRendering] = useState(false);

  const prerenderBanner = useCallback(
    async (input: PrerenderInput): Promise<PrerenderedBanner | "not_applicable" | { error: string }> => {
      if (renderingRef.current) {
        return { error: "Banner render already in progress" };
      }

      const { contentItemId, bannerConfig, scheduledFor, campaign, sourceImageUrl, sourceMediaPath, placement } = input;

      // No banner configured
      if (!bannerConfig?.enabled) {
        return "not_applicable";
      }

      // Compute label
      let labelText: string | null = null;

      if (bannerConfig.customMessage?.trim()) {
        labelText = bannerConfig.customMessage.trim().toUpperCase();
      } else if (campaign?.campaignType && campaign?.metadata && scheduledFor) {
        const timing = extractCampaignTiming({
          campaign_type: campaign.campaignType,
          metadata: campaign.metadata,
        });
        const referenceAt = DateTime.fromISO(scheduledFor, { zone: timing.timezone });
        labelText = getProximityLabel({ referenceAt, campaignTiming: timing });
      }

      // No label — not applicable (7+ days away or post-event)
      if (!labelText) {
        return "not_applicable";
      }

      if (!sourceImageUrl) {
        return { error: "No source image available for banner rendering" };
      }

      renderingRef.current = true;
      setIsRendering(true);

      try {
        // 1. Render banner on canvas
        const blob = await renderBannerCanvas({
          imageUrl: sourceImageUrl,
          position: bannerConfig.position,
          bgColour: bannerConfig.bgColour,
          textColour: bannerConfig.textColour,
          labelText,
        });

        // 2. Get signed upload URL from server
        const uploadResult = await createBannerUploadUrl({ contentItemId });
        if ("error" in uploadResult) {
          return { error: uploadResult.error };
        }

        // 3. Upload the blob via the signed URL
        const supabase = createBrowserSupabaseClient();
        // Extract the token from the signed URL for uploadToSignedUrl
        const urlObj = new URL(uploadResult.signedUrl);
        const token = urlObj.searchParams.get("token") ?? "";

        const { error: uploadError } = await supabase.storage
          .from(MEDIA_BUCKET)
          .uploadToSignedUrl(uploadResult.storagePath, token, blob, {
            contentType: "image/jpeg",
          });

        if (uploadError) {
          return { error: `Banner upload failed: ${uploadError.message}` };
        }

        return {
          storagePath: uploadResult.storagePath,
          label: labelText,
          scheduledAt: scheduledFor ?? new Date().toISOString(),
          sourceMediaPath: sourceMediaPath ?? "",
          renderMetadata: {
            position: bannerConfig.position,
            bgColour: bannerConfig.bgColour,
            textColour: bannerConfig.textColour,
            placement,
          },
        };
      } finally {
        renderingRef.current = false;
        setIsRendering(false);
      }
    },
    [],
  );

  return { prerenderBanner, isRendering };
}
