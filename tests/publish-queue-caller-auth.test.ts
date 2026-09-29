import { inspect } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import {
  CALLER_CHECK_ENFORCED,
  checkCaller,
  logCallerVerdict,
  readAllowedKeys,
  type CallerVerdict,
} from '../supabase/functions/publish-queue/caller-auth';

/**
 * publish-queue's caller check (tasks/SPEC-supabase-new-api-keys.md, step 1). The platform's
 * verify_jwt check lets the public anon key through, so the function itself accepts only the
 * project's service keys: the legacy service-role key, every secret key in SUPABASE_SECRET_KEYS
 * and the local single SUPABASE_SECRET_KEY. The fixtures are not real keys.
 */

const LEGACY = 'fixture-jwt-header.fixture-service-role-payload.fixture-service-role-signature';
const ANON = 'fixture-jwt-header.fixture-anon-payload.fixture-anon-signature';
const USER_SESSION = 'fixture-jwt-header.fixture-user-session-payload.fixture-user-signature';
const SECRET_DEFAULT = 'sb_secret_fixture-default-not-a-real-key';
const SECRET_SECOND = 'sb_secret_fixture-second-not-a-real-key';
const SECRET_SINGLE = 'sb_secret_fixture-local-single-not-a-real-key';
const PUBLISHABLE = 'sb_publishable_fixture-not-a-real-key';

const ALL_KEYS = [LEGACY, ANON, USER_SESSION, SECRET_DEFAULT, SECRET_SECOND, SECRET_SINGLE, PUBLISHABLE];

type Env = Record<string, string | undefined>;

/** Live today: the legacy keys only (the anon key is injected too, and must not be allowed). */
const LIVE_TODAY: Env = { SUPABASE_SERVICE_ROLE_KEY: LEGACY, SUPABASE_ANON_KEY: ANON };

/** After step 5: the platform adds the JSON objects of named keys next to the legacy ones. */
const WITH_NEW_KEYS: Env = {
  ...LIVE_TODAY,
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET_DEFAULT, backend: SECRET_SECOND }),
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }),
};

function check(env: Env, headers: Record<string, string>): Promise<CallerVerdict> {
  return checkCaller(new Headers(headers), (name) => env[name]);
}

