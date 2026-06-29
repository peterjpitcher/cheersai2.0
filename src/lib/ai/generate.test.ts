import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiGenerationResponse } from './schemas';

// Mock OpenAI client before importing generate module
const mockParse = vi.fn();

vi.mock('./client', () => ({
  getOpenAIClient: () => ({
    chat: {
      completions: {
        parse: mockParse,
      },
    },
  }),
}));

// Import after mock setup
const { generatePlatformCopy } = await import('./generate');

const VALID_RESPONSE: AiGenerationResponse = {
  facebook: { body: 'Join us tonight.', hashtags: ['#pub'], cta_text: 'Book now' },
  instagram: { body: 'A great evening.', hashtags: ['#food'], link_in_bio_line: null },
};

const DEFAULT_OPTIONS = {
  systemPrompt: 'You are a test assistant.',
  userPrompt: 'Write a post about pub quiz night.',
  temperature: 0.7,
};

describe('generatePlatformCopy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns parsed response matching schema', async () => {
    mockParse.mockResolvedValue({
      choices: [{ message: { parsed: VALID_RESPONSE } }],
    });

    const result = await generatePlatformCopy(DEFAULT_OPTIONS);

    expect(result).toEqual(VALID_RESPONSE);
    expect(mockParse).toHaveBeenCalledOnce();

    // Verify the model and temperature are passed correctly
    const callArgs = mockParse.mock.calls[0]![0];
    expect(callArgs.temperature).toBe(0.7);
    expect(callArgs.model).toBe('gpt-4o-mini');
  });

  it('throws after 30s timeout', async () => {
    // Mock a slow response that never resolves before abort
    mockParse.mockImplementation(
      (_opts: unknown, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const promise = generatePlatformCopy(DEFAULT_OPTIONS);

    // Advance timers past the 30s timeout
    vi.advanceTimersByTime(31_000);

    await expect(promise).rejects.toThrow('timed out after 30 seconds');
  });

  it('throws descriptive error when parsed is null', async () => {
    mockParse.mockResolvedValue({
      choices: [{ message: { parsed: null } }],
    });

    await expect(generatePlatformCopy(DEFAULT_OPTIONS)).rejects.toThrow(
      'AI returned no parsed content',
    );
  });

  it('throws descriptive error when choices are empty', async () => {
    mockParse.mockResolvedValue({ choices: [] });

    await expect(generatePlatformCopy(DEFAULT_OPTIONS)).rejects.toThrow(
      'AI returned no parsed content',
    );
  });
});
