import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { atLondon, type CalendarPlan, type PlanSlot } from '@/lib/content/calendar-fill';
import { applyCalendarPlan, parseCalendarPlan, rollbackCalendarPlan, verifyAppliedPlan } from '@/lib/content/calendar-fill-apply';
import type { scheduleContentBatch } from '@/lib/content/schedule-batch';

type Row = Record<string, unknown>;

function read(row: Row, column: string): unknown {
  if (!column.includes('->>')) return row[column];
  const [field, key] = column.split('->>');
  const value = row[field];
  return value && typeof value === 'object' ? (value as Row)[key] : undefined;
}

/** In-memory tables for the query shapes apply and rollback use; updates and deletes change the rows. */
function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let action: { kind: 'update'; values: Row } | { kind: 'delete' } | null = null;
    const matching = (): Row[] => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    const run = (): { data: Row[]; error: null } => {
      const hit = matching();
      if (action?.kind === 'update') for (const row of hit) Object.assign(row, action.values);
      if (action?.kind === 'delete') tables[table] = (tables[table] ?? []).filter((row) => !hit.includes(row));
      return { data: hit.map((row) => ({ ...row })), error: null };
    };
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => (filters.push((row) => read(row, column) === value), builder),
      is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(read(row, column))), builder),
      gte: (column: string, value: string) => (filters.push((row) => Date.parse(String(row[column])) >= Date.parse(value)), builder),
      lt: (column: string, value: string) => (filters.push((row) => Date.parse(String(row[column])) < Date.parse(value)), builder),
      update: (values: Row) => ((action = { kind: 'update', values }), builder),
      delete: () => ((action = { kind: 'delete' }), builder),
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

const ACCOUNT = '91fda684-2801-4abb-980e-f42cec017cef';
const NOW = new Date('2026-10-18T09:00:00Z');
const ids = ['a1', 'a2', 'a3', 'a4'].map((suffix) => `00000000-0000-4000-8000-0000000000${suffix}`);
const ARTWORK = '74db8445-3784-44ae-b4ec-0861ed1a9716';
const PHOTO = '5a6cd1a9-b5bf-4ee1-bd89-8029c06c7191';

function planSlot(date: string, overrides: Partial<PlanSlot> = {}): PlanSlot {
  return {
    slotKey: `calendar:20261017220000:lunch:${date}`,
    date,
    scheduledAt: atLondon(date, '11:00'),
    label: 'Weekday lunch',
    copy: { facebook: { body: 'Lunch is on.' }, instagram: { body: 'Lunch is on.' } } as PlanSlot['copy'],
    bodies: { facebook: 'Lunch is on.\n\nBook a table: https://l.example.com/fb', instagram: 'Lunch is on.\n\nLink in bio' },
    mediaIds: [PHOTO],
    dayFeedCounts: { facebook: 0, instagram: 0 },
    warnings: [],
    ...overrides,
  };
}

function basePlan(overrides: Partial<CalendarPlan> = {}): CalendarPlan {
  return {
    version: 1,
    planId: '20261017220000',
    createdAt: '2026-10-17T21:00:00.000Z',
    model: 'gpt-5.5',
    accountId: ACCOUNT,
    from: '2026-10-21',
    to: '2026-12-02',
    moves: [],
    batches: [],
    unfilled: [],
    ruleBreaks: [],
    notes: [],
    days: [],
    sources: [],
    events: [],
    ...overrides,
  };
}

const move = {
  campaignId: 'c-quiz',
  campaignName: 'Sparks Quiz',
  items: ids.map((contentItemId, index) => ({ contentItemId, platform: index % 2 ? 'instagram' : 'facebook', placement: index < 2 ? 'feed' : 'story' })),
  fromIso: atLondon('2026-10-28', '12:00'),
  toIso: atLondon('2026-10-28', '11:00'),
  reason: 'build_up_time' as const,
};

function scheduledItems(at: string): Row[] {
  return move.items.map((item) => ({
    id: item.contentItemId,
    account_id: ACCOUNT,
    status: 'scheduled',
    scheduled_for: at,
    deleted_at: null,
    platform: item.platform,
    placement: item.placement,
    prompt_context: { slotKey: 'cadence:weekly-1' },
  }));
}

