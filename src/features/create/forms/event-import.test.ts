import { describe, expect, it } from 'vitest';

import { eventBriefSchema } from '@/features/create/schemas/content-schemas';

import { importedBriefText, ownerChoseTone, toneAfterImport } from './event-import';

describe('importedBriefText', () => {
  it('keeps only the venue notes when a fact sheet came with the event', () => {
    expect(importedBriefText({ description: 'Two themed rounds.', prompt: 'Imported from management app event "X".' }, true)).toBe('Two themed rounds.');
  });

  it('adds the summary line when there is no fact sheet', () => {
    expect(importedBriefText({ description: 'Two themed rounds.', prompt: 'Imported from management app event "X".' }, false))
      .toBe('Two themed rounds.\n\nImported from management app event "X".');
  });

  it('clears the notes when the event brings none, so an earlier event\'s notes do not linger', () => {
    expect(importedBriefText({ prompt: 'Imported from management app event "X".' }, true)).toBe('');
    expect(importedBriefText({ description: '   ' }, true)).toBe('');
  });
});

describe('toneAfterImport', () => {
  it('keeps a tone the owner picked, even Friendly & Warm', () => {
    expect(toneAfterImport({ ownerChoseTone: true, suggestedTone: 'playful' })).toBeNull();
  });

  it('uses the event\'s suggestion, or puts the default back, when the owner has not picked one', () => {
    expect(toneAfterImport({ ownerChoseTone: false, suggestedTone: 'community_focused' })).toBe('community_focused');
    expect(toneAfterImport({ ownerChoseTone: false })).toBe('friendly_warm');
  });
});

describe('ownerChoseTone', () => {
  it('trusts the recorded choice, even for Friendly & Warm', () => {
    expect(ownerChoseTone({ toneChosen: true, tone: 'friendly_warm' })).toBe(true);
    expect(ownerChoseTone({ toneChosen: false, tone: 'playful' })).toBe(false);
  });

  it('treats any non-default tone in an older draft as chosen, so a resumed draft keeps it', () => {
    expect(ownerChoseTone({ tone: 'professional' })).toBe(true);
    expect(ownerChoseTone({ tone: 'friendly_warm' })).toBe(false);
    expect(ownerChoseTone({})).toBe(false);
  });

  it('is kept by the brief schema, so drafts and type changes carry it', () => {
    const parsed = eventBriefSchema.parse({
      contentType: 'event',
      title: 'Quiz Night',
      platforms: ['facebook'],
      eventName: 'Quiz Night',
      eventDate: '2026-11-04',
      eventTime: '19:00',
      tone: 'friendly_warm',
      toneChosen: true,
    });
    expect(parsed.toneChosen).toBe(true);
  });
});
