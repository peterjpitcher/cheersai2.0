import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  client: null as unknown,
  reportSignupFailure: vi.fn<(kind: string, error: unknown) => Promise<void>>(async () => undefined),
  warn: vi.fn(),
  // next/server after(): callbacks are kept and run by the test, as Vercel runs them after the response.
  afterCallbacks: [] as Array<() => unknown>,
  afterThrows: false,
}));

vi.mock('@/lib/logging', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() }),
}));
vi.mock('next/headers', () => ({ headers: () => mocks.headers() }));
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => {
    if (mocks.afterThrows) throw new Error('`after` was called outside a request scope');
    mocks.afterCallbacks.push(callback);
  },
}));
vi.mock('@/lib/supabase/service', () => ({ tryCreateServiceSupabaseClient: () => mocks.client }));
vi.mock('@/lib/signup/alerts', () => ({ reportSignupFailure: mocks.reportSignupFailure }));

const { getSelfServeSignupSwitch, readSelfServeSignupSwitch, resetSignupSwitchAlertForTests, SELF_SERVE_SIGNUP_FLAG } =
  await import('@/lib/signup/switch');

type Row = { name: string; enabled: boolean | null };

/** A service client whose app_flags read answers with `result` (or rejects with it, like a timeout). */
function service(result: { data: unknown; error: unknown } | Error) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.in = vi.fn(() => c);
  c.abortSignal = vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)));
  return { client: { from: vi.fn(() => c) }, chain: c };
}

function flags(signup: boolean | null | 'missing', enforcement: boolean | null | 'missing') {
  const rows: Row[] = [];
  if (signup !== 'missing') rows.push({ name: 'self_serve_signup', enabled: signup });
  if (enforcement !== 'missing') rows.push({ name: 'billing_enforcement', enabled: enforcement });
  return service({ data: rows, error: null });
}

async function runAfterCallbacks(): Promise<void> {
  for (const callback of mocks.afterCallbacks.splice(0)) await callback();
}