const jobsFor = (at: string): Row[] => ids.map((id) => ({ content_item_id: id, account_id: ACCOUNT, status: 'queued', next_attempt_at: at }));

describe('applyCalendarPlan: moves', () => {
  it('moves a whole slot, feed and story, with its publish jobs', async () => {
    const tables = { content_items: scheduledItems(move.fromIso), publish_jobs: jobsFor(move.fromIso) };
    const outcome = await applyCalendarPlan({ db: fakeDb(tables), now: () => NOW }, basePlan({ moves: [move] }));

    expect(outcome.failed).toEqual([]);
    expect(outcome.record.moved).toEqual([{ contentItemIds: ids, fromIso: move.fromIso, toIso: move.toIso }]);
    expect(tables.content_items.every((row) => row.scheduled_for === move.toIso)).toBe(true);
    expect(tables.publish_jobs.every((row) => row.next_attempt_at === move.toIso)).toBe(true);
  });

  it('leaves a slot alone when one of its posts has been moved since the plan was made', async () => {
    const items = scheduledItems(move.fromIso);
    items[3].scheduled_for = atLondon('2026-10-29', '12:00');
    const tables = { content_items: items, publish_jobs: jobsFor(move.fromIso) };
    const outcome = await applyCalendarPlan({ db: fakeDb(tables), now: () => NOW }, basePlan({ moves: [move] }));

    expect(outcome.skipped).toEqual([{ what: expect.stringContaining('Sparks Quiz'), reason: 'a post in this slot has been moved since the plan was made' }]);
    expect(tables.content_items.slice(0, 3).every((row) => row.scheduled_for === move.fromIso)).toBe(true);
    expect(outcome.record.moved).toEqual([]);
  });

  it('leaves a slot alone when the publisher has taken one of its jobs', async () => {
    const jobs = jobsFor(move.fromIso);
    jobs[0].status = 'in_progress';
    const tables = { content_items: scheduledItems(move.fromIso), publish_jobs: jobs };
    const outcome = await applyCalendarPlan({ db: fakeDb(tables), now: () => NOW }, basePlan({ moves: [move] }));

    expect(outcome.skipped[0].reason).toBe('its publish jobs are not all waiting');
    expect(tables.content_items.every((row) => row.scheduled_for === move.fromIso)).toBe(true);
  });
});

describe('applyCalendarPlan: optional 7am moves', () => {
  const early = { ...move, reason: 'early_build_up' as const, fromIso: atLondon('2026-10-28', '07:00') };

  it('leaves them alone unless asked, and makes them when asked', async () => {
    const tables = { content_items: scheduledItems(early.fromIso), publish_jobs: jobsFor(early.fromIso) };
    const db = fakeDb(tables);

    const left = await applyCalendarPlan({ db, now: () => NOW }, basePlan({ moves: [early] }));
    expect(left.optionalLeft).toBe(1);
    expect(tables.content_items.every((row) => row.scheduled_for === early.fromIso)).toBe(true);

    const made = await applyCalendarPlan({ db, now: () => NOW }, basePlan({ moves: [early] }), undefined, { withEarlyMoves: true });
    expect(made.optionalLeft).toBe(0);
    expect(made.record.moved).toEqual([{ contentItemIds: ids, fromIso: early.fromIso, toIso: early.toIso }]);
    expect(tables.content_items.every((row) => row.scheduled_for === early.toIso)).toBe(true);
  });
});

