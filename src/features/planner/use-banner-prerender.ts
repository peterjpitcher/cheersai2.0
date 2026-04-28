"use client";

import { useCallback, useRef, useState } from "react";
import type { BannerConfig } from "@/lib/scheduling/banner-config";
import { renderPlannerContentBanner } from "@/app/(app)/planner/actions";

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

      const { contentItemId, bannerConfig } = input;

      // No banner configured
      if (!bannerConfig?.enabled) {
        return "not_applicable";
      }

      renderingRef.current = true;
      setIsRendering(true);

      try {
        const result = await renderPlannerContentBanner({ contentId: contentItemId });
        if (result.status === "not_applicable" || result.status === "skipped") {
          return "not_applicable";
        }

        return {
          storagePath: result.storagePath,
          label: result.label,
          scheduledAt: result.scheduledAt ?? new Date().toISOString(),
          sourceMediaPath: result.sourceMediaPath,
          renderMetadata: result.renderMetadata,
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Banner render failed" };
      } finally {
        renderingRef.current = false;
        setIsRendering(false);
      }
    },
    [],
  );

  return { prerenderBanner, isRendering };
}
