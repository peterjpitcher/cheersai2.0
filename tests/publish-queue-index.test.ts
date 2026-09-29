import { inspect } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * publish-queue's entry point, loaded as the edge runtime loads it, under a stubbed Deno global
 * (Deno.serve and Deno.env). Step 1 of tasks/SPEC-supabase-new-api-keys.md: the caller check runs
 * before anything else and only logs its verdict, so every caller, refused or not, still gets
 * exactly today's behaviour and publishing cannot break. The "step 2" tests switch the one flag
 * in caller-auth.ts on through a module mock, to show what that one-line change will do.
 *
 * index.ts is Deno code outside the app's tsconfig (Deno global, URL imports), so it is imported
 * by a runtime path that tsc does not follow. worker.ts is mocked, so no database is involved.
 */

const ENTRY: string = '../supabase/functions/publish-queue/index.ts';
const CALLER_AUTH: string = '../supabase/functions/publish-queue/caller-auth.ts';
const FUNCTION_URL = 'https://project-ref.supabase.co/functions/v1/publish-queue';

const LEGACY = 'fixture-jwt-header.fixture-service-role-payload.fixture-service-role-signature';
const ANON = 'fixture-jwt-header.fixture-anon-payload.fixture-anon-signature';
const SECRET_DEFAULT = 'sb_secret_fixture-default-not-a-real-key';
const PUBLISHABLE = 'sb_publishable_fixture-not-a-real-key';
const ALL_KEYS = [LEGACY, ANON, SECRET_DEFAULT, PUBLISHABLE];

type Handler = (request: Request) => Promise<Response>;
type Env = Record<string, string | undefined>;

const LIVE_TODAY: Env = { SUPABASE_SERVICE_ROLE_KEY: LEGACY, SUPABASE_ANON_KEY: ANON };
const WITH_NEW_KEYS: Env = {
  ...LIVE_TODAY,
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET_DEFAULT }),
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }),
};

const processDueJobs = vi.hoisted(() => vi.fn());

vi.mock('../supabase/functions/publish-queue/worker.ts', () => ({
  createDefaultConfig: () => ({}),
  PublishQueueWorker: class {
    processDueJobs = processDueJobs;
  },
}));

// The app's service client (src/lib/supabase/service.ts), built from a stubbed environment.
const appEnv = vi.hoisted(() => ({
  client: { NEXT_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co' },
  server: { SUPABASE_SERVICE_ROLE_KEY: '' },
}));
vi.mock('@/env', () => ({ env: appEnv }));

async function loadFunction(env: Env, { enforced = false } = {}): Promise<Handler> {
  vi.resetModules();
  if (enforced) {
    vi.doMock(CALLER_AUTH, async (importOriginal: () => Promise<Record<string, unknown>>) => ({
      ...(await importOriginal()),
      CALLER_CHECK_ENFORCED: true,
    }));
  } else {
    vi.doUnmock(CALLER_AUTH);
  }
  let handler: Handler | undefined;
  vi.stubGlobal('Deno', {
    env: { get: (name: string) => env[name] },
    serve: (registered: Handler) => {
      handler = registered;
    },
  });
  await import(/* @vite-ignore */ ENTRY);
  if (!handler) {
    throw new Error('index.ts did not register a request handler');
  }
  return handler;
}

/**
 * The request the app's callers make: supabase-js functions.invoke from the service client, as
 * src/app/api/cron/publish-scheduler/route.ts and src/app/actions/tournament.ts call it.
 */
async function requestFromServiceClient(serviceKey: string, source: string): Promise<Request> {
  appEnv.server.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  let captured: Request | undefined;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === FUNCTION_URL) {
      captured = request;
    }
    return Response.json({ ok: true, processed: 0 });
  });
  try {
    const { error } = await createServiceSupabaseClient().functions.invoke('publish-queue', {
      body: { leadWindowMinutes: 5, source },
    });
    expect(error).toBeNull();
  } finally {
    fetchSpy.mockRestore();
  }
  if (!captured) {
    throw new Error('supabase-js did not call publish-queue');
  }
  return captured;
}

