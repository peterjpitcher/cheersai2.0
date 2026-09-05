import { describe, expect, it } from 'vitest';

import { applyChannelRules, hasBlockingIssues, lintContent } from './content-rules';

describe('applyChannelRules — link-in-bio removal on Facebook', () => {
  it('removes the whole link-in-bio sentence rather than leaving a broken fragment', () => {
    const result = applyChannelRules({
      body: 'Come down Friday for live music. Find the link in our bio to book. Doors open at 6pm.',
      platform: 'facebook',
      placement: 'feed',
    });
    // The old phrase-only deletion produced "Find the to book." — assert that
    // orphan fragment never appears and the surrounding copy survives intact.
    expect(result.body).not.toMatch(/find the to book/i);
    expect(result.body).not.toMatch(/link in (?:our|the)?\s*bio/i);
    expect(result.body).toContain('Doors open at 6pm.');
  });
});

describe('applyChannelRules — disallowed claim removal', () => {
  it('drops the whole claim sentence when other sentences remain', () => {
    const result = applyChannelRules({
      body: 'Live music from 8pm. Spaces are limited, so book early. Bring your mates.',
      platform: 'facebook',
      placement: 'feed',
    });
    expect(result.body).not.toMatch(/spaces are limited/i);
    // No orphaned leading connective/comma left behind.
    expect(result.body).not.toMatch(/(^|\n)\s*,/);
    expect(result.body).toContain('Live music from 8pm.');
    expect(result.body).toContain('Bring your mates.');
  });

  it('cleans the fragment instead of leaving a leading comma when the claim was the whole body', () => {
    const result = applyChannelRules({
      body: 'Spaces are limited, so book early.',
      platform: 'facebook',
      placement: 'feed',
    });
    expect(result.body).not.toMatch(/spaces are limited/i);
    expect(result.body.trim()).not.toMatch(/^[,;:]/);
    expect(result.body).toMatch(/book early/i);
  });
});

describe('applyChannelRules and lintContent: em dash house style', () => {
  // Built from the code point so this file never holds a literal em dash.
  const dash = String.fromCharCode(0x2014);

  it('repairs an em dash instead of leaving it in the copy', () => {
    const result = applyChannelRules({
      body: `Quiz night is back ${dash} first round at 7pm.`,
      platform: 'facebook',
      placement: 'feed',
    });
    expect(result.body).not.toContain(dash);
    expect(result.body).toContain('Quiz night is back, first round at 7pm.');
    expect(result.repairs).toContain('em_dashes_replaced');
  });

  it('does not record the repair when the copy has no em dash', () => {
    const result = applyChannelRules({
      body: 'Quiz night is back, first round at 7pm.',
      platform: 'facebook',
      placement: 'feed',
    });
    expect(result.repairs).not.toContain('em_dashes_replaced');
  });

  it('flags an em dash as a warning rather than a blocking error', () => {
    const result = lintContent({
      body: `Quiz night is back ${dash} first round at 7pm.`,
      platform: 'facebook',
      placement: 'feed',
    });
    const issue = result.issues.find((entry) => entry.code === 'em_dash');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warning');
    expect(hasBlockingIssues(result)).toBe(false);
  });

  it('raises no em dash issue for copy that has already been repaired', () => {
    const repaired = applyChannelRules({
      body: `Roast from 1pm ${dash} book ahead.`,
      platform: 'facebook',
      placement: 'feed',
    });
    const result = lintContent({
      body: repaired.body,
      platform: 'facebook',
      placement: 'feed',
    });
    expect(result.issues.map((entry) => entry.code)).not.toContain('em_dash');
  });
});
