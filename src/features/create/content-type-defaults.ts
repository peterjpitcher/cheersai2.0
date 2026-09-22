import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import type { ContentBriefInput } from '@/features/create/schemas/content-schemas';
import type { ContentType } from '@/types/content';

export interface ContentTypeDefaultsOptions {
  /** The active brand's default event venue from Settings; empty when not set. */
  defaultEventVenue: string;
  /** Injectable clock for tests; defaults to now. */
  now?: DateTime;
}

/**
 * Starting values for the type-specific brief fields when the user picks a content type.
 * Shared fields (title, prompt, tone, ...) are carried over by the wizard, not set here.
 */
export function getContentTypeDefaults(
  type: ContentType,
  { defaultEventVenue, now = DateTime.now() }: ContentTypeDefaultsOptions,
): Partial<ContentBriefInput> {
  const typeDefaults: Record<ContentType, Partial<ContentBriefInput>> = {
    instant_post: { publishMode: 'now' },
    story: {},
    // Events go out on the feed and as a story on every posting day, so both
    // are on by default rather than something to remember to tick. The venue
    // is the brand's own default, so one brand's venue never pre-fills another's.
    event: {
      eventName: '',
      eventDate: '',
      eventTime: '',
      venue: defaultEventVenue.trim(),
      placements: ['feed', 'story'],
    },
    promotion: { offerSummary: '', endDate: '', placements: ['feed'] },
    weekly_recurring: {
      daysOfWeek: [1],
      time: '12:00',
      endDate: now.setZone(DEFAULT_TIMEZONE).plus({ weeks: 4 }).toFormat('yyyy-MM-dd'),
      placement: 'feed',
    },
  };

  return typeDefaults[type];
}
