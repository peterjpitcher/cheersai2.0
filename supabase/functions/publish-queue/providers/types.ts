export type ProviderPlatform = "facebook" | "instagram" | "gbp";
export type ProviderPlacement = "feed" | "story";

export interface ProviderMedia {
  id: string;
  url: string;
  mediaType: "image" | "video";
  mimeType?: string | null;
}

export interface ProviderPublishPayload {
  body: string;
  media: ProviderMedia[];
  scheduledFor?: string | null;
  campaignName?: string | null;
  promptContext?: Record<string, unknown> | null;
  placement: ProviderPlacement;
}

export interface ProviderAuthContext {
  connectionId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
}

export interface ProviderPublishRequest {
  payload: ProviderPublishPayload;
  auth: ProviderAuthContext;
  accountId: string;
  contentId: string;
  attempt: number;
  connectionMetadata: Record<string, unknown> | null;
  placement: ProviderPlacement;
}

export interface ProviderPublishResult {
  platform: ProviderPlatform;
  externalId: string;
  payloadPreview: string;
  publishedAt: string;
  rawResponse?: unknown;
}
