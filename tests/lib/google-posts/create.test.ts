import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listGoogleBrands, type GoogleBrand } from '@/lib/google-posts/brands';
import {
  createGoogleVersionsForExistingSchedule,
  createVersionsForNewContent,
  insertGoogleVersion,
  planGoogleVersionsForExistingSchedule,
} from '@/lib/google-posts/create';

import { ACCOUNT, addCampaign, addPost, createWorld, PARENT, type World } from './world';

let world: World;

async function brand(): Promise<GoogleBrand> {
  const [found] = await listGoogleBrands(world.deps.db);
  return found;
}

const versions = () => world.db.rows('gbp_posts');

beforeEach(() => {
  world = createWorld();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('automatic creation (decision D8)', () => {
  it('creates a version only for posts created after the connection was made', async () => {
    const before = addPost(world, { createdAt: '2026-11-08T09:00:00.000Z' });
    const after = addPost(world, { createdAt: '2026-11-12T09:00:00.000Z' });

    const outcome = await createVersionsForNewContent(world.deps, await brand());

    expect(outcome.created).toEqual([after]);
    expect(versions().map((row) => row.content_item_id)).toEqual([after]);
    expect(versions().some((row) => row.content_item_id === before)).toBe(false);
    expect(versions()[0]).toMatchObject({ account_id: ACCOUNT, local_post_parent: PARENT, state: 'pending', topic_type: 'STANDARD' });
  });

  it('creates nothing automatically when the connection time is not known', async () => {
    world = createWorld({ connectedAt: null });
    addPost(world, { createdAt: '2026-11-12T09:00:00.000Z' });
    const outcome = await createVersionsForNewContent(world.deps, await brand());
    expect(outcome.created).toEqual([]);
    expect(versions()).toEqual([]);
  });

  it('never creates one for a story, an Instagram post, a draft or a trashed post', async () => {
    addPost(world, { placement: 'story' });
    addPost(world, { platform: 'instagram' });
    addPost(world, { status: 'draft' });
    addPost(world, { deletedAt: '2026-11-15T09:00:00.000Z' });
    await createVersionsForNewContent(world.deps, await brand());
    expect(versions()).toEqual([]);
  });

  it('still creates one for a post the publisher reached before this run', async () => {
    const soon = new Date(world.clock.now().getTime() - 60 * 1000).toISOString();
    const posted = addPost(world, { status: 'posted', scheduledFor: soon });
    const publishing = addPost(world, { status: 'publishing', scheduledFor: soon });
    const outcome = await createVersionsForNewContent(world.deps, await brand());
    expect(outcome.created.sort()).toEqual([posted, publishing].sort());
  });

  it('a second run creates nothing more', async () => {
    addPost(world);
    await createVersionsForNewContent(world.deps, await brand());
    const again = await createVersionsForNewContent(world.deps, await brand());
    expect(again.created).toEqual([]);
    expect(versions()).toHaveLength(1);
  });

  it('reaches posts beyond the first page once earlier posts have versions', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 230; index += 1) {
      const minute = String(index % 60).padStart(2, '0');
      const hour = String(12 + Math.floor(index / 60)).padStart(2, '0');
      ids.push(addPost(world, { scheduledFor: `2026-11-20T${hour}:${minute}:00.000Z` }));
    }
    const outcome = await createVersionsForNewContent(world.deps, await brand());
    expect(outcome.created).toHaveLength(230);
    expect(new Set(versions().map((row) => row.content_item_id))).toEqual(new Set(ids));
    const again = await createVersionsForNewContent(world.deps, await brand());
    expect(again.created).toEqual([]);
  });

  it('only scopes its reads and writes to the brand', async () => {
    addPost(world);
    world.db.queries.length = 0;
    await createVersionsForNewContent(world.deps, await brand());
    const unscoped = world.db.queries.filter(
      (query) =>
        ['content_items', 'gbp_posts', 'campaigns'].includes(query.table) &&
        query.op !== 'insert' &&
        !query.eq.some(([column, value]) => column === 'account_id' && value === ACCOUNT),
    );
    expect(unscoped).toEqual([]);
    expect(versions().every((row) => row.account_id === ACCOUNT)).toBe(true);
  });
});

