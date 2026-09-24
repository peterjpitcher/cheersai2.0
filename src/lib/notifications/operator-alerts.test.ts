import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSendEmail = vi.fn();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (...args: unknown[]) => mockSendEmail(...args) }));

const mockLogAdminEvent = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ logAdminEvent: (...args: unknown[]) => mockLogAdminEvent(...args) }));

const envState = { OPERATOR_ALERT_EMAIL: 'ops@test.example' };
vi.mock('@/env', () => ({ env: { server: envState, client: {} } }));

const { alertRepeatedPublishFailures } = await import('@/lib/notifications/operator-alerts');

type Result = { data: unknown; error: unknown };

function mockService(tables: Record<string, Result>) {
  return {
    from: vi.fn((table: string) => {
      const result = tables[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'gt', 'in', 'limit']) chain[method] = vi.fn(() => chain);
      chain.returns = vi.fn().mockResolvedValue(result);
      chain.maybeSingle = vi.fn().mockResolvedValue(result);
      return chain;
    }),
  };
}

const NOW = new Date('2026-09-24T12:00:00Z');
const jobs = (contentIds: string[]) => ({ data: contentIds.map((id) => ({ content_item_id: id })), error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mockSendEmail.mockResolvedValue(undefined);
  envState.OPERATOR_ALERT_EMAIL = 'ops@test.example';
});

describe('alertRepeatedPublishFailures', () => {
  it('alerts the operator once when a brand reaches 3 failures in 24 hours', async () => {
    const service = mockService({
      publish_jobs: jobs(['c1', 'c2', 'c3', 'c4']),
      content_items: {
        data: [
          { id: 'c1', account_id: 'brand-a' },
          { id: 'c2', account_id: 'brand-a' },
          { id: 'c3', account_id: 'brand-a' },
          { id: 'c4', account_id: 'brand-b' },
        ],
        error: null,
      },
      admin_audit: { data: null, error: null },
      accounts: { data: { business_name: 'The New Venue' }, error: null },
    });

    const result = await alertRepeatedPublishFailures(service as never, NOW);

    expect(result.alerted).toEqual(['brand-a']);
    expect(mockSendEmail).toHaveBeenCalledOnce();
    const email = mockSendEmail.mock.calls[0][0] as { to: string; subject: string; html: string; required: boolean };
    expect(email.to).toBe('ops@test.example');
    expect(email.required).toBe(true);
    expect(email.subject).toBe('[Cheers operator] The New Venue: 3 failed posts in 24 hours');
    for (const bad of ['undefined', 'NaN', 'null']) expect(email.html).not.toContain(bad);
    expect(mockLogAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: null, action: 'operator_publish_failure_alert', targetAccountId: 'brand-a' }),
    );
  });

  it('does not alert again within 24 hours', async () => {
    const service = mockService({
      publish_jobs: jobs(['c1', 'c2', 'c3']),
      content_items: { data: ['c1', 'c2', 'c3'].map((id) => ({ id, account_id: 'brand-a' })), error: null },
      admin_audit: { data: { id: 'previous-alert' }, error: null },
    });

    const result = await alertRepeatedPublishFailures(service as never, NOW);

    expect(result).toEqual({ alerted: [], skipped: ['brand-a'] });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('stays quiet below the threshold', async () => {
    const service = mockService({
      publish_jobs: jobs(['c1', 'c2']),
      content_items: { data: ['c1', 'c2'].map((id) => ({ id, account_id: 'brand-a' })), error: null },
    });
    expect(await alertRepeatedPublishFailures(service as never, NOW)).toEqual({ alerted: [], skipped: [] });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('fails loudly (never silently) when the operator address is missing or the lookup fails', async () => {
    envState.OPERATOR_ALERT_EMAIL = '';
    const service = mockService({
      publish_jobs: jobs(['c1', 'c2', 'c3']),
      content_items: { data: ['c1', 'c2', 'c3'].map((id) => ({ id, account_id: 'brand-a' })), error: null },
      admin_audit: { data: null, error: null },
      accounts: { data: { business_name: 'X' }, error: null },
    });
    await expect(alertRepeatedPublishFailures(service as never, NOW)).rejects.toThrow('OPERATOR_ALERT_EMAIL');

    const broken = mockService({ publish_jobs: { data: null, error: { message: 'db down' } } });
    await expect(alertRepeatedPublishFailures(broken as never, NOW)).rejects.toThrow('db down');
  });
});
