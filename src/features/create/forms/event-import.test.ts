import { describe, expect, it } from 'vitest';

import { importedBriefText, toneAfterImport } from './event-import';

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