describe('event campaigns: one event post, then standard reminders (D13)', () => {
  const stored = {
    eventStart: '2026-11-21T20:00:00.000Z',
    eventEnd: '2026-11-21T23:00:00.000Z',
    eventTitle: 'Music Bingo',
    googleCtaUrl: 'https://l.example.com/bingo',
    takesBookings: true,
  };

  it('makes the earliest upcoming Facebook feed post the event post and each later one a standard reminder', async () => {
    const campaignId = addCampaign(world, { metadata: stored, name: 'Music Bingo' });
    const later = addPost(world, { campaignId, scheduledFor: '2026-11-20T18:00:00.000Z' });
    const first = addPost(world, { campaignId, scheduledFor: '2026-11-18T18:00:00.000Z' });
    addPost(world, { campaignId, placement: 'story', scheduledFor: '2026-11-17T18:00:00.000Z' });

    await createVersionsForNewContent(world.deps, await brand());

    expect(versions()).toHaveLength(2);
    expect(versions().find((row) => row.content_item_id === first)).toMatchObject({
      topic_type: 'EVENT',
      event_title: 'Music Bingo',
      cta_type: 'BOOK',
      source_event_key: `campaign:${campaignId}`,
    });
    // The later post is a reminder: a standard post, same button, no event key. The story gets nothing.
    expect(versions().find((row) => row.content_item_id === later)).toMatchObject({
      topic_type: 'STANDARD',
      event_title: null,
      cta_type: 'BOOK',
      cta_url: 'https://l.example.com/bingo',
      source_event_key: null,
    });
    expect(world.management.list).not.toHaveBeenCalled();
  });

  it('gives a post added later a standard reminder, never a second event post', async () => {
    const campaignId = addCampaign(world, { metadata: stored });
    const first = addPost(world, { campaignId, scheduledFor: '2026-11-18T18:00:00.000Z' });
    await createVersionsForNewContent(world.deps, await brand());
    // The first post's version is skipped later; a newly added post is a reminder, not a second event post.
    world.db.tables.gbp_posts[0].state = 'skipped';
    world.db.tables.gbp_posts[0].hold_reason = 'parent_removed';
    world.db.tables.content_items.find((row) => row.id === first)!.deleted_at = '2026-11-16T09:00:00.000Z';
    const added = addPost(world, { campaignId, scheduledFor: '2026-11-19T18:00:00.000Z' });

    await createVersionsForNewContent(world.deps, await brand());
    expect(versions()).toHaveLength(2);
    expect(versions().filter((row) => row.source_event_key)).toHaveLength(1);
    expect(versions().find((row) => row.content_item_id === added)).toMatchObject({ topic_type: 'STANDARD', source_event_key: null });

    // A third pass creates nothing more.
    await createVersionsForNewContent(world.deps, await brand());
    expect(versions()).toHaveLength(2);
  });

  it('treats a unique violation from a racing run as "already has one", never an error', async () => {
    const campaignId = addCampaign(world, { metadata: stored });
    addPost(world, { campaignId, scheduledFor: '2026-11-18T18:00:00.000Z' });

    const [a, b] = await Promise.all([
      createVersionsForNewContent(world.deps, await brand()),
      createVersionsForNewContent(world.deps, await brand()),
    ]);

    expect(versions()).toHaveLength(1);
    expect([...a.created, ...b.created]).toHaveLength(1);
    expect([...a.alreadyHad, ...b.alreadyHad]).toHaveLength(1);
    expect([...a.failed, ...b.failed]).toEqual([]);
  });

  it('the database refuses a second version for the same event on two different posts', async () => {
    const one = addPost(world);
    const two = addPost(world);
    const row = (contentItemId: string) => ({
      account_id: ACCOUNT,
      content_item_id: contentItemId,
      source_event_key: 'mgmt:evt-1',
      local_post_parent: PARENT,
      state: 'pending' as const,
      hold_reason: null,
      topic_type: 'STANDARD' as const,
      summary: 'Quiz',
      cta_type: null,
      cta_url: null,
      event_title: null,
      event_start: null,
      event_end: null,
    });
    const results = await Promise.all([insertGoogleVersion(world.deps.db, row(one)), insertGoogleVersion(world.deps.db, row(two))]);
    expect(results.sort()).toEqual(['already_had', 'created']);
    expect(versions()).toHaveLength(1);
  });
});