describe('applyCalendarPlan: new posts', () => {
  const batch = (slots: PlanSlot[], extra: Partial<CalendarPlan['batches'][number]> = {}): CalendarPlan['batches'][number] => ({
    key: 'lunch',
    kind: 'lunch',
    title: 'Weekday lunch',
    contentType: 'weekly_recurring',
    brief: { contentType: 'weekly_recurring', title: 'Weekday lunch' },
    photos: {},
    slots,
    notes: [],
    ...extra,
  });

  it('schedules the slots through the shared step and records what it made', async () => {
    const schedule = vi.fn(async () => ({ success: true, contentItemIds: ['n1', 'n2', 'n3', 'n4'], campaignId: 'camp-new', placements: ['feed', 'story'] })) as unknown as typeof scheduleContentBatch;
    const tables: Record<string, Row[]> = { content_items: [], publish_jobs: [] };
    const plan = basePlan({ batches: [batch([planSlot('2026-10-22')])] });
    const outcome = await applyCalendarPlan({ db: fakeDb(tables), now: () => NOW, schedule }, plan);

    expect(outcome.failed).toEqual([]);
    expect(schedule).toHaveBeenCalledWith(expect.anything(), ACCOUNT, expect.objectContaining({
      contentType: 'weekly_recurring',
      platforms: ['facebook', 'instagram'],
      mode: 'schedule',
      slotCopies: [expect.objectContaining({ slotKey: 'calendar:20261017220000:lunch:2026-10-22', mediaIds: [PHOTO] })],
    }));
    expect(outcome.record.created).toEqual([{ batchKey: 'lunch', slotKeys: ['calendar:20261017220000:lunch:2026-10-22'], contentItemIds: ['n1', 'n2', 'n3', 'n4'], campaignId: 'camp-new', createdCampaign: true }]);
  });

  it('skips a day that has had a post added since the plan was made, and a slot already created', async () => {
    const schedule = vi.fn() as unknown as typeof scheduleContentBatch;
    const tables: Record<string, Row[]> = {
      content_items: [
        { id: 'owner-post', account_id: ACCOUNT, status: 'scheduled', platform: 'facebook', placement: 'feed', deleted_at: null, scheduled_for: atLondon('2026-10-22', '18:00'), prompt_context: { slotKey: 'wizard' } },
        { id: 'made-earlier', account_id: ACCOUNT, status: 'scheduled', platform: 'facebook', placement: 'feed', deleted_at: null, scheduled_for: atLondon('2026-10-23', '11:00'), prompt_context: { slotKey: 'calendar:20261017220000:lunch:2026-10-23' } },
      ],
    };
    const plan = basePlan({ batches: [batch([planSlot('2026-10-22'), planSlot('2026-10-23')])] });
    const outcome = await applyCalendarPlan({ db: fakeDb(tables), now: () => NOW, schedule }, plan);

    expect(schedule).not.toHaveBeenCalled();
    expect(outcome.skipped.map((entry) => entry.reason)).toEqual([
      'a facebook post has been added to Thu 22 Oct since the plan was made',
      'already created',
    ]);
  });

  it('imports a new campaign\'s artwork first and uses it for every post', async () => {
    const schedule = vi.fn(async () => ({ success: true, contentItemIds: ['n1'], campaignId: 'camp-sleigh' })) as unknown as typeof scheduleContentBatch;
    const importArtwork = vi.fn(async () => ARTWORK);
    const plan = basePlan({
      batches: [batch([planSlot('2026-11-27', { mediaIds: [], slotKey: 'calendar:20261017220000:event-mb:2026-11-27' })], {
        key: 'event-mb', kind: 'new_campaign', title: 'Sleigh My Name', contentType: 'event',
        artwork: { eventId: 'mb-dec', eventName: 'Sleigh My Name', assetId: null, fileName: null },
      })],
    });
    const outcome = await applyCalendarPlan({ db: fakeDb({ content_items: [] }), now: () => NOW, schedule, importArtwork }, plan);

    expect(importArtwork).toHaveBeenCalledWith({ eventId: 'mb-dec', eventName: 'Sleigh My Name' });
    expect(schedule).toHaveBeenCalledWith(expect.anything(), ACCOUNT, expect.objectContaining({ slotCopies: [expect.objectContaining({ mediaIds: [ARTWORK] })] }));
    expect(outcome.record.importedArtwork).toEqual([{ eventId: 'mb-dec', assetId: ARTWORK }]);
  });

  it('reports the shared step refusing a batch, and writes nothing else for it', async () => {
    const schedule = vi.fn(async () => ({ error: 'Sleigh My Name can be promoted from Saturday 14th November.' })) as unknown as typeof scheduleContentBatch;
    const outcome = await applyCalendarPlan({ db: fakeDb({ content_items: [] }), now: () => NOW, schedule }, basePlan({ batches: [batch([planSlot('2026-10-22')])] }));

    expect(outcome.failed).toEqual([{ what: 'Weekday lunch', error: 'Sleigh My Name can be promoted from Saturday 14th November.' }]);
    expect(outcome.record.created).toEqual([]);
  });
});

