import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { contentBriefSchema } from '@/features/create/schemas/content-schemas';
import type { AiGenerationResponse } from '@/lib/ai/schemas';
import type { writeCopy } from '@/lib/ai/write-copy';
import {
  atLondon,
  briefForSubject,
  calendarSubjectsSchema,
  decideCalendar,
  londonTime,
  planCalendarFill,
  type CalendarEvent,
  type CalendarPost,
  type DecideInput,
} from '@/lib/content/calendar-fill';
import { renderCalendarReport } from '@/lib/content/calendar-fill-report';
import type { ManagementEventDetail, ManagementEventListItem } from '@/lib/management-app/client';

const NOW = new Date('2026-10-17T16:00:00Z');
const LONG_DASH = String.fromCharCode(0x2014);
let sequence = 0;

/** One slot: a feed post and a story on Facebook and Instagram, at a London time. */
function slot(at: string, options: Partial<CalendarPost> & { eventName?: string; eventDate?: string } = {}): CalendarPost[] {
  const [date, time] = at.split(' ');
  const scheduledFor = atLondon(date, time);
  return (['facebook', 'instagram'] as const).flatMap((platform) =>
    (['feed', 'story'] as const).map((placement) => {
      sequence += 1;
      return {
        id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
        campaignId: 'campaignId' in options ? options.campaignId ?? null : null,
        campaignName: options.campaignName ?? options.eventName ?? null,
        contentType: options.contentType ?? (options.eventName ? 'event' : 'instant_post'),
        platform,
        placement,
        status: options.status ?? 'scheduled',
        scheduledFor,
        slotKey: options.slotKey ?? null,
        source: options.source ?? null,
        eventName: options.eventName ?? null,
        eventDate: options.eventDate ?? null,
        mediaIds: options.mediaIds ?? ['art-0'],
        jobStatuses: options.jobStatuses ?? ['queued'],
        body: placement === 'feed' ? options.body ?? `Body for ${options.eventName ?? 'post'}` : '',
        brief: options.brief ?? null,
      } satisfies CalendarPost;
    }),
  );
}

function event(id: string, name: string, date: string, category: string, cancelled = false): CalendarEvent {
  return { id, name, slug: id, date, time: '19:00', categoryName: category, categorySlug: category.toLowerCase().replace(/\s+/g, '-'), cancelled };
}

function decide(overrides: Partial<DecideInput>) {
  return decideCalendar({ from: '2026-10-21', to: '2026-12-02', now: NOW, posts: [], events: [], subjects: {}, ...overrides });
}

describe('decideCalendar: times', () => {
  const quizzes = [event('q-oct', 'October Quiz', '2026-10-07', 'Quiz Night'), event('q-nov', 'Sparks Quiz', '2026-11-04', 'Quiz Night')];

  it('moves build-up posts from 12:00 to 11:00 the same day, feed and story together, and leaves the event day at 7am', () => {
    const posts = [
      ...slot('2026-10-28 12:00', { campaignId: 'c-quiz', eventName: 'Sparks Quiz', eventDate: '2026-11-04' }),
      ...slot('2026-11-04 07:00', { campaignId: 'c-quiz', eventName: 'Sparks Quiz', eventDate: '2026-11-04' }),
    ];
    const decision = decide({ posts, events: quizzes });

    expect(decision.moves).toHaveLength(1);
    expect(decision.moves[0]).toMatchObject({ campaignName: 'Sparks Quiz', fromIso: atLondon('2026-10-28', '12:00'), toIso: atLondon('2026-10-28', '11:00'), reason: 'build_up_time' });
    expect(decision.moves[0].items).toHaveLength(4);
  });

  it('clears a shared minute by moving the post for the later event to 11:00', () => {
    const events = [
      event('cb-oct', 'Autumn Jackpot', '2026-09-30', 'Cash Bingo'),
      event('cb-nov', 'Snowball Showdown', '2026-11-18', 'Cash Bingo'),
      ...quizzes,
      event('q-dec', 'Tinsel & Trivia', '2026-12-02', 'Quiz Night'),
    ];
    const posts = [
      ...slot('2026-11-14 07:00', { campaignId: 'c-cash', eventName: 'Snowball Showdown', eventDate: '2026-11-18' }),
      ...slot('2026-11-14 07:00', { campaignId: 'c-trivia', eventName: 'Tinsel & Trivia', eventDate: '2026-12-02' }),
    ];
    const decision = decide({ posts, events });

    expect(decision.moves).toHaveLength(1);
    expect(decision.moves[0]).toMatchObject({ campaignName: 'Tinsel & Trivia', toIso: atLondon('2026-11-14', '11:00'), reason: 'collision' });
  });

  it('never moves an event-day post or one whose publishing has started', () => {
    const events = [event('t-nov', 'Tasting Night', '2026-11-20', 'Tasting'), event('m-dec', 'Sleigh', '2026-12-11', 'Music Bingo')];
    const posts = [
      ...slot('2026-11-20 07:00', { campaignId: 'c-tasting', eventName: 'Tasting Night', eventDate: '2026-11-20' }),
      ...slot('2026-11-20 07:00', { campaignId: 'c-sleigh', eventName: 'Sleigh', eventDate: '2026-12-11', jobStatuses: ['in_progress'] }),
    ];
    const decision = decide({ posts, events });

    expect(decision.moves).toEqual([]);
    expect(decision.notes.join(' ')).toMatch(/Sleigh on Fri 20 Nov at 07:00 shares its minute with another post but cannot be moved/);
  });
});