describe('event details from the management app', () => {
  // How the five live event campaigns look: no eventEnd, sourceEventKey or googleCtaUrl.
  const legacy = {
    eventStart: '2026-11-21T20:00:00.000+00:00',
    startDate: '2026-11-21',
    startTime: '20:00',
    brief: { eventName: 'Cash Bingo' },
  };

  function enableManagement(): void {
    world.db.tables.accounts.find((row) => row.id === ACCOUNT)!.management_import_enabled = true;
    world.db.seed('management_app_connections', [{ account_id: ACCOUNT, base_url: 'https://management.example', api_key: 'mgmt-key' }]);
  }

  const detail = {
    id: 'evt-42',
    name: 'Cash Bingo',
    date: '2026-11-21',
    time: '20:00',
    end_time: '23:00',
    booking_url: 'https://book.example/cash-bingo',
    cta_links: { gbp: 'https://l.example.com/cash-bingo-g' },
  };

  it('matches by exact name, date and time and builds an EVENT', async () => {
    enableManagement();
    world.management.list.mockResolvedValue([
      { id: 'evt-41', name: 'Cash Bingo Special', date: '2026-11-21', time: '20:00' },
      { id: 'evt-42', name: '  cash bingo ', date: '2026-11-21', time: '20:00' },
      { id: 'evt-43', name: 'Cash Bingo', date: '2026-11-28', time: '20:00' },
    ]);
    world.management.detail.mockResolvedValue(detail);
    const campaignId = addCampaign(world, { metadata: legacy, name: 'Cash Bingo' });
    const post = addPost(world, { campaignId, scheduledFor: '2026-11-19T18:00:00.000Z' });

    await createVersionsForNewContent(world.deps, await brand());

    expect(world.management.list).toHaveBeenCalledWith(
      { baseUrl: 'https://management.example', apiKey: 'mgmt-key' },
      { query: 'Cash Bingo', fromDate: '2026-11-21', toDate: '2026-11-21', limit: 50 },
    );
    expect(world.management.detail).toHaveBeenCalledWith(expect.anything(), 'evt-42');
    expect(versions()[0]).toMatchObject({
      content_item_id: post,
      topic_type: 'EVENT',
      source_event_key: 'mgmt:evt-42',
      event_title: 'Cash Bingo',
      event_start: '2026-11-21T20:00:00.000Z',
      event_end: '2026-11-21T23:00:00.000Z',
      cta_type: 'BOOK',
      cta_url: 'https://l.example.com/cash-bingo-g',
    });
  });

  it('looks the event up once and gives its later posts the same button as reminders', async () => {
    enableManagement();
    world.management.list.mockResolvedValue([{ id: 'evt-42', name: 'Cash Bingo', date: '2026-11-21', time: '20:00' }]);
    world.management.detail.mockResolvedValue(detail);
    const campaignId = addCampaign(world, { metadata: legacy, name: 'Cash Bingo' });
    const first = addPost(world, { campaignId, scheduledFor: '2026-11-18T18:00:00.000Z' });
    const second = addPost(world, { campaignId, scheduledFor: '2026-11-19T18:00:00.000Z' });
    const third = addPost(world, { campaignId, scheduledFor: '2026-11-20T18:00:00.000Z' });

    await createVersionsForNewContent(world.deps, await brand());

    expect(world.management.list).toHaveBeenCalledTimes(1);
    expect(world.management.detail).toHaveBeenCalledTimes(1);
    expect(versions()).toHaveLength(3);
    expect(versions().find((row) => row.content_item_id === first)).toMatchObject({ topic_type: 'EVENT', source_event_key: 'mgmt:evt-42' });
    for (const reminder of [second, third]) {
      expect(versions().find((row) => row.content_item_id === reminder)).toMatchObject({
        topic_type: 'STANDARD',
        source_event_key: null,
        cta_type: 'BOOK',
        cta_url: 'https://l.example.com/cash-bingo-g',
      });
    }
  });

  it.each([
    ['two events match', [
      { id: 'a', name: 'Cash Bingo', date: '2026-11-21', time: '20:00' },
      { id: 'b', name: 'Cash Bingo', date: '2026-11-21', time: '20:00' },
    ]],
    ['no event matches the time', [{ id: 'a', name: 'Cash Bingo', date: '2026-11-21', time: '19:30' }]],
  ])('falls back to STANDARD when %s', async (_label, listed) => {
    enableManagement();
    world.management.list.mockResolvedValue(listed);
    const campaignId = addCampaign(world, { metadata: legacy, name: 'Cash Bingo' });
    addPost(world, { campaignId, scheduledFor: '2026-11-19T18:00:00.000Z' });

    await createVersionsForNewContent(world.deps, await brand());

    expect(world.management.detail).not.toHaveBeenCalled();
    expect(versions()[0]).toMatchObject({ topic_type: 'STANDARD', source_event_key: `campaign:${campaignId}`, cta_type: null });
  });

  it('falls back to STANDARD, and logs, when the management app fails', async () => {
    enableManagement();
    world.management.list.mockRejectedValue(Object.assign(new Error('Management API rate limit exceeded (429)'), { code: 'RATE_LIMITED', status: 429 }));
    const campaignId = addCampaign(world, { metadata: legacy, name: 'Cash Bingo' });
    addPost(world, { campaignId, scheduledFor: '2026-11-19T18:00:00.000Z' });

    await createVersionsForNewContent(world.deps, await brand());

    expect(versions()[0]).toMatchObject({ topic_type: 'STANDARD' });
    expect(console.warn).toHaveBeenCalled();
  });

  it('does not call the management app for a brand without management import', async () => {
    const campaignId = addCampaign(world, { metadata: legacy, name: 'Cash Bingo' });
    addPost(world, { campaignId, scheduledFor: '2026-11-19T18:00:00.000Z' });
    await createVersionsForNewContent(world.deps, await brand());
    expect(world.management.list).not.toHaveBeenCalled();
    expect(versions()[0]).toMatchObject({ topic_type: 'STANDARD' });
  });

  it('caps and paces management calls, and leaves the rest for the next run', async () => {
    enableManagement();
    world.management.list.mockImplementation(async (_config: unknown, options: { query: string }) => [
      { id: `id-${options.query}`, name: options.query, date: '2026-11-21', time: '20:00' },
    ]);
    world.management.detail.mockImplementation(async (_config: unknown, eventId: string) => ({ ...detail, id: eventId }));
    for (let index = 0; index < 8; index += 1) {
      const campaignId = addCampaign(world, { metadata: { ...legacy, brief: { eventName: `Event ${index}` } }, name: `Event ${index}` });
      addPost(world, { campaignId, scheduledFor: `2026-11-19T1${index}:00:00.000Z` });
    }

    const first = await createVersionsForNewContent(world.deps, await brand());

    // Ten calls a run: five events (a list and a detail each), three left for later.
    expect(world.management.list.mock.calls.length + world.management.detail.mock.calls.length).toBe(10);
    expect(first.created).toHaveLength(5);
    expect(first.deferred).toBe(3);
    expect(world.sleep).toHaveBeenCalledTimes(9);
    expect(world.sleep).toHaveBeenCalledWith(1000);

    const second = await createVersionsForNewContent(world.deps, await brand());
    expect(second.created).toHaveLength(3);
    expect(versions()).toHaveLength(8);
  });
});

