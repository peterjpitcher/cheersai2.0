import { describe, expect, it, vi } from 'vitest';

import {
  createGraphGet,
  insightValue,
  loadPublishedPosts,
  PostResultsError,
  publishedLondonDate,
  readFacebookResults,
  readInstagramResults,
  syncAccountPostResults,
  type GraphGet,
} from '@/lib/analytics/post-results';

const TOKEN = 'fixture-page-token';

/** A Graph fake: answers by path and metric; anything unlisted is refused like a missing permission. */
function graph(answers: Record<string, unknown>, failures: Record<string, { code: number; message: string }> = {}): GraphGet & { calls: string[] } {
  const calls: string[] = [];
  const fake: GraphGet = async (path, params) => {
    const key = params.metric ? `${path}?metric=${params.metric}` : path;
    calls.push(key);
    if (failures[key]) return { ok: false, status: 400, ...failures[key] };
    if (key in answers) return { ok: true, json: answers[key] };
    return { ok: false, status: 403, code: 10, message: 'Requires read_insights permission' };
  };
  return Object.assign(fake, { calls });
}

const lifetime = (name: string, value: unknown) => ({ data: [{ name, period: 'lifetime', values: [{ value }] }] });

describe('insightValue', () => {
  it('reads both shapes Meta returns, and nothing from an empty answer', () => {
    expect(insightValue(lifetime('reach', 42))).toBe(42);
    expect(insightValue({ data: [{ name: 'views', total_value: { value: 77 } }] })).toBe(77);
    expect(insightValue({ data: [] })).toBeNull();
    expect(insightValue(null)).toBeNull();
  });
});

describe('readFacebookResults', () => {
  const POST = '123_456';
  const base = { reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, shares: { count: 2 } };

  it('reads the counts and each metric on its own request', async () => {
    const get = graph({
      [POST]: base,
      [`${POST}/insights?metric=post_media_view`]: lifetime('post_media_view', 900),
      [`${POST}/insights?metric=post_total_media_view_unique`]: lifetime('post_total_media_view_unique', 340),
      [`${POST}/insights?metric=post_clicks_by_type`]: lifetime('post_clicks_by_type', { 'link clicks': 17, 'other clicks': 9 }),
    });
    const results = await readFacebookResults(get, POST, TOKEN);

    expect(get.calls).toEqual([
      POST,
      `${POST}/insights?metric=post_media_view`,
      `${POST}/insights?metric=post_total_media_view_unique`,
      `${POST}/insights?metric=post_clicks_by_type`,
    ]);
    expect(results).toMatchObject({
      impressions: 900,
      reach: 340,
      clicks: 17,
      comments: 3,
      shares: 2,
      engagementCount: 17,
      engagementRate: Number((17 / 340).toFixed(4)),
      refused: {},
    });
  });

  it('keeps the counts when the insights are refused, and says what was refused', async () => {
    const results = await readFacebookResults(graph({ [POST]: { reactions: { summary: { total_count: 5 } }, comments: { summary: { total_count: 1 } } } }), POST, TOKEN);

    expect(results).toMatchObject({ impressions: null, reach: null, clicks: null, comments: 1, shares: 0, engagementCount: 6, engagementRate: null });
    expect(Object.keys(results.refused)).toEqual(['post_media_view', 'post_total_media_view_unique', 'post_clicks_by_type']);
    expect(results.refused.post_media_view).toContain('code 10');
  });

  it('gives up on a post Meta no longer knows, and flags a bad token', async () => {
    await expect(readFacebookResults(graph({}, { [POST]: { code: 100, message: 'Object does not exist' } }), POST, TOKEN))
      .rejects.toMatchObject({ tokenProblem: false });
    const expired = readFacebookResults(graph({}, { [POST]: { code: 190, message: 'Session has expired' } }), POST, TOKEN);
    await expect(expired).rejects.toBeInstanceOf(PostResultsError);
    await expect(expired).rejects.toMatchObject({ tokenProblem: true });
  });
});

