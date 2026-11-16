import { describe, expect, it } from 'vitest';

import { buildGoogleVersion, cutTitle, type BuildInput, type CampaignInfo, type ParentItem } from '@/lib/google-posts/build';

const NOW = new Date('2026-11-16T10:00:00.000Z');
const PARENT = 'accounts/111/locations/999';

const item = (overrides: Partial<ParentItem> = {}): ParentItem => ({
  id: 'post-1',
  account_id: 'acc-1',
  campaign_id: 'camp-1',
  platform: 'facebook',
  placement: 'feed',
  status: 'scheduled',
  scheduled_for: '2026-11-19T18:00:00.000Z',
  deleted_at: null,
  created_at: '2026-11-15T09:00:00.000Z',
  ...overrides,
});

const eventCampaign = (metadata: Record<string, unknown>): CampaignInfo => ({
  id: 'camp-1',
  campaign_type: 'event',
  name: 'Quiz Night',
  metadata,
});

const input = (overrides: Partial<BuildInput> = {}): BuildInput => ({
  item: item(),
  body: 'Quiz night this Thursday from 8pm. Book here: https://example.com/quiz #quiz',
  campaign: null,
  localPostParent: PARENT,
  now: NOW,
  isFirstEventPost: false,
  event: null,
  ...overrides,
});

describe('buildGoogleVersion: ordinary posts', () => {
  it('builds a STANDARD version with cleaned wording and no button', () => {
    const result = buildGoogleVersion(input({ campaign: { id: 'camp-1', campaign_type: 'instant_post', name: 'Quiz', metadata: {} } }));
    expect(result).toEqual({
      ok: true,
      row: {
        account_id: 'acc-1',
        content_item_id: 'post-1',
        local_post_parent: PARENT,
        state: 'pending',
        hold_reason: null,
        summary: 'Quiz night this Thursday from 8pm.',
        source_event_key: null,
        topic_type: 'STANDARD',
        cta_type: null,
        cta_url: null,
        event_title: null,
        event_start: null,
        event_end: null,
      },
    });
  });

  it('adds a Learn more button only when the campaign holds a googleCtaUrl', () => {
    const result = buildGoogleVersion(
      input({ campaign: { id: 'camp-1', campaign_type: 'promotion', name: 'Roast', metadata: { googleCtaUrl: 'https://l.example.com/g' } } }),
    );
    expect(result.ok && result.row).toMatchObject({ cta_type: 'LEARN_MORE', cta_url: 'https://l.example.com/g' });
  });

  it('holds an alcohol price promotion, and empty wording, for a person', () => {
    const promo = buildGoogleVersion(input({ body: '2 for 1 cocktails every Friday!' }));
    expect(promo.ok && promo.row).toMatchObject({ state: 'held', hold_reason: 'alcohol_promotion' });
    const empty = buildGoogleVersion(input({ body: '#friday @someone https://example.com' }));
    expect(empty.ok && empty.row).toMatchObject({ state: 'held', hold_reason: 'no_wording', summary: '' });
  });

  it.each([
    ['an Instagram post', { platform: 'instagram' }, 'not_facebook'],
    ['a story', { placement: 'story' }, 'not_feed'],
    ['a draft', { status: 'draft' }, 'draft'],
    ['a trashed post', { deleted_at: '2026-11-15T10:00:00.000Z' }, 'trashed'],
    ['a post more than a few minutes in the past', { scheduled_for: '2026-11-16T09:50:00.000Z' }, 'in_the_past'],
    ['a post with no time', { scheduled_for: null }, 'not_scheduled'],
  ])('never builds one for %s', (_label, overrides, reason) => {
    expect(buildGoogleVersion(input({ item: item(overrides as Partial<ParentItem>) }))).toEqual({ ok: false, reason });
  });

  it('still builds one for a post due a minute ago', () => {
    expect(buildGoogleVersion(input({ item: item({ scheduled_for: '2026-11-16T09:59:00.000Z' }) })).ok).toBe(true);
  });
});

