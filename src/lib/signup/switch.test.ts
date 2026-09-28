import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logging', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const { readSelfServeSignupSwitch, SELF_SERVE_SIGNUP_FLAG } = await import('@/lib/signup/switch');

function service(result: { data: unknown; error: unknown } | Error) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.abortSignal = vi.fn(() => c);
  c.maybeSingle = result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result);
  return { client: { from: vi.fn(() => c) }, chain: c };
}

describe('readSelfServeSignupSwitch', () => {
  it('reads the self_serve_signup row of app_flags, with a timeout', async () => {
    const { client, chain } = service({ data: { enabled: true }, error: null });
    expect(await readSelfServeSignupSwitch(client as never)).toBe('open');
    expect(client.from).toHaveBeenCalledWith('app_flags');
    expect(chain.eq).toHaveBeenCalledWith('name', SELF_SERVE_SIGNUP_FLAG);
    expect(SELF_SERVE_SIGNUP_FLAG).toBe('self_serve_signup');
    expect(chain.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('is closed when the switch is off or the row is missing', async () => {
    expect(await readSelfServeSignupSwitch(service({ data: { enabled: false }, error: null }).client as never)).toBe('closed');
    expect(await readSelfServeSignupSwitch(service({ data: null, error: null }).client as never)).toBe('closed');
  });

  it('is unavailable, never open, when the read fails, times out or the service key is missing', async () => {
    expect(await readSelfServeSignupSwitch(service({ data: null, error: { message: 'db down' } }).client as never)).toBe(
      'unavailable',
    );
    expect(await readSelfServeSignupSwitch(service(new Error('The operation was aborted')).client as never)).toBe(
      'unavailable',
    );
    expect(await readSelfServeSignupSwitch(null)).toBe('unavailable');
  });
});
