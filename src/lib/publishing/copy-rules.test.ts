import { describe, expect, it } from 'vitest';

import { cleanCopyArtifacts, normalizeHashtags, sanitizeCtaText, sanitizePublishBody } from './copy-rules';

describe('normalizeHashtags — URL-form hashtags', () => {
  it('salvages the tag from a Facebook hashtag URL instead of mangling it', () => {
    // Regression: model emitted "https://www.facebook.com/hashtag/BarStaff",
    // which previously became "#httpswwwfacebookcomhashtagBarStaff".
    const result = normalizeHashtags(['https://www.facebook.com/hashtag/BarStaff'], 'facebook');
    expect(result).toEqual(['#BarStaff']);
  });

  it('salvages the tag from an Instagram explore/tags URL', () => {
    const result = normalizeHashtags(['https://www.instagram.com/explore/tags/KitchenTeam'], 'instagram');
    expect(result).toEqual(['#KitchenTeam']);
  });

  it('handles a whole mangle-prone set from one post', () => {
    const result = normalizeHashtags(
      [
        '#Hiring',
        'https://www.facebook.com/hashtag/BarStaff',
        'https://www.facebook.com/hashtag/KitchenTeam',
        'https://www.facebook.com/hashtag/JoinOurTeam',
        'https://www.facebook.com/hashtag/StanwellMoor',
      ],
      'facebook',
    );
    expect(result).toEqual(['#Hiring', '#BarStaff', '#KitchenTeam', '#JoinOurTeam', '#StanwellMoor']);
  });

  it('drops a bare non-hashtag URL rather than turning it into a tag', () => {
    const result = normalizeHashtags(['https://l.the-anchor.pub/jobs', '#Hiring'], 'facebook');
    expect(result).toEqual(['#Hiring']);
  });

  it('leaves ordinary hashtags untouched', () => {
    const result = normalizeHashtags(['#PubJobs', 'StanwellMoor'], 'facebook');
    expect(result).toEqual(['#PubJobs', '#StanwellMoor']);
  });
});

describe('cleanCopyArtifacts', () => {
  // Regression: cleanCopyArtifacts runs on every publish body and CTA, so an
  // unconditional "at/via/on" trim ate legitimate final words.
  it('leaves a legitimate trailing "on" / "at" / "via" untouched', () => {
    expect(cleanCopyArtifacts('The match is on')).toBe('The match is on');
    expect(cleanCopyArtifacts('Pull up a chair at')).toBe('Pull up a chair at');
    expect(cleanCopyArtifacts('Order via')).toBe('Order via');
    expect(cleanCopyArtifacts("Tell us what you're on.")).toBe("Tell us what you're on.");
  });

  it('still collapses spaces before punctuation', () => {
    expect(cleanCopyArtifacts('Great night ahead ! See you soon .')).toBe(
      'Great night ahead! See you soon.',
    );
  });

  it('preserves paragraph breaks', () => {
    expect(cleanCopyArtifacts('Line one.\n\nLine two.')).toContain('\n\n');
  });
});

describe('sanitizePublishBody', () => {
  it('strips a URL sentence but keeps ordinary copy ending in "on"', () => {
    expect(sanitizePublishBody('facebook', 'The big match is on')).toBe('The big match is on');
  });

  it('removes a booking-link sentence and leaves the rest intact', () => {
    expect(
      sanitizePublishBody('facebook', 'Live music tonight. Book at the-anchor.pub/table.'),
    ).toBe('Live music tonight.');
  });

  // Regression: missing-space prose must not be wiped as if it were a link.
  it('does not blank the body when a full stop has no following space', () => {
    expect(sanitizePublishBody('facebook', 'Great food.Great drinks.See you soon.')).toBe(
      'Great food.Great drinks.See you soon.',
    );
    expect(sanitizePublishBody('instagram', 'Sorted.Come down for the quiz on Thursday.')).toBe(
      'Sorted.Come down for the quiz on Thursday.',
    );
  });
});

describe('sanitizeCtaText', () => {
  it('drops a preposition and its link, leaving a clean CTA', () => {
    expect(sanitizeCtaText('Book now at the-anchor.pub/book-table')).toBe('Book now');
  });

  it('leaves a link-free CTA ending in "on" untouched', () => {
    expect(sanitizeCtaText("What's on")).toBe("What's on");
  });
});
