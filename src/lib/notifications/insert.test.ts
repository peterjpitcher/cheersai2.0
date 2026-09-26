import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryNotificationsTable } from '../../../tests/helpers/in-memory-notifications';
import { insertNotification } from './insert';

const ACCOUNT_ID = '6f1b1c1e-8c2a-4c47-9a53-1f2e3d4c5b6a';
const CONNECTION_ID = '0b7d4a2e-3f5c-4e61-8a9b-2c3d4e5f6a7b';
const OTHER_CONNECTION_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const HOUR_MS = 60 * 60 * 1000;

let table: InMemoryNotificationsTable;

function client(): SupabaseClient {
  return { from: (name: string) => table.from(name) } as unknown as SupabaseClient;
}

function expiredAlert(overrides: Partial<Parameters<typeof insertNotification>[0]> = {}) {
  return insertNotification({
    supabase: client(),
    accountId: ACCOUNT_ID,
    category: 'connection_expired',
    title: 'Facebook Page token expired',
    body: 'Your Facebook Page connection (The Anchor) has token expired. Reconnect to resume publishing.',
    resourceType: 'connection',
    resourceId: CONNECTION_ID,
    ...overrides,
  });
}

beforeEach(() => {
  table = new InMemoryNotificationsTable();
});

describe('in-memory notifications table matches the live constraints', () => {
  it.each(['account_id', 'message'])('rejects a row without %s', (column) => {
    const row: Record<string, unknown> = { account_id: ACCOUNT_ID, message: 'Headline' };
    delete row[column];

    return expect(table.from('notifications').insert(row)).resolves.toEqual({
      data: null,
      error: expect.objectContaining({ code: '23502', message: expect.stringContaining(`"${column}"`) }),
    });
  });

  it('rejects a resource_id that is not a uuid, and an unknown column', async () => {
    const notUuid = await table.from('notifications').insert({ account_id: ACCOUNT_ID, message: 'x', resource_id: 'conn-1' });
    expect(notUuid.error?.code).toBe('22P02');

    const unknown = await table.from('notifications').insert({ account_id: ACCOUNT_ID, message: 'x', severity: 'high' });
    expect(unknown.error?.code).toBe('PGRST204');
    expect(table.rows).toHaveLength(0);
  });
});

describe('insertNotification', () => {
  it('writes a row the live table accepts, with the headline in message', async () => {
    const result = await expiredAlert();

    expect(result).toEqual({ status: 'inserted' });
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({
      account_id: ACCOUNT_ID,
      category: 'connection_expired',
      urgency: 'urgent',
      message: 'Facebook Page token expired',
      title: 'Facebook Page token expired',
      body: expect.stringContaining('Reconnect to resume publishing'),
      resource_type: 'connection',
      resource_id: CONNECTION_ID,
    });
  });

  it('writes a row when there is no resource to deduplicate on', async () => {
    const result = await expiredAlert({ resourceType: null, resourceId: null, body: null });

    expect(result).toEqual({ status: 'inserted' });
    expect(table.rows[0]).toMatchObject({ message: 'Facebook Page token expired', body: null, resource_id: null });
  });

  it('returns duplicate without inserting when the same alert was recorded in the last 24 hours', async () => {
    table.seed({
      account_id: ACCOUNT_ID,
      category: 'connection_expired',
      message: 'Facebook Page token expired',
      resource_type: 'connection',
      resource_id: CONNECTION_ID,
      created_at: new Date(Date.now() - HOUR_MS).toISOString(),
    });

    await expect(expiredAlert()).resolves.toEqual({ status: 'duplicate' });
    expect(table.rows).toHaveLength(1);
  });

  it('records the alert again once the earlier one is over 24 hours old, or for another connection', async () => {
    table.seed({
      account_id: ACCOUNT_ID,
      category: 'connection_expired',
      message: 'Facebook Page token expired',
      resource_type: 'connection',
      resource_id: CONNECTION_ID,
      created_at: new Date(Date.now() - 25 * HOUR_MS).toISOString(),
    });

    await expect(expiredAlert()).resolves.toEqual({ status: 'inserted' });
    await expect(expiredAlert({ resourceId: OTHER_CONNECTION_ID })).resolves.toEqual({ status: 'inserted' });
    expect(table.rows).toHaveLength(3);
  });

  it('reports a rejected insert as failed, never as a duplicate', async () => {
    table.insertError = 'connection to database lost';

    await expect(expiredAlert()).resolves.toEqual({ status: 'failed', error: 'connection to database lost' });
    expect(table.rows).toHaveLength(0);
  });

  it('reports a failed duplicate check as failed and does not insert', async () => {
    table.selectError = 'statement timeout';

    const result = await expiredAlert();

    expect(result).toEqual({ status: 'failed', error: 'Duplicate check failed: statement timeout' });
    expect(table.rows).toHaveLength(0);
  });
});
