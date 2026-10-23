import { describe, expect, it, vi } from 'vitest';

import {
  EVENT_ORDER_CATEGORY,
  checkAccountEventOrder,
  findEvent,
  orderNotice,
  postsBeforeWindow,
  type EventOrderDeps,
} from '@/lib/content/event-order-check';
import type { PromotionWindow } from '@/lib/management-app/promotion-window';

const CONFIG = { baseUrl: 'https://management.example.com', apiKey: 'fixture-management-key' };
const ACCOUNT = 'acc-anchor';
const NOW = new Date('2026-10-23T18:00:00Z');

const WINDOW: PromotionWindow = {
  opensOn: '2026-11-19',
  afterEvent: 'Snowball Showdown Cash Bingo',
  afterDate: '2026-11-18',
  category: 'Cash Bingo',
};

function post(id: string, scheduledFor: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    campaign_id: 'campaign-jackpot',
    scheduled_for: scheduledFor,
    event_name: 'Christmas Jackpot Cash Bingo',
    event_date: '2026-12-16',
    category: 'Cash Bingo',
    ...overrides,
  };
}

/** A content_items query that records its filters and returns the given rows. */
function database(rows: unknown[], error: { message: string } | null = null) {
  const filters: Array<[string, string, unknown]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['eq', 'is', 'gt']) {
    builder[method] = vi.fn((column: string, value: unknown) => {
      filters.push([method, column, value]);
      return builder;
    });
  }
  builder.select = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.returns = vi.fn().mockResolvedValue({ data: error ? null : rows, error });
  const db = { from: vi.fn(() => builder) };
  return { db, filters };
}

function deps(overrides: Partial<EventOrderDeps> = {}): EventOrderDeps & {
  listEvents: ReturnType<typeof vi.fn>;
  loadWindow: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
} {
  return {
    listEvents: vi.fn().mockResolvedValue([
      { id: 'event-jackpot', name: 'Christmas Jackpot Cash Bingo', date: '2026-12-16', categoryName: 'Cash Bingo', categorySlug: 'cash-bingo' },
    ]),
    loadWindow: vi.fn().mockResolvedValue(WINDOW),
    notify: vi.fn().mockResolvedValue({ status: 'inserted' }),
    ...overrides,
  } as never;
}

describe('postsBeforeWindow', () => {
  it('keeps only posts whose London date is before the window opens', () => {
    const posts = [
      post('a', '2026-11-18T11:00:00Z'),
      post('b', '2026-11-19T00:30:00Z'),
      post('c', '2026-11-19T07:00:00Z'),
    ];
    expect(postsBeforeWindow(posts, WINDOW).map((row) => row.id)).toEqual(['a']);
  });

  it('goes by the London date in summer time, not the UTC one', () => {
    const october = { ...WINDOW, opensOn: '2026-10-20' };
    // 23:30 UTC on 19 October is 00:30 on 20 October in London (BST): inside the window.
    expect(postsBeforeWindow([post('a', '2026-10-19T23:30:00Z')], october)).toEqual([]);
    // 22:30 UTC is 23:30 on 19 October in London: too early.
    expect(postsBeforeWindow([post('b', '2026-10-19T22:30:00Z')], october).map((row) => row.id)).toEqual(['b']);
  });

  it('flags nothing when the event has no earlier event of its type', () => {
    expect(postsBeforeWindow([post('a', '2026-11-01T11:00:00Z')], null)).toEqual([]);
  });
});

describe('findEvent', () => {
  const events = [
    { id: '1', name: 'Quiz Night', date: '2026-11-04' },
    { id: '2', name: 'Quiz Night', date: '2026-12-02' },
    { id: '3', name: 'Quiz Nights', date: '2026-12-03' },
  ];

  it('takes the exact name nearest the stored date, so a moved event is found', () => {
    expect(findEvent(events, 'quiz night', '2026-12-05')?.id).toBe('2');
  });

  it('finds nothing without an exact name', () => {
    expect(findEvent(events, 'Christmas Quiz', '2026-12-02')).toBeNull();
  });
});

describe('orderNotice', () => {
  it('names the event, the count, the opening day and the posts too early', () => {
    const notice = orderNotice('Christmas Jackpot Cash Bingo', WINDOW, [
      post('a', '2026-11-17T11:00:00Z'),
      post('b', '2026-11-18T07:00:00Z'),
    ]);
    expect(notice.title).toBe(
      'Christmas Jackpot Cash Bingo: 2 scheduled posts go out before Thursday 19th November, when its promotion may start. Move or delete them in the planner.',
    );
    expect(notice.body).toContain('after the last Cash Bingo (Snowball Showdown Cash Bingo)');
    expect(notice.body).toContain('Posts too early: Tuesday 17th November, Wednesday 18th November.');
  });

  it('reads right for one post', () => {
    expect(orderNotice('Christmas Jackpot Cash Bingo', WINDOW, [post('a', '2026-11-17T11:00:00Z')]).title)
      .toContain(': 1 scheduled post goes out before Thursday 19th November, when its promotion may start. Move or delete it in the planner.');
  });
});

