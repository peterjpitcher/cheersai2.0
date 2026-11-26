/**
 * Google posts in the planner (tasks/SPEC-gbp-separate-posts.md, decision D14).
 *
 * A Google post is shown as its own tile beside the Facebook and Instagram
 * ones. It is not a content item, so the tile is a ContentItem-shaped object
 * carrying `googlePostId`, and the content `Platform` type stays Facebook and
 * Instagram only. Clicking it opens the Google post's own page, never the
 * post drawer (which reads content items).
 *
 * Pure and browser-safe.
 */

import type { ContentItem, ContentStatus, Platform } from '@/types/content';

/** What a planner tile's channel badge can show. */
export type ChannelKey = Platform | 'google';

const GOOGLE_TILE_PREFIX = 'google:';

/** The id a Google tile is clicked with, so it can never be mistaken for a content item's id. */
export function googleTileId(googlePostId: string): string {
  return `${GOOGLE_TILE_PREFIX}${googlePostId}`;
}

/** The Google post's page for a tile id made by googleTileId, or null for any other id. */
export function googlePostHrefForTile(tileId: string): string | null {
  if (!tileId.startsWith(GOOGLE_TILE_PREFIX)) return null;
  return `/planner/google/${encodeURIComponent(tileId.slice(GOOGLE_TILE_PREFIX.length))}`;
}

export function isGoogleTile(item: unknown): item is ContentItem & { googlePostId: string } {
  return typeof item === 'object' && item !== null && typeof (item as { googlePostId?: unknown }).googlePostId === 'string';
}

/** A Google post's state in the planner's own status words. */
export function googleStateToContentStatus(state: string): ContentStatus {
  switch (state) {
    case 'sent':
      return 'published';
    case 'claimed':
    case 'uncertain':
      return 'publishing';
    case 'failed':
      return 'failed';
    case 'held':
      // Waiting for a person: counted with the posts that need attention.
      return 'review';
    default:
      return 'scheduled';
  }
}

export interface GoogleTileInput {
  id: string;
  accountId: string;
  state: string;
  /** When it goes (or went) out. */
  when: Date;
  title: string | null;
  campaignName: string | null;
  thumbnailUrl: string | null;
}

/** The ContentItem-shaped tile for one Google post. */
export function toGoogleTile(input: GoogleTileInput): ContentItem & { googlePostId: string } {
  return {
    id: googleTileId(input.id),
    googlePostId: input.id,
    accountId: input.accountId,
    contentType: 'instant_post',
    status: googleStateToContentStatus(input.state),
    title: input.title,
    bodyDraft: null,
    campaignName: input.campaignName,
    scheduledAt: input.when,
    eventDate: null,
    eventEndDate: null,
    couponCode: null,
    recurringDayOfWeek: null,
    autoConfirm: false,
    aiGenerationParams: null,
    thumbnailUrl: input.thumbnailUrl,
    placement: 'feed',
    platform: null,
    createdAt: input.when,
    updatedAt: input.when,
  };
}