function both(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/** Every 8-character run of a key, except runs inside the public prefixes, so none may appear in a log. */
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

describe('checkCaller', () => {
  it('is report-only in step 1', () => {
    expect(CALLER_CHECK_ENFORCED).toBe(false);
  });

  it('accepts the legacy service-role key on both headers, as supabase-js sends it', async () => {
    expect(await check(LIVE_TODAY, both(LEGACY))).toEqual({
      accepted: true,
      reason: 'matched',
      keyKind: 'legacy_service_role',
      matchedHeader: 'both',
      presented: 'both',
      legacyServiceRoleKeyConfigured: true,
      secretKeysConfigured: 0,
      secretKeysMalformed: false,
    });
  });

  it('accepts the legacy key on either header alone', async () => {
    const bearerOnly = await check(LIVE_TODAY, { Authorization: `Bearer ${LEGACY}` });
    expect(bearerOnly).toMatchObject({ accepted: true, keyKind: 'legacy_service_role', matchedHeader: 'authorization', presented: 'authorization' });

    const apikeyOnly = await check(LIVE_TODAY, { apikey: LEGACY });
    expect(apikeyOnly).toMatchObject({ accepted: true, keyKind: 'legacy_service_role', matchedHeader: 'apikey', presented: 'apikey' });
  });

  it('accepts every secret key in SUPABASE_SECRET_KEYS, not only the default one', async () => {
    for (const key of [SECRET_DEFAULT, SECRET_SECOND]) {
      expect(await check(WITH_NEW_KEYS, { apikey: key })).toMatchObject({
        accepted: true,
        keyKind: 'secret_key',
        matchedHeader: 'apikey',
        secretKeysConfigured: 2,
        legacyServiceRoleKeyConfigured: true,
      });
      expect(await check(WITH_NEW_KEYS, both(key))).toMatchObject({ accepted: true, keyKind: 'secret_key', matchedHeader: 'both' });
    }
  });

  it('accepts a secret key on apikey when Authorization carries some other token', async () => {
    const verdict = await check(WITH_NEW_KEYS, { apikey: SECRET_DEFAULT, Authorization: `Bearer ${USER_SESSION}` });
    expect(verdict).toMatchObject({ accepted: true, keyKind: 'secret_key', matchedHeader: 'apikey', presented: 'both' });
  });

  it('accepts the single SUPABASE_SECRET_KEY a locally served function gets', async () => {
    const env: Env = { SUPABASE_SECRET_KEY: SECRET_SINGLE, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE };
    expect(await check(env, both(SECRET_SINGLE))).toMatchObject({
      accepted: true,
      keyKind: 'secret_key',
      matchedHeader: 'both',
      secretKeysConfigured: 1,
      legacyServiceRoleKeyConfigured: false,
    });
  });

  it('says secret_key when the two headers matched different kinds of key', async () => {
    const verdict = await check(WITH_NEW_KEYS, { apikey: SECRET_DEFAULT, Authorization: `Bearer ${LEGACY}` });
    expect(verdict).toMatchObject({ accepted: true, keyKind: 'secret_key', matchedHeader: 'both' });
  });

  it('refuses the anon key, which passes verify_jwt, on either or both headers', async () => {
    for (const headers of [both(ANON), { apikey: ANON }, { Authorization: `Bearer ${ANON}` }]) {
      expect(await check(WITH_NEW_KEYS, headers)).toMatchObject({ accepted: false, reason: 'no_match', keyKind: 'none', matchedHeader: 'none' });
    }
  });

  it("refuses a publishable key and a signed-in user's session token", async () => {
    expect(await check(WITH_NEW_KEYS, both(PUBLISHABLE))).toMatchObject({ accepted: false, reason: 'no_match' });
    expect(await check(WITH_NEW_KEYS, { apikey: ANON, Authorization: `Bearer ${USER_SESSION}` })).toMatchObject({
      accepted: false,
      reason: 'no_match',
      presented: 'both',
    });
  });

  it('refuses a request with no credential', async () => {
    expect(await check(WITH_NEW_KEYS, {})).toMatchObject({ accepted: false, reason: 'no_credentials', presented: 'none', matchedHeader: 'none' });
    expect(await check(WITH_NEW_KEYS, { apikey: '   ', Authorization: 'Bearer ' })).toMatchObject({ accepted: false, reason: 'no_credentials' });
  });

  it('refuses wrong, truncated, extended and altered keys', async () => {
    const candidates = [
      'not-the-service-role-key',
      LEGACY.slice(0, -1),
      LEGACY.slice(1),
      LEGACY.slice(0, 20),
      `${LEGACY}x`,
      LEGACY.toUpperCase(),
      SECRET_DEFAULT.slice(0, -1),
      `${SECRET_DEFAULT}0`,
      `${LEGACY},${LEGACY}`,
    ];
    for (const key of candidates) {
      expect(await check(WITH_NEW_KEYS, both(key)), key.length.toString()).toMatchObject({ accepted: false, reason: 'no_match' });
    }
  });

  it('trims whitespace around a presented key and reads the Bearer scheme in any case', async () => {
    expect(await check(LIVE_TODAY, { apikey: `  ${LEGACY}\t` })).toMatchObject({ accepted: true, matchedHeader: 'apikey' });
    expect(await check(LIVE_TODAY, { Authorization: `  bearer   ${LEGACY}  ` })).toMatchObject({ accepted: true, matchedHeader: 'authorization' });
  });

  it('reads Authorization only as a Bearer token', async () => {
    for (const authorization of [LEGACY, `Basic ${LEGACY}`, `Token ${LEGACY}`, `Bearer ${LEGACY} extra`]) {
      expect(await check(LIVE_TODAY, { Authorization: authorization }), authorization.slice(0, 6)).toMatchObject({
        accepted: false,
        reason: 'no_credentials',
        presented: 'none',
      });
    }
  });

  it('adds no key from a malformed SUPABASE_SECRET_KEYS, and keeps the other keys', async () => {
    const malformed = [
      'not json',
      `{"default": "${SECRET_DEFAULT}"`,
      JSON.stringify([SECRET_DEFAULT]),
      JSON.stringify(SECRET_DEFAULT),
      'null',
      '42',
      JSON.stringify({ default: SECRET_DEFAULT, other: 42 }),
      JSON.stringify({ default: SECRET_DEFAULT, other: '  ' }),
      JSON.stringify({ default: { key: SECRET_DEFAULT } }),
    ];
    for (const value of malformed) {
      const env: Env = { ...LIVE_TODAY, SUPABASE_SECRET_KEYS: value };
      expect(readAllowedKeys((name) => env[name]).secretKeysMalformed, value).toBe(true);
      expect(await check(env, both(SECRET_DEFAULT)), value).toMatchObject({
        accepted: false,
        reason: 'no_match',
        secretKeysConfigured: 0,
        secretKeysMalformed: true,
      });
      expect(await check(env, both(LEGACY)), value).toMatchObject({ accepted: true, keyKind: 'legacy_service_role' });
    }
  });

  it('treats an empty object or a blank SUPABASE_SECRET_KEYS as no secret keys, not as malformed', async () => {
    for (const value of ['{}', '', '   ']) {
      const env: Env = { ...LIVE_TODAY, SUPABASE_SECRET_KEYS: value };
      expect(await check(env, both(LEGACY)), JSON.stringify(value)).toMatchObject({
        accepted: true,
        secretKeysConfigured: 0,
        secretKeysMalformed: false,
      });
    }
  });

  it('refuses everyone when no allowed key is configured at all', async () => {
    const emptyConfigurations: Env[] = [
      {},
      { SUPABASE_ANON_KEY: ANON, SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }) },
      { SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: '  ', SUPABASE_SECRET_KEYS: '{}' },
      { SUPABASE_SECRET_KEYS: 'not json' },
    ];
    for (const env of emptyConfigurations) {
      for (const headers of [{}, both(LEGACY), both(''), { apikey: ' ' }, both(ANON)]) {
        expect(await check(env, headers)).toMatchObject({
          accepted: false,
          reason: 'no_allowed_keys',
          keyKind: 'none',
          matchedHeader: 'none',
          legacyServiceRoleKeyConfigured: false,
          secretKeysConfigured: 0,
        });
      }
    }
  });

  it('never returns any part of a key in the verdict', async () => {
    for (const key of ALL_KEYS) {
      const verdict = JSON.stringify(await check(WITH_NEW_KEYS, both(key)));
      for (const secret of ALL_KEYS) {
        for (const fragment of keyFragments(secret)) {
          expect(verdict).not.toContain(fragment);
        }
      }
    }
  });
});

