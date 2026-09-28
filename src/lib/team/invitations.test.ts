import { describe, expect, it, vi } from 'vitest';

import { renderTeamInvitationEmail } from '@/lib/team/invitation-email';
import {
  acceptTeamInvitationForUser,
  getInviteUsage,
  listPendingInvitationsForUser,
  recordTeamInvitation,
  TEAM_INVITES_PER_DAY,
} from '@/lib/team/invitations';

const NOW = new Date('2026-10-25T00:30:00Z'); // the night the clocks go back

function tableService(results: Record<string, { data?: unknown; count?: number; error: unknown }>) {
  const calls: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
  return {
    calls,
    client: {
      from: vi.fn((table: string) => {
        const filters: Array<[string, string, unknown]> = [];
        calls.push({ table, filters });
        const c: Record<string, unknown> = {};
        c.select = vi.fn(() => c);
        c.order = vi.fn(() => c);
        for (const m of ['eq', 'is', 'gt', 'in']) {
          c[m] = vi.fn((column: string, value: unknown) => {
            filters.push([m, column, value]);
            return c;
          });
        }
        c.then = (resolve: (v: unknown) => unknown) => resolve(results[table]);
        return c;
      }),
    },
  };
}

describe('recordTeamInvitation', () => {
  it('always sends the approved daily cap of 5', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'invited', error: null });
    const outcome = await recordTeamInvitation({ rpc } as never, {
      accountId: 'acc',
      userId: 'user',
      role: 'member',
      invitedBy: 'owner',
      seatLimit: null,
      grantAccess: false,
    });
    expect(outcome).toBe('invited');
    expect(TEAM_INVITES_PER_DAY).toBe(5);
    expect(rpc).toHaveBeenCalledWith('record_team_invitation', expect.objectContaining({ p_daily_limit: 5, p_seat_limit: null }));
  });

  it('throws on a database error or an unknown answer', async () => {
    const params = { accountId: 'acc', userId: 'user', role: 'member' as const, invitedBy: 'owner', seatLimit: 2, grantAccess: true };
    await expect(recordTeamInvitation({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'down' } }) } as never, params)).rejects.toThrow(
      /record_team_invitation failed/,
    );
    await expect(recordTeamInvitation({ rpc: vi.fn().mockResolvedValue({ data: 'maybe', error: null }) } as never, params)).rejects.toThrow(
      /unexpected result/,
    );
  });
});

describe('acceptTeamInvitationForUser', () => {
  it('passes the session user id and returns the outcome', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'expired', error: null });
    expect(await acceptTeamInvitationForUser({ rpc } as never, 'inv', 'user')).toBe('expired');
    expect(rpc).toHaveBeenCalledWith('accept_team_invitation', { p_invitation_id: 'inv', p_user_id: 'user' });
  });

  it('throws on a database error', async () => {
    await expect(
      acceptTeamInvitationForUser({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'down' } }) } as never, 'inv', 'user'),
    ).rejects.toThrow();
  });
});

describe('getInviteUsage', () => {
  it('counts the last 24 hours in absolute time, whatever the clocks do', async () => {
    const { client, calls } = tableService({ team_invitations: { count: 3, error: null } });
    expect(await getInviteUsage(client as never, 'acc', NOW)).toEqual({ sentLastDay: 3, openInvitations: 3 });
    const daily = calls[0].filters.find(([m, column]) => m === 'gt' && column === 'created_at');
    expect(daily?.[2]).toBe('2026-10-24T00:30:00.000Z');
    expect(calls.every((call) => call.filters.some(([m, column, value]) => m === 'eq' && column === 'account_id' && value === 'acc'))).toBe(true);
  });

  it('throws when it cannot count', async () => {
    const { client } = tableService({ team_invitations: { count: 0, error: { message: 'down' } } });
    await expect(getInviteUsage(client as never, 'acc', NOW)).rejects.toThrow();
  });
});

describe('listPendingInvitationsForUser', () => {
  it('lists only this person\'s open invitations, for brands that are still open', async () => {
    const { client, calls } = tableService({
      team_invitations: {
        data: [
          { id: 'i1', account_id: 'live', role: 'owner', expires_at: '2026-10-30T00:00:00Z' },
          { id: 'i2', account_id: 'closed', role: 'member', expires_at: '2026-10-30T00:00:00Z' },
        ],
        error: null,
      },
      accounts: { data: [{ id: 'live', business_name: 'The Anchor' }], error: null },
    });
    const list = await listPendingInvitationsForUser(client as never, 'user-1', NOW);
    expect(list).toEqual([{ id: 'i1', accountId: 'live', brandName: 'The Anchor', role: 'owner', expiresAt: '2026-10-30T00:00:00Z' }]);
    expect(calls[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'user_id', 'user-1'],
        ['is', 'accepted_at', null],
        ['is', 'declined_at', null],
        ['is', 'cancelled_at', null],
        ['gt', 'expires_at', NOW.toISOString()],
      ]),
    );
    expect(calls[1].filters).toEqual(expect.arrayContaining([['is', 'archived_at', null]]));
  });

  it('makes no second query when there is nothing waiting', async () => {
    const { client, calls } = tableService({ team_invitations: { data: [], error: null } });
    expect(await listPendingInvitationsForUser(client as never, 'user-1', NOW)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('throws on a lookup error', async () => {
    const { client } = tableService({ team_invitations: { data: null, error: { message: 'down' } } });
    await expect(listPendingInvitationsForUser(client as never, 'user-1', NOW)).rejects.toThrow();
  });
});

describe('renderTeamInvitationEmail (fixture render)', () => {
  it('names the brand, links to the invitations page and carries no sign-in token', () => {
    const email = renderTeamInvitationEmail({ acceptUrl: 'https://cheers.orangejelly.co.uk/invitations', brandName: 'The Crown & Anchor' });
    for (const bad of ['undefined', 'null', 'NaN', 'Invalid Date', 'href=""']) {
      expect(email.html).not.toContain(bad);
      expect(email.subject).not.toContain(bad);
    }
    expect(email.subject).toBe("You're invited to join The Crown & Anchor on Cheers");
    expect(email.html).toContain('The Crown &amp; Anchor');
    expect(email.html).toContain('href="https://cheers.orangejelly.co.uk/invitations"');
    expect(email.html).toContain('expires in 7 days');
    expect(email.html).not.toContain('token');
  });

  it('escapes a hostile brand name', () => {
    const email = renderTeamInvitationEmail({ acceptUrl: 'https://cheers.orangejelly.co.uk/invitations', brandName: '<a href="https://evil.example">x</a>' });
    expect(email.html).not.toContain('<a href="https://evil.example">');
  });

  it('refuses to render without a link', () => {
    expect(() => renderTeamInvitationEmail({ acceptUrl: '', brandName: 'The Anchor' })).toThrow();
  });
});
