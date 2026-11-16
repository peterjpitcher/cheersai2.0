import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runGooglePostsCron } from '@/lib/google-posts/run';

import { ACCOUNT, addPost, createWorld, json, OTHER_ACCOUNT, PARENT, type World } from './world';

let world: World;

vi.mock('@/lib/google-posts/deps', () => ({
  defaultGooglePostsDeps: vi.fn(async () => world.deps),
}));

beforeEach(() => {
  world = createWorld();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  world.setGoogle(({ method }) => (method === 'POST' ? json({ name: `${PARENT}/localPosts/x`, state: 'PROCESSING' }) : json({})));
});

function enableOtherBrand(): void {
  world.db.tables.accounts.find((row) => row.id === OTHER_ACCOUNT)!.google_posts_enabled = true;
  world.db.seed('social_connections', [
    {
      account_id: OTHER_ACCOUNT,
      provider: 'gbp',
      status: 'active',
      platform_account_id: 'accounts/222/locations/888',
      metadata: { localPostParent: 'accounts/222/locations/888', connectedAt: '2026-11-10T09:00:00.000Z' },
    },
  ]);
}

describe('runGooglePostsCron', () => {
  it('does nothing outside the database when no brand has Google on and connected', async () => {
    world.db.tables.accounts.find((row) => row.id === ACCOUNT)!.google_posts_enabled = false;
    addPost(world, { scheduledFor: '2026-11-16T09:59:00.000Z' });
    const summary = await runGooglePostsCron(world.deps);
    expect(summary.brands).toBe(0);
    expect(world.fetch).not.toHaveBeenCalled();
    expect(world.token).not.toHaveBeenCalled();
    expect(world.db.rows('gbp_posts')).toEqual([]);
  });

  it('ignores a brand switched on but with no active Google connection', async () => {
    world.db.tables.social_connections[0].status = 'needs_action';
    addPost(world);
    const summary = await runGooglePostsCron(world.deps);
    expect(summary.brands).toBe(0);
    expect(world.db.rows('gbp_posts')).toEqual([]);
  });

  it('creates, then sends once the post is due, in later runs', async () => {
    addPost(world, { scheduledFor: '2026-11-16T10:30:00.000Z' });
    const first = await runGooglePostsCron(world.deps);
    expect(first.created).toBe(1);
    expect(first.send.sent).toBe(0);

    world.clock.set('2026-11-16T10:31:00.000Z');
    const second = await runGooglePostsCron(world.deps);
    expect(second.send.sent).toBe(1);
    expect(world.db.rows('gbp_posts')[0].state).toBe('sent');
  });

  it("does not let one brand's failure stop another", async () => {
    enableOtherBrand();
    addPost(world, { scheduledFor: '2026-11-16T10:30:00.000Z' });
    addPost(world, { account: OTHER_ACCOUNT, scheduledFor: '2026-11-16T10:30:00.000Z' });
    // The first brand's candidate read fails; the other brand still gets its version.
    world.db.fail('content_items', 'select', 1);
    const summary = await runGooglePostsCron(world.deps);
    expect(summary.brands).toBe(2);
    expect(summary.stepFailures).toBeGreaterThanOrEqual(1);
    expect(world.db.rows('gbp_posts').map((row) => row.account_id)).toEqual([OTHER_ACCOUNT]);
  });

  it('starts no new work once the time budget is spent', async () => {
    enableOtherBrand();
    addPost(world, { scheduledFor: '2026-11-16T10:30:00.000Z' });
    addPost(world, { account: OTHER_ACCOUNT, scheduledFor: '2026-11-16T10:30:00.000Z' });
    // Every database read moves the clock on by 10 seconds.
    const slow = world.deps.db;
    world.deps.db = new Proxy(slow, {
      get(target, prop, receiver) {
        if (prop === 'from') {
          return (table: string) => {
            world.clock.advance(10_000);
            return target.from(table);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const summary = await runGooglePostsCron(world.deps, { budgetMs: 30_000 });
    expect(summary.outOfTime).toBe(true);
    expect(world.fetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/google-posts', () => {
  const call = async (headers: Record<string, string> = {}) => {
    const { GET } = await import('@/app/api/cron/google-posts/route');
    return GET(new Request('https://cheers.example/api/cron/google-posts', { headers }));
  };

  it('refuses a request without the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    const response = await call();
    expect(response.status).toBe(401);
    const wrong = await call({ Authorization: 'Bearer wrong' });
    expect(wrong.status).toBe(401);
    expect(world.db.queries).toEqual([]);
    vi.unstubAllEnvs();
  });

  it('runs and answers counts only', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    addPost(world, { scheduledFor: '2026-11-16T10:30:00.000Z', body: 'A very particular sentence for the quiz.' });
    const response = await call({ Authorization: 'Bearer test-cron-secret' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ brands: 1, created: 1, stepFailures: 0 });
    expect(JSON.stringify(body)).not.toContain('particular sentence');
    vi.unstubAllEnvs();
  });

  it('answers 500 when a step failed', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    world.db.fail('content_items', 'select', 1);
    const response = await call({ Authorization: 'Bearer test-cron-secret' });
    expect(response.status).toBe(500);
    vi.unstubAllEnvs();
  });
});
