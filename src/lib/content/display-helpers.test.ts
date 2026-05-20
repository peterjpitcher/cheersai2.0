import { describe, it, expect } from 'vitest';
import { getDisplayTitle } from './display-helpers';
import type { ContentItem } from '@/types/content';

/** Minimal ContentItem factory — only fields relevant to getDisplayTitle */
function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 'test-id',
    accountId: 'acc-1',
    contentType: 'instant_post',
    status: 'draft',
    title: null,
    bodyDraft: null,
    campaignName: null,
    scheduledAt: null,
    eventDate: null,
    eventEndDate: null,
    couponCode: null,
    recurringDayOfWeek: null,
    autoConfirm: false,
    aiGenerationParams: null,
    thumbnailUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('getDisplayTitle', () => {
  it('returns title when title is present', () => {
    const item = makeItem({ title: 'My Great Post' });
    expect(getDisplayTitle(item)).toBe('My Great Post');
  });

  it('trims whitespace from title', () => {
    const item = makeItem({ title: '  Padded Title  ' });
    expect(getDisplayTitle(item)).toBe('Padded Title');
  });

  it('returns campaignName when title is null', () => {
    const item = makeItem({ campaignName: 'Summer Promo' });
    expect(getDisplayTitle(item)).toBe('Summer Promo');
  });

  it('returns campaignName when title is empty string', () => {
    const item = makeItem({ title: '', campaignName: 'Bank Holiday' });
    expect(getDisplayTitle(item)).toBe('Bank Holiday');
  });

  it('returns campaignName when title is whitespace only', () => {
    const item = makeItem({ title: '   ', campaignName: 'Quiz Night' });
    expect(getDisplayTitle(item)).toBe('Quiz Night');
  });

  it('returns truncated body preview when title and campaignName are null', () => {
    const longBody = 'Come and join us for a fantastic evening of live music and great food!';
    const item = makeItem({
      bodyDraft: {
        generatedCopy: {
          facebook: { body: longBody },
        },
      },
    });
    const result = getDisplayTitle(item);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result).toContain('…');
  });

  it('returns full body preview when body is under 40 characters', () => {
    const shortBody = 'Live music tonight!';
    const item = makeItem({
      bodyDraft: {
        generatedCopy: {
          facebook: { body: shortBody },
        },
      },
    });
    expect(getDisplayTitle(item)).toBe('Live music tonight!');
  });

  it('falls back through instagram body when facebook is missing', () => {
    const item = makeItem({
      bodyDraft: {
        generatedCopy: {
          instagram: { body: 'IG post text' },
        },
      },
    });
    expect(getDisplayTitle(item)).toBe('IG post text');
  });

  it('falls back through gbp body when facebook and instagram are missing', () => {
    const item = makeItem({
      bodyDraft: {
        generatedCopy: {
          gbp: { body: 'GBP post text' },
        },
      },
    });
    expect(getDisplayTitle(item)).toBe('GBP post text');
  });

  it('returns "Untitled" when all fields are null', () => {
    const item = makeItem();
    expect(getDisplayTitle(item)).toBe('Untitled');
  });

  it('returns "Untitled" when bodyDraft has no generatedCopy', () => {
    const item = makeItem({ bodyDraft: { step: 1 } });
    expect(getDisplayTitle(item)).toBe('Untitled');
  });

  it('returns "Untitled" when body text is empty string', () => {
    const item = makeItem({
      bodyDraft: {
        generatedCopy: {
          facebook: { body: '' },
        },
      },
    });
    expect(getDisplayTitle(item)).toBe('Untitled');
  });

  it('prefers title over campaignName', () => {
    const item = makeItem({ title: 'Title', campaignName: 'Campaign' });
    expect(getDisplayTitle(item)).toBe('Title');
  });

  it('prefers campaignName over body preview', () => {
    const item = makeItem({
      campaignName: 'Campaign',
      bodyDraft: {
        generatedCopy: {
          facebook: { body: 'Body text' },
        },
      },
    });
    expect(getDisplayTitle(item)).toBe('Campaign');
  });
});