describe('buildGoogleVersion: events', () => {
  const stored = {
    eventStart: '2026-11-19T20:00:00.000+00:00',
    eventEnd: '2026-11-19T22:30:00.000+00:00',
    eventTitle: 'Quiz Night',
    googleCtaUrl: 'https://l.example.com/quiz-g',
    takesBookings: true,
    sourceEventKey: 'mgmt:evt-1',
  };

  it('builds an EVENT with the stored end, a Book button and the stored key', () => {
    const result = buildGoogleVersion(input({ campaign: eventCampaign(stored), isFirstEventPost: true }));
    expect(result.ok && result.row).toMatchObject({
      topic_type: 'EVENT',
      source_event_key: 'mgmt:evt-1',
      event_title: 'Quiz Night',
      event_start: '2026-11-19T20:00:00.000Z',
      event_end: '2026-11-19T22:30:00.000Z',
      cta_type: 'BOOK',
      cta_url: 'https://l.example.com/quiz-g',
    });
  });

  it('uses Learn more when the event takes no bookings, and no button without a link', () => {
    const learn = buildGoogleVersion(input({ campaign: eventCampaign({ ...stored, takesBookings: false }), isFirstEventPost: true }));
    expect(learn.ok && learn.row).toMatchObject({ cta_type: 'LEARN_MORE' });
    const none = buildGoogleVersion(input({ campaign: eventCampaign({ ...stored, googleCtaUrl: null }), isFirstEventPost: true }));
    expect(none.ok && none.row).toMatchObject({ cta_type: null, cta_url: null, topic_type: 'EVENT' });
  });

  it('gives a later post of the same event nothing', () => {
    expect(buildGoogleVersion(input({ campaign: eventCampaign(stored), isFirstEventPost: false }))).toEqual({
      ok: false,
      reason: 'not_first_event_post',
    });
  });

  it('falls back to a STANDARD post, still keyed to the event, when no end is known', () => {
    const result = buildGoogleVersion(
      input({
        campaign: eventCampaign({ eventStart: '2026-11-19T20:00:00.000+00:00', startDate: '2026-11-19', startTime: '20:00', brief: { eventName: 'Quiz' } }),
        isFirstEventPost: true,
      }),
    );
    expect(result.ok && result.row).toMatchObject({ topic_type: 'STANDARD', source_event_key: 'campaign:camp-1', event_title: null });
  });

  it('gives an event that has already ended nothing', () => {
    const result = buildGoogleVersion(
      input({
        campaign: eventCampaign({ ...stored, eventStart: '2026-11-15T20:00:00.000Z', eventEnd: '2026-11-15T23:00:00.000Z' }),
        isFirstEventPost: true,
      }),
    );
    expect(result).toEqual({ ok: false, reason: 'event_over' });
  });

  it('uses mgmt:<id> for a matched management event when the campaign holds no key', () => {
    const result = buildGoogleVersion(
      input({
        campaign: eventCampaign({ eventStart: stored.eventStart }),
        isFirstEventPost: true,
        event: {
          title: 'Quiz Night',
          start: stored.eventStart,
          end: stored.eventEnd,
          googleCtaUrl: 'https://l.example.com/m',
          takesBookings: false,
          managementEventId: 'evt-9',
        },
      }),
    );
    expect(result.ok && result.row).toMatchObject({ source_event_key: 'mgmt:evt-9', topic_type: 'EVENT', cta_type: 'LEARN_MORE' });
  });
});

describe('cutTitle', () => {
  it('cuts at a word boundary to 58 characters, Unicode-safe', () => {
    const long = 'The Grand Christmas Quiz Night Spectacular With Prizes For Everyone';
    const cut = cutTitle(long);
    expect(Array.from(cut).length).toBeLessThanOrEqual(58);
    expect(long.startsWith(cut)).toBe(true);
    expect(cut.endsWith(' ')).toBe(false);
    expect(cutTitle('🎄'.repeat(70))).toBe('🎄'.repeat(58));
    expect(cutTitle('  Quiz   Night  ')).toBe('Quiz Night');
  });
});