describe('readInstagramResults', () => {
  const MEDIA = '17890000000000001';

  it('reads likes and comments, then views, reach, shares, saves and total interactions', async () => {
    const results = await readInstagramResults(graph({
      [MEDIA]: { like_count: 40, comments_count: 4 },
      [`${MEDIA}/insights?metric=views`]: lifetime('views', 1200),
      [`${MEDIA}/insights?metric=reach`]: lifetime('reach', 800),
      [`${MEDIA}/insights?metric=shares`]: lifetime('shares', 5),
      [`${MEDIA}/insights?metric=saved`]: lifetime('saved', 7),
      [`${MEDIA}/insights?metric=total_interactions`]: lifetime('total_interactions', 56),
    }), MEDIA, TOKEN);

    expect(results).toMatchObject({ impressions: 1200, reach: 800, clicks: null, comments: 4, shares: 5, engagementCount: 56, engagementRate: 0.07 });
  });

  it('adds up what it has when total interactions are refused', async () => {
    const results = await readInstagramResults(graph({
      [MEDIA]: { like_count: 40, comments_count: 4 },
      [`${MEDIA}/insights?metric=reach`]: lifetime('reach', 800),
    }), MEDIA, TOKEN);

    expect(results.engagementCount).toBe(44);
    expect(results.impressions).toBeNull();
    expect(Object.keys(results.refused)).toEqual(['views', 'shares', 'saved', 'total_interactions']);
  });
});

describe('publishedLondonDate', () => {
  it('is the London date the post went out', () => {
    expect(publishedLondonDate('2026-10-24T23:30:00.000Z')).toBe('2026-10-25');
    expect(publishedLondonDate('2026-11-24T23:30:00.000Z')).toBe('2026-11-24');
  });
});

type Row = Record<string, unknown>;

function jobsDb(jobs: Row[], { upsertError = null as { message: string } | null } = {}) {
  const filters: Array<[string, string, unknown]> = [];
  const upserts: Array<{ row: Row; options: unknown }> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['eq', 'gte', 'in']) {
    builder[method] = vi.fn((column: string, value: unknown) => {
      filters.push([method, column, value]);
      return builder;
    });
  }
  builder.select = vi.fn(() => builder);
  builder.returns = vi.fn().mockResolvedValue({ data: jobs, error: null });
  builder.upsert = vi.fn(async (row: Row, options: unknown) => {
    upserts.push({ row, options });
    return { error: upsertError };
  });
  return { db: { from: vi.fn(() => builder) } as never, filters, upserts };
}

const NOW = new Date('2026-10-30T05:15:00Z');
const job = (id: string, platform: string, placement: string, externalId: string | null, publishedAt = '2026-10-24T10:00:01.000Z'): Row => ({
  id,
  placement,
  updated_at: '2026-10-24T10:00:05.000Z',
  provider_response: externalId ? { externalId, publishedAt, platform } : {},
  content_items: { platform, placement },
});

describe('loadPublishedPosts', () => {
  it("lists the brand's published feed posts from the last 28 days, with Meta's id", async () => {
    const { db, filters } = jobsDb([
      job('j1', 'facebook', 'feed', '123_456'),
      job('j2', 'instagram', 'feed', '178900'),
      job('j3', 'instagram', 'story', '178901'),
      job('j4', 'facebook', 'feed', null),
    ]);
    const posts = await loadPublishedPosts(db, 'acc-1', NOW);

    expect(posts).toEqual([
      { jobId: 'j1', platform: 'facebook', externalId: '123_456', publishedAt: '2026-10-24T10:00:01.000Z' },
      { jobId: 'j2', platform: 'instagram', externalId: '178900', publishedAt: '2026-10-24T10:00:01.000Z' },
    ]);
    expect(filters).toEqual(expect.arrayContaining([
      ['eq', 'account_id', 'acc-1'],
      ['eq', 'status', 'succeeded'],
      ['gte', 'updated_at', '2026-10-02T05:15:00.000Z'],
    ]));
  });
});