describe('decideCalendar: 7am build-up posts and rugby days', () => {
  const events = [
    event('cb-sep', 'Autumn Jackpot', '2026-09-30', 'Cash Bingo'),
    event('cb-nov', 'Snowball Showdown', '2026-11-18', 'Cash Bingo'),
    event('q-nov', 'Sparks Quiz', '2026-11-04', 'Quiz Night'),
    event('q-dec', 'Tinsel & Trivia', '2026-12-02', 'Quiz Night'),
  ];

  it('lists 7am build-up posts to move to 11:00 as optional, keeping 7am where 11:00 is taken', () => {
    const posts = [
      ...slot('2026-11-04 07:00', { campaignId: 'c-sparks', eventName: 'Sparks Quiz', eventDate: '2026-11-04' }),
      ...slot('2026-11-03 07:00', { campaignId: 'c-cash', eventName: 'Snowball Showdown', eventDate: '2026-11-18' }),
      ...slot('2026-11-14 07:00', { campaignId: 'c-cash', eventName: 'Snowball Showdown', eventDate: '2026-11-18' }),
      ...slot('2026-11-14 11:00', { campaignId: 'c-trivia', eventName: 'Tinsel & Trivia', eventDate: '2026-12-02' }),
      ...slot('2026-11-18 07:00', { campaignId: 'c-cash', eventName: 'Snowball Showdown', eventDate: '2026-11-18' }),
    ];
    const decision = decide({ from: '2026-11-01', to: '2026-11-30', posts, events });

    expect(decision.moves.map((move) => [move.fromIso, move.toIso, move.reason])).toEqual([
      [atLondon('2026-11-03', '07:00'), atLondon('2026-11-03', '11:00'), 'early_build_up'],
    ]);
    expect(decision.notes).toContain('Snowball Showdown on Sat 14 Nov stays at 07:00: 11:00 already has a post that day.');
  });

  it("counts a rugby fixture's separate Facebook and Instagram posts as one post a platform", () => {
    const rugby = (platform: 'facebook' | 'instagram') =>
      slot('2026-12-09 20:10', { source: 'tournament', slotKey: `tournament:${platform}` }).filter((post) => post.platform === platform);
    const decision = decide({
      from: '2026-11-14',
      to: '2026-12-02',
      events: [event('mb-nov', 'Sequins', '2026-11-13', 'Music Bingo'), event('mb-dec', 'Sleigh My Name', '2026-12-11', 'Music Bingo')],
      posts: [...rugby('facebook'), ...rugby('instagram')],
    });

    const sleigh = decision.newCampaigns.find((campaign) => campaign.event.name === 'Sleigh My Name');
    expect(sleigh?.slots.some((entry) => entry.date === '2026-12-09' && entry.label === '2 days to go')).toBe(true);
  });
});

