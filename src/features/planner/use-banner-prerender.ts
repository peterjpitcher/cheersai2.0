"use client";

import type { BannerConfig } from "@/lib/scheduling/banner-config";

/**
 * Input for the banner pre-render hook.
 * Stub — the server actions agent will provide the full implementation.
 */
export interface BannerPrerenderInput {
  contentItemId: string;
  bannerConfig: BannerConfig;
  scheduledFor: string | null;
  campaign: {
    campaignType: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
  sourceImageUrl: string | null;
  sourceMediaPath: string | null;
  placement: "feed" | "story";
}

export interface BannerPrerenderSuccess {
  storagePath: string;
  label: string;
  scheduledAt: string;
  sourceMediaPath: string | null;
  renderMetadata: Record<string, unknown>;
}

export type BannerPrerenderResult =
  | BannerPrerenderSuccess
  | { error: string }
  | "not_applicable";

/**
 * Hook to pre-render banner overlays before approval.
 *
 * STUB: Returns a no-op that resolves to "not_applicable".
 * The server actions agent will replace this with the real implementation
 * that uploads the rendered banner to Supabase Storage.
 */
export function useBannerPrerender(): {
  prerenderBanner: (input: BannerPrerenderInput) => Promise<BannerPrerenderResult>;
} {
  const prerenderBanner = async (
    _input: BannerPrerenderInput,
  ): Promise<BannerPrerenderResult> => {
    // Stub — real implementation will render canvas + upload to storage
    return "not_applicable";
  };

  return { prerenderBanner };
}