describe('the deliberate pass over the existing schedule (D8)', () => {
  it('lists what would be created, held and skipped, and creates nothing', async () => {
    const old = addPost(world, { createdAt: '2026-11-01T09:00:00.000Z' });
    const promo = addPost(world, { createdAt: '2026-11-01T09:00:00.000Z', body: 'Happy hour: £4 pints from 5pm' });
    const story = addPost(world, { createdAt: '2026-11-01T09:00:00.000Z', placement: 'story' });

    const plan = await planGoogleVersionsForExistingSchedule(ACCOUNT, world.deps);

    expect(plan.create.map((entry) => entry.contentItemId)).toEqual([old]);
    expect(plan.held.map((entry) => entry.contentItemId)).toEqual([promo]);
    expect(plan.held[0].row).toMatchObject({ state: 'held', hold_reason: 'alcohol_promotion' });
    expect(plan.skipped).toEqual([expect.objectContaining({ contentItemId: story, reason: 'a story, not a feed post' })]);
    expect(versions()).toEqual([]);
  });

  it('creates exactly what the dry run listed, and a second run creates nothing', async () => {
    const a = addPost(world, { createdAt: '2026-11-01T09:00:00.000Z' });
    const b = addPost(world, { createdAt: '2026-11-01T09:00:00.000Z', scheduledFor: '2026-11-22T12:00:00.000Z' });
    const plan = await planGoogleVersionsForExistingSchedule(ACCOUNT, world.deps);
    // Added after the dry run: not in the plan, so not created by this apply.
    addPost(world, { createdAt: '2026-11-01T09:00:00.000Z' });

    const first = await createGoogleVersionsForExistingSchedule(ACCOUNT, plan, world.deps);
    expect(first.created.sort()).toEqual([a, b].sort());
    expect(versions().map((row) => row.content_item_id).sort()).toEqual([a, b].sort());

    const second = await createGoogleVersionsForExistingSchedule(ACCOUNT, plan, world.deps);
    expect(second.created).toEqual([]);
    expect(second.alreadyHad.sort()).toEqual([a, b].sort());
    expect(versions()).toHaveLength(2);
  });

  it('does not create a version for a post that changed after the dry run', async () => {
    const moved = addPost(world, { createdAt: '2026-11-01T09:00:00.000Z' });
    const binned = addPost(world, { createdAt: '2026-11-01T09:00:00.000Z' });
    const plan = await planGoogleVersionsForExistingSchedule(ACCOUNT, world.deps);
    world.db.tables.content_items.find((row) => row.id === moved)!.scheduled_for = '2026-11-25T18:00:00.000Z';
    world.db.tables.content_items.find((row) => row.id === binned)!.deleted_at = '2026-11-16T09:30:00.000Z';

    const outcome = await createGoogleVersionsForExistingSchedule(ACCOUNT, plan, world.deps);
    expect(outcome.created).toEqual([]);
    expect(outcome.changed.map((entry) => entry.contentItemId).sort()).toEqual([moved, binned].sort());
    expect(versions()).toEqual([]);
  });

  it('refuses a brand with the switch off, and a plan for another location', async () => {
    addPost(world, { createdAt: '2026-11-01T09:00:00.000Z' });
    const plan = await planGoogleVersionsForExistingSchedule(ACCOUNT, world.deps);
    await expect(
      createGoogleVersionsForExistingSchedule(ACCOUNT, { ...plan, localPostParent: 'accounts/1/locations/2' }, world.deps),
    ).rejects.toThrow(/location has changed/);

    world.db.tables.accounts.find((row) => row.id === ACCOUNT)!.google_posts_enabled = false;
    await expect(planGoogleVersionsForExistingSchedule(ACCOUNT, world.deps)).rejects.toThrow(/not switched on/);
    await expect(createGoogleVersionsForExistingSchedule(ACCOUNT, plan, world.deps)).rejects.toThrow(/not switched on/);
    expect(versions()).toEqual([]);
  });
});