describe('decideCalendar: empty days', () => {
  const quizEvents = [event('q-nov', 'Sparks Quiz', '2026-11-04', 'Quiz Night'), event('q-dec', 'Tinsel & Trivia', '2026-12-02', 'Quiz Night')];
  const trivia = (at: string) => slot(at, { campaignId: 'c-trivia', eventName: 'Tinsel & Trivia', eventDate: '2026-12-02' });
  const photos = {
    lunch: [{ id: 'lunch-1', fileName: 'cod.jpg' }, { id: 'lunch-2', fileName: 'stack.jpg' }],
    roast: [{ id: 'roast-1', fileName: 'roast.jpg' }],
    private_hire: [{ id: 'hire-1', fileName: 'hire.jpg' }],
  };

  it('puts the roast on Saturday, lunch Tuesday to Friday, private hire first in the half month, and a build-up on the rest', () => {
    const decision = decide({
      from: '2026-11-23',
      to: '2026-11-29',
      posts: trivia('2026-11-25 11:00'),
      events: quizEvents,
      subjects: photos,
    });

    expect(decision.venue.map((entry) => [entry.slot.date, entry.subject, entry.photo.id])).toEqual([
      ['2026-11-23', 'private_hire', 'hire-1'],
      ['2026-11-24', 'lunch', 'lunch-1'],
      ['2026-11-26', 'lunch', 'lunch-2'],
      ['2026-11-28', 'roast', 'roast-1'],
    ]);
    // Both lunch photos were used within the week, so Friday is listed rather than filled.
    expect(decision.unfilled).toEqual([{ date: '2026-11-27', reason: 'No lunch photo that has not been used in the week around it.' }]);
    expect(decision.buildUps.map((entry) => [entry.slot.date, entry.event.name, londonTime(entry.slot.scheduledAt)])).toEqual([['2026-11-29', 'Tinsel & Trivia', '11:00']]);
    expect(decision.venue.every((entry) => londonTime(entry.slot.scheduledAt) === '11:00')).toBe(true);
  });

  it('puts the roast on Friday when Saturday is taken, once a week', () => {
    const decision = decide({
      from: '2026-11-27',
      to: '2026-11-28',
      posts: trivia('2026-11-28 11:00'),
      events: quizEvents,
      subjects: { roast: photos.roast },
    });

    expect(decision.venue.map((entry) => [entry.slot.date, entry.subject])).toEqual([['2026-11-27', 'roast']]);
  });

  it('builds up the soonest event that is open for promotion and has had no post in the two days before', () => {
    const events = [
      ...quizEvents,
      // The last tasting night is on the 29th, so the next one cannot be promoted that day.
      event('t-1', 'Autumn Tasting', '2026-11-29', 'Tasting'),
      event('t-2', 'Winter Tasting', '2026-11-30', 'Tasting'),
      event('mb-nov', 'Sequins', '2026-11-13', 'Music Bingo'),
      event('mb-dec', 'Sleigh', '2026-12-11', 'Music Bingo'),
    ];
    const posts = [
      ...slot('2026-11-20 11:00', { campaignId: 'c-autumn', eventName: 'Autumn Tasting', eventDate: '2026-11-29' }),
      ...slot('2026-11-25 11:00', { campaignId: 'c-tasting', eventName: 'Winter Tasting', eventDate: '2026-11-30' }),
      ...trivia('2026-11-28 07:00'),
      ...slot('2026-11-22 11:00', { campaignId: 'c-sleigh', eventName: 'Sleigh', eventDate: '2026-12-11' }),
    ];
    const decision = decide({ from: '2026-11-29', to: '2026-11-29', posts, events });

    expect(decision.buildUps.map((entry) => entry.event.name)).toEqual(['Sleigh']);
  });

  it('lists a day it cannot fill', () => {
    const decision = decide({ from: '2026-11-29', to: '2026-11-29', events: quizEvents });

    expect(decision.unfilled).toEqual([{ date: '2026-11-29', reason: 'No event is open for promotion without a post in the two days before.' }]);
  });
});