describe('logCallerVerdict', () => {
  function logger() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }

  /** The verdicts a logger method logged, parsed from `[publish-queue] caller accepted|refused {...}`. */
  function loggedVerdicts(spy: { mock: { calls: unknown[][] } }, outcome: 'accepted' | 'refused'): Record<string, unknown>[] {
    const prefix = `[publish-queue] caller ${outcome} `;
    return spy.mock.calls
      .filter((call) => call.length === 1 && typeof call[0] === 'string' && call[0].startsWith(prefix))
      .map((call) => JSON.parse((call[0] as string).slice(prefix.length)) as Record<string, unknown>);
  }

  it('writes each verdict on a single line', async () => {
    const log = logger();
    logCallerVerdict(await check(LIVE_TODAY, both(LEGACY)), { method: 'POST', enforced: false }, log);

    expect(log.info).toHaveBeenCalledWith(
      '[publish-queue] caller accepted {"reason":"matched","keyKind":"legacy_service_role","matchedHeader":"both","presented":"both","method":"POST","enforced":false,"legacyServiceRoleKeyConfigured":true,"secretKeysConfigured":0}',
    );
  });

  it('logs an accepted caller as info with labels only', async () => {
    const log = logger();
    logCallerVerdict(await check(LIVE_TODAY, both(LEGACY)), { method: 'POST', enforced: false }, log);

    expect(loggedVerdicts(log.info, 'accepted')).toContainEqual({
      reason: 'matched',
      keyKind: 'legacy_service_role',
      matchedHeader: 'both',
      presented: 'both',
      method: 'POST',
      enforced: false,
      legacyServiceRoleKeyConfigured: true,
      secretKeysConfigured: 0,
    });
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs a refused caller as a warning', async () => {
    const log = logger();
    logCallerVerdict(await check(LIVE_TODAY, both(ANON)), { method: 'POST', enforced: false }, log);

    expect(loggedVerdicts(log.warn, 'refused')).toContainEqual(expect.objectContaining({ reason: 'no_match', keyKind: 'none' }));
    expect(log.info).not.toHaveBeenCalled();
  });

  it('logs an error when no allowed key is configured', async () => {
    const log = logger();
    logCallerVerdict(await check({}, both(LEGACY)), { method: 'POST', enforced: false }, log);

    expect(loggedVerdicts(log.error, 'refused')).toContainEqual(expect.objectContaining({ reason: 'no_allowed_keys' }));
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('logs an error when SUPABASE_SECRET_KEYS is malformed, without its contents', async () => {
    const log = logger();
    const env: Env = { ...LIVE_TODAY, SUPABASE_SECRET_KEYS: `{"default": "${SECRET_DEFAULT}"` };
    logCallerVerdict(await check(env, both(LEGACY)), { method: 'GET', enforced: false }, log);

    expect(log.error).toHaveBeenCalledWith('[publish-queue] SUPABASE_SECRET_KEYS is not a JSON object of named keys; it added no key');
    expect(loggedVerdicts(log.info, 'accepted')).toContainEqual(expect.objectContaining({ method: 'GET' }));
  });

  it('never logs any part of a key or token', async () => {
    const log = logger();
    const environments: Env[] = [LIVE_TODAY, WITH_NEW_KEYS, {}, { ...LIVE_TODAY, SUPABASE_SECRET_KEYS: `[${JSON.stringify(SECRET_DEFAULT)}]` }];
    for (const env of environments) {
      for (const key of [...ALL_KEYS, '']) {
        for (const headers of [both(key), { apikey: key }, { Authorization: `Bearer ${key}` }, { Authorization: key }]) {
          logCallerVerdict(await check(env, headers), { method: 'POST', enforced: false }, log);
        }
      }
    }

    const logged = inspect([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls], { depth: 10 });
    expect(log.info).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
    for (const key of ALL_KEYS) {
      for (const fragment of keyFragments(key)) {
        expect(logged).not.toContain(fragment);
      }
    }
  });
});
