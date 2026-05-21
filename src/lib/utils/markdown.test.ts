import { describe, expect, it } from 'vitest';

import { collapseWhitespacePreservingBreaks, stripMarkdown } from './markdown';

describe('stripMarkdown', () => {
  it('removes bold markers but keeps the text', () => {
    expect(stripMarkdown('**Big news** tonight')).toBe('Big news tonight');
    expect(stripMarkdown('__Big news__ tonight')).toBe('Big news tonight');
  });

  it('removes stray unmatched bold markers', () => {
    expect(stripMarkdown('Get ready** for tunes')).toBe('Get ready for tunes');
  });

  it('strips line-start headings without touching hashtags', () => {
    expect(stripMarkdown('# Music Bingo')).toBe('Music Bingo');
    // hashtags have no space after # and must survive
    expect(stripMarkdown('Join us #MusicBingo #LiveMusic')).toBe('Join us #MusicBingo #LiveMusic');
  });

  it('removes inline code and markdown links', () => {
    expect(stripMarkdown('Use `code` here')).toBe('Use code here');
    expect(stripMarkdown('Book at [our site](https://example.com)')).toBe('Book at our site');
  });
});

describe('collapseWhitespacePreservingBreaks', () => {
  it('preserves paragraph breaks', () => {
    expect(collapseWhitespacePreservingBreaks('Line one.\n\nLine two.')).toBe('Line one.\n\nLine two.');
  });

  it('collapses runs of spaces and tabs to a single space', () => {
    expect(collapseWhitespacePreservingBreaks('a    b\tc')).toBe('a b c');
  });

  it('clamps three or more consecutive newlines to a single blank line', () => {
    expect(collapseWhitespacePreservingBreaks('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('trims spaces around newlines and the whole string', () => {
    expect(collapseWhitespacePreservingBreaks('  a  \n   b  ')).toBe('a\nb');
  });
});
