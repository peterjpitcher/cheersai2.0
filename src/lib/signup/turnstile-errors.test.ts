import { describe, expect, it } from 'vitest';

import { isTurnstileSetupFailure, TURNSTILE_CONFIG_ERROR_CODES } from '@/lib/signup/turnstile-errors';

describe('isTurnstileSetupFailure: what the sign-up form reports to us', () => {
  it('reports a script that could not load or never showed the widget, and a widget that refused our parameters', () => {
    expect(isTurnstileSetupFailure('script_load_failed')).toBe(true);
    expect(isTurnstileSetupFailure('script_timeout')).toBe(true);
    expect(isTurnstileSetupFailure('render_failed')).toBe(true);
  });

  it("reports Cloudflare's site key, domain and configuration codes", () => {
    expect(TURNSTILE_CONFIG_ERROR_CODES).toEqual(['110100', '110110', '110200', '400020', '400021', '400070']);
    for (const code of TURNSTILE_CONFIG_ERROR_CODES) {
      expect(isTurnstileSetupFailure('widget_error', code), code).toBe(true);
    }
  });

  it("does not report the visitor's own failures", () => {
    for (const code of ['110600', '110620', '200100', '200500', '300010', '300031', '600010', '600030']) {
      expect(isTurnstileSetupFailure('widget_error', code), code).toBe(false);
    }
    expect(isTurnstileSetupFailure('widget_error')).toBe(false);
  });
});
