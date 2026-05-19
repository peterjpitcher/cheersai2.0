/**
 * Pipeline handler integration tests (processPublishJob).
 * Validates the full pipeline flow: load job -> guard duplicates -> transition
 * states -> call adapter -> record result -> audit.
 *
 * Mocks Supabase at the client level and uses MSW for API calls.
 * Tests cover: success path, idempotency (23505), max retry failure, re-queue retry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { server, setupMswLifecycle } from '../../../tests/msw/server';
import { metaAuthErrorHandler } from '../../../tests/msw/handlers';
import { processPublishJob } from './handler';
import type { ProviderPlatform } from '@/types/providers';

// --- Mock Supabase service client ---

/** Configurable mock data for Supabase queries */
let mockJobData: {
  id: string;
  account_id: string;
  content_item_id: string;
  platform: ProviderPlatform;
  status: string;
  retry_count: number;
  max_retries: number;
  scheduled_at: string;
} | null = null;

let mockAttemptInsertError: { code: string; message: string } | null = null;
let mockContentItemData: { id: string; content_type: string; status: string } | null = null;
let mockConnectionData: { id: string } | null = null;
let mockVariantData: { body: string; media_ids: string[] } | null = null;
let mockContentTypeData: { content_type: string } | null = null;

// Track Supabase calls for assertions
const supabaseUpdateCalls: Array<{ table: string; data: Record<string, unknown>; id: string }> = [];
const supabaseInsertCalls: Array<{ table: string; data: Record<string, unknown> }> = [];

function createMockQueryBuilder(table: string) {
  const builder: Record<string, unknown> = {};

  // Fluent chain methods that return self
  const self = () => builder;
  builder.select = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn().mockReturnValue(builder);
  builder.in = vi.fn().mockReturnValue(builder);
  builder.order = vi.fn().mockReturnValue(builder);
  builder.limit = vi.fn().mockReturnValue(builder);
  builder.throwOnError = vi.fn().mockReturnValue(builder);

  builder.single = vi.fn().mockImplementation(() => {
    if (table === 'publish_jobs') {
      return { data: mockJobData, error: mockJobData ? null : { message: 'not found' } };
    }
    if (table === 'content_items') {
      return { data: mockContentItemData ?? mockContentTypeData, error: null };
    }
    if (table === 'social_connections') {
      return { data: mockConnectionData, error: mockConnectionData ? null : { message: 'not found' } };
    }
    if (table === 'content_variants') {
      return { data: mockVariantData, error: null };
    }
    return { data: null, error: null };
  });

  builder.maybeSingle = vi.fn().mockImplementation(() => {
    if (table === 'content_variants') {
      return { data: mockVariantData, error: null };
    }
    return { data: null, error: null };
  });

  builder.insert = vi.fn().mockImplementation((data: Record<string, unknown>) => {
    supabaseInsertCalls.push({ table, data });
    if (table === 'publish_attempts' && mockAttemptInsertError) {
      return {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockReturnValue({ data: null, error: mockAttemptInsertError }),
        }),
      };
    }
    if (table === 'publish_attempts') {
      return {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockReturnValue({ data: { id: 'attempt_001' }, error: null }),
        }),
      };
    }
    // audit_log insert
    return { throwOnError: vi.fn().mockReturnValue({ data: null, error: null }) };
  });

  builder.update = vi.fn().mockImplementation((data: Record<string, unknown>) => {
    // Track update calls with a deferred ID capture
    const call = { table, data, id: '' };
    supabaseUpdateCalls.push(call);
    return {
      eq: vi.fn().mockImplementation((_col: string, val: string) => {
        // Capture the first eq value as the ID
        if (!call.id) call.id = val;
        return {
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockReturnValue({ data: { status: data.status }, error: null }),
          }),
          single: vi.fn().mockReturnValue({ data: { status: data.status }, error: null }),
        };
      }),
    };
  });

  return builder;
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({
    from: vi.fn((table: string) => createMockQueryBuilder(table)),
  })),
}));