describe('verifyAppliedPlan', () => {
  it('finds a post whose text differs from the plan', async () => {
    const slot = planSlot('2026-10-22');
    const rows = (['facebook', 'instagram'] as const).flatMap((platform) => (['feed', 'story'] as const).map((placement) => ({
      id: `${platform}-${placement}`,
      account_id: ACCOUNT,
      status: 'scheduled',
      scheduled_for: slot.scheduledAt,
      platform,
      placement,
      prompt_context: { slotKey: slot.slotKey },
      content_variants: [{ body: placement === 'story' ? '' : platform === 'facebook' ? 'Edited by hand' : slot.bodies.instagram, media_ids: [PHOTO] }],
    })));
    const db = fakeDb({ content_items: rows, publish_jobs: rows.map((row) => ({ content_item_id: row.id, account_id: ACCOUNT, status: 'queued' })) });
    const plan = basePlan({ batches: [{ key: 'lunch', kind: 'lunch', title: 'Weekday lunch', contentType: 'weekly_recurring', brief: {}, photos: {}, slots: [slot], notes: [] }] });

    const problems = await verifyAppliedPlan(db, plan, { planId: plan.planId, accountId: ACCOUNT, moved: [], importedArtwork: [], created: [{ batchKey: 'lunch', slotKeys: [slot.slotKey], contentItemIds: rows.map((row) => row.id), campaignId: null, createdCampaign: false }] });

    expect(problems).toEqual([{ what: 'Weekday lunch, Thu 22 Oct, 11:00', problem: 'facebook text differs from the plan' }]);
  });
});

describe('rollbackCalendarPlan', () => {
  it('bins the posts it added that have not gone out, and moves moved posts back', async () => {
    const tables: Record<string, Row[]> = {
      content_items: [
        { id: 'n1', account_id: ACCOUNT, status: 'scheduled', deleted_at: null, platform: 'facebook', placement: 'feed', scheduled_for: atLondon('2026-10-22', '11:00') },
        { id: 'n2', account_id: ACCOUNT, status: 'posted', deleted_at: null, platform: 'instagram', placement: 'feed', scheduled_for: atLondon('2026-10-22', '11:00') },
        ...scheduledItems(move.toIso),
      ],
      publish_jobs: [
        { content_item_id: 'n1', account_id: ACCOUNT, status: 'queued' },
        { content_item_id: 'n2', account_id: ACCOUNT, status: 'succeeded' },
        ...jobsFor(move.toIso),
      ],
    };
    const plan = basePlan({ moves: [move] });
    const outcome = await rollbackCalendarPlan({ db: fakeDb(tables), now: () => NOW }, plan, {
      planId: plan.planId,
      accountId: ACCOUNT,
      moved: [{ contentItemIds: ids, fromIso: move.fromIso, toIso: move.toIso }],
      created: [{ batchKey: 'lunch', slotKeys: [], contentItemIds: ['n1', 'n2'], campaignId: null, createdCampaign: false }],
      importedArtwork: [],
    });

    expect(outcome.failed).toEqual([]);
    expect(tables.content_items.find((row) => row.id === 'n1')?.deleted_at).toBe(NOW.toISOString());
    expect(tables.content_items.find((row) => row.id === 'n2')?.deleted_at).toBeNull();
    expect(tables.publish_jobs.some((row) => row.content_item_id === 'n1')).toBe(false);
    expect(outcome.skipped).toEqual([expect.objectContaining({ reason: 'it is posted and cannot be taken back' })]);
    expect(tables.content_items.filter((row) => ids.includes(String(row.id))).every((row) => row.scheduled_for === move.fromIso)).toBe(true);
    expect(tables.publish_jobs.filter((row) => ids.includes(String(row.content_item_id))).every((row) => row.next_attempt_at === move.fromIso)).toBe(true);
  });
});

describe('parseCalendarPlan', () => {
  it('refuses a file that is not a calendar plan', () => {
    expect(() => parseCalendarPlan({ version: 1, slots: [] })).toThrow(/Not a calendar plan/);
  });
});
