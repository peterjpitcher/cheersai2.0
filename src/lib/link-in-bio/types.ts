import type { ResolvedConfig } from "@/lib/banner/config";
import type { MediaAssetSummary } from "@/lib/library/data";

// ---------------------------------------------------------------------------
// Enums / union types (D-01, D-03, D-08)
// ---------------------------------------------------------------------------

/** Tile type determines the rendering and embed behaviour (D-01). */
export type TileType = 'link' | 'media' | 'embed_map' | 'embed_menu' | 'embed_social' | 'embed_events';

/** Layout template selection (D-08). */
export type LinkInBioTemplate = 'classic' | 'grid' | 'magazine' | 'minimal';

/** Curated font selection for link-in-bio pages (D-03). */
export type LinkInBioFont = 'inter' | 'playfair' | 'space-grotesk' | 'dm-serif';

// ---------------------------------------------------------------------------
// Embed data shapes
// ---------------------------------------------------------------------------

export interface EmbedMapData {
  placeId: string;
  query: string;
}

export interface EmbedMenuData {
  pdfUrl: string;
  title: string;
}

export interface EmbedSocialData {
  platform: 'instagram' | 'facebook';
  postUrl: string;
}

export interface EmbedEventsData {
  maxItems: number;
}

// ---------------------------------------------------------------------------
// Click tracking
// ---------------------------------------------------------------------------

export interface ClickTrackingEvent {
  profileId: string;
  tileId: string | null;
  clickType: 'tile' | 'cta' | 'social';
  referrer: string | null;
}

// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

export interface LinkInBioProfile {
  accountId: string;
  slug: string;
  displayName: string | null;
  bio: string | null;
  logoUrl: string | null;
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
  template: LinkInBioTemplate;
  fontFamily: LinkInBioFont;
  isPublished: boolean;
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
  tileType: TileType;
  embedData: Record<string, unknown> | null;
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
  tileType: TileType;
  embedData: Record<string, unknown> | null;
  media?: {
    url: string;
    shape: "square" | "story";
  } | null;
}

export interface PublicCampaignCard {
  id: string;
  campaignId: string;
  name: string;
  campaignType: string;
  scheduledFor: string;
  endAt: string;
  linkUrl: string;
  ctaLabel: string | null;
  summary: string | null;
  displayStartsAt: string | null;
  displayEndsAt: string | null;
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

export interface PublicWebsiteEvent {
  id: string;
  slug: string | null;
  name: string;
  startsAt: string;
  status: string | null;
  categoryLabel: string | null;
  summary: string | null;
  imageUrl: string | null;
  ctaUrl: string;
  ctaLabel: string;
}

export interface PublicLinkInBioPageData {
  profile: LinkInBioProfile;
  tiles: PublicLinkInBioTile[];
  campaigns: PublicCampaignCard[];
  websiteEvents?: PublicWebsiteEvent[];
  logoMedia?: {
    url: string;
  } | null;
  heroMedia?: {
    url: string;
    shape: "square" | "story";
  } | null;
}

export interface UpdateLinkInBioProfileInput {
  slug: string;
  displayName?: string | null;
  bio?: string | null;
  logoUrl?: string | null;
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
  template?: LinkInBioTemplate;
  fontFamily?: LinkInBioFont;
  isPublished?: boolean;
}

export interface UpsertLinkInBioTileInput {
  id?: string;
  title: string;
  subtitle?: string | null;
  ctaLabel: string;
  ctaUrl: string;
  mediaAssetId?: string | null;
  enabled?: boolean;
  tileType?: TileType;
  embedData?: Record<string, unknown> | null;
}

export interface ReorderLinkInBioTilesInput {
  tileIdsInOrder: string[];
}

export interface LinkInBioProfileWithTiles {
  profile: LinkInBioProfile | null;
  tiles: LinkInBioTile[];
}
