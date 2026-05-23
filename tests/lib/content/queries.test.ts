import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  getContentByAccount,
  getContentById,
  getContentForCalendar,
} from '@/lib/content/queries';

function makeContentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'content-1',
    account_id: 'account-1',
    content_type: 'event',
    status: 'scheduled',
    title: null,
    body_draft: null,
    campaign_name: 'Campaign',
    scheduled_at: '2026-06-11T19:00:00.000Z',
    event_date: null,
    event_end_date: null,
    coupon_code: null,
    recurring_day_of_week: null,
    auto_confirm: false,
    ai_generation_params: null,
    placement: 'feed',
    platform: 'facebook',
    created_at: '2026-05-01T10:00:00.000Z',
    updated_at: '2026-05-01T10:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function createQueryMock(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const chain: Record<string, unknown> = {};

  for (const method of ['from', 'select', 'eq', 'is', 'order', 'range', 'in', 'gte', 'lte']) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    });
  }

  chain.single = vi.fn(() => {
    calls.push({ method: 'single', args: [] });
    return Promise.resolve(result);
  });

  chain.then = vi.fn((resolve, reject) => Promise.resolve(result).then(resolve, reject));

  return {
    client: {
      from: chain.from,
    },
    calls,
  };
}

describe('content queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not return soft-deleted rows when fetching by id', async () => {
    const query = createQueryMock({ data: makeContentRow(), error: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(query.client as never);

    await getContentById('content-1');

    expect(query.calls).toContainEqual({ method: 'is', args: ['deleted_at', null] });
  });

  it('does not return soft-deleted rows when fetching account content', async () => {
    const query = createQueryMock({ data: [makeContentRow()], error: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(query.client as never);

    await getContentByAccount({ status: ['scheduled', 'draft'] });

    expect(query.calls).toContainEqual({ method: 'is', args: ['deleted_at', null] });
    expect(query.calls).toContainEqual({ method: 'in', args: ['status', ['scheduled', 'draft']] });
  });

  it('does not return soft-deleted rows in the planner calendar range', async () => {
    const query = createQueryMock({ data: [makeContentRow()], error: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(query.client as never);

    await getContentForCalendar('2026-06-01T00:00:00.000Z', '2026-06-30T23:59:59.999Z');

    expect(query.calls).toContainEqual({ method: 'is', args: ['deleted_at', null] });
    expect(query.calls).toContainEqual({
      method: 'gte',
      args: ['scheduled_at', '2026-06-01T00:00:00.000Z'],
    });
    expect(query.calls).toContainEqual({
      method: 'lte',
      args: ['scheduled_at', '2026-06-30T23:59:59.999Z'],
    });
  });
});
