import { describe, expect, it } from 'vitest';

import {
  countGoogleCharacters,
  formatGoogleEventTimes,
  googleButtonLabel,
  googleModerationLabel,
  googleStateChip,
  postCanHaveGoogleVersion,
} from '@/lib/google-posts/view-text';

describe('Google section words', () => {
  it('gives every state a short plain label and a tone with design tokens', () => {
    expect(googleStateChip({ state: 'pending', googleState: null })).toEqual({ label: 'Waiting for its time', tone: 'scheduled' });
    expect(googleStateChip({ state: 'held', googleState: null })).toEqual({ label: 'Held', tone: 'draft' });
    expect(googleStateChip({ state: 'claimed', googleState: null })).toEqual({ label: 'Sending', tone: 'publishing' });
    expect(googleStateChip({ state: 'sent', googleState: 'PROCESSING' })).toEqual({ label: 'Sent', tone: 'publishing' });
    expect(googleStateChip({ state: 'sent', googleState: null })).toEqual({ label: 'Sent', tone: 'publishing' });
    expect(googleStateChip({ state: 'sent', googleState: 'LIVE' })).toEqual({ label: 'Posted', tone: 'posted' });
    expect(googleStateChip({ state: 'sent', googleState: 'REJECTED' })).toEqual({ label: 'Rejected', tone: 'failed' });
    expect(googleStateChip({ state: 'uncertain', googleState: null })).toEqual({ label: 'Could not confirm', tone: 'failed' });
    expect(googleStateChip({ state: 'failed', googleState: null })).toEqual({ label: 'Failed', tone: 'failed' });
    expect(googleStateChip({ state: 'skipped', googleState: null })).toEqual({ label: 'Skipped', tone: 'draft' });
  });

  it('never shows a raw state for one it does not know', () => {
    const chip = googleStateChip({ state: 'mystery' as never, googleState: null });
    expect(chip.label).toBe('Google version');
  });

  it('names the button types and Google moderation in plain words', () => {
    expect(googleButtonLabel('BOOK')).toBe('Book');
    expect(googleButtonLabel('LEARN_MORE')).toBe('Learn more');
    expect(googleButtonLabel('CALL')).toBe('Button');

    expect(googleModerationLabel(null)).toBeNull();
    expect(googleModerationLabel('LIVE')).toBe('Live');
    expect(googleModerationLabel('PROCESSING')).toBe('Google is still checking it');
    expect(googleModerationLabel('REJECTED')).toBe('Rejected by Google');
    expect(googleModerationLabel('LOCAL_POST_STATE_UNSPECIFIED')).toBe('Not known yet');
  });

  it('only a Facebook feed post can have a Google version', () => {
    expect(postCanHaveGoogleVersion({ platform: 'facebook', placement: 'feed' })).toBe(true);
    expect(postCanHaveGoogleVersion({ platform: 'facebook', placement: 'story' })).toBe(false);
    expect(postCanHaveGoogleVersion({ platform: 'instagram', placement: 'feed' })).toBe(false);
  });

  it('counts characters as code points, so an emoji is one', () => {
    expect(countGoogleCharacters('Quiz')).toBe(4);
    expect(countGoogleCharacters('Quiz \u{1F389}')).toBe(6);
    expect(countGoogleCharacters('')).toBe(0);
  });
});

describe('formatGoogleEventTimes', () => {
  const LONDON = 'Europe/London';

  it('shows London times in summer (BST, UTC+1) and winter (GMT)', () => {
    expect(formatGoogleEventTimes('2026-07-04T18:00:00.000Z', '2026-07-04T21:30:00.000Z', LONDON)).toBe(
      'Saturday 4 July 2026, 19:00 to 22:30',
    );
    expect(formatGoogleEventTimes('2026-11-21T19:00:00.000Z', '2026-11-21T23:00:00.000Z', LONDON)).toBe(
      'Saturday 21 November 2026, 19:00 to 23:00',
    );
  });

  it('keeps the right hours across the October clock change', () => {
    // Clocks go back at 02:00 BST on Sunday 25 October 2026: 23:00 UTC on the 24th is midnight BST,
    // and 03:00 UTC on the 25th is 03:00 GMT.
    expect(formatGoogleEventTimes('2026-10-24T20:00:00.000Z', '2026-10-25T03:00:00.000Z', LONDON)).toBe(
      'Saturday 24 October 2026, 21:00 to Sunday 25 October 2026, 03:00',
    );
  });

  it('names the end day when the event runs past midnight', () => {
    expect(formatGoogleEventTimes('2026-12-31T21:00:00.000Z', '2027-01-01T01:00:00.000Z', LONDON)).toBe(
      'Thursday 31 December 2026, 21:00 to Friday 1 January 2027, 01:00',
    );
  });

  it('shows the start alone without an end, and nothing without a valid start', () => {
    expect(formatGoogleEventTimes('2026-11-21T19:00:00.000Z', null, LONDON)).toBe('Saturday 21 November 2026, 19:00');
    expect(formatGoogleEventTimes('2026-11-21T19:00:00.000Z', 'not a date', LONDON)).toBe('Saturday 21 November 2026, 19:00');
    expect(formatGoogleEventTimes(null, null, LONDON)).toBeNull();
    expect(formatGoogleEventTimes('not a date', null, LONDON)).toBeNull();
  });
});
