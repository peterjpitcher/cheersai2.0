import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DateTime } from 'luxon';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLICHE_EXAMPLES, HERO, homeFaq, homeFeatures, hospitalityPoints, venueTypeList } from '@/content/homepage';
import { plainText } from '@/content/rich-text';
import { buildPromotionSuggestions } from '@/features/create/schedule/suggestion-utils';
import { eventBriefSchema, promotionBriefSchema } from '@/features/create/schemas/content-schemas';
import { buildSystemPrompt } from '@/lib/ai/prompts';
import { BANNED_PHRASES } from '@/lib/ai/voice';
import { buildEventCadenceSlots } from '@/lib/create/event-cadence';
import { getProximityLabel } from '@/lib/scheduling/proximity-label';
import type { BrandProfile } from '@/lib/settings/data';
import { VENUE_TYPES } from '@/lib/signup/venue-form';

/**
 * The homepage's venue claims (SPEC-homepage-hospitality-and-logo), each
 * checked against the code that makes it true, so a change to the product
 * that breaks a promise on the page fails here rather than misleading a venue.
 */

const TZ = 'Europe/London';

function point(icon: string): string {
  const found = hospitalityPoints().find((entry) => entry.icon === icon);
  if (!found) throw new Error(`no hospitality point "${icon}"`);
  return found.body;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the event claims', () => {
  it('names the date strip labels an evening event gets two days before, the day before and on the day', () => {
    // Live music on Friday 9 October 2026 at 8pm; posts on Wednesday and
    // Thursday at noon and on the day at 7am.
    const timing = { campaignType: 'event' as const, startAt: DateTime.fromISO('2026-10-09T20:00', { zone: TZ }), startTime: '20:00', timezone: TZ };
    const labels = ['2026-10-07T12:00', '2026-10-08T12:00', '2026-10-09T07:00'].map((at) =>
      getProximityLabel({ referenceAt: DateTime.fromISO(at, { zone: TZ }), campaignTiming: timing }),
    );

    expect(labels).toEqual(['THIS FRIDAY', 'TOMORROW NIGHT', 'TONIGHT']);
    expect(point('events')).toContain(`from ${labels[0]} to ${labels[1]} to ${labels[2]}`);
    expect(HERO.intro).toContain(`${labels[0]} or ${labels[2]} on the picture`);
  });

  it('suggests weekly posts in the weeks before, then two days, one day and the day itself', () => {
    const labels = buildEventCadenceSlots({
      startDate: '2026-11-06',
      startTime: '20:00',
      timezone: TZ,
      now: new Date('2026-09-29T09:00:00Z'),
    }).map((slot) => slot.label);

    expect(labels.filter((label) => label.startsWith('Weekly hype')).length).toBeGreaterThan(0);
    expect(labels.slice(-3)).toEqual(['2 days to go', '1 day to go', 'Event day']);
    expect(point('events')).toContain('posts in the weeks before, two days before, the day before and on the day');
  });

  it('posts an event on the feed and as a story unless the owner changes it', () => {
    expect(eventBriefSchema.shape.placements.parse(undefined)).toEqual(['feed', 'story']);
    expect(point('events')).toContain('each on your feed and as a story');
  });
});

describe('the offers claim', () => {
  it('needs an end date and suggests a launch, a reminder and a last-chance post', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T08:00:00Z'));

    expect(promotionBriefSchema.shape.endDate.safeParse(undefined).success).toBe(false);
    expect(buildPromotionSuggestions({ endDate: '2026-10-11', timezone: TZ }).map((slot) => slot.label)).toEqual([
      'Launch',
      'Mid-run reminder',
      'Last chance',
    ]);
    const offers = homeFeatures().find((feature) => feature.icon === 'offers');
    expect(offers?.body).toContain('Give it an end date and Cheers suggests a launch post, a reminder and a last-chance post.');
  });
});

describe('the venue voice claims', () => {
  const brand: BrandProfile = {
    toneFormal: 0.5,
    tonePlayful: 0.5,
    keyPhrases: [],
    bannedTopics: [],
    bannedPhrases: [],
    defaultHashtags: [],
    defaultEmojis: [],
    businessType: 'pub',
  };

  it('writes as the venue type chosen at sign-up, in British English', () => {
    const prompt = buildSystemPrompt('event', 'friendly_warm', undefined, brand);
    expect(prompt).toContain('Business type: pub.');
    expect(prompt).toContain('Use British English throughout.');
    expect(point('voice')).toContain('writes as that kind of place, in British English');
  });

  it('only quotes clichés that Cheers keeps out of every post', () => {
    const prompt = buildSystemPrompt('event', 'friendly_warm', undefined, brand);
    for (const phrase of CLICHE_EXAMPLES) {
      expect(BANNED_PHRASES).toContain(phrase);
      expect(prompt).toContain(phrase);
      expect(point('voice')).toContain(`"${phrase}"`);
    }
  });

  it("names the sign-up form's venue types, and its Other choice", () => {
    const named = VENUE_TYPES.filter((venue) => venue.value !== 'other').map((venue) => venue.label.toLowerCase());
    expect(named).toEqual(['pub', 'bar', 'restaurant', 'cafe', 'hotel']);
    expect(venueTypeList()).toBe('pubs, bars, restaurants, cafes and hotels');
    expect(point('voice')).toContain(`Choose ${named.slice(0, -1).join(', ')} or ${named[named.length - 1]} when you sign up`);

    const answer = homeFaq().find((item) => item.question === 'Is Cheers only for pubs?');
    expect(plainText(answer?.answer ?? '')).toBe(
      'No. Cheers is made for pubs, bars, restaurants, cafes and hotels. When you sign up you choose your type of venue, or Other hospitality venue, and Cheers writes your posts for that kind of place.',
    );
  });
});

describe('the link-in-bio and photo claims', () => {
  it('names the buttons the public link-in-bio page shows', () => {
    const page = readFileSync(join(process.cwd(), 'src/features/link-in-bio/public/link-in-bio-public-page.tsx'), 'utf8');
    for (const label of ['Book a table', 'See our menu', 'Call us', 'Find us']) {
      expect(page).toContain(`label: "${label}"`);
      expect(point('link')).toContain(label);
    }
  });

  it('tags photos by what is in them, food and drink included', () => {
    const tagging = readFileSync(join(process.cwd(), 'src/lib/ai/media-tagging.ts'), 'utf8');
    expect(tagging).toContain('any food or drink');
    const library = homeFeatures().find((feature) => feature.icon === 'library');
    expect(library?.body).toContain('Upload photos of your food, drinks and venue, and Cheers names and tags them');
  });
});
