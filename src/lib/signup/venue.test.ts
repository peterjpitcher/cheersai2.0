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
  decideVenueAccess,
  destinationForMember,
  markSignupVerified,
  parseProvisionOutcome,
  provisionSelfServeBrand,
  readSignedInLogin,
  readVenueSignupState,
} = await import('@/lib/signup/venue');
const { hasControlCharacters, storedBusinessType, venueNameHasLink, VENUE_TYPES } = await import('@/lib/signup/venue-form');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part(claims)}.signature`;
}

beforeEach(() => {
  vi.clearAllMocks();
  // What the local stack's Supabase Auth puts in a session opened by an invite or sign-up link.
  mockGetSession.mockResolvedValue({ data: { session: { access_token: token({ amr: [{ method: 'otp', timestamp: 1 }] }) } } });
});

describe('readSignedInLogin', () => {
  it('reads the login from the verified session, lower-cased, with how the session was opened', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: 'Owner@Venue.test', email_confirmed_at: '2026-09-28T09:00:00Z' } },
      error: null,
    });
    expect(await readSignedInLogin()).toEqual({
      status: 'signed_in',
      user: { id: USER_ID, email: 'owner@venue.test', emailConfirmed: true, cameFromEmailLink: true },
    });
  });

  it('an unconfirmed login is marked as such', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID, email: 'a@b.test', email_confirmed_at: null } }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: token({ amr: [{ method: 'password' }] }) } } });
    const login = await readSignedInLogin();
    expect(login).toMatchObject({ status: 'signed_in', user: { emailConfirmed: false, cameFromEmailLink: false } });
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

describe('how the session was opened', () => {
  it.each(['otp', 'invite', 'recovery', 'magiclink'])('an email link recorded as "%s" counts as an email link', async (method) => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID, email: 'a@b.test', email_confirmed_at: 'x' } }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: token({ amr: [{ method }] }) } } });
    expect(await readSignedInLogin()).toMatchObject({ user: { cameFromEmailLink: true } });
  });

  it('a password sign-in does not, and neither does an unreadable session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID, email: 'a@b.test', email_confirmed_at: 'x' } }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: token({ amr: [{ method: 'password' }] }) } } });
    expect(await readSignedInLogin()).toMatchObject({ user: { cameFromEmailLink: false } });
    mockGetSession.mockRejectedValue(new Error('cookie unreadable'));
    expect(await readSignedInLogin()).toMatchObject({ status: 'signed_in', user: { cameFromEmailLink: false } });
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
  type Answer = { data: unknown; error: { message: string } | null };
  /** Table answers, plus a log of every filter, so scoping by user id can be checked. */
  function service(answers: Partial<Record<string, Answer>>, updateError?: string) {
    const filters: Array<[string, string, unknown]> = [];
    const update = vi.fn();
    const answer = (table: string): Answer => answers[table] ?? { data: table === 'self_serve_signups' || table === 'app_admins' ? null : [], error: null };
    return {
      filters,
      update,
      client: {
        from: (table: string) => {
          let updating = false;
          const chain: Record<string, unknown> = {};
          chain.select = () => chain;
          chain.update = (values: unknown) => {
            updating = true;
            update(table, values);
            return chain;
          };
          for (const method of ['eq', 'in', 'gt']) {
            chain[method] = (column: string, value: unknown) => {
              filters.push([table, method === 'eq' ? column : `${method}:${column}`, value]);
              return chain;
            };
          }
          chain.is = (column: string, value: unknown) => {
            filters.push([table, `is:${column}`, value]);
            if (updating) return Promise.resolve({ error: updateError ? { message: updateError } : null });
            return chain;
          };
          chain.maybeSingle = async () => answer(table);
          chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(answer(table)).then(resolve, reject);
          return chain;
        },
      } as never,
    };
  }

  it('reads memberships (and which are live), admin, open invitations and the sign-up row, all scoped to the user', async () => {
    const ARCHIVED = '44444444-4444-4444-8444-444444444444';
    const INVITED = '55555555-5555-4555-8555-555555555555';
    const db = service({
      account_members: { data: [{ account_id: ACCOUNT_ID }, { account_id: ARCHIVED }], error: null },
      app_admins: { data: null, error: null },
      team_invitations: { data: [{ account_id: INVITED }], error: null },
      accounts: { data: [{ id: ACCOUNT_ID }, { id: INVITED }], error: null },
      self_serve_signups: { data: { account_id: ACCOUNT_ID, verified_at: 'v', venue_created_at: 'c' }, error: null },
    });
    expect(await readVenueSignupState(db.client, USER_ID)).toEqual({
      memberships: [
        { accountId: ACCOUNT_ID, usable: true },
        { accountId: ARCHIVED, usable: false },
      ],
      isAdmin: false,
      hasOpenInvitation: true,
      signup: { accountId: ACCOUNT_ID, verifiedAt: 'v', venueCreatedAt: 'c' },
    });
    for (const table of ['account_members', 'app_admins', 'team_invitations', 'self_serve_signups']) {
      expect(db.filters).toContainEqual([table, 'user_id', USER_ID]);
    }
    // Only open, unexpired invitations; only the login's own brands are looked up.
    expect(db.filters).toContainEqual(['team_invitations', 'is:accepted_at', null]);
    expect(db.filters).toContainEqual(['team_invitations', 'is:declined_at', null]);
    expect(db.filters).toContainEqual(['team_invitations', 'is:cancelled_at', null]);
    expect(db.filters.some(([table, column]) => table === 'team_invitations' && column === 'gt:expires_at')).toBe(true);
    expect(db.filters).toContainEqual(['accounts', 'in:id', [ACCOUNT_ID, ARCHIVED, INVITED]]);
    expect(db.filters).toContainEqual(['accounts', 'is:archived_at', null]);
  });

  it('an invitation to an archived brand does not count', async () => {
    const db = service({
      team_invitations: { data: [{ account_id: ACCOUNT_ID }], error: null },
      accounts: { data: [], error: null },
    });
    expect((await readVenueSignupState(db.client, USER_ID)).hasOpenInvitation).toBe(false);
  });

  it('an admin is marked as one', async () => {
    const db = service({ app_admins: { data: { user_id: USER_ID }, error: null } });
    expect((await readVenueSignupState(db.client, USER_ID)).isAdmin).toBe(true);
  });

  it('no row, no brand, not an admin, no invitation, and no brands read', async () => {
    const db = service({});
    expect(await readVenueSignupState(db.client, USER_ID)).toEqual({ memberships: [], isAdmin: false, hasOpenInvitation: false, signup: null });
    expect(db.filters.some(([table]) => table === 'accounts')).toBe(false);
  });

  it.each(['account_members', 'app_admins', 'team_invitations', 'self_serve_signups'])('throws when %s cannot be read', async (table) => {
    const db = service({ [table]: { data: null, error: { message: 'boom' } } });
    await expect(readVenueSignupState(db.client, USER_ID)).rejects.toThrow(table);
  });

  it('throws when the brands cannot be read', async () => {
    const db = service({
      account_members: { data: [{ account_id: ACCOUNT_ID }], error: null },
      accounts: { data: null, error: { message: 'boom' } },
    });
    await expect(readVenueSignupState(db.client, USER_ID)).rejects.toThrow(/accounts/);
  });

  it('sets verified_at once, for this user only', async () => {
    const db = service({});
    await markSignupVerified(db.client, USER_ID);
    expect(db.update).toHaveBeenCalledWith('self_serve_signups', { verified_at: expect.any(String) });
    expect(db.filters).toEqual([
      ['self_serve_signups', 'user_id', USER_ID],
      ['self_serve_signups', 'is:verified_at', null],
    ]);
    await expect(markSignupVerified(service({}, 'timeout').client, USER_ID)).rejects.toThrow(/verified_at/);
  });
});

describe('decideVenueAccess', () => {
  const OTHER = '66666666-6666-4666-8666-666666666666';
  const base = { memberships: [], isAdmin: false, hasOpenInvitation: false, signup: null };
  const ownRow = { accountId: ACCOUNT_ID, verifiedAt: 'v', venueCreatedAt: 'c' };

  it.each<[string, Parameters<typeof decideVenueAccess>[0], string]>([
    ['nobody special', base, 'form'],
    ['a sign-up row with no venue', { ...base, signup: { accountId: null, verifiedAt: 'v', venueCreatedAt: null } }, 'form'],
    ['the venue this sign-up made, still a live member', { ...base, memberships: [{ accountId: ACCOUNT_ID, usable: true }], signup: ownRow }, 'own_venue'],
    ['the venue this sign-up made, archived', { ...base, memberships: [{ accountId: ACCOUNT_ID, usable: false }], signup: ownRow }, 'venue_closed'],
    ['removed from the venue this sign-up made', { ...base, signup: ownRow }, 'removed'],
    ['removed, but a member of another live brand', { ...base, memberships: [{ accountId: OTHER, usable: true }], signup: ownRow }, 'member'],
    ['a venue made and deleted', { ...base, signup: { accountId: null, verifiedAt: 'v', venueCreatedAt: 'c' } }, 'venue_closed'],
    ['a member of a live brand', { ...base, memberships: [{ accountId: OTHER, usable: true }] }, 'member'],
    ['a member of only archived brands', { ...base, memberships: [{ accountId: OTHER, usable: false }] }, 'member_no_brand'],
    ['an admin', { ...base, isAdmin: true }, 'admin'],
    ['someone with an open invitation', { ...base, hasOpenInvitation: true }, 'invited'],
    ['a member with an invitation (member wins)', { ...base, memberships: [{ accountId: OTHER, usable: true }], hasOpenInvitation: true }, 'member'],
  ])('%s: %s', (_label, state, expected) => {
    expect(decideVenueAccess(state)).toBe(expected);
  });
});

describe('destinationForMember', () => {
  const user = { id: USER_ID, email: 'a@b.test', emailConfirmed: true, cameFromEmailLink: true };

  it('an invited member who arrived by an email link, with no venue from this sign-up, chooses a password', async () => {
    expect(await destinationForMember(user, null)).toBe('/auth/set-password');
    expect(await destinationForMember(user, { accountId: null, verifiedAt: null, venueCreatedAt: null })).toBe('/auth/set-password');
  });

  it('the owner of the venue this sign-up made, or someone signed in with a password, goes to Billing or the planner', async () => {
    expect(await destinationForMember(user, { accountId: ACCOUNT_ID, verifiedAt: 'v', venueCreatedAt: 'c' })).toBe('/settings#billing');
    expect(await destinationForMember({ ...user, cameFromEmailLink: false }, null)).toBe('/settings#billing');
  });
});

describe('parseProvisionOutcome and provisionSelfServeBrand', () => {
  it('accepts only answers it knows', () => {
    expect(parseProvisionOutcome({ status: 'created', account_id: ACCOUNT_ID })).toEqual({ status: 'created', accountId: ACCOUNT_ID });
    expect(parseProvisionOutcome({ status: 'existing', account_id: ACCOUNT_ID })).toEqual({ status: 'existing', accountId: ACCOUNT_ID });
    for (const status of ['closed', 'no_login', 'venue_closed', 'member', 'email_mismatch', 'removed', 'admin', 'invited', 'unconfirmed']) {
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

  it('refuses the same control characters as the database, including U+0085 (next line)', () => {
    for (const text of ['a\nb', 'a\tb', 'a\u0000b', 'a\u007fb', 'a\u0085b', 'a\u009fb']) expect(hasControlCharacters(text), JSON.stringify(text)).toBe(true);
    // Not controls: a no-break space, a zero-width space, accents and emoji.
    for (const text of ['Caf\u00e9 du Parc', 'a\u00a0b', 'a\u200bb', 'The \u{1F37A} Bar']) expect(hasControlCharacters(text), JSON.stringify(text)).toBe(false);
  });
});