describe('decideCalendar: new campaigns', () => {
  const events = [
    event('mb-nov', 'Sequins', '2026-11-13', 'Music Bingo'),
    event('mb-dec', 'Sleigh My Name', '2026-12-11', 'Music Bingo'),
    event('t-nov', 'Tinsel & Tipples', '2026-11-20', 'Tasting'),
  ];

  it('gives an event its own campaign, never before its window, with a weekly post moved off a busy day', () => {
    const posts = [
      ...slot('2026-11-13 07:00', { campaignId: 'c-sequins', eventName: 'Sequins', eventDate: '2026-11-13' }),
      ...slot('2026-11-20 07:00', { campaignId: 'c-tipples', eventName: 'Tinsel & Tipples', eventDate: '2026-11-20' }),
    ];
    const decision = decide({ from: '2026-11-14', to: '2026-12-02', posts, events });

    expect(decision.newCampaigns).toHaveLength(1);
    const campaign = decision.newCampaigns[0];
    expect(campaign.event.name).toBe('Sleigh My Name');
    expect(campaign.window?.opensOn).toBe('2026-11-14');
    const cadence = campaign.slots.filter((entry) => entry.kind !== 'build_up');
    expect(cadence.map((entry) => [entry.date, londonTime(entry.scheduledAt), entry.label])).toEqual([
      ['2026-11-19', '11:00', '3 weeks to go'],
      ['2026-11-27', '11:00', '2 weeks to go'],
      ['2026-12-04', '11:00', 'A week to go'],
      ['2026-12-09', '11:00', '2 days to go'],
      ['2026-12-10', '11:00', '1 day to go'],
      ['2026-12-11', '07:00', 'Event day'],
    ]);
    expect(cadence[0].note).toBe('Moved from Fri 20 Nov, which already has a post.');
    expect(campaign.slots.every((entry) => entry.date >= '2026-11-14')).toBe(true);
  });

  it('adds no campaign when none of its posts would fall in the period', () => {
    const decision = decide({ from: '2026-10-21', to: '2026-11-01', events: [...events, event('q-mar', 'Spring Quiz', '2027-03-03', 'Quiz Night')] });

    expect(decision.newCampaigns.map((campaign) => campaign.event.name)).not.toContain('Spring Quiz');
  });

  it('never makes a campaign for a cancelled event, or a second one for an event that has one', () => {
    const decision = decide({
      from: '2026-11-14',
      to: '2026-12-02',
      events: [...events.slice(0, 2), event('t-nov', 'Tinsel & Tipples', '2026-11-20', 'Tasting', true)],
      posts: slot('2026-11-21 11:00', { campaignId: 'c-sleigh', eventName: 'Sleigh My Name', eventDate: '2026-12-11' }),
    });

    expect(decision.newCampaigns).toEqual([]);
  });

  it('reports a scheduled post that goes out before its window', () => {
    const decision = decide({
      from: '2026-11-01',
      to: '2026-11-30',
      events,
      posts: slot('2026-11-10 11:00', { campaignId: 'c-sleigh', eventName: 'Sleigh My Name', eventDate: '2026-12-11' }),
    });

    expect(decision.ruleBreaks).toEqual([{ campaignName: 'Sleigh My Name', date: '2026-11-10', opensOn: '2026-11-14', afterEvent: 'Sequins' }]);
  });
});

