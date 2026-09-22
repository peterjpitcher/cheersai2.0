import { describe, expect, it } from 'vitest';

import { findBannedPhrase, findRewriteCopyProblems } from '@/lib/campaigns/rewrite-copy';

describe('findRewriteCopyProblems', () => {
  it('rejects the copy that went live on 22 September 2026', () => {
    const problems = findRewriteCopyProblems(
      {
        headline: 'Book Weekday Lunch A (cod and chips)',
        primaryText:
          'Reserve a table for Weekday Lunch A (cod and chips).\n\n'
          + 'Weekday lunch at The Anchor, Stanwell Moor: lunch is served Tuesday to Friday, 12pm to 3pm (new since 1 September 2026)\n\n'
          + 'Book today and make the plan easy to say yes to.',
        description: 'Book now',
      },
      { campaignName: 'Weekday Lunch A (cod and chips)' },
    );

    expect(problems).toContain('it uses the internal campaign name');
  });

  it('catches the 36-character cut of a long campaign name the old rewrite used', () => {
    const campaignName = 'Weekday Dinner B (beef and ale pie) cold audience';
    const problems = findRewriteCopyProblems(
      {
        headline: 'Book a weekday dinner',
        primaryText: `Reserve a table for ${campaignName.slice(0, 36)}.`,
      },
      { campaignName },
    );

    expect(problems).toContain('it uses the internal campaign name');
  });

  it('catches the part of a campaign name before a pipe', () => {
    const problems = findRewriteCopyProblems(
      { headline: 'Book Sunday lunch prospecting', primaryText: 'Reserve a table today.' },
      { campaignName: 'Sunday lunch prospecting | Cold | Sep' },
    );

    expect(problems).toContain('it uses the internal campaign name');
  });

  it('allows a campaign name that is also the public imported event name', () => {
    const problems = findRewriteCopyProblems(
      { headline: 'Book Music Bingo', primaryText: 'Reserve a table for Music Bingo on Friday 8 May.' },
      { campaignName: 'Music Bingo', publicNames: ['Music Bingo'] },
    );

    expect(problems).toEqual([]);
  });

  it('passes clean first-person copy', () => {
    const problems = findRewriteCopyProblems(
      {
        headline: 'Lunch from £9, Tuesday to Friday',
        primaryText: "Snack pots are £9 and wraps are £10.\n\nBook your table online and we'll have it ready for you.",
        description: 'Book now',
      },
      { campaignName: 'Weekday Lunch A (cod and chips)' },
    );

    expect(problems).toEqual([]);
  });

  it('rejects playbook banned phrases, walk-ins, web addresses and raw dates', () => {
    const context = { campaignName: 'Campaign X' };

    expect(findRewriteCopyProblems({ headline: 'Lunch from £9', primaryText: 'A hidden gem for lunch.' }, context))
      .toContain('it uses the banned phrase "hidden gem"');
    expect(findRewriteCopyProblems({ headline: 'Lunch from £9', primaryText: 'Walk-ins welcome.' }, context))
      .toContain('it says walk-ins are welcome');
    expect(findRewriteCopyProblems({ headline: 'Lunch from £9', primaryText: 'See https://the-anchor.pub now.' }, context))
      .toContain('it contains a web address');
    expect(findRewriteCopyProblems({ headline: 'Lunch from £9', primaryText: 'Served from 2026-09-01.' }, context))
      .toContain('it contains an unformatted date');
  });

  it('rejects empty and over-length fields', () => {
    const problems = findRewriteCopyProblems(
      { headline: 'x'.repeat(41), primaryText: '', description: 'y'.repeat(26) },
      { campaignName: 'Campaign X' },
    );

    expect(problems).toEqual(expect.arrayContaining([
      'the primary text is empty',
      'the headline is longer than 40 characters',
      'the description is longer than 25 characters',
    ]));
  });
});

describe('findBannedPhrase', () => {
  it('matches whole phrases regardless of case and curly apostrophes', () => {
    expect(findBannedPhrase('Don’t miss the quiz')).toBe("don't miss");
    expect(findBannedPhrase('EXCLUSIVE offer')).toBe('exclusive');
  });

  it('ignores words that only contain a banned word', () => {
    expect(findBannedPhrase('Exclusively local produce')).toBeNull();
  });
});
