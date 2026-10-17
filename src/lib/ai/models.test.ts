import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_COPY_MODEL, copyTimeoutMs, isReasoningModel, resolveCopyModel } from './models';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('copy model selection', () => {
  it('uses the default unless OPENAI_MODEL is set', () => {
    vi.stubEnv('OPENAI_MODEL', '');
    expect(resolveCopyModel()).toBe(DEFAULT_COPY_MODEL);
    vi.stubEnv('OPENAI_MODEL', ' gpt-5.5 ');
    expect(resolveCopyModel()).toBe('gpt-5.5');
  });

  it.each([
    ['gpt-4o-mini', false], ['gpt-4.1-mini', false], ['gpt-5.4-mini', true], ['gpt-5.5', true], ['gpt-6-sol', true], ['o3', true], ['o4-mini', true],
  ])('treats %s as a reasoning model: %s', (model, reasoning) => {
    expect(isReasoningModel(model)).toBe(reasoning);
    expect(copyTimeoutMs(model)).toBe(reasoning ? 60_000 : 30_000);
  });
});
