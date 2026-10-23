import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import type { AiGenerationResponse } from '@/lib/ai/schemas';
import type { CampaignSlotPlan } from '@/lib/ai/slot-jobs';

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

describe('campaign plan from the wizard (B3)', () => {
  const hostedBrief = { ...brief, facts: { host: 'Jo' } } as unknown as ContentBrief;
  const plan: CampaignSlotPlan = {
    job: 'meet_the_host',
    host: 'Someone Else',
    position: 2,
    total: 4,
    earlierOpenings: ['Two rounds of 70s disco on Friday 13th November.'],
    earlierQuestions: ['Which decade will you dress as?'],
    allowQuestion: true,
  };
  const refused = 'We could not write this post. Refresh the page and try again.';

  // The Instagram drafts here must not open like the plan's earlier post ("Two rounds of..."),
  // or the house-style check asks for a rewrite.
  const freshInstagram = 'Jo on the mic for two rounds of 70s disco.';

  it('writes the plan into the prompt, naming the host from the brief', async () => {
    generatePlatformCopy.mockResolvedValueOnce(draft('Jo hosts two rounds of 70s disco on Friday 13th November.', freshInstagram));
    const { generateContent } = await import('@/app/actions/ai-generate');
    const result = await generateContent('content-1', hostedBrief, { scheduledAt: '2026-11-06T08:00:00Z', campaign: plan });

    expect(result.error).toBeUndefined();
    const prompt = generatePlatformCopy.mock.calls[0][0].userPrompt as string;
    expect(prompt).toContain('Campaign plan: this is post 2 of 4 for this event.');
    expect(prompt).toContain('Lead with the host, Jo,');
    expect(prompt).not.toContain('Someone Else');
    expect(prompt).toContain('- "Two rounds of 70s disco on Friday 13th November."');
    expect(prompt).toContain('"Which decade will you dress as?"');
    expect(prompt).toContain('You may ask one question');
  });

  it('rewrites a post that opens like another in its campaign, or asks a question its plan does not allow', async () => {
    generatePlatformCopy
      .mockResolvedValueOnce(draft('Two rounds of 70s disco and Jo on the mic. Which decade suits you?', freshInstagram))
      .mockResolvedValueOnce(draft('Jo hosts two rounds of 70s disco on Friday 13th November.', freshInstagram));
    const { generateContent } = await import('@/app/actions/ai-generate');
    const result = await generateContent('content-1', hostedBrief, {
      scheduledAt: '2026-11-06T08:00:00Z',
      campaign: { ...plan, allowQuestion: false },
    });

    expect(generatePlatformCopy).toHaveBeenCalledTimes(2);
    const rewrite = generatePlatformCopy.mock.calls[1][0].userPrompt as string;
    expect(rewrite).toContain("Facebook: open differently from the campaign's other posts");
    expect(rewrite).toContain('Facebook: ask no question in this post');
    expect(result.error).toBeUndefined();
    expect(result.data?.warnings).toEqual([]);
  });

  it('writes no campaign block without a plan', async () => {
    generatePlatformCopy.mockResolvedValueOnce(draft('Two rounds of 70s disco and Jo on the mic, Friday 13th November.'));
    const { generateContent } = await import('@/app/actions/ai-generate');
    await generateContent('content-1', hostedBrief, { scheduledAt: '2026-11-06T08:00:00Z' });

    expect(generatePlatformCopy.mock.calls[0][0].userPrompt).not.toContain('Campaign plan');
  });

  it('passes the plan when a post is rewritten with a modifier', async () => {
    generatePlatformCopy.mockResolvedValueOnce(draft('Jo hosts two rounds of 70s disco on Friday 13th November.', freshInstagram));
    const { regenerateWithModifier } = await import('@/app/actions/ai-generate');
    const result = await regenerateWithModifier('content-1', hostedBrief, 'Make the copy shorter and more concise.', {
      scheduledAt: '2026-11-06T08:00:00Z',
      campaign: { ...plan, job: 'how_it_works', allowQuestion: false },
    });

    expect(result.error).toBeUndefined();
    const prompt = generatePlatformCopy.mock.calls[0][0].userPrompt as string;
    expect(prompt).toContain('Explain how the night works for someone who has never been');
    expect(prompt).toContain('Do not ask a question in this post.');
  });

  it.each([
    ['an unknown job', { ...plan, job: 'go_viral' }],
    ['a place after the last post', { ...plan, position: 5 }],
    ['more posts than a campaign holds', { ...plan, position: 1, total: 13 }],
    ['too many openings', { ...plan, earlierOpenings: Array.from({ length: 23 }, (_, index) => `Opening ${index}.`) }],
    ['an opening longer than any first line', { ...plan, earlierOpenings: ['x'.repeat(141)] }],
    ['a missing field', { job: 'announce', position: 1, total: 1 }],
    ['no plan at all', null],
  ])('refuses %s without calling the model', async (_case, campaign) => {
    const { generateContent } = await import('@/app/actions/ai-generate');
    const result = await generateContent('content-1', hostedBrief, {
      scheduledAt: '2026-11-06T08:00:00Z',
      campaign: campaign as unknown as CampaignSlotPlan,
    });

    expect(result).toEqual({ error: refused });
    expect(generatePlatformCopy).not.toHaveBeenCalled();
  });

  it('refuses a plan for a brief that is not an event', async () => {
    const promotion = {
      contentType: 'promotion',
      title: 'Two for one pizzas',
      prompt: 'Two for one pizzas on Tuesdays.',
      platforms: ['facebook'],
      offerSummary: 'Two for one pizzas',
      endDate: '2026-12-31',
    } as unknown as ContentBrief;
    const { regenerateWithModifier } = await import('@/app/actions/ai-generate');
    const result = await regenerateWithModifier('content-1', promotion, 'Make the copy shorter and more concise.', {
      campaign: { ...plan, job: 'announce' },
    });

    expect(result).toEqual({ error: refused });
    expect(generatePlatformCopy).not.toHaveBeenCalled();
  });

  it('refuses meet the host when the brief names no host', async () => {
    const { generateContent } = await import('@/app/actions/ai-generate');
    const result = await generateContent('content-1', brief, { scheduledAt: '2026-11-06T08:00:00Z', campaign: plan });

    expect(result).toEqual({ error: refused });
    expect(generatePlatformCopy).not.toHaveBeenCalled();
  });
});
