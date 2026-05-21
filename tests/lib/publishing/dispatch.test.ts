import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPublishJSON = vi.fn().mockResolvedValue({ messageId: 'msg-123' });

vi.mock('@/lib/qstash/client', () => ({
  getQStashClient: vi.fn(() => ({
    publishJSON: mockPublishJSON,
  })),
}));

vi.mock('@/env', () => ({
  env: {
    client: {
      NEXT_PUBLIC_SITE_URL: 'https://app.cheersai.com',
    },
  },
}));

const { dispatchToQStash } = await import('@/lib/publishing/dispatch');

describe('dispatchToQStash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should dispatch a publish job to QStash with correct URL', async () => {
    await dispatchToQStash({
      jobId: 'job-1',
      deduplicationId: 'dedup-1',
    });

    expect(mockPublishJSON).toHaveBeenCalledOnce();
    const call = mockPublishJSON.mock.calls[0][0];
    expect(call.url).toBe('https://app.cheersai.com/api/webhooks/qstash-publish');
    expect(call.body).toEqual({ jobId: 'job-1' });
  });

  it('should include failureCallback URL', async () => {
    await dispatchToQStash({
      jobId: 'job-1',
      deduplicationId: 'dedup-1',
    });

    const call = mockPublishJSON.mock.calls[0][0];
    expect(call.failureCallback).toBe(
      'https://app.cheersai.com/api/webhooks/qstash-publish/failure',
    );
  });

  it('should set retries to 3', async () => {
    await dispatchToQStash({
      jobId: 'job-1',
      deduplicationId: 'dedup-1',
    });

    const call = mockPublishJSON.mock.calls[0][0];
    expect(call.retries).toBe(3);
  });

  it('should pass deduplicationId', async () => {
    await dispatchToQStash({
      jobId: 'job-1',
      deduplicationId: 'unique-key-abc',
    });

    const call = mockPublishJSON.mock.calls[0][0];
    expect(call.deduplicationId).toBe('unique-key-abc');
  });

  it('should include delay when delaySeconds is positive', async () => {
    await dispatchToQStash({
      jobId: 'job-1',
      deduplicationId: 'dedup-1',
      delaySeconds: 60,
    });

    const call = mockPublishJSON.mock.calls[0][0];
    expect(call.delay).toBe(60);
  });

  it('should not include delay when delaySeconds is zero', async () => {
    await dispatchToQStash({
      jobId: 'job-1',
      deduplicationId: 'dedup-1',
      delaySeconds: 0,
    });

    const call = mockPublishJSON.mock.calls[0][0];
    expect(call.delay).toBeUndefined();
  });

  it('should not include delay when delaySeconds is undefined', async () => {
    await dispatchToQStash({
      jobId: 'job-1',
      deduplicationId: 'dedup-1',
    });

    const call = mockPublishJSON.mock.calls[0][0];
    expect(call.delay).toBeUndefined();
  });

  it('should forward Content-Type header', async () => {
    await dispatchToQStash({
      jobId: 'job-1',
      deduplicationId: 'dedup-1',
    });

    const call = mockPublishJSON.mock.calls[0][0];
    expect(call.headers['Upstash-Forward-Content-Type']).toBe('application/json');
  });
});
