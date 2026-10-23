import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  applyBookingLinePlan,
  changeForPost,
  parseBookingLinePlan,
  planBookingLineBackfill,
  renderBookingLineReport,
} from '@/lib/content/booking-line-backfill';
import { parseArgs } from '../../../scripts/ops/booking-line-backfill';

type Row = Record<string, unknown>;

/** A small in-memory stand-in for the query shapes the backfill uses (as in the rewrite tool's tests). */
function fakeDb(tables: Record<string, Row[]>): { db: SupabaseClient; updates: Array<{ table: string; values: Row; filters: string[] }> } {
  const updates: Array<{ table: string; values: Row; filters: string[] }> = [];
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    const described: string[] = [];
    let pending: Row | null = null;
    const rows = (): Row[] => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    const run = (): { data: Row[]; error: null } => {
      if (!pending) return { data: rows(), error: null };
      const hit = rows();
      for (const row of hit) Object.assign(row, pending);
      updates.push({ table, values: pending, filters: described });
      return { data: hit.map((row) => ({ id: row.id })), error: null };
    };
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => {
        described.push(`eq ${column}`);
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
const NOW = new Date('2026-10-23T19:00:00Z');
const OLD_LINE = 'Book a place for each person through the link in our bio.';
const NEW_LINE = 'Book a place for each person at Snowball Showdown Cash Bingo through the link in our bio.';
const caption = (line: string): string => `Game 10 grows with every bingo book sold.\n\n${line}\n\n#CashBingo #StanwellMoor`;
const preview = (line: string): Row => ({
  brief: { eventName: 'Snowball Showdown Cash Bingo', contentType: 'event', ctaLinks: { instagram: 'https://l.the-anchor.pub/ig1' } },
  structuredCopy: { body: 'Game 10 grows with every bingo book sold.', hashtags: ['#CashBingo', '#StanwellMoor'], linkInBioLine: line },
  platform: 'instagram',
});

function post(id: string, overrides: Row = {}, variant: Row = {}): Row {
  return {
    id,
    account_id: ACCOUNT,
    platform: 'instagram',
    placement: 'feed',
    content_type: 'event',
    status: 'scheduled',
    deleted_at: null,
    scheduled_for: '2026-10-26T11:00:00.000Z',
    prompt_context: {},
    content_variants: [{ id: `v-${id}`, body: caption(OLD_LINE), preview_data: preview(OLD_LINE), ...variant }],
    ...overrides,
  };
}

function tablesFor(posts: Row[], jobs: Row[] = []): Record<string, Row[]> {
  return {
    content_items: posts,
    content_variants: posts.flatMap((item) => (item.content_variants as Row[]).map((variant) => ({ ...variant, content_item_id: item.id }))),
    publish_jobs: jobs.length ? jobs : posts.map((item) => ({ content_item_id: item.id, account_id: ACCOUNT, status: 'queued' })),
  };
}

describe('changeForPost', () => {
  it('changes only the booking line, in the caption and the stored copy', () => {
    const change = changeForPost(caption(OLD_LINE), preview(OLD_LINE), 'Snowball Showdown Cash Bingo');
    expect(change).toEqual({
      oldLine: OLD_LINE,
      newLine: NEW_LINE,
      newBody: caption(NEW_LINE),
      newPreviewData: preview(NEW_LINE),
    });
  });

  it.each([
    ['no booking line', 'Game 10 grows with every bingo book sold.', 'no booking line'],
    ['two booking lines', `${caption(OLD_LINE)}\nLink in bio to book.`, 'more than one booking line'],
  ])('leaves a post with %s alone', (_label, body, reason) => {
    expect(changeForPost(body, preview(OLD_LINE), 'Snowball Showdown Cash Bingo')).toEqual({ reason });
  });

  it('leaves alone a line that already names the event, a post with no event name, or a hand-edited caption', () => {
    const named = 'Book Snowball Showdown through the link in our bio.';
    expect(changeForPost(caption(named), preview(named), 'Snowball Showdown Cash Bingo')).toEqual({ reason: 'the line already names the event' });
    expect(changeForPost(caption(OLD_LINE), preview(OLD_LINE), null)).toEqual({ reason: 'no event name stored with the post' });
    const edited = { ...preview(OLD_LINE), structuredCopy: { ...(preview(OLD_LINE).structuredCopy as Row), publishBodyOverride: caption(OLD_LINE) } };
    expect(changeForPost(caption(OLD_LINE), edited, 'Snowball Showdown Cash Bingo')).toEqual({ reason: 'the caption was edited by hand' });
    expect(changeForPost(caption(OLD_LINE), preview('Link in bio to book.'), 'Snowball Showdown Cash Bingo'))
      .toEqual({ reason: 'the stored booking line does not match the caption' });
  });

  it('leaves alone a caption edited in the planner, which changes the caption but not the stored copy', () => {
    const edited = caption(OLD_LINE).replace('Game 10 grows', 'The Game 10 jackpot grows');
    expect(changeForPost(edited, preview(OLD_LINE), 'Snowball Showdown Cash Bingo')).toEqual({ reason: 'the caption was edited by hand' });
    expect(changeForPost(caption(OLD_LINE), { brief: {} }, 'Snowball Showdown Cash Bingo')).toEqual({ reason: 'no stored copy to check the caption against' });
  });
});

describe('planBookingLineBackfill', () => {
  it("plans the brand's own scheduled Instagram feed event posts and changes nothing", async () => {
    const tables = tablesFor([
      post('a'),
      post('other-brand', { account_id: 'someone-else' }),
      post('facebook', { platform: 'facebook' }),
      post('story', { placement: 'story' }),
      post('published', { status: 'posted' }),
      post('deleted', { deleted_at: '2026-10-20T10:00:00Z' }),
      post('weekly', { content_type: 'weekly_recurring' }),
    ]);
    const { db, updates } = fakeDb(tables);
    const plan = await planBookingLineBackfill(db, { accountId: ACCOUNT, now: NOW });

    expect(plan.posts.map((planned) => planned.contentItemId)).toEqual(['a']);
    expect(plan.posts[0]).toMatchObject({ eventName: 'Snowball Showdown Cash Bingo', oldLine: OLD_LINE, newLine: NEW_LINE, variantId: 'v-a' });
    expect(updates).toEqual([]);
  });

  it('leaves alone posts due within the hour and posts already being sent', async () => {
    const tables = tablesFor(
      [post('soon', { scheduled_for: '2026-10-23T19:30:00.000Z' }), post('sending')],
      [
        { content_item_id: 'soon', account_id: ACCOUNT, status: 'queued' },
        { content_item_id: 'sending', account_id: ACCOUNT, status: 'in_progress' },
      ],
    );
    const plan = await planBookingLineBackfill(fakeDb(tables).db, { accountId: ACCOUNT, now: NOW });

    expect(plan.posts).toEqual([]);
    expect(plan.skipped.map((skipped) => [skipped.contentItemId, skipped.reason])).toEqual([
      ['soon', 'due within 60 minutes'],
      ['sending', 'publishing has started (in_progress)'],
    ]);
  });

  it("reads the event name from the post's context when the stored copy has no brief", async () => {
    const { brief, ...withoutBrief } = preview(OLD_LINE);
    const tables = tablesFor([
      post('a', { prompt_context: { brief } }, { preview_data: withoutBrief }),
    ]);
    const plan = await planBookingLineBackfill(fakeDb(tables).db, { accountId: ACCOUNT, now: NOW });
    expect(plan.posts[0]?.newLine).toBe(NEW_LINE);
  });
});

describe('applyBookingLinePlan', () => {
  async function planned(posts: Row[]) {
    const tables = tablesFor(posts);
    const { db, updates } = fakeDb(tables);
    const plan = parseBookingLinePlan(JSON.parse(JSON.stringify(await planBookingLineBackfill(db, { accountId: ACCOUNT, now: NOW }))));
    return { tables, db, updates, plan };
  }

  it('writes exactly the planned line, guarded by the old caption, and rolls it back', async () => {
    const { tables, db, updates, plan } = await planned([post('a')]);
    const applied = await applyBookingLinePlan(db, plan, { mode: 'apply', now: () => NOW });

    expect(applied).toEqual({ written: ['a'], skipped: [], failed: [] });
    expect(tables.content_variants[0]).toMatchObject({ body: caption(NEW_LINE), preview_data: preview(NEW_LINE) });
    expect(updates[0]).toMatchObject({ table: 'content_variants', filters: ['eq id', 'eq content_item_id', 'eq body'] });

    const again = await applyBookingLinePlan(db, plan, { mode: 'apply', now: () => NOW });
    expect(again.skipped).toEqual([{ contentItemId: 'a', reason: 'already done' }]);

    const rolledBack = await applyBookingLinePlan(db, plan, { mode: 'rollback', now: () => NOW });
    expect(rolledBack.written).toEqual(['a']);
    expect(tables.content_variants[0]).toMatchObject({ body: caption(OLD_LINE), preview_data: preview(OLD_LINE) });
  });

  it('leaves a post alone when it was edited, moved, published or is due within the hour', async () => {
    const { tables, db, plan } = await planned([post('edited'), post('moved'), post('published'), post('soon')]);
    (tables.content_variants.find((variant) => variant.content_item_id === 'edited') as Row).body = 'Owner rewrote this.';
    (tables.content_items.find((item) => item.id === 'moved') as Row).scheduled_for = '2026-10-27T11:00:00.000Z';
    (tables.content_items.find((item) => item.id === 'published') as Row).status = 'posted';
    const outcome = await applyBookingLinePlan(db, plan, { mode: 'apply', now: () => new Date('2026-10-26T10:30:00Z') });

    expect(outcome.written).toEqual([]);
    expect(outcome.skipped).toEqual([
      { contentItemId: 'edited', reason: 'due within 60 minutes' },
      { contentItemId: 'moved', reason: 'the post has been moved since the plan was made' },
      { contentItemId: 'published', reason: 'status is now posted' },
      { contentItemId: 'soon', reason: 'due within 60 minutes' },
    ]);

    const later = await applyBookingLinePlan(db, plan, { mode: 'apply', now: () => NOW });
    expect(later.skipped.find((skipped) => skipped.contentItemId === 'edited')?.reason).toBe('the caption has been changed since the plan was made');
  });
});

describe('parseBookingLinePlan and the report', () => {
  it('refuses a file that is not a booking-line plan', () => {
    expect(() => parseBookingLinePlan({ kind: 'event-post-rewrite' })).toThrow('Not a booking-line plan');
  });

  it('lists each post with its London time, event and both lines', async () => {
    const plan = await planBookingLineBackfill(fakeDb(tablesFor([post('a')])).db, { accountId: ACCOUNT, now: NOW });
    const report = renderBookingLineReport(plan);
    expect(report).toContain('1 posts change, 0 left alone');
    expect(report).toContain(`| 1 | Mon 26 Oct 11:00 | Snowball Showdown Cash Bingo | ${OLD_LINE} | ${NEW_LINE} |`);
  });
});

describe('parseArgs', () => {
  it('needs an account to plan and a plan file to apply or roll back', () => {
    expect(parseArgs(['--account', ACCOUNT])).toMatchObject({ mode: 'plan', accountId: ACCOUNT });
    expect(parseArgs(['--apply', '--plan', 'plan.json'])).toMatchObject({ mode: 'apply', planFile: 'plan.json' });
    expect(() => parseArgs([])).toThrow('A plan run needs --account');
    expect(() => parseArgs(['--rollback'])).toThrow('--rollback needs --plan');
    expect(() => parseArgs(['--apply', '--rollback', '--plan', 'p'])).toThrow('Choose --apply or --rollback');
  });
});