function post(headers: Record<string, string>, body: unknown = { leadWindowMinutes: 5, source: 'probe' }): Request {
  return new Request(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function both(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/** Every 8-character run of a key, except runs inside the public prefixes. */
function keyFragments(key: string): string[] {
  const prefixes = ['sb_secret_', 'sb_publishable_'];
  const fragments: string[] = [];
  for (let index = 0; index + 8 <= key.length; index += 1) {
    const fragment = key.slice(index, index + 8);
    if (!prefixes.some((prefix) => prefix.includes(fragment))) {
      fragments.push(fragment);
    }
  }
  return fragments;
}

/** The verdicts a console spy logged, parsed from `[publish-queue] caller accepted|refused {...}`. */
function loggedVerdicts(spy: MockInstance, outcome: 'accepted' | 'refused'): Record<string, unknown>[] {
  const prefix = `[publish-queue] caller ${outcome} `;
  return spy.mock.calls
    .filter((call) => call.length === 1 && typeof call[0] === 'string' && call[0].startsWith(prefix))
    .map((call) => JSON.parse((call[0] as string).slice(prefix.length)) as Record<string, unknown>);
}

let consoleSpies: MockInstance[] = [];
let info: MockInstance;
let warn: MockInstance;
let error: MockInstance;

beforeEach(() => {
  processDueJobs.mockReset();
  processDueJobs.mockResolvedValue({ processed: 0 });
  appEnv.server.SUPABASE_SERVICE_ROLE_KEY = '';
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleSpies = [
    info,
    warn,
    error,
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'debug').mockImplementation(() => {}),
  ];
});

afterEach(() => {
  // No test may put any part of any key or token into any log call.
  const logged = inspect(consoleSpies.map((spy) => spy.mock.calls), { depth: 10 });
  for (const key of ALL_KEYS) {
    for (const fragment of keyFragments(key)) {
      expect(logged, 'a log call contained key material').not.toContain(fragment);
    }
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock(CALLER_AUTH);
});

describe('publish-queue caller check, step 1 (report-only)', () => {
  it("accepts the scheduler's request exactly as supabase-js sends it, with the legacy key on both headers", async () => {
    const request = await requestFromServiceClient(LEGACY, 'vercel-publish-scheduler');
    expect(request.headers.get('apikey')).toBe(LEGACY);
    expect(request.headers.get('authorization')).toBe(`Bearer ${LEGACY}`);

    const handler = await loadFunction(LIVE_TODAY);
    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, processed: 0 });
    expect(loggedVerdicts(info, 'accepted')).toContainEqual({
      reason: 'matched',
      keyKind: 'legacy_service_role',
      matchedHeader: 'both',
      presented: 'both',
      method: 'POST',
      enforced: false,
      legacyServiceRoleKeyConfigured: true,
      secretKeysConfigured: 0,
    });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(processDueJobs).toHaveBeenCalledWith(5, 'vercel-publish-scheduler');
    // The verdict is logged before the worker runs.
    expect(info.mock.invocationCallOrder[0]).toBeLessThan(processDueJobs.mock.invocationCallOrder[0]);
  });

  it("accepts tournament publishing's request the same way", async () => {
    const handler = await loadFunction(LIVE_TODAY);
    const response = await handler(await requestFromServiceClient(LEGACY, 'tournament-publish-now'));

    expect(response.status).toBe(200);
    expect(loggedVerdicts(info, 'accepted')).toContainEqual(expect.objectContaining({ keyKind: 'legacy_service_role', matchedHeader: 'both' }));
    expect(processDueJobs).toHaveBeenCalledWith(5, 'tournament-publish-now');
  });

  it('accepts the same app request once the service client holds a secret key (step 9)', async () => {
    const handler = await loadFunction(WITH_NEW_KEYS);
    const response = await handler(await requestFromServiceClient(SECRET_DEFAULT, 'vercel-publish-scheduler'));

    expect(response.status).toBe(200);
    expect(loggedVerdicts(info, 'accepted')).toContainEqual(
      expect.objectContaining({ keyKind: 'secret_key', matchedHeader: 'both', secretKeysConfigured: 1 }),
    );
  });

  it('still processes jobs for a refused caller, so publishing cannot break in this step', async () => {
    const refused = [both(ANON), both(PUBLISHABLE), { apikey: 'wrong-key' }, both(LEGACY.slice(0, -1)), {}];
    for (const headers of refused) {
      const handler = await loadFunction(WITH_NEW_KEYS);
      const response = await handler(post(headers, { leadWindowMinutes: 5, source: 'someone' }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, processed: 0 });
    }

    expect(processDueJobs).toHaveBeenCalledTimes(refused.length);
    expect(processDueJobs.mock.calls.every((call) => call[0] === 5 && call[1] === 'someone')).toBe(true);
    const logged = loggedVerdicts(warn, 'refused');
    expect(logged).toHaveLength(refused.length);
    expect(logged.every((verdict) => verdict.keyKind === 'none' && verdict.enforced === false)).toBe(true);
    expect(info).not.toHaveBeenCalled();
  });

  it('keeps answering a GET with 405, as today, and logs the refusal first', async () => {
    const handler = await loadFunction(LIVE_TODAY);
    const response = await handler(new Request(FUNCTION_URL, { method: 'GET' }));

    expect(response.status).toBe(405);
    expect(loggedVerdicts(warn, 'refused')).toContainEqual(
      expect.objectContaining({ reason: 'no_credentials', presented: 'none', method: 'GET' }),
    );
    expect(processDueJobs).not.toHaveBeenCalled();
  });

  it('accepts a secret key from SUPABASE_SECRET_KEYS on apikey alone', async () => {
    const handler = await loadFunction(WITH_NEW_KEYS);
    const response = await handler(post({ apikey: SECRET_DEFAULT }));

    expect(response.status).toBe(200);
    expect(loggedVerdicts(info, 'accepted')).toContainEqual(expect.objectContaining({ keyKind: 'secret_key', matchedHeader: 'apikey' }));
  });

  it('logs an error, and still carries on, when no allowed key is configured', async () => {
    const handler = await loadFunction({ SUPABASE_ANON_KEY: ANON });
    const response = await handler(post(both(LEGACY)));

    expect(response.status).toBe(200);
    expect(loggedVerdicts(error, 'refused')).toContainEqual(expect.objectContaining({ reason: 'no_allowed_keys' }));
    expect(processDueJobs).toHaveBeenCalledOnce();
  });

  it('logs a malformed SUPABASE_SECRET_KEYS and still accepts the legacy key', async () => {
    const handler = await loadFunction({ ...LIVE_TODAY, SUPABASE_SECRET_KEYS: 'not json' });
    const response = await handler(post(both(LEGACY)));

    expect(response.status).toBe(200);
    expect(error).toHaveBeenCalledWith('[publish-queue] SUPABASE_SECRET_KEYS is not a JSON object of named keys; it added no key');
    expect(loggedVerdicts(info, 'accepted')).toContainEqual(expect.objectContaining({ keyKind: 'legacy_service_role' }));
  });

  it('reads the environment on every request, so keys the platform adds later are seen', async () => {
    const env: Env = { ...LIVE_TODAY };
    const handler = await loadFunction(env);

    await handler(post({ apikey: SECRET_DEFAULT }));
    expect(loggedVerdicts(warn, 'refused')).toContainEqual(expect.objectContaining({ reason: 'no_match' }));

    env.SUPABASE_SECRET_KEYS = JSON.stringify({ default: SECRET_DEFAULT });
    await handler(post({ apikey: SECRET_DEFAULT }));
    expect(loggedVerdicts(info, 'accepted')).toContainEqual(expect.objectContaining({ keyKind: 'secret_key' }));
  });
});

describe('publish-queue caller check, step 2 (CALLER_CHECK_ENFORCED = true)', () => {
  it('refuses with an empty 401 before the body is read or the worker runs', async () => {
    for (const headers of [both(ANON), both(PUBLISHABLE), { apikey: 'wrong-key' }, {}]) {
      const handler = await loadFunction(LIVE_TODAY, { enforced: true });
      const request = post(headers);
      const response = await handler(request);

      expect(response.status).toBe(401);
      expect(await response.text()).toBe('');
      expect(request.bodyUsed).toBe(false);
      expect(processDueJobs).not.toHaveBeenCalled();
      expect(loggedVerdicts(warn, 'refused')).toContainEqual(expect.objectContaining({ enforced: true }));
    }
  });

  it('checks the caller before the method, so a GET without a key gets 401, not 405', async () => {
    const handler = await loadFunction(LIVE_TODAY, { enforced: true });
    const response = await handler(new Request(FUNCTION_URL, { method: 'GET' }));

    expect(response.status).toBe(401);
  });

  it('refuses everyone when no allowed key is configured', async () => {
    const handler = await loadFunction({}, { enforced: true });
    const response = await handler(post(both(LEGACY)));

    expect(response.status).toBe(401);
    expect(processDueJobs).not.toHaveBeenCalled();
  });

  it('lets the app callers through unchanged', async () => {
    const handler = await loadFunction(LIVE_TODAY, { enforced: true });
    const response = await handler(await requestFromServiceClient(LEGACY, 'vercel-publish-scheduler'));

    expect(response.status).toBe(200);
    expect(processDueJobs).toHaveBeenCalledWith(5, 'vercel-publish-scheduler');
    expect(loggedVerdicts(info, 'accepted')).toContainEqual(expect.objectContaining({ enforced: true }));

    const get = await handler(new Request(FUNCTION_URL, { method: 'GET', headers: both(LEGACY) }));
    expect(get.status).toBe(405);
  });
});
