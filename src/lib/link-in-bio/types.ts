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
