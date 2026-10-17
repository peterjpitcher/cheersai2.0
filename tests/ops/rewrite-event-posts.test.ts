import { describe, expect, it } from 'vitest';

import { parseArgs } from '../../scripts/ops/rewrite-event-posts';

describe('rewrite-event-posts arguments', () => {
  it('plans by default, for the given brand and campaigns', () => {
    expect(parseArgs(['--account', 'acc-1', '--campaign', 'c-1', '--campaign', 'c-2'])).toEqual({
      mode: 'plan',
      accountId: 'acc-1',
      campaignIds: ['c-1', 'c-2'],
      planFile: null,
      outDir: null,
      note: null,
    });
  });

  it('takes an owner note for a plan run only', () => {
    expect(parseArgs(['--account', 'acc-1', '--note', 'Mention the jackpot.'])).toMatchObject({ mode: 'plan', note: 'Mention the jackpot.' });
    expect(() => parseArgs(['--apply', '--plan', 'p.json', '--note', 'x'])).toThrow(/only applies to a plan run/);
  });

  it('applies or rolls back a plan file', () => {
    expect(parseArgs(['--apply', '--plan', 'plan.json'])).toMatchObject({ mode: 'apply', planFile: 'plan.json' });
    expect(parseArgs(['--rollback', '--plan', 'plan.json'])).toMatchObject({ mode: 'rollback', planFile: 'plan.json' });
  });

  it('refuses unclear or incomplete requests', () => {
    expect(() => parseArgs([])).toThrow(/needs --account/);
    expect(() => parseArgs(['--apply'])).toThrow(/needs --plan/);
    expect(() => parseArgs(['--apply', '--rollback', '--plan', 'p.json'])).toThrow(/not both/);
    expect(() => parseArgs(['--account'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--account', 'acc-1', '--force'])).toThrow(/Unknown option --force/);
  });
});
