import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processPublishJob } from './handler';
import { ProviderError, ErrorClassification } from '@/lib/providers/errors';

// -- Mocks --

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

function createChainableUpdate() {
  const chain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null }),
  };
  return chain;
}

function createChainableSelect() {
  const chain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return chain;
}

const mockPublishPost = vi.fn();
const mockAdapter = {
  platform: 'facebook' as const,
  supports: vi.fn(() => true),
  validate: vi.fn(() => ({ valid: true, errors: [] })),
  publishPost: mockPublishPost,
};

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => {
    // Build a mock that returns different chain results depending on table
    return {
      from: vi.fn((table: string) => {
        if (table === 'publish_jobs') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'job-1',
                    account_id: 'acc-1',
                    content_item_id: 'ci-1',
                    platform: 'facebook',
                    status: 'queued',
                    retry_count: 0,
                    max_retries: 4,
                    scheduled_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              })),
            })),
            update: vi.fn(() => {
              const chain = createChainableUpdate();
              return chain;
            }),
          };
        }
        if (table === 'publish_attempts') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: { id: 'att-1' }, error: null }),
              })),
            })),
            update: vi.fn(() => {
              const chain = createChainableUpdate();
              return chain;
            }),
          };
        }
        if (table === 'content_items') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'ci-1',
                    content_type: 'instant_post',
                    status: 'queued',
                  },
                  error: null,
                }),
              })),
            })),
            update: vi.fn(() => {
              const chain = createChainableUpdate();
              return chain;
            }),
          };
        }
        if (table === 'content_variants') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { body: 'Hello world', media_ids: [] },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          };
        }
        if (table === 'social_connections') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'conn-1' },
                    error: null,
                  }),
                })),
              })),
            })),
          };
        }
        if (table === 'audit_log') {
          return {
            insert: vi.fn(() => ({
              throwOnError: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          };
        }
        return {
          select: vi.fn(() => createChainableSelect()),
          insert: vi.fn(() => ({ throwOnError: vi.fn().mockResolvedValue({ data: null, error: null }) })),
          update: vi.fn(() => createChainableUpdate()),
        };
      }),
    };
  }),
}));

vi.mock('@/lib/logging/correlation', () => ({
  getCorrelationId: vi.fn(() => 'corr-123'),
  withCorrelationId: vi.fn((_fn: () => unknown) => _fn()),
}));

vi.mock('@/lib/logging', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('@/lib/providers/init', () => ({
  initializeProviderRegistry: vi.fn(),
}));

vi.mock('@/lib/providers/registry', () => ({
  getAdapter: vi.fn(() => mockAdapter),
}));

vi.mock('./audit', () => ({
  logPublishAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./state-machine', () => ({
  canTransition: vi.fn(() => true),
  transitionStatus: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockPublishPost.mockResolvedValue({ platformPostId: 'fb-post-123', url: 'https://fb.com/post/123' });
});

describe('handler', () => {
  describe('processPublishJob', () => {
    it('calls getAdapter(platform).publishPost() with correct connectionId', async () => {
      const result = await processPublishJob('job-1');

      expect(mockPublishPost).toHaveBeenCalled();
      // The first argument should be a connection ID
      const callArgs = mockPublishPost.mock.calls[0];
      expect(callArgs[0]).toBe('conn-1');
    });

    it('returns published: true and platformPostId on adapter success', async () => {
      const result = await processPublishJob('job-1');

      expect(result).toEqual(
        expect.objectContaining({
          published: true,
          platformPostId: 'fb-post-123',
        }),
      );
    });

    it('calls logPublishAuditEvent for every attempt', async () => {
      const { logPublishAuditEvent } = await import('./audit');

      await processPublishJob('job-1');

      // Should have been called at least for the attempt + success
      expect(logPublishAuditEvent).toHaveBeenCalled();
      expect((logPublishAuditEvent as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('calls transitionStatus for state changes', async () => {
      const { transitionStatus } = await import('./state-machine');

      await processPublishJob('job-1');

      // Should transition to publishing and then to published
      expect(transitionStatus).toHaveBeenCalled();
    });
  });
});
