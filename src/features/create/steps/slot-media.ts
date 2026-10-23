/**
 * Default pictures for the posts of an event campaign (B6, tasks/SPEC-vary-the-picture.md).
 *
 * The announcement and the event day keep the event artwork. The posts in between take a photo
 * the owner has tagged `reuse` in the Library, chosen for the post's job, so a campaign stops
 * showing the same artwork seven times. Only `reuse` photos are ever picked: the library's other
 * tags are free-form and some mislead (a photo of pies is tagged "sunday roast"), and a picture's
 * tags go into the prompt. The owner still sees and can change every picture before scheduling.
 */

import type { SlotJob } from '@/lib/ai/slot-jobs';
import type { MediaAssetSummary } from '@/lib/library/data';

/** The Library tag that marks a photo as fine to use on any event post. */
export const REUSE_TAG = 'reuse';

/** Jobs that show the event's own artwork: the announcement and the day itself. */
const ARTWORK_JOBS: ReadonlySet<SlotJob> = new Set<SlotJob>(['announce', 'tonight']);

const FOOD = /\b(?:food|dinner|lunch|burgers?|pizzas?|chips|pies?|roast|desserts?|starters?|dish(?:es)?|meals?|brunch|breakfast|sandwich(?:es)?|steak|fish)\b/i;
const VENUE_OR_EVENT = /\b(?:bar|pub|interior|garden|terrace|beer|pints?|drinks?|crowd|guests?|quiz|bingo|music|karaoke|party|stage|band|dj|singer|host|night)\b/i;

const hasTag = (asset: MediaAssetSummary, pattern: RegExp): boolean => asset.tags.some((tag) => pattern.test(tag));

/**
 * Each slot's default pictures, in the order of `jobs`: undefined keeps the campaign's own
 * selection (the artwork). A slot's story needs an upright version, so only photos that have
 * one are offered; each photo is used once per campaign.
 */
export function defaultSlotMedia(
  jobs: readonly SlotJob[],
  library: readonly MediaAssetSummary[],
  options: { host?: string | null } = {},
): Array<string[] | undefined> {
  const reusable = library.filter(
    (asset) =>
      asset.mediaType === 'image' &&
      Boolean(asset.derivedVariants?.story) &&
      asset.tags.some((tag) => tag.trim().toLowerCase() === REUSE_TAG),
  );
  const hostName = options.host?.trim().split(/\s+/)[0];
  const host = hostName && hostName.length > 1 ? new RegExp(`\\b${hostName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null;
  const used = new Set<string>();

  /** The first unused photo with a tag matching a preference, in order; `avoid` rules photos out. */
  const pick = (preferences: Array<RegExp | null>, avoid?: RegExp): string[] | undefined => {
    for (const preference of preferences) {
      if (!preference) continue;
      const match = reusable.find(
        (asset) => !used.has(asset.id) && hasTag(asset, preference) && !(avoid && hasTag(asset, avoid)),
      );
      if (match) {
        used.add(match.id);
        return [match.id];
      }
    }
    return undefined;
  };

  // A food photo only where the post is about eating: elsewhere its tags would pull the copy
  // towards food ("pub food" would otherwise count as a venue photo).
  return jobs.map((job) => {
    if (ARTWORK_JOBS.has(job)) return undefined;
    if (job === 'eat_first') return pick([FOOD]);
    if (job === 'meet_the_host') return pick([host, VENUE_OR_EVENT], FOOD);
    return pick([VENUE_OR_EVENT], FOOD);
  });
}
