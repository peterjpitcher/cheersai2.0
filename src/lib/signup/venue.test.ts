import { beforeEach, describe, expect, it, vi } from 'vitest';

type AuthAnswer = { data: { user: unknown }; error: { name?: string; status?: number; code?: string; message: string } | null };
const mockGetUser = vi.fn<() => Promise<AuthAnswer>>();
const mockGetSession = vi.fn<() => Promise<{ data: { session: { access_token: string } | null } }>>();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: () => mockGetUser(), getSession: () => mockGetSession() } }),
}));
const mockAfterPassword = vi.fn<() => Promise<string>>(async () => '/settings#billing');
vi.mock('@/lib/billing/setup-redirect', () => ({ destinationAfterPasswordSet: () => mockAfterPassword() }));

const {
  amrMethods,
  destinationForMember,
  markSignupVerified,
  parseProvisionOutcome,
  provisionSelfServeBrand,
  readSignedInLogin,
  readVenueSignupState,
} = await import('@/lib/signup/venue');
const { storedBusinessType, venueNameHasLink, VENUE_TYPES } = await import('@/lib/signup/venue-form');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part(claims)}.signature`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: token({ amr: [{ method: 'invite', timestamp: 1 }] }) } } });
});

describe('readSignedInLogin', () => {
  it('reads the login from the verified session, lower-cased, with how the session was opened', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: 'Owner@Venue.test', email_confirmed_at: '2026-09-28T09:00:00Z' } },
      error: null,
    });
    expect(await readSignedInLogin()).toEqual({
      status: 'signed_in',
      user: { id: USER_ID, email: 'owner@venue.test', emailConfirmed: true, cameFromInviteLink: true },
    });
  });

  it('an unconfirmed login is marked as such', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID, email: 'a@b.test', email_confirmed_at: null } }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: token({ amr: [{ method: 'password' }] }) } } });
    const login = await readSignedInLogin();
    expect(login).toMatchObject({ status: 'signed_in', user: { emailConfirmed: false, cameFromInviteLink: false } });
  });

  it.each([
    [{ name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' }],
    [{ status: 403, code: 'user_not_found', message: 'User from sub claim in JWT does not exist' }],
    [{ status: 403, code: 'session_not_found', message: 'Session not found' }],
    [{ status: 401, message: 'invalid JWT' }],
  ])('treats %o as signed out', async (error) => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error });
    expect(await readSignedInLogin()).toEqual({ status: 'signed_out' });
  });

  it('a network failure or outage is "unavailable", never signed out', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { status: 503, message: 'upstream down' } });
    expect(await readSignedInLogin()).toMatchObject({ status: 'unavailable' });
    mockGetUser.mockRejectedValue(new Error('fetch failed'));
    expect(await readSignedInLogin()).toEqual({ status: 'unavailable', error: 'fetch failed' });
  });
});

describe('amrMethods', () => {
  it('reads the methods and ignores anything malformed', () => {
    expect(amrMethods(token({ amr: [{ method: 'invite' }, { method: 'password' }, { nope: 1 }] }))).toEqual(['invite', 'password']);
    expect(amrMethods(token({}))).toEqual([]);
    expect(amrMethods('not-a-token')).toEqual([]);
    expect(amrMethods(null)).toEqual([]);
  });
});

describe('readVenueSignupState and markSignupVerified', () => {
  function service(answers: { members?: unknown; signup?: unknown; memberError?: string; signupError?: string; updateError?: string }) {
    const filters: Array<[string, string, unknown]> = [];
    const update = vi.fn();
    return {
      filters,
      update,
      client: {
        from: (table: string) => {
          const chain: Record<string, unknown> = {};
          chain.select = () => chain;
          chain.update = (values: unknown) => {
            update(table, values);
            return chain;
          };
          chain.eq = (column: string, value: unknown) => {
            filters.push([table, column, value]);
            return chain;
          };
          chain.is = (column: string, value: unknown) => {
            filters.push([table, `is:${column}`, value]);
            return Promise.resolve({ error: answers.updateError ? { message: answers.updateError } : null });
          };
          chain.limit = async () => ({ data: answers.members ?? [], error: answers.memberError ? { message: answers.memberError } : null });
          chain.maybeSingle = async () => ({ data: answers.signup ?? null, error: answers.signupError ? { message: answers.signupError } : null });
          return chain;
        },
      } as never,
    };
  }

  it('reads membership and the sign-up row, both scoped to the user id', async () => {
    const db = service({ members: [{ account_id: ACCOUNT_ID }], signup: { account_id: ACCOUNT_ID, verified_at: 'v', venue_created_at: 'c' } });
    expect(await readVenueSignupState(db.client, USER_ID)).toEqual({
      isMember: true,
      signup: { accountId: ACCOUNT_ID, verifiedAt: 'v', venueCreatedAt: 'c' },
    });
    expect(db.filters).toEqual([
      ['account_members', 'user_id', USER_ID],
      ['self_serve_signups', 'user_id', USER_ID],
    ]);
  });

  it('no row and no brand', async () => {
    expect(await readVenueSignupState(service({}).client, USER_ID)).toEqual({ isMember: false, signup: null });
  });

  it('throws on either read failing', async () => {
    await expect(readVenueSignupState(service({ memberError: 'boom' }).client, USER_ID)).rejects.toThrow(/account_members/);
    await expect(readVenueSignupState(service({ signupError: 'boom' }).client, USER_ID)).rejects.toThrow(/self_serve_signups/);
  });

  it('sets verified_at once, for this user only', async () => {
    const db = service({});
    await markSignupVerified(db.client, USER_ID);
    expect(db.update).toHaveBeenCalledWith('self_serve_signups', { verified_at: expect.any(String) });
    expect(db.filters).toEqual([
      ['self_serve_signups', 'user_id', USER_ID],
      ['self_serve_signups', 'is:verified_at', null],
    ]);
    await expect(markSignupVerified(service({ updateError: 'timeout' }).client, USER_ID)).rejects.toThrow(/verified_at/);
  });
});

describe('destinationForMember', () => {
  const user = { id: USER_ID, email: 'a@b.test', emailConfirmed: true, cameFromInviteLink: true };

  it('an invited member who arrived by an invite link, with no venue from this sign-up, chooses a password', async () => {
    expect(await destinationForMember(user, null)).toBe('/auth/set-password');
    expect(await destinationForMember(user, { accountId: null, verifiedAt: null, venueCreatedAt: null })).toBe('/auth/set-password');
  });

  it('the owner of the venue this sign-up made, or someone signed in with a password, goes to Billing or the planner', async () => {
    expect(await destinationForMember(user, { accountId: ACCOUNT_ID, verifiedAt: 'v', venueCreatedAt: 'c' })).toBe('/settings#billing');
    expect(await destinationForMember({ ...user, cameFromInviteLink: false }, null)).toBe('/settings#billing');
  });
});

describe('parseProvisionOutcome and provisionSelfServeBrand', () => {
  it('accepts only answers it knows', () => {
    expect(parseProvisionOutcome({ status: 'created', account_id: ACCOUNT_ID })).toEqual({ status: 'created', accountId: ACCOUNT_ID });
    expect(parseProvisionOutcome({ status: 'existing', account_id: ACCOUNT_ID })).toEqual({ status: 'existing', accountId: ACCOUNT_ID });
    for (const status of ['closed', 'no_login', 'venue_closed', 'member', 'email_mismatch']) {
      expect(parseProvisionOutcome({ status })).toEqual({ status });
    }
    expect(parseProvisionOutcome({ status: 'created' })).toBeNull();
    expect(parseProvisionOutcome({ status: 'created', account_id: 'x' })).toBeNull();
    expect(parseProvisionOutcome({ status: 'no_signup' })).toBeNull();
    expect(parseProvisionOutcome(null)).toBeNull();
    expect(parseProvisionOutcome('created')).toBeNull();
  });

  it('throws on a database error or an unknown answer', async () => {
    const args = { userId: USER_ID, venueName: 'V', businessType: 'pub', email: 'a@b.test', legalVersion: '1' };
    const failing = { rpc: async () => ({ data: null, error: { code: '57014', message: 'statement timeout' } }) } as never;
    await expect(provisionSelfServeBrand(failing, args)).rejects.toThrow(/57014 statement timeout/);
    const odd = { rpc: async () => ({ data: { status: 'what' }, error: null }) } as never;
    await expect(provisionSelfServeBrand(odd, args)).rejects.toThrow(/does not expect/);
  });
});

describe('venue form rules', () => {
  it('stores the type for each choice, with "hospitality venue" for Other', () => {
    expect(VENUE_TYPES.map((type) => [type.value, storedBusinessType(type.value)])).toEqual([
      ['pub', 'pub'],
      ['bar', 'bar'],
      ['restaurant', 'restaurant'],
      ['cafe', 'cafe'],
      ['hotel', 'hotel'],
      ['other', 'hospitality venue'],
    ]);
    // Every stored value fits brand_profile.business_type (at most 60 characters).
    for (const type of VENUE_TYPES) expect(type.stored.length).toBeLessThanOrEqual(60);
  });

  it('spots links and email addresses in a venue name', () => {
    for (const name of ['http://x.test', 'HTTPS://X.TEST', 'www.pub.test', 'WWW.PUB', 'a@b']) expect(venueNameHasLink(name)).toBe(true);
    for (const name of ["The King's Head", 'Fish & Chips Co.', 'Bar 2:30']) expect(venueNameHasLink(name)).toBe(false);
  });
});