describe('checkAccountEventOrder', () => {
  it("reads only the brand's own scheduled event posts still to go out", async () => {
    const { db, filters } = database([]);
    await checkAccountEventOrder({ db: db as never, accountId: ACCOUNT, config: CONFIG, now: NOW }, deps());

    expect(db.from).toHaveBeenCalledWith('content_items');
    expect(filters).toEqual(expect.arrayContaining([
      ['eq', 'account_id', ACCOUNT],
      ['eq', 'content_type', 'event'],
      ['eq', 'status', 'scheduled'],
      ['is', 'deleted_at', null],
      ['gt', 'scheduled_for', NOW.toISOString()],
    ]));
  });

  it('tells the owner once per campaign when its posts go out too early', async () => {
    const { db } = database([
      post('a', '2026-11-17T11:00:00Z'),
      post('b', '2026-11-17T11:00:00Z', { id: 'b' }),
      post('c', '2026-11-25T11:00:00Z'),
    ]);
    const check = deps();
    const summary = await checkAccountEventOrder({ db: db as never, accountId: ACCOUNT, config: CONFIG, now: NOW }, check);

    expect(summary).toEqual({ campaigns: 1, posts: 3, flagged: 2, notified: 1 });
    expect(check.loadWindow).toHaveBeenCalledWith(CONFIG, {
      eventId: 'event-jackpot',
      eventDate: '2026-12-16',
      categorySlug: 'cash-bingo',
      categoryName: 'Cash Bingo',
    });
    expect(check.notify).toHaveBeenCalledOnce();
    expect(check.notify).toHaveBeenCalledWith(expect.objectContaining({
      accountId: ACCOUNT,
      category: EVENT_ORDER_CATEGORY,
      resourceType: 'campaign',
      resourceId: 'campaign-jackpot',
      title: expect.stringContaining('Christmas Jackpot Cash Bingo: 2 scheduled posts go out before'),
    }));
  });

  it('checks a moved event on its current date and category', async () => {
    const { db } = database([post('a', '2026-11-17T11:00:00Z', { category: null })]);
    const check = deps({
      listEvents: vi.fn().mockResolvedValue([
        { id: 'event-jackpot', name: 'Christmas Jackpot Cash Bingo', date: '2026-12-09', categoryName: 'Cash Bingo', categorySlug: 'cash-bingo' },
      ]),
    });
    await checkAccountEventOrder({ db: db as never, accountId: ACCOUNT, config: CONFIG, now: NOW }, check);

    expect(check.listEvents).toHaveBeenCalledWith(CONFIG, { query: 'Christmas Jackpot Cash Bingo', limit: 20 });
    expect(check.loadWindow).toHaveBeenCalledWith(CONFIG, expect.objectContaining({ eventDate: '2026-12-09', categoryName: 'Cash Bingo' }));
  });

  it('falls back to the date and category stored with the posts when the events system has no such event', async () => {
    const { db } = database([post('a', '2026-11-17T11:00:00Z')]);
    const check = deps({ listEvents: vi.fn().mockResolvedValue([]) });
    await checkAccountEventOrder({ db: db as never, accountId: ACCOUNT, config: CONFIG, now: NOW }, check);

    expect(check.loadWindow).toHaveBeenCalledWith(CONFIG, {
      eventId: undefined,
      eventDate: '2026-12-16',
      categorySlug: null,
      categoryName: 'Cash Bingo',
    });
  });

  it('says nothing when every post is inside the window, or the event has no earlier event of its type', async () => {
    const inside = deps();
    await checkAccountEventOrder({ db: database([post('a', '2026-11-25T11:00:00Z')]).db as never, accountId: ACCOUNT, config: CONFIG, now: NOW }, inside);
    expect(inside.notify).not.toHaveBeenCalled();

    const noWindow = deps({ loadWindow: vi.fn().mockResolvedValue(null) });
    await checkAccountEventOrder({ db: database([post('a', '2026-11-01T11:00:00Z')]).db as never, accountId: ACCOUNT, config: CONFIG, now: NOW }, noWindow);
    expect(noWindow.notify).not.toHaveBeenCalled();
  });

  it('counts a notice already given today as not new', async () => {
    const check = deps({ notify: vi.fn().mockResolvedValue({ status: 'duplicate' }) });
    const summary = await checkAccountEventOrder(
      { db: database([post('a', '2026-11-17T11:00:00Z')]).db as never, accountId: ACCOUNT, config: CONFIG, now: NOW },
      check,
    );
    expect(summary).toMatchObject({ flagged: 1, notified: 0 });
  });

  it('fails when the owner cannot be told, the posts cannot be read, or the events system is down', async () => {
    await expect(checkAccountEventOrder(
      { db: database([post('a', '2026-11-17T11:00:00Z')]).db as never, accountId: ACCOUNT, config: CONFIG, now: NOW },
      deps({ notify: vi.fn().mockResolvedValue({ status: 'failed', error: 'insert refused' }) }),
    )).rejects.toThrow('the owner could not be told: insert refused');

    await expect(checkAccountEventOrder(
      { db: database([], { message: 'timeout' }).db as never, accountId: ACCOUNT, config: CONFIG, now: NOW },
      deps(),
    )).rejects.toThrow('scheduled event posts could not be read: timeout');

    await expect(checkAccountEventOrder(
      { db: database([post('a', '2026-11-17T11:00:00Z')]).db as never, accountId: ACCOUNT, config: CONFIG, now: NOW },
      deps({ listEvents: vi.fn().mockRejectedValue(new Error('events system unavailable')) }),
    )).rejects.toThrow('events system unavailable');
  });
});
