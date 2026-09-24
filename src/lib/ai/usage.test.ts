import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInsert = vi.fn();
const mockServiceClient = vi.fn(() => ({ from: vi.fn(() => ({ insert: mockInsert })) }));
vi.mock('@/lib/supabase/service', () => ({ tryCreateServiceSupabaseClient: () => mockServiceClient() }));

const mockWarn = vi.fn();
vi.mock('@/lib/logging', () => ({ createLogger: () => ({ warn: mockWarn, error: vi.fn(), info: vi.fn() }) }));

const { trackAiCall } = await import('@/lib/ai/usage');

const CONTEXT = { accountId: 'brand-1', feature: 'post_copy' as const };

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockResolvedValue({ error: null });
});

describe('trackAiCall', () => {
  it('records a successful call with the model and token counts', async () => {
    const result = await trackAiCall(CONTEXT, 'gpt-4o-mini', async () => ({
      model: 'gpt-4o-mini-2024-07-18',
      usage: { prompt_tokens: 120, completion_tokens: 45 },
      value: 'copy',
    }));

    expect(result.value).toBe('copy');
    expect(mockInsert).toHaveBeenCalledWith({
      account_id: 'brand-1',
      feature: 'post_copy',
      model: 'gpt-4o-mini-2024-07-18',
      prompt_tokens: 120,
      completion_tokens: 45,
      succeeded: true,
    });
  });

  it('records a failed call and still throws the original error', async () => {
    await expect(
      trackAiCall(CONTEXT, 'gpt-4o', async () => {
        throw new Error('OpenAI timeout');
      }),
    ).rejects.toThrow('OpenAI timeout');

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o', prompt_tokens: null, completion_tokens: null, succeeded: false }),
    );
  });

  it('never fails the AI call when the usage write fails', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'db down' } });
    const result = await trackAiCall(CONTEXT, 'gpt-4o-mini', async () => ({ usage: null, value: 1 }));
    expect(result.value).toBe(1);
    expect(mockWarn).toHaveBeenCalled();

    mockServiceClient.mockImplementationOnce(() => {
      throw new Error('no service role');
    });
    await expect(trackAiCall(CONTEXT, 'gpt-4o-mini', async () => ({ usage: null, value: 2 }))).resolves.toEqual({ usage: null, value: 2 });
  });

  it('runs unrecorded without a brand', async () => {
    await trackAiCall(undefined, 'gpt-4o-mini', async () => ({ usage: null, value: 3 }));
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
