import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchToQStash } from './dispatch';

const mockPublishJSON = vi.fn();

vi.mock('@/lib/qstash/client', () => ({
  getQStashClient: vi.fn(() => ({
    publishJSON: mockPublishJSON,
  })),
}));

vi.mock('@/env', () => ({
  env: {
    client: { NEXT_PUBLIC_SITE_URL: 'https://app.cheersai.com' },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockPublishJSON.mockResolvedValue({ messageId: 'msg-123' });
});

describe('dispatch', () => {
  describe('dispatchToQStash', () => {
    it('calls client.publishJSON with url containing /api/webhooks/qstash-publish', async () => {
      await dispatchToQStash({ jobId: 'job-1', deduplicationId: 'dedup-1' });

      expect(mockPublishJSON).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://app.cheersai.com/api/webhooks/qstash-publish',
        }),
      );
    });

    it('sets retries: 3 in publishJSON options', async () => {
      await dispatchToQStash({ jobId: 'job-1', deduplicationId: 'dedup-1' });

      expect(mockPublishJSON).toHaveBeenCalledWith(
        expect.objectContaining({
          retries: 3,
        }),
      );
    });

    it('passes deduplicationId from options', async () => {
      await dispatchToQStash({ jobId: 'job-1', deduplicationId: 'my-dedup-key' });

      expect(mockPublishJSON).toHaveBeenCalledWith(
        expect.objectContaining({
          deduplicationId: 'my-dedup-key',
        }),
      );
    });

    it('sets delay when delaySeconds is provided', async () => {
      await dispatchToQStash({ jobId: 'job-1', deduplicationId: 'dedup-1', delaySeconds: 300 });

      expect(mockPublishJSON).toHaveBeenCalledWith(
        expect.objectContaining({
          delay: 300,
        }),
      );
    });

    it('does not set delay when delaySeconds is not provided', async () => {
      await dispatchToQStash({ jobId: 'job-1', deduplicationId: 'dedup-1' });

      const callArg = mockPublishJSON.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('delay');
    });

    it('body contains jobId', async () => {
      await dispatchToQStash({ jobId: 'job-42', deduplicationId: 'dedup-1' });

      expect(mockPublishJSON).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { jobId: 'job-42' },
        }),
      );
    });
  });
});
