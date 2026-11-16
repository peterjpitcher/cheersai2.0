import { describe, expect, it } from 'vitest';

import { parseArgs, parsePlan, renderPlan } from '../../scripts/ops/google-versions-existing-schedule';

describe('google-versions-existing-schedule arguments', () => {
  it('is a dry run unless --apply is given', () => {
    expect(parseArgs(['--account', 'acc-1'])).toMatchObject({ mode: 'plan', accountId: 'acc-1' });
    expect(() => parseArgs([])).toThrow(/needs --account/);
  });

  it('applies only a saved plan, with the owner\'s words recorded', () => {
    expect(parseArgs(['--apply', '--plan', 'temp/plan.json', '--asked', 'yes, add them'])).toMatchObject({
      mode: 'apply',
      planFile: 'temp/plan.json',
      asked: 'yes, add them',
    });
    expect(() => parseArgs(['--apply', '--asked', 'yes'])).toThrow(/--plan/);
    expect(() => parseArgs(['--apply', '--plan', 'p.json'])).toThrow(/--asked/);
    expect(() => parseArgs(['--apply', '--plan', 'p.json', '--asked', '   '])).toThrow(/--asked/);
  });

  it('refuses unknown options and options with no value', () => {
    expect(() => parseArgs(['--account'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--account', '--apply'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--account', 'a', '--force'])).toThrow(/Unknown option/);
  });
});

describe('the plan file', () => {
  const plan = {
    accountId: 'acc-1',
    localPostParent: 'accounts/1/locations/2',
    generatedAt: '2026-11-16T10:00:00.000Z',
    create: [{ contentItemId: 'post-1', scheduledFor: '2026-11-20T18:00:00.000Z', reason: 'STANDARD', row: {} }],
    held: [],
    skipped: [{ contentItemId: 'post-2', scheduledFor: null, reason: 'a story, not a feed post' }],
    deferred: [],
  };

  it('prints London times and says nothing was created', () => {
    const text = renderPlan(plan as never);
    expect(text).toContain('Nothing has been created.');
    expect(text).toContain('Fri 20 Nov 2026 18:00  post-1');
    expect(text).toContain('Would be created but held for a person: none');
  });

  it('refuses a file that is not a plan', () => {
    expect(parsePlan(plan)).toBe(plan);
    expect(() => parsePlan({ accountId: 'acc-1' })).toThrow(/not a plan/);
    expect(() => parsePlan(null)).toThrow(/not a plan/);
  });
});