describe('syncAccountPostResults', () => {
  const answers = {
    '123_456': { reactions: { summary: { total_count: 1 } }, comments: { summary: { total_count: 0 } } },
    '178900': { like_count: 2, comments_count: 1 },
  };

  it('stores one row per post, keyed so a daily run updates it, on the London publish date', async () => {
    const { db, upserts } = jobsDb([job('j1', 'facebook', 'feed', '123_456'), job('j2', 'instagram', 'feed', '178900', '2026-10-24T23:30:00.000Z')]);
    const summary = await syncAccountPostResults(
      { db, accountId: 'acc-1', now: NOW },
      { get: graph(answers), tokenFor: async () => TOKEN },
    );

    expect(summary).toMatchObject({ posts: 2, written: 2, skipped: 0 });
    expect(summary.refused).toMatchObject({ post_media_view: 1, views: 1 });
    expect(upserts.map((upsert) => upsert.options)).toEqual([
      { onConflict: 'publish_job_id,platform,snapshot_date' },
      { onConflict: 'publish_job_id,platform,snapshot_date' },
    ]);
    expect(upserts[0].row).toMatchObject({ account_id: 'acc-1', publish_job_id: 'j1', platform: 'facebook', snapshot_date: '2026-10-24', engagement_count: 1 });
    expect(upserts[1].row).toMatchObject({ publish_job_id: 'j2', platform: 'instagram', snapshot_date: '2026-10-25', engagement_count: 3 });
    expect(upserts[0].row.raw_data).toMatchObject({ externalId: '123_456', readAt: NOW.toISOString(), refused: expect.objectContaining({ post_media_view: expect.any(String) }) });
    expect(JSON.stringify(upserts)).not.toContain(TOKEN);
  });

  it('skips a platform with no usable connection, and stops using a token Meta rejects', async () => {
    const { db, upserts } = jobsDb([job('j1', 'facebook', 'feed', '111'), job('j2', 'facebook', 'feed', '222'), job('j3', 'instagram', 'feed', '178900')]);
    const log = vi.fn();
    const get = graph({ '178900': answers['178900'] }, { '111': { code: 190, message: 'Session has expired' } });
    const summary = await syncAccountPostResults(
      { db, accountId: 'acc-1', now: NOW },
      { get, tokenFor: async (platform) => (platform === 'facebook' ? TOKEN : null), log },
    );

    expect(summary).toMatchObject({ posts: 3, written: 0, skipped: 3 });
    expect(get.calls).toEqual(['111']);
    expect(upserts).toEqual([]);
    expect(log).toHaveBeenCalledWith('post results unavailable', expect.objectContaining({ jobId: 'j1', reason: expect.stringContaining('code 190') }));
  });

  it('fails the brand when a result cannot be stored', async () => {
    const { db } = jobsDb([job('j1', 'facebook', 'feed', '123_456')], { upsertError: { message: 'insert refused' } });
    await expect(syncAccountPostResults({ db, accountId: 'acc-1', now: NOW }, { get: graph(answers), tokenFor: async () => TOKEN }))
      .rejects.toThrow('results could not be stored: insert refused');
  });
});

describe('createGraphGet', () => {
  it('sends the token in a header, never the URL, and returns Meta error details', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 10, message: 'Requires read_insights permission' } }), { status: 403 }));
    const get = createGraphGet('https://graph.facebook.com/v24.0/', fetchMock as never);

    await expect(get('123_456', { fields: 'shares' }, TOKEN)).resolves.toEqual({ ok: true, json: { id: '1' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://graph.facebook.com/v24.0/123_456?fields=shares');
    expect(String(url)).not.toContain(TOKEN);
    expect(init).toEqual({ headers: { Authorization: `Bearer ${TOKEN}` } });

    await expect(get('123_456/insights', { metric: 'post_media_view' }, TOKEN))
      .resolves.toEqual({ ok: false, status: 403, code: 10, message: 'Requires read_insights permission' });
  });
});
