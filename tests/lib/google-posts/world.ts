import { vi } from 'vitest';

import type { GoogleAccessTokenResult } from '@/lib/connections/google-token';
import type { GooglePostsDeps } from '@/lib/google-posts/deps';
import type { ManagementEventClient } from '@/lib/google-posts/management-lookup';

import { InMemoryGooglePostsDb } from '../../helpers/in-memory-google-posts-db';

/**
 * A small world for Google version tests: one brand with Google switched on
 * and connected, a fake clock, a fake Google (fetch) and a fake token source.
 * Mocks only: nothing here reaches Google, the management app or Supabase.
 */

export const ACCOUNT = '11111111-1111-4111-8111-111111111111';
export const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222';
export const CONNECTION = '33333333-3333-4333-8333-333333333333';
export const OTHER_CONNECTION = '44444444-4444-4444-8444-444444444444';
export const PARENT = 'accounts/111/locations/999';
export const OTHER_PARENT = 'accounts/222/locations/888';
export const CONNECTED_AT = '2026-11-10T09:00:00.000Z';
export const ACCESS_TOKEN = 'ya29.secret-access-token';

export interface FakeClock {
  now: () => Date;
  set: (iso: string) => void;
  advance: (ms: number) => void;
}

export function fakeClock(start: string): FakeClock {
  let current = Date.parse(start);
  return {
    now: () => new Date(current),
    set: (iso) => {
      current = Date.parse(iso);
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

export type GoogleHandler = (request: { method: string; url: string; body: unknown; token: string | null }) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function googleError(status: number, message: string, googleStatus = 'INVALID_ARGUMENT'): Response {
  return json({ error: { code: status, message, status: googleStatus } }, status);
}

export interface World {
  db: InMemoryGooglePostsDb;
  clock: FakeClock;
  deps: GooglePostsDeps;
  fetch: ReturnType<typeof vi.fn>;
  /** Every Google request, in order. */
  google: Array<{ method: string; url: string; body: unknown; token: string | null }>;
  setGoogle: (handler: GoogleHandler) => void;
  token: ReturnType<typeof vi.fn>;
  management: { list: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn> };
  sleep: ReturnType<typeof vi.fn>;
}

export function createWorld({ start = '2026-11-16T10:00:00.000Z', connectedAt = CONNECTED_AT as string | null } = {}): World {
  const db = new InMemoryGooglePostsDb();
  const clock = fakeClock(start);
  db.clock = clock.now;
  const google: World['google'] = [];
  let handler: GoogleHandler = () => googleError(500, 'no handler set', 'INTERNAL');

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const auth = headers.get('Authorization');
    const request = {
      method: init?.method ?? 'GET',
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      token: auth ? auth.replace(/^Bearer /, '') : null,
    };
    google.push(request);
    return handler(request);
  });

  const token = vi.fn(async (): Promise<GoogleAccessTokenResult> => ({
    ok: true,
    accessToken: ACCESS_TOKEN,
    expiresAt: '2026-11-16T11:00:00.000Z',
    refreshed: false,
  }));

  const management = { list: vi.fn(), detail: vi.fn() };
  const sleep = vi.fn(async () => {});

  db.seed('accounts', [
    { id: ACCOUNT, business_name: 'Test Pub', google_posts_enabled: true, management_import_enabled: false },
    { id: OTHER_ACCOUNT, business_name: 'Other Pub', google_posts_enabled: false },
  ]);
  db.seed('social_connections', [
    {
      id: CONNECTION,
      account_id: ACCOUNT,
      provider: 'gbp',
      status: 'active',
      platform_account_id: PARENT,
      metadata: { localPostParent: PARENT, locationTitle: 'Test Pub', placeId: 'place-1', ...(connectedAt ? { connectedAt } : {}) },
    },
  ]);

  const deps: GooglePostsDeps = {
    db: db.client(),
    fetch: fetchMock as unknown as typeof fetch,
    now: clock.now,
    sleep,
    random: () => 0.5,
    getAccessToken: token,
    management: management as unknown as ManagementEventClient,
  };

  return {
    db,
    clock,
    deps,
    fetch: fetchMock,
    google,
    setGoogle: (next) => {
      handler = next;
    },
    token,
    management,
    sleep,
  };
}

let counter = 0;
/** A uuid that is readable in a failing test. */
export function id(prefix: number): string {
  counter += 1;
  const tail = String(counter).padStart(12, '0');
  return `${String(prefix).padStart(8, '0')}-0000-4000-8000-${tail}`;
}

export interface PostOptions {
  account?: string;
  campaignId?: string | null;
  platform?: string;
  placement?: string;
  status?: string;
  scheduledFor?: string | null;
  createdAt?: string;
  deletedAt?: string | null;
  body?: string | null;
  mediaIds?: string[];
}

/** A Facebook feed post (by default) with its copy. Returns its id. */
export function addPost(world: World, options: PostOptions = {}): string {
  const postId = id(1);
  world.db.seed('content_items', [
    {
      id: postId,
      account_id: options.account ?? ACCOUNT,
      campaign_id: options.campaignId ?? null,
      platform: options.platform ?? 'facebook',
      placement: options.placement ?? 'feed',
      status: options.status ?? 'scheduled',
      scheduled_for: options.scheduledFor === undefined ? '2026-11-20T18:00:00.000Z' : options.scheduledFor,
      deleted_at: options.deletedAt ?? null,
      created_at: options.createdAt ?? '2026-11-12T09:00:00.000Z',
    },
  ]);
  world.db.seed('content_variants', [
    {
      content_item_id: postId,
      body: options.body === undefined ? 'Quiz night this Thursday from 8pm. Teams of up to six. #quiz' : options.body,
      media_ids: options.mediaIds ?? [],
    },
  ]);
  return postId;
}

export function addCampaign(
  world: World,
  { type = 'event', name = 'Quiz Night', metadata = {} as Record<string, unknown>, account = ACCOUNT } = {},
): string {
  const campaignId = id(2);
  world.db.seed('campaigns', [{ id: campaignId, account_id: account, name, campaign_type: type, metadata }]);
  return campaignId;
}

export function addImage(
  world: World,
  { mediaType = 'image', mime = 'image/jpeg' as string | null, size = 200_000 as number | null, path = 'acc/quiz.jpg', derived = {} as Record<string, unknown> } = {},
): string {
  const mediaId = id(3);
  world.db.seed('media_assets', [
    {
      id: mediaId,
      account_id: ACCOUNT,
      storage_path: path,
      media_type: mediaType,
      mime_type: mime,
      size_bytes: size,
      derived_variants: derived,
    },
  ]);
  return mediaId;
}

/** Everything written to the console, joined: for "no secret in any log" checks. */
export function consoleText(): string {
  return [console.error, console.warn, console.log, console.info]
    .flatMap((fn) => (vi.isMockFunction(fn) ? fn.mock.calls.flat() : []))
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join('\n');
}