describe('briefForSubject', () => {
  const subjects = calendarSubjectsSchema.parse({
    lunch: {
      title: 'Weekday lunch',
      contentType: 'weekly_recurring',
      daysOfWeek: [2, 3, 4, 5],
      time: '12:00',
      ctaLabel: 'Book a table',
      ctaLinks: { facebook: 'https://example.com/fb', instagram: 'https://example.com/ig' },
      notes: 'Lunch 12pm to 3pm, Tuesday to Friday.',
      source: 'the website',
      photos: ['5a6cd1a9-b5bf-4ee1-bd89-8029c06c7191'],
    },
    private_hire: {
      title: 'Private hire',
      contentType: 'instant_post',
      ctaLabel: 'Enquire',
      ctaLinks: { facebook: 'https://example.com/fb', instagram: 'https://example.com/ig' },
      notes: 'Rooms from 10 guests.',
      source: 'the website',
      photos: ['896aef90-b74a-46d3-8fb7-e38e9b1551ce'],
    },
  });

  it('makes valid briefs that ask for the feed and a story', () => {
    const lunch = briefForSubject(subjects.lunch!, ['2026-11-26', '2026-10-22']);
    const hire = briefForSubject(subjects.private_hire!, ['2026-10-25']);

    expect(lunch).toMatchObject({ contentType: 'weekly_recurring', daysOfWeek: [2, 3, 4, 5], endDate: '2026-11-26', placements: ['feed', 'story'], ctaLabel: 'Book a table' });
    expect(hire).toMatchObject({ contentType: 'instant_post', publishMode: 'schedule', placements: ['feed', 'story'] });
    expect(contentBriefSchema.safeParse(lunch).success).toBe(true);
    expect(contentBriefSchema.safeParse(hire).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A whole plan run, with the database, the events system and the AI faked
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function read(row: Row, column: string): unknown {
  if (!column.includes('->>')) return row[column];
  const [field, key] = column.split('->>');
  const value = row[field];
  return value && typeof value === 'object' ? (value as Row)[key] : undefined;
}

/** Answers the read shapes a plan run uses; it never writes. */
function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    const rows = (): Row[] => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    const builder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      eq: (column: string, value: unknown) => (filters.push((row) => read(row, column) === value), builder),
      is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      gte: (column: string, value: string) => (filters.push((row) => String(row[column]) >= value), builder),
      lte: (column: string, value: string) => (filters.push((row) => String(row[column]) <= value), builder),
      like: (column: string, pattern: string) => (filters.push((row) => String(row[column] ?? '').startsWith(pattern.replace(/%$/, ''))), builder),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

const ACCOUNT = '91fda684-2801-4abb-980e-f42cec017cef';
const LUNCH_PHOTO = '5a6cd1a9-b5bf-4ee1-bd89-8029c06c7191';
const ARTWORK = '74db8445-3784-44ae-b4ec-0861ed1a9716';

const subjects = calendarSubjectsSchema.parse({
  lunch: {
    title: 'Weekday lunch',
    contentType: 'weekly_recurring',
    daysOfWeek: [2, 3, 4, 5],
    time: '12:00',
    ctaLabel: 'Book a table',
    ctaLinks: { facebook: 'https://l.example.com/fb-lunch', instagram: 'https://l.example.com/ig-lunch' },
    notes: 'Lunch 12pm to 3pm, Tuesday to Friday.',
    source: 'the website',
    photos: [LUNCH_PHOTO],
  },
});

function response(body: string): AiGenerationResponse {
  return {
    facebook: { body, hashtags: ['#TheAnchor'], cta_text: '' },
    instagram: { body, hashtags: ['#TheAnchor'], link_in_bio_line: 'Book through the link in our bio' },
  } as unknown as AiGenerationResponse;
}

const listEvents = async (): Promise<ManagementEventListItem[]> => [
  { id: 'mb-nov', name: 'Sequins', date: '2026-11-13', categoryName: 'Music Bingo', categorySlug: 'music-bingo' },
  { id: 'mb-dec', name: 'Sleigh My Name', slug: 'sleigh', date: '2026-12-11', time: '19:00', categoryName: 'Music Bingo', categorySlug: 'music-bingo' },
];

const sleighDetail = {
  id: 'mb-dec',
  name: 'Sleigh My Name',
  date: '2026-12-11',
  time: '19:00',
  categoryName: 'Music Bingo',
  brief: 'Christmas number ones and singalongs, hosted by Nikki.',
  ctaLinks: { facebook: 'https://l.example.com/fb-sleigh' },
  linkInBioUrl: 'https://l.example.com/ig-sleigh',
} as unknown as ManagementEventDetail;

describe('planCalendarFill', () => {
  it("writes each new post with its job, both platforms' text and links, and drops a post whose wording is untrue at its time", async () => {
    const posts: Row[] = slot('2026-11-13 07:00', { campaignId: 'c-sequins', eventName: 'Sequins', eventDate: '2026-11-13' }).map((post) => ({
      id: post.id,
      campaign_id: post.campaignId,
      platform: post.platform,
      placement: post.placement,
      status: 'scheduled',
      scheduled_for: post.scheduledFor,
      content_type: 'event',
      account_id: ACCOUNT,
      deleted_at: null,
      prompt_context: { slotKey: 'cadence:x', brief: { contentType: 'event', eventName: 'Sequins', eventDate: '2026-11-13' } },
      campaigns: { name: 'Sequins' },
      content_variants: [{ body: 'Sequins body', media_ids: ['x'], preview_data: null }],
    }));
    const db = fakeDb({
      content_items: posts,
      publish_jobs: posts.map((post) => ({ content_item_id: post.id, status: 'queued', account_id: ACCOUNT })),
      media_assets: [
        { id: LUNCH_PHOTO, account_id: ACCOUNT, file_name: 'cod.jpg', media_type: 'image', aspect_class: 'square', derived_variants: { story: 'derived/x/story.jpg' }, hidden_at: null },
        { id: ARTWORK, account_id: ACCOUNT, file_name: 'sleigh-artwork.jpg', media_type: 'image', aspect_class: 'square', derived_variants: { story: 'derived/a/story.jpg' }, hidden_at: null, source_key: 'ams:event:mb-dec:abc' },
      ],
      posting_defaults: [{ account_id: ACCOUNT, default_event_venue: 'The Anchor' }],
    });
    const calls: Array<Parameters<typeof writeCopy>[0]> = [];
    const write = (async (input: Parameters<typeof writeCopy>[0]) => {
      calls.push(input);
      // The post a week before claims "tomorrow", which is untrue that day.
      const day = String(input.scheduledAt).slice(0, 10);
      const body = day === '2026-12-04' ? 'See you tomorrow for Sleigh My Name!' : `Post for ${input.slotLabel}.`;
      return { processed: { copy: response(body), warnings: [] }, temporal: {}, temperature: 0.7 };
    }) as unknown as typeof writeCopy;

    const plan = await planCalendarFill(
      { db, listEvents, getEventDetail: async () => sleighDetail, write, now: () => NOW, model: 'test-model' },
      { accountId: ACCOUNT, from: '2026-11-17', to: '2026-11-24', subjects },
    );

    const lunch = plan.batches.find((batch) => batch.kind === 'lunch');
    expect(lunch?.slots.length).toBeGreaterThan(0);
    const first = lunch!.slots[0];
    expect(first.slotKey).toMatch(/^calendar:\d{14}:lunch:2026-11-\d{2}$/);
    expect(first.bodies.facebook).toContain('Book a table: https://l.example.com/fb-lunch');
    expect(first.bodies.instagram).toContain('Book through the link in our bio');
    expect(first.mediaIds).toEqual([LUNCH_PHOTO]);
    expect(londonTime(first.scheduledAt)).toBe('11:00');

    const sleigh = plan.batches.find((batch) => batch.kind === 'new_campaign');
    expect(sleigh?.artwork).toMatchObject({ eventId: 'mb-dec', assetId: ARTWORK });
    expect(sleigh?.brief).toMatchObject({ eventName: 'Sleigh My Name', promotionWindow: { opensOn: '2026-11-14' }, placements: ['feed', 'story'] });
    expect(sleigh?.slots[0].job).toBe('announce');
    expect(sleigh?.slots.at(-1)?.job).toBe('tonight');
    expect(sleigh?.slots.some((entry) => entry.date === '2026-12-04')).toBe(false);
    expect(plan.unfilled.some((entry) => entry.date === '2026-12-04' && /untrue at its time/.test(entry.reason))).toBe(true);

    // Each later event post is told how the earlier ones opened.
    const sleighCalls = calls.filter((input) => input.campaign);
    expect(sleighCalls[0].campaign?.earlierOpenings).toEqual([]);
    expect(sleighCalls[1].campaign?.earlierOpenings.length).toBeGreaterThan(0);

    const report = renderCalendarReport(plan);
    expect(report).toContain('Nothing has changed yet.');
    expect(report).toContain('New event campaign: Sleigh My Name');
    expect(report).not.toContain(LONG_DASH);
  });
});
