import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logPublishAuditEvent } from './audit';

// Mock dependencies
const mockInsert = vi.fn();
const mockThrowOnError = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: mockInsert,
    })),
  })),
}));

vi.mock('@/lib/logging/correlation', () => ({
  getCorrelationId: vi.fn(() => 'test-correlation-id'),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReturnValue({ throwOnError: mockThrowOnError });
  mockThrowOnError.mockResolvedValue({ data: null, error: null });
});

describe('audit', () => {
  describe('logPublishAuditEvent', () => {
    it('inserts into audit_log with correct column mapping', async () => {
      await logPublishAuditEvent({
        accountId: 'acc-123',
        operationType: 'publish_attempt',
        resourceType: 'publish_job',
        resourceId: 'job-456',
        details: { attemptNumber: 1 },
      });

      expect(mockInsert).toHaveBeenCalledWith({
        account_id: 'acc-123',
        operation_type: 'publish_attempt',
        resource_type: 'publish_job',
        resource_id: 'job-456',
        operation_status: 'success',
        details: { attemptNumber: 1 },
        correlation_id: 'test-correlation-id',
      });
    });

    it('operation_status is failure when operationType contains failure', async () => {
      await logPublishAuditEvent({
        accountId: 'acc-123',
        operationType: 'publish_failure',
        resourceType: 'publish_job',
        resourceId: 'job-456',
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_status: 'failure',
        }),
      );
    });

    it('operation_status is success for all other operation types', async () => {
      for (const opType of ['publish_attempt', 'publish_success', 'publish_retry', 'state_transition'] as const) {
        vi.clearAllMocks();
        mockInsert.mockReturnValue({ throwOnError: mockThrowOnError });
        mockThrowOnError.mockResolvedValue({ data: null, error: null });

        await logPublishAuditEvent({
          accountId: 'acc-123',
          operationType: opType,
          resourceType: 'publish_job',
          resourceId: 'job-456',
        });

        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            operation_status: 'success',
          }),
        );
      }
    });

    it('correlation_id is included from getCorrelationId()', async () => {
      await logPublishAuditEvent({
        accountId: 'acc-123',
        operationType: 'publish_success',
        resourceType: 'publish_job',
        resourceId: 'job-456',
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          correlation_id: 'test-correlation-id',
        }),
      );
    });

    it('details defaults to null when not provided', async () => {
      await logPublishAuditEvent({
        accountId: 'acc-123',
        operationType: 'publish_success',
        resourceType: 'publish_job',
        resourceId: 'job-456',
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          details: null,
        }),
      );
    });
  });
});
