import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventLookup, loadManagementConfig, type ManagementEventClient } from '@/lib/google-posts/management-lookup';

import { ACCOUNT, createWorld, type World } from './world';

const config = { baseUrl: 'https://management.example', apiKey: 'mgmt-key' };
const detail = { id: 'evt-1', name: 'Quiz', date: '2026-11-19', time: '20:00', end_time: '22:30', booking_url: 'https://book.example/q' };
const query = { managementEventId: null, name: 'Quiz', date: '2026-11-19', time: '20:00' };

let client: { list: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn> };
let sleep: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>;

function lookup(options: { maxCalls?: number; canCall?: () => boolean } = {}) {
  return createEventLookup({ config, client: client as unknown as ManagementEventClient, sleep, accountId: ACCOUNT, ...options });
}

beforeEach(() => {
  client = { list: vi.fn(async () => [{ id: 'evt-1', name: 'Quiz', date: '2026-11-19', time: '20:00:00' }]), detail: vi.fn(async () => detail) };
  sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('createEventLookup', () => {
  it('matches on name, date and time, and reads the end from the event', async () => {
    const result = await lookup().find(query);
    expect(result).toEqual({
      status: 'matched',
      event: expect.objectContaining({ managementEventId: 'evt-1', start: '2026-11-19T20:00:00.000+00:00', end: '2026-11-19T22:30:00.000+00:00', takesBookings: true }),
    });
  });

  it('goes straight to the event when its id is already known', async () => {
    await lookup().find({ ...query, managementEventId: 'evt-1' });
    expect(client.list).not.toHaveBeenCalled();
    expect(client.detail).toHaveBeenCalledWith(config, 'evt-1');
  });

  it('does not match without a name, date and time', async () => {
    expect(await lookup().find({ ...query, time: null })).toMatchObject({ status: 'not_matched' });
    expect(client.list).not.toHaveBeenCalled();
  });

  it('reads each event once a run', async () => {
    const one = lookup();
    await Promise.all([one.find(query), one.find(query)]);
    await one.find(query);
    expect(client.list).toHaveBeenCalledTimes(1);
    expect(client.detail).toHaveBeenCalledTimes(1);
  });

  it('defers once the call limit or the time is used up, and is not remembered', async () => {
    const capped = lookup({ maxCalls: 1 });
    expect(await capped.find(query)).toEqual({ status: 'deferred' });
    expect(capped.calls()).toBe(1);
    let allowed = false;
    const timed = lookup({ canCall: () => allowed });
    expect(await timed.find(query)).toEqual({ status: 'deferred' });
    allowed = true;
    expect(await timed.find(query)).toMatchObject({ status: 'matched' });
  });

  it('waits a second between calls', async () => {
    await lookup().find(query);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('treats a missing or failing event as not matched', async () => {
    client.detail.mockRejectedValue(Object.assign(new Error('Management event not found'), { code: 'NOT_FOUND', status: 404 }));
    expect(await lookup().find(query)).toMatchObject({ status: 'not_matched', reason: 'the management app could not be read' });
  });
});

describe('loadManagementConfig', () => {
  let world: World;
  beforeEach(() => {
    world = createWorld();
  });

  it('needs management import switched on and an enabled connection with a key', async () => {
    expect(await loadManagementConfig(world.deps.db, ACCOUNT)).toBeNull();
    world.db.tables.accounts.find((row) => row.id === ACCOUNT)!.management_import_enabled = true;
    world.db.seed('management_app_connections', [{ account_id: ACCOUNT, base_url: 'https://m.example', api_key: ' key ' }]);
    expect(await loadManagementConfig(world.deps.db, ACCOUNT)).toEqual({ baseUrl: 'https://m.example', apiKey: 'key' });
    world.db.tables.management_app_connections[0].enabled = false;
    expect(await loadManagementConfig(world.deps.db, ACCOUNT)).toBeNull();
  });
});
