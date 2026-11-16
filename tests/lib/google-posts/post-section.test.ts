import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/server', () => ({ requireAuthContext: vi.fn() }));

import { readGooglePostSection } from '@/lib/google-posts/post-section';

import { ACCOUNT, addPost, createWorld, OTHER_ACCOUNT, PARENT, type World } from './world';

let world: World;

function context(googlePosts = true, accountId = ACCOUNT) {
  return { supabase: world.deps.db, accountId, features: { googlePosts } };
}

function addVersion(postId: string, overrides: Record<string, unknown> = {}, account = ACCOUNT): void {
  world.db.seed('gbp_posts', [
    { account_id: account, content_item_id: postId, local_post_parent: PARENT, state: 'pending', summary: 'Quiz night.', ...overrides },
  ]);
}

beforeEach(() => {
  world = createWorld();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the Google section of the post page', () => {
  it('reads nothing for a brand without the switch in its session', async () => {
    const postId = addPost(world);
    addVersion(postId);
    world.db.queries.length = 0;

    const section = await readGooglePostSection(context(false), { id: postId, platform: 'facebook', placement: 'feed' });

    expect(section).toEqual({ kind: 'hidden' });
    expect(world.db.queries).toEqual([]);
  });

  it.each([
    ['instagram', 'feed'],
    ['facebook', 'story'],
  ])('reads nothing for a %s %s post, which cannot have a Google version', async (platform, placement) => {
    const postId = addPost(world, { platform, placement } as never);
    world.db.queries.length = 0;

    const section = await readGooglePostSection(context(), { id: postId, platform, placement });

    expect(section).toEqual({ kind: 'hidden' });
    expect(world.db.queries).toEqual([]);
  });

  it('shows the version, with its plain words, when the switch is on and Google is connected', async () => {
    const postId = addPost(world);
    addVersion(postId, { summary_edited_at: null });

    const section = await readGooglePostSection(context(), { id: postId, platform: 'facebook', placement: 'feed' });

    expect(section.kind).toBe('ready');
    if (section.kind !== 'ready') return;
    expect(section.version).toMatchObject({
      contentItemId: postId,
      state: 'pending',
      summary: 'Quiz night.',
      summaryEdited: false,
      canEdit: true,
      canSkip: true,
    });
  });

  it('shows the section with no version for a Facebook feed post that has none', async () => {
    const postId = addPost(world);

    const section = await readGooglePostSection(context(), { id: postId, platform: 'facebook', placement: 'feed' });

    expect(section).toEqual({ kind: 'ready', version: null });
  });

  it('never shows another brand its version', async () => {
    const postId = addPost(world, { account: OTHER_ACCOUNT });
    addVersion(postId, {}, OTHER_ACCOUNT);

    const section = await readGooglePostSection(context(), { id: postId, platform: 'facebook', placement: 'feed' });

    expect(section).toEqual({ kind: 'ready', version: null });
  });

  it('asks for a reconnect when the Google connection needs action, still showing the version', async () => {
    const postId = addPost(world);
    addVersion(postId);
    world.db.tables.social_connections[0].status = 'needs_action';

    const section = await readGooglePostSection(context(), { id: postId, platform: 'facebook', placement: 'feed' });

    expect(section.kind).toBe('reconnect');
    if (section.kind !== 'reconnect') return;
    expect(section.version?.contentItemId).toBe(postId);
  });

  it('asks for a reconnect when there is no Google connection at all', async () => {
    const postId = addPost(world);
    world.db.tables.social_connections.length = 0;

    const section = await readGooglePostSection(context(), { id: postId, platform: 'facebook', placement: 'feed' });

    expect(section).toEqual({ kind: 'reconnect', version: null });
  });

  it('hides the section when the switch was turned off since the session was read', async () => {
    const postId = addPost(world);
    addVersion(postId);
    world.db.tables.accounts.find((row) => row.id === ACCOUNT)!.google_posts_enabled = false;

    const section = await readGooglePostSection(context(), { id: postId, platform: 'facebook', placement: 'feed' });

    expect(section).toEqual({ kind: 'hidden' });
  });

  it('says it could not load, rather than breaking the page, when a read fails', async () => {
    const postId = addPost(world);
    addVersion(postId);
    world.db.fail('gbp_posts', 'select', 1);

    expect(await readGooglePostSection(context(), { id: postId, platform: 'facebook', placement: 'feed' })).toEqual({
      kind: 'unavailable',
    });

    world.db.fail('accounts', 'select', 1);
    expect(await readGooglePostSection(context(), { id: postId, platform: 'facebook', placement: 'feed' })).toEqual({
      kind: 'unavailable',
    });
  });
});