beforeEach(() => {
  mocks.reportSignupFailure.mockClear();
  mocks.warn.mockClear();
  mocks.afterCallbacks.length = 0;
  mocks.afterThrows = false;
  resetSignupSwitchAlertForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('readSelfServeSignupSwitch', () => {
  it('reads both app_flags rows in one query, with a timeout', async () => {
    const { client, chain } = flags(true, true);
    expect(await readSelfServeSignupSwitch(client as never)).toBe('open');
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledWith('app_flags');
    expect(chain.select).toHaveBeenCalledWith('name, enabled');
    expect(chain.in).toHaveBeenCalledWith('name', ['self_serve_signup', 'billing_enforcement']);
    expect(SELF_SERVE_SIGNUP_FLAG).toBe('self_serve_signup');
    expect(chain.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it.each([
    { signup: true, enforcement: true, expected: 'open' },
    { signup: true, enforcement: false, expected: 'enforcement_off' },
    { signup: false, enforcement: true, expected: 'closed' },
    { signup: false, enforcement: false, expected: 'closed' },
  ] as const)(
    'is $expected with self_serve_signup $signup and billing_enforcement $enforcement',
    async ({ signup, enforcement, expected }) => {
      expect(await readSelfServeSignupSwitch(flags(signup, enforcement).client as never)).toBe(expected);
    },
  );

  it('is open only when both rows are on: every other flag combination is closed for callers', async () => {
    const combinations: Array<[boolean | null | 'missing', boolean | null | 'missing']> = [];
    for (const signup of [true, false, null, 'missing'] as const) {
      for (const enforcement of [true, false, null, 'missing'] as const) combinations.push([signup, enforcement]);
    }
    for (const [signup, enforcement] of combinations) {
      const state = await readSelfServeSignupSwitch(flags(signup, enforcement).client as never);
      expect(state === 'open').toBe(signup === true && enforcement === true);
    }
  });

  it('keeps sign-up closed when billing_enforcement cannot be read from its row (missing or not true)', async () => {
    expect(await readSelfServeSignupSwitch(flags(true, 'missing').client as never)).toBe('enforcement_off');
    expect(await readSelfServeSignupSwitch(flags(true, null).client as never)).toBe('enforcement_off');
    expect(
      await readSelfServeSignupSwitch(
        service({ data: [{ name: 'self_serve_signup', enabled: true }, { name: 'billing_enforcement', enabled: 'true' }], error: null })
          .client as never,
      ),
    ).toBe('enforcement_off');
  });

  it('is closed when the switch is off or its row is missing, whatever billing enforcement says', async () => {
    expect(await readSelfServeSignupSwitch(flags('missing', true).client as never)).toBe('closed');
    expect(await readSelfServeSignupSwitch(flags(null, true).client as never)).toBe('closed');
    expect(await readSelfServeSignupSwitch(service({ data: [], error: null }).client as never)).toBe('closed');
    expect(mocks.reportSignupFailure).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(0);
  });

  it('is unavailable, never open, when the read fails, times out, answers oddly or the service key is missing', async () => {
    expect(await readSelfServeSignupSwitch(service({ data: null, error: { message: 'db down' } }).client as never)).toBe(
      'unavailable',
    );
    expect(await readSelfServeSignupSwitch(service(new Error('The operation was aborted')).client as never)).toBe(
      'unavailable',
    );
    expect(await readSelfServeSignupSwitch(service({ data: null, error: null }).client as never)).toBe('unavailable');
    expect(
      await readSelfServeSignupSwitch(service({ data: { name: 'self_serve_signup', enabled: true }, error: null }).client as never),
    ).toBe('unavailable');
    expect(await readSelfServeSignupSwitch(null)).toBe('unavailable');
    // A failed read is alerted by the sign-up actions as 'switch', not here.
    expect(mocks.reportSignupFailure).not.toHaveBeenCalled();
  });

  it('logs the switch on without billing enforcement on every read, and says which it was', async () => {
    await readSelfServeSignupSwitch(flags(true, false).client as never);
    await readSelfServeSignupSwitch(flags(true, 'missing').client as never);
    expect(mocks.warn).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenNthCalledWith(1, expect.stringContaining('billing enforcement'), { billingEnforcement: 'off' });
    expect(mocks.warn).toHaveBeenNthCalledWith(2, expect.stringContaining('billing enforcement'), { billingEnforcement: 'missing' });
  });

  it('alerts the operator once, after the response, however many reads find the switch on without enforcement', async () => {
    const first = await readSelfServeSignupSwitch(flags(true, false).client as never);
    // The read answers without waiting for the alert.
    expect(first).toBe('enforcement_off');
    expect(mocks.reportSignupFailure).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(1);

    for (let i = 0; i < 5; i += 1) await readSelfServeSignupSwitch(flags(true, false).client as never);
    expect(mocks.afterCallbacks).toHaveLength(1);

    await runAfterCallbacks();
    expect(mocks.reportSignupFailure).toHaveBeenCalledTimes(1);
    const [kind, error] = mocks.reportSignupFailure.mock.calls[0] ?? [];
    expect(kind).toBe('signup_without_enforcement');
    // Flag names and state only: nothing about the visitor.
    expect(error).toEqual(new Error('app_flags.self_serve_signup is on but app_flags.billing_enforcement is off'));
  });

  it('alerts again after an hour on the same server', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T09:00:00Z'));
    await readSelfServeSignupSwitch(flags(true, false).client as never);
    vi.setSystemTime(new Date('2026-09-29T09:59:59Z'));
    await readSelfServeSignupSwitch(flags(true, false).client as never);
    expect(mocks.afterCallbacks).toHaveLength(1);

    vi.setSystemTime(new Date('2026-09-29T10:00:00Z'));
    await readSelfServeSignupSwitch(flags(true, false).client as never);
    await runAfterCallbacks();
    expect(mocks.reportSignupFailure).toHaveBeenCalledTimes(2);
  });

  it('sends the alert straight away outside a request, where after() is not available', async () => {
    mocks.afterThrows = true;
    expect(await readSelfServeSignupSwitch(flags(true, 'missing').client as never)).toBe('enforcement_off');
    expect(mocks.reportSignupFailure).toHaveBeenCalledTimes(1);
    expect(mocks.reportSignupFailure).toHaveBeenCalledWith(
      'signup_without_enforcement',
      new Error('app_flags.self_serve_signup is on but app_flags.billing_enforcement is missing'),
    );
  });

  it('matches each flag by name, whatever order the rows come back in', async () => {
    const reversed = (signup: boolean, enforcement: boolean) =>
      service({
        data: [
          { name: 'billing_enforcement', enabled: enforcement },
          { name: 'self_serve_signup', enabled: signup },
        ],
        error: null,
      }).client as never;
    expect(await readSelfServeSignupSwitch(reversed(true, true))).toBe('open');
    expect(await readSelfServeSignupSwitch(reversed(true, false))).toBe('enforcement_off');
    expect(await readSelfServeSignupSwitch(reversed(false, true))).toBe('closed');
  });

  it('does not alert when sign-up is open or closed', async () => {
    await readSelfServeSignupSwitch(flags(true, true).client as never);
    await readSelfServeSignupSwitch(flags(false, false).client as never);
    await readSelfServeSignupSwitch(flags(false, true).client as never);
    expect(mocks.afterCallbacks).toHaveLength(0);
    expect(mocks.reportSignupFailure).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});

describe('getSelfServeSignupSwitch', () => {
  it('reads once per request, however often the page and its metadata ask', async () => {
    const { client, chain } = flags(false, true);
    mocks.client = client;
    const requestA = new Headers();
    const requestB = new Headers();

    mocks.headers.mockResolvedValue(requestA);
    const [first, second] = await Promise.all([getSelfServeSignupSwitch(), getSelfServeSignupSwitch()]);
    expect([first, second, await getSelfServeSignupSwitch()]).toEqual(['closed', 'closed', 'closed']);
    expect(chain.abortSignal).toHaveBeenCalledTimes(1);

    // A new request reads again, so a flip shows on the next visit.
    mocks.headers.mockResolvedValue(requestB);
    await getSelfServeSignupSwitch();
    expect(chain.abortSignal).toHaveBeenCalledTimes(2);
  });

  it('reads directly outside a request', async () => {
    const { client, chain } = flags(true, true);
    mocks.client = client;
    mocks.headers.mockRejectedValue(new Error('headers() was called outside a request scope'));

    expect(await getSelfServeSignupSwitch()).toBe('open');
    expect(await getSelfServeSignupSwitch()).toBe('open');
    expect(chain.abortSignal).toHaveBeenCalledTimes(2);
  });

  it('is closed for the request when the switch is on without billing enforcement, and alerts once', async () => {
    const { client } = flags(true, false);
    mocks.client = client;
    mocks.headers.mockResolvedValue(new Headers());
    expect(await getSelfServeSignupSwitch()).toBe('enforcement_off');
    mocks.headers.mockResolvedValue(new Headers());
    expect(await getSelfServeSignupSwitch()).toBe('enforcement_off');
    await runAfterCallbacks();
    expect(mocks.reportSignupFailure).toHaveBeenCalledTimes(1);
  });

  it('is unavailable when the service key is missing', async () => {
    mocks.client = null;
    mocks.headers.mockResolvedValue(new Headers());
    expect(await getSelfServeSignupSwitch()).toBe('unavailable');
  });
});
