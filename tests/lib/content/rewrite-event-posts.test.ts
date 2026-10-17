import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { writeCopy } from '@/lib/ai/write-copy';
import {
  applyRewritePlan,
  chooseManagementEvent,
  parseRewritePlan,
  planEventPostRewrites,
  rebuildEventBrief,
  renderRewriteReport,
  type RewritePlan,
} from '@/lib/content/rewrite-event-posts';
import type { ManagementEventDetail } from '@/lib/management-app/client';
import type { AiGenerationResponse } from '@/lib/ai/schemas';

type Row = Record<string, unknown>;

/** A small in-memory stand-in for the query shapes the rewrite uses. */
function fakeDb(tables: Record<string, Row[]>): { db: SupabaseClient; updates: Array<{ table: string; values: Row }> } {
  const updates: Array<{ table: string; values: Row }> = [];
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let pending: Row | null = null;
    const rows = (): Row[] => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    const run = (): { data: Row[]; error: null } => {
      if (!pending) return { data: rows(), error: null };
      const hit = rows();
      for (const row of hit) Object.assign(row, pending);
      updates.push({ table, values: pending });
      return { data: hit.map((row) => ({ id: row.id })), error: null };
    };
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      gt: (column: string, value: string) => {
        filters.push((row) => Date.parse(String(row[column])) > Date.parse(value));
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      update: (values: Row) => {
        pending = values;
        return builder;
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  return { db: { from } as unknown as SupabaseClient, updates };
}

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-17T16:00:00Z');

const storedBrief = {
  tone: 'friendly_warm',
  title: 'Snowball Showdown Cash Bingo',
  venue: 'The Anchor, Stanwell Moor Village',
  prompt: '# The Anchor Cash Bingo Night\r\n\r\n**£10 per bingo book, paid in cash on arrival.**\n\nImported from management app event "Snowball Showdown Cash Bingo". Current status: scheduled.',
  ctaLinks: { facebook: 'https://l.the-anchor.pub/fb1', instagram: 'https://l.the-anchor.pub/ig1' },
  ctaStyle: 'default',
  eventDate: '2026-11-18',
  eventName: 'Snowball Showdown Cash Bingo',
  eventTime: '19:00',
  platforms: ['facebook', 'instagram'],
  placements: ['feed', 'story'],
  contentType: 'event',
  proofPoints: [],
  eventEndDate: '',
  includeEmojis: true,
  includeHashtags: true,
  lengthPreference: 'standard',
};

const detail: ManagementEventDetail = {
  id: 'evt-1',
  name: 'Snowball Showdown Cash Bingo',
  date: '2026-11-18',
  time: '19:00',
  brief: '# The Anchor Cash Bingo Night\r\n\r\n**£10 per bingo book, paid in cash on arrival.**',
  booking_mode: 'communal',
  payment_mode: 'cash_only',
  price_per_seat: 10,
  category: { name: 'Cash Bingo', slug: 'cash-bingo' },
  event_status: 'scheduled',
  performer_name: 'Peter Pitcher',
};

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function item(n: number, overrides: Row = {}, variant: Row = {}): Row {
  const scheduled = (overrides.scheduled_for as string | undefined) ?? '2026-10-19T06:00:00+00:00';
  return {
    id: uuid(n),
    account_id: ACCOUNT,
    campaign_id: 'camp-1',
    platform: 'facebook',
    placement: 'feed',
    status: 'scheduled',
    content_type: 'event',
    deleted_at: null,
    scheduled_for: scheduled,
    prompt_context: { slotKey: `manual:${scheduled}`, slotLabel: null, brief: storedBrief },
    campaigns: { name: 'Snowball Showdown Cash Bingo' },
    content_variants: [{ id: uuid(100 + n), body: `Old copy ${n}`, media_ids: null, preview_data: { structuredCopy: { body: `Old copy ${n}` } }, ...variant }],
    ...overrides,
  };
}

function draft(facebook: string, instagram = 'Ten games and a £180 snowball.'): AiGenerationResponse {
  return {
    facebook: { body: facebook, cta_text: 'Book now', hashtags: ['#CashBingo'] },
    instagram: { body: instagram, hashtags: ['#CashBingo'], link_in_bio_line: 'Book through the link in our bio.' },
  };
}

function writer(copy: AiGenerationResponse, warnings: string[] = []): typeof writeCopy {
  return vi.fn(async () => ({ processed: { copy, warnings }, temporal: {}, temperature: 0.7 })) as unknown as typeof writeCopy;
}

describe('rebuildEventBrief', () => {
  it('uses the current description and fact sheet, drops the summary line and picks a tone for the kind of event', () => {
    const { brief, facts, notes, cancelled } = rebuildEventBrief(storedBrief, detail);
    expect(brief.prompt).toBe('The Anchor Cash Bingo Night\n\n£10 per bingo book, paid in cash on arrival.');
    expect(facts).toMatchObject({ price: '£10 per person, paid in cash on arrival', host: 'Peter Pitcher', category: 'Cash Bingo' });
    expect(brief.facts).toEqual(facts);
    expect(brief.tone).toBe('community_focused');
    // Dates, times and links stay as scheduled.
    expect(brief).toMatchObject({ eventDate: '2026-11-18', eventTime: '19:00', ctaLinks: storedBrief.ctaLinks });
    expect(notes).toEqual([]);
    expect(cancelled).toBe(false);
  });

  it('keeps a tone the owner chose', () => {
    expect(rebuildEventBrief({ ...storedBrief, tone: 'professional' }, detail).brief.tone).toBe('professional');
  });

  it('flags a moved event and a changed description for the owner', () => {
    const { notes } = rebuildEventBrief(storedBrief, { ...detail, date: '2026-11-25', brief: 'Now with a £200 snowball.' });
    expect(notes.join(' ')).toMatch(/now has this on 2026-11-25 at 19:00/);
    expect(notes.join(' ')).toMatch(/description in the events system has changed/);
  });

  it('marks a cancelled event so its posts are left alone', () => {
    const result = rebuildEventBrief(storedBrief, { ...detail, event_status: 'cancelled' });
    expect(result.cancelled).toBe(true);
    expect(result.notes[0]).toMatch(/cancelled/);
  });

  it('falls back to the stored brief, tidied, when the event cannot be found', () => {
    const { brief, facts, notes } = rebuildEventBrief(storedBrief, null);
    expect(facts).toBeNull();
    expect(brief.facts).toBeUndefined();
    expect(brief.prompt).toContain('£10 per bingo book, paid in cash on arrival.');
    expect(brief.prompt).not.toContain('**');
    expect(notes[0]).toMatch(/Not found in the events system/);
  });
});

describe('chooseManagementEvent', () => {
  const list = [
    { id: 'a', name: 'Snowball Showdown Cash Bingo', date: '2026-12-16' },
    { id: 'b', name: 'Snowball Showdown Cash Bingo', date: '2026-11-18' },
    { id: 'c', name: 'Festive Music Bingo', date: '2026-11-18' },
  ];

  it('prefers the same name on the same date', () => {
    expect(chooseManagementEvent(list, 'snowball showdown cash bingo', '2026-11-18')?.id).toBe('b');
  });

  it('falls back to the nearest date for a moved event', () => {
    expect(chooseManagementEvent(list.filter((event) => event.id !== 'b'), 'Snowball Showdown Cash Bingo', '2026-11-18')?.id).toBe('a');
  });

  it('finds nothing when no name matches', () => {
    expect(chooseManagementEvent(list, 'Quiz Night', '2026-11-18')).toBeNull();
  });
});

describe('planEventPostRewrites', () => {
  function setup(extra: Row[] = [], jobs: Row[] = []) {
    const items = [
      item(1),
      item(2, { platform: 'instagram' }),
      item(3, { placement: 'story' }, { body: '' }),
      ...extra,
    ];
    const variants = items.flatMap((row) => row.content_variants as Row[]);
    return fakeDb({
      content_items: items,
      content_variants: variants,
      publish_jobs: [...items.map((row) => ({ content_item_id: row.id, status: 'queued' })), ...jobs],
      brand_profile: [],
      media_assets: [],
    });
  }

  it('writes one slot once, for both platforms, with the facts, and changes nothing', async () => {
    const { db, updates } = setup();
    const write = writer(draft('Ten games, a £180 snowball and £10 books paid in cash on the door.'));
    const plan = await planEventPostRewrites(
      { db, write, findEvent: async () => detail, now: () => NOW, model: 'gpt-test' },
      { accountId: ACCOUNT },
    );

    expect(write).toHaveBeenCalledTimes(1);
    const input = vi.mocked(write).mock.calls[0][0];
    expect(input.scheduledAt).toBe('2026-10-19T06:00:00+00:00');
    expect(input.brief).toMatchObject({ contentType: 'event', tone: 'community_focused', facts: { host: 'Peter Pitcher' } });
    expect(updates).toEqual([]);

    expect(plan.model).toBe('gpt-test');
    expect(plan.storiesLeftAlone).toBe(1);
    expect(plan.slots).toHaveLength(1);
    const [facebook, instagram] = plan.slots[0].posts;
    expect(facebook).toMatchObject({ contentItemId: uuid(1), variantId: uuid(101), platform: 'facebook', oldBody: 'Old copy 1' });
    expect(facebook.newBody).toContain('Ten games, a £180 snowball');
    expect(facebook.newBody).toContain('Book now: https://l.the-anchor.pub/fb1');
    expect(facebook.newPreviewData).toMatchObject({
      platform: 'facebook',
      ctaUrl: 'https://l.the-anchor.pub/fb1',
      structuredCopy: { ctaText: 'Book now' },
      brief: { facts: { host: 'Peter Pitcher' } },
    });
    expect(instagram.newBody).toContain('Book through the link in our bio.');
    expect(instagram.newBody).not.toContain('https://');
    expect(plan.events[0]).toMatchObject({ eventName: 'Snowball Showdown Cash Bingo', tone: 'community_focused' });
  });

  it('leaves alone posts due within the hour, not scheduled, or already publishing', async () => {
    const { db } = setup(
      [
        item(4, { scheduled_for: '2026-10-17T16:30:00+00:00' }),
        item(5, { status: 'draft', scheduled_for: '2026-10-20T06:00:00+00:00' }),
        item(6, { scheduled_for: '2026-10-21T06:00:00+00:00' }),
      ],
      [{ content_item_id: uuid(6), status: 'publishing' }],
    );
    const plan = await planEventPostRewrites(
      { db, write: writer(draft('Ten games and a £180 snowball.')), findEvent: async () => detail, now: () => NOW, model: 'gpt-test' },
      { accountId: ACCOUNT },
    );

    const reasons = Object.fromEntries(plan.skipped.map((post) => [post.contentItemId, post.reason]));
    expect(reasons[uuid(4)]).toBe('due within 60 minutes');
    expect(reasons[uuid(5)]).toBe('status is draft');
    expect(reasons[uuid(6)]).toMatch(/publishing has started/);
    expect(plan.slots.flatMap((slot) => slot.posts.map((post) => post.contentItemId))).toEqual([uuid(1), uuid(2)]);
  });

  it('refuses new text that would be untrue at its time', async () => {
    const { db } = setup();
    const plan = await planEventPostRewrites(
      { db, write: writer(draft('Cash bingo tonight from 7pm.')), findEvent: async () => detail, now: () => NOW, model: 'gpt-test' },
      { accountId: ACCOUNT },
    );
    const facebook = plan.skipped.find((post) => post.contentItemId === uuid(1));
    expect(facebook?.reason).toMatch(/tonight/);
    expect(plan.slots[0].posts.map((post) => post.platform)).toEqual(['instagram']);
  });

  it('retries a failed write once, then leaves the slot alone', async () => {
    const { db } = setup();
    const write = vi.fn(async () => {
      throw new Error('timed out');
    }) as unknown as typeof writeCopy;
    const plan = await planEventPostRewrites(
      { db, write, findEvent: async () => detail, now: () => NOW, model: 'gpt-test' },
      { accountId: ACCOUNT },
    );
    expect(write).toHaveBeenCalledTimes(2);
    expect(plan.slots).toEqual([]);
    expect(plan.skipped.map((post) => post.reason)).toEqual([
      'the AI could not write it (timed out)',
      'the AI could not write it (timed out)',
    ]);
  });

  it('notes an events system it could not reach and writes from the stored brief', async () => {
    const { db } = setup();
    const write = writer(draft('Ten games and a £180 snowball.'));
    const plan = await planEventPostRewrites(
      {
        db,
        write,
        findEvent: async () => {
          throw new Error('no management app connection for this brand');
        },
        now: () => NOW,
        model: 'gpt-test',
      },
      { accountId: ACCOUNT },
    );
    expect(plan.events[0].notes[0]).toMatch(/could not be reached \(no management app connection/);
    expect(vi.mocked(write).mock.calls[0][0].brief).not.toHaveProperty('facts');
    expect(plan.slots[0].posts).toHaveLength(2);
  });
});

describe('applyRewritePlan', () => {
  function planFor(posts: Array<{ n: number; scheduledFor?: string }>): RewritePlan {
    return {
      version: 1,
      createdAt: NOW.toISOString(),
      model: 'gpt-test',
      accountId: ACCOUNT,
      storiesLeftAlone: 0,
      events: [],
      skipped: [],
      slots: [
        {
          campaignId: 'camp-1',
          campaignName: 'Snowball Showdown Cash Bingo',
          scheduledFor: '2026-10-19T06:00:00+00:00',
          slotLabel: null,
          warnings: [],
          posts: posts.map(({ n, scheduledFor }) => ({
            contentItemId: uuid(n),
            variantId: uuid(100 + n),
            platform: 'facebook' as const,
            scheduledFor: scheduledFor ?? '2026-10-19T06:00:00+00:00',
            oldBody: `Old copy ${n}`,
            newBody: `New copy ${n}`,
            oldPreviewData: { structuredCopy: { body: `Old copy ${n}` } },
            newPreviewData: { structuredCopy: { body: `New copy ${n}` } },
          })),
        },
      ],
    };
  }

  function tablesFor(items: Row[], jobs: Row[] = []) {
    const variants: Row[] = items.map((row) => ({ ...(row.content_variants as Row[])[0], content_item_id: row.id }));
    return {
      content_items: items,
      content_variants: variants,
      publish_jobs: [...items.map((row) => ({ content_item_id: row.id, status: 'queued' })), ...jobs],
    };
  }

  it('writes the planned text and stored copy only where the post is unchanged', async () => {
    const tables = tablesFor([
      item(1),
      item(2, {}, { body: 'Edited by the owner' }),
      item(3, { scheduled_for: '2026-10-22T06:00:00+00:00' }),
      item(4, { status: 'posted' }),
      item(5),
    ], [{ content_item_id: uuid(5), status: 'publishing' }]);
    const { db } = fakeDb(tables);
    const outcome = await applyRewritePlan(db, parseRewritePlan(planFor([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }])), {
      mode: 'apply',
      now: () => NOW,
    });

    expect(outcome.written).toEqual([uuid(1)]);
    expect(Object.fromEntries(outcome.skipped.map((post) => [post.contentItemId, post.reason]))).toEqual({
      [uuid(2)]: 'the text has been changed since the plan was made',
      [uuid(3)]: 'the post has been moved since the plan was made',
      [uuid(4)]: 'status is now posted',
      [uuid(5)]: 'publishing has started (publishing)',
    });
    expect(outcome.failed).toEqual([]);
    expect(tables.content_variants[0]).toMatchObject({ body: 'New copy 1', preview_data: { structuredCopy: { body: 'New copy 1' } } });
    expect(tables.content_variants[1]).toMatchObject({ body: 'Edited by the owner' });
    expect(tables.content_items[0].updated_at).toBe(NOW.toISOString());
  });

  it('leaves alone a post that has come within the hour since planning', async () => {
    const tables = tablesFor([item(1)]);
    const { db } = fakeDb(tables);
    const outcome = await applyRewritePlan(db, parseRewritePlan(planFor([{ n: 1 }])), {
      mode: 'apply',
      now: () => new Date('2026-10-19T05:30:00Z'),
    });
    expect(outcome.skipped).toEqual([{ contentItemId: uuid(1), reason: 'due within 60 minutes' }]);
    expect(tables.content_variants[0].body).toBe('Old copy 1');
  });

  it('rolls back only text it wrote, and says when a post is already done', async () => {
    const tables = tablesFor([item(1, {}, { body: 'New copy 1' }), item(2)]);
    const { db } = fakeDb(tables);
    const outcome = await applyRewritePlan(db, parseRewritePlan(planFor([{ n: 1 }, { n: 2 }])), {
      mode: 'rollback',
      now: () => NOW,
    });
    expect(outcome.written).toEqual([uuid(1)]);
    expect(outcome.skipped).toEqual([{ contentItemId: uuid(2), reason: 'already done' }]);
    expect(tables.content_variants[0]).toMatchObject({ body: 'Old copy 1', preview_data: { structuredCopy: { body: 'Old copy 1' } } });
  });

  it('refuses a file that is not a plan', () => {
    expect(() => parseRewritePlan({ version: 2 })).toThrow(/Not a rewrite plan/);
    expect(() => parseRewritePlan({ ...planFor([{ n: 1 }]), accountId: 'not-an-id' })).toThrow(/Not a rewrite plan/);
  });
});

describe('renderRewriteReport', () => {
  it('shows each post before and after, the checks and what was left alone', () => {
    const report = renderRewriteReport({
      version: 1,
      createdAt: NOW.toISOString(),
      model: 'gpt-test',
      accountId: ACCOUNT,
      storiesLeftAlone: 2,
      events: [{ campaignId: 'camp-1', campaignName: 'Snowball Showdown Cash Bingo', eventName: 'Snowball Showdown Cash Bingo', eventDate: '2026-11-18', facts: { price: '£10 per person' }, tone: 'community_focused', notes: ['Check this.'] }],
      skipped: [{ contentItemId: uuid(9), campaignName: 'Snowball Showdown Cash Bingo', platform: 'facebook', scheduledFor: '2026-10-17T16:30:00+00:00', reason: 'due within 60 minutes' }],
      slots: [
        {
          campaignId: 'camp-1',
          campaignName: 'Snowball Showdown Cash Bingo',
          scheduledFor: '2026-10-19T06:00:00+00:00',
          slotLabel: null,
          warnings: ['House style: one question at most.'],
          posts: [{
            contentItemId: uuid(1),
            variantId: uuid(101),
            platform: 'facebook',
            scheduledFor: '2026-10-19T06:00:00+00:00',
            oldBody: 'Old line one\n\nOld line two',
            newBody: 'New line one',
            oldPreviewData: null,
            newPreviewData: {},
          }],
        },
      ],
    });

    expect(report).toContain('Written Sat 17 Oct, 17:00 (London) with gpt-test. 1 posts in 1 slots would change.');
    expect(report).toContain('## Snowball Showdown Cash Bingo');
    expect(report).toContain('Facts used: price: £10 per person.');
    expect(report).toContain('**Check:** Check this.');
    expect(report).toContain('### Mon 19 Oct, 07:00');
    expect(report).toContain('> Old line one\n>\n> Old line two');
    expect(report).toContain('**Facebook, after**\n\n> New line one');
    expect(report).toContain('Warnings: House style: one question at most.');
    expect(report).toContain('- Snowball Showdown Cash Bingo, Sat 17 Oct, 17:30, facebook: due within 60 minutes');
  });
});