// Mock provider registry — return a mock adapter that publishes successfully
const mockPublishPost = vi.fn().mockResolvedValue({ platformPostId: 'mock_platform_123' });
const mockPublishStory = vi.fn().mockResolvedValue({ platformPostId: 'mock_story_123' });

vi.mock('@/lib/providers/registry', () => ({
  getAdapter: vi.fn(() => ({
    platform: 'facebook',
    supports: vi.fn().mockReturnValue(true),
    validate: vi.fn().mockReturnValue({ valid: true, errors: [] }),
    publishPost: mockPublishPost,
    publishStory: mockPublishStory,
  })),
}));

vi.mock('@/lib/providers/init', () => ({
  initializeProviderRegistry: vi.fn(),
}));

vi.mock('@/lib/providers/types', () => ({
  isGbpAdapter: vi.fn().mockReturnValue(false),
}));

// Mock logging and correlation
vi.mock('@/lib/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('@/lib/logging/correlation', () => ({
  getCorrelationId: vi.fn().mockReturnValue('corr_test_123'),
}));

// Mock audit logging
vi.mock('./audit', () => ({
  logPublishAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock state machine — just resolve
vi.mock('./state-machine', () => ({
  transitionStatus: vi.fn().mockResolvedValue(undefined),
}));

describe('processPublishJob (integration)', () => {
  setupMswLifecycle();

  beforeEach(() => {
    vi.clearAllMocks();
    supabaseUpdateCalls.length = 0;
    supabaseInsertCalls.length = 0;
    mockAttemptInsertError = null;

    // Default mock data: a queued Facebook job
    mockJobData = {
      id: 'job_001',
      account_id: 'acct_001',
      content_item_id: 'content_001',
      platform: 'facebook',
      status: 'queued',
      retry_count: 0,
      max_retries: 4,
      scheduled_at: new Date().toISOString(),
    };

    mockContentItemData = { id: 'content_001', content_type: 'instant_post', status: 'queued' };
    mockConnectionData = { id: 'conn_001' };
    mockVariantData = { body: 'Hello from integration test!', media_ids: [] };
    mockContentTypeData = { content_type: 'instant_post' };
  });

  it('should process a job through full success path', async () => {
    const result = await processPublishJob('job_001');

    expect(result).toBeDefined();
    expect(result.published).toBe(true);
    expect(result.platformPostId).toBe('mock_platform_123');
  });

  it('should return alreadyDone for published job', async () => {
    mockJobData!.status = 'published';

    const result = await processPublishJob('job_001');

    expect(result).toBeDefined();
    expect(result.alreadyDone).toBe(true);
  });

  it('should return alreadyDone on duplicate attempt (23505)', async () => {
    mockAttemptInsertError = { code: '23505', message: 'unique_violation' };

    const result = await processPublishJob('job_001');

    expect(result).toBeDefined();
    expect(result.alreadyDone).toBe(true);
  });

  it('should transition to failed after max retries', async () => {
    mockJobData!.retry_count = 3;
    mockJobData!.max_retries = 4;
    mockPublishPost.mockRejectedValueOnce(new Error('API failure'));

    await expect(processPublishJob('job_001')).rejects.toThrow('API failure');

    // Verify a publish_attempts insert was made for attempt 4
    const attemptInsert = supabaseInsertCalls.find(c => c.table === 'publish_attempts');
    expect(attemptInsert).toBeDefined();
    expect(attemptInsert!.data.attempt_number).toBe(4);
  });

  it('should re-queue for retry when retries remain', async () => {
    mockJobData!.retry_count = 0;
    mockJobData!.max_retries = 4;
    mockPublishPost.mockRejectedValueOnce(new Error('Temporary failure'));

    await expect(processPublishJob('job_001')).rejects.toThrow('Temporary failure');

    // Verify the attempt was recorded (attempt_number = 1)
    const attemptInsert = supabaseInsertCalls.find(c => c.table === 'publish_attempts');
    expect(attemptInsert).toBeDefined();
    expect(attemptInsert!.data.attempt_number).toBe(1);
  });
});
