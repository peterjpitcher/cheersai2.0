import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  client: null as unknown,
}));

vi.mock('@/lib/logging', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('next/headers', () => ({ headers: () => mocks.headers() }));
vi.mock('@/lib/supabase/service', () => ({ tryCreateServiceSupabaseClient: () => mocks.client }));

const { getSelfServeSignupSwitch, readSelfServeSignupSwitch, SELF_SERVE_SIGNUP_FLAG } = await import(
  '@/lib/signup/switch'
);

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

describe('getSelfServeSignupSwitch', () => {
  it('reads once per request, however often the page and its metadata ask', async () => {
    const { client, chain } = service({ data: { enabled: false }, error: null });
    mocks.client = client;
    const requestA = new Headers();
    const requestB = new Headers();

    mocks.headers.mockResolvedValue(requestA);
    const [first, second] = await Promise.all([getSelfServeSignupSwitch(), getSelfServeSignupSwitch()]);
    expect([first, second, await getSelfServeSignupSwitch()]).toEqual(['closed', 'closed', 'closed']);
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);

    // A new request reads again, so a flip shows on the next visit.
    mocks.headers.mockResolvedValue(requestB);
    await getSelfServeSignupSwitch();
    expect(chain.maybeSingle).toHaveBeenCalledTimes(2);
  });

  it('reads directly outside a request', async () => {
    const { client, chain } = service({ data: { enabled: true }, error: null });
    mocks.client = client;
    mocks.headers.mockRejectedValue(new Error('headers() was called outside a request scope'));

    expect(await getSelfServeSignupSwitch()).toBe('open');
    expect(await getSelfServeSignupSwitch()).toBe('open');
    expect(chain.maybeSingle).toHaveBeenCalledTimes(2);
  });

  it('is unavailable when the service key is missing', async () => {
    mocks.client = null;
    mocks.headers.mockResolvedValue(new Headers());
    expect(await getSelfServeSignupSwitch()).toBe('unavailable');
  });
});
