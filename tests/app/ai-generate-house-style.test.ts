import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import type { AiGenerationResponse } from '@/lib/ai/schemas';

const generatePlatformCopy = vi.fn();

vi.mock('@/lib/ai/generate', () => ({
  AI_OWNER_MESSAGES: { empty: 'empty', timeout: 'timeout' },
  generatePlatformCopy: (...args: unknown[]) => generatePlatformCopy(...args),
}));

function supabaseStub() {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'update']) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (resolve: (value: unknown) => void) => Promise.resolve({ data: null, error: null }).then(resolve);
  return { from: vi.fn(() => chain) };
}

vi.mock('@/lib/billing/entitlement-server', () => ({
  requireEntitledContext: vi.fn(async () => ({ supabase: supabaseStub(), accountId: 'account-1' })),
}));

function draft(facebook: string, instagram = 'Two rounds of 70s disco with Jo on the mic.'): AiGenerationResponse {
  return {
    facebook: { body: facebook, cta_text: 'Book now', hashtags: ['#MusicBingo'] },
    instagram: { body: instagram, hashtags: ['#MusicBingo'], link_in_bio_line: 'Link in bio to book.' },
  };
}

const brief = {
  contentType: 'event',
  title: 'Disco Night Music Bingo',
  prompt: 'Two rounds of 70s disco, host Jo, £5 cash on the night.',
  platforms: ['facebook', 'instagram'],
  tone: 'friendly_warm',
  lengthPreference: 'standard',
  includeHashtags: true,
  includeEmojis: true,
  ctaStyle: 'default',
  proofPoints: [],
  eventName: 'Disco Night Music Bingo',
  eventDate: '2026-11-13',
  eventTime: '19:00',
  placements: ['feed'],
} as unknown as ContentBrief;

beforeEach(() => {
  generatePlatformCopy.mockReset();
});

describe('generateContent house-style check', () => {
  it('keeps a first draft that passes, with a single model call', async () => {
    generatePlatformCopy.mockResolvedValueOnce(draft('Two rounds of 70s disco and Jo on the mic, Friday 13th November.'));
    const { generateContent } = await import('@/app/actions/ai-generate');
    const result = await generateContent('content-1', brief, { scheduledAt: '2026-10-30T12:00:00Z', slotLabel: 'Weekly hype · 2 weeks out' });

    expect(result.error).toBeUndefined();
    expect(generatePlatformCopy).toHaveBeenCalledTimes(1);
    expect(result.data?.warnings.filter((warning) => warning.startsWith('House style'))).toEqual([]);
  });

  it('rewrites once, listing the problems, when the first draft opens with a stock phrase', async () => {
    generatePlatformCopy
      .mockResolvedValueOnce(draft('Get ready for a fun, lively night of Music Bingo!'))
      .mockResolvedValueOnce(draft('Two rounds of 70s disco and Jo on the mic, Friday 13th November.'));
    const { generateContent } = await import('@/app/actions/ai-generate');
    const result = await generateContent('content-1', brief, { scheduledAt: '2026-10-30T12:00:00Z' });

    expect(generatePlatformCopy).toHaveBeenCalledTimes(2);
    const retryPrompt = generatePlatformCopy.mock.calls[1][0].userPrompt as string;
    expect(retryPrompt).toContain('Your first draft broke these house-style rules');
    expect(retryPrompt).toMatch(/stock opening/);
    expect(retryPrompt).toMatch(/filler words/);
    expect(result.data?.copy.facebook.body).toContain('Two rounds of 70s disco');
    expect(result.data?.warnings.some((warning) => warning.startsWith('House style'))).toBe(false);
  });

  it('returns what is still wrong as a warning rather than blocking the post', async () => {
    generatePlatformCopy
      .mockResolvedValueOnce(draft('Get ready for Music Bingo!'))
      .mockResolvedValueOnce(draft("Tonight's the night for Music Bingo!"));
    const { generateContent } = await import('@/app/actions/ai-generate');
    const result = await generateContent('content-1', brief, { scheduledAt: '2026-10-30T12:00:00Z' });

    expect(generatePlatformCopy).toHaveBeenCalledTimes(2);
    expect(result.error).toBeUndefined();
    expect(result.data?.warnings.some((warning) => warning.startsWith('House style: Facebook: open with'))).toBe(true);
  });
});
