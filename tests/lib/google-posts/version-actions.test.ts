import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GOOGLE_VERSION_ACTION_MESSAGES } from '@/lib/google-posts/data';

import { ACCOUNT, addPost, createWorld, OTHER_ACCOUNT, PARENT, type World } from './world';

let world: World;
let googlePosts = true;
let entitled = true;

const auth = vi.hoisted(() => ({ requireAuthContext: vi.fn(), requireEntitledContext: vi.fn() }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: auth.requireAuthContext }));
vi.mock('@/lib/billing/entitlement-server', () => ({ requireEntitledContext: auth.requireEntitledContext }));

import {
  editGoogleVersionWording,
  loadGoogleVersion,
  releaseGoogleVersion,
  retryGoogleVersion,
  skipGoogleVersion,
} from '@/app/(app)/planner/google-version-actions';

function context() {
  return { supabase: world.deps.db, accountId: ACCOUNT, activeAccountId: ACCOUNT, features: { googlePosts }, brands: [], role: 'owner', isSuperAdmin: false };
}

function addVersion(state: string, overrides: Record<string, unknown> = {}, account = ACCOUNT): string {
  const postId = addPost(world, { account });
  world.db.seed('gbp_posts', [
    {
      account_id: account,
      content_item_id: postId,
      local_post_parent: PARENT,
      state,
      hold_reason: state === 'held' || state === 'failed' ? 'alcohol_promotion' : null,
      summary: 'Quiz night.',
      ...overrides,
    },
  ]);
  return postId;
}

const row = (postId: string) => world.db.tables.gbp_posts.find((candidate) => candidate.content_item_id === postId)!;

beforeEach(() => {
  vi.clearAllMocks();
  world = createWorld();
  googlePosts = true;
  entitled = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  auth.requireAuthContext.mockImplementation(async () => context());
  auth.requireEntitledContext.mockImplementation(async () => {
    if (!entitled) throw new Error('Your plan does not allow this.');
    return context();
  });
});

describe('Google version actions', () => {
  it('loads the version for the active brand only', async () => {
    const own = addVersion('pending');
    const other = addVersion('pending', {}, OTHER_ACCOUNT);
    expect((await loadGoogleVersion({ contentId: own })).version).toMatchObject({ state: 'pending', summary: 'Quiz night.' });
    expect((await loadGoogleVersion({ contentId: other })).version).toBeNull();
  });

  it('edits the wording through the copy rules and stops it following Facebook', async () => {
    const postId = addVersion('held', { hold_reason: 'no_wording', summary: '' });
    const result = await editGoogleVersionWording({ contentId: postId, summary: 'Quiz tonight! Call 01234 567890 #quiz' });
    expect(result).toMatchObject({ success: true });
    expect(row(postId)).toMatchObject({ state: 'pending', hold_reason: null, summary: 'Quiz tonight!' });
    expect(row(postId).summary_edited_at).not.toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(`/planner/${postId}`);
  });

  it('keeps an edited alcohol promotion held until it is released', async () => {
    const postId = addVersion('held');
    await editGoogleVersionWording({ contentId: postId, summary: 'Quiz tonight from 8pm.' });
    expect(row(postId).state).toBe('held');
    expect(await releaseGoogleVersion({ contentId: postId })).toMatchObject({ success: true });
    expect(row(postId)).toMatchObject({ state: 'pending', hold_reason: null });
  });

  it('holds a pending version whose edited wording is an alcohol promotion', async () => {
    const postId = addVersion('pending');
    expect(await editGoogleVersionWording({ contentId: postId, summary: 'Pints for £4 all night.' })).toMatchObject({ success: true });
    expect(row(postId)).toMatchObject({ state: 'held', hold_reason: 'alcohol_promotion' });
  });

  it('refuses to edit a version already sent, or to leave no wording', async () => {
    const sent = addVersion('sent', { google_post_name: `${PARENT}/localPosts/1`, sent_at: '2026-11-16T09:00:00.000Z', claimed_at: '2026-11-16T09:00:00.000Z' });
    expect(await editGoogleVersionWording({ contentId: sent, summary: 'New words' })).toEqual({
      success: false,
      error: GOOGLE_VERSION_ACTION_MESSAGES.notEditable,
    });
    const pending = addVersion('pending');
    expect(await editGoogleVersionWording({ contentId: pending, summary: '#only @tags' })).toEqual({
      success: false,
      error: GOOGLE_VERSION_ACTION_MESSAGES.emptyWording,
    });
  });

  it('skips a pending, held or failed version, and nothing else', async () => {
    for (const state of ['pending', 'held', 'failed']) {
      const postId = addVersion(state);
      expect(await skipGoogleVersion({ contentId: postId })).toMatchObject({ success: true });
      expect(row(postId)).toMatchObject({ state: 'skipped', hold_reason: 'skipped_by_person' });
    }
    const skipped = addVersion('skipped');
    expect(await skipGoogleVersion({ contentId: skipped })).toEqual({ success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.notSkippable });
  });

  it('retries only a failed version, with its attempts reset', async () => {
    const failed = addVersion('failed', { attempts: 5, last_error: 'Google refused this post.' });
    expect(await retryGoogleVersion({ contentId: failed })).toMatchObject({ success: true });
    expect(row(failed)).toMatchObject({ state: 'pending', attempts: 0, hold_reason: null, last_error: null });
    const pending = addVersion('pending');
    expect(await retryGoogleVersion({ contentId: pending })).toEqual({ success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.notFailed });
  });

  it('refuses everything when the switch is off or Google is not connected', async () => {
    const postId = addVersion('failed');
    googlePosts = false;
    expect(await retryGoogleVersion({ contentId: postId })).toMatchObject({ success: false });
    expect((await loadGoogleVersion({ contentId: postId })).version).toBeNull();

    googlePosts = true;
    world.db.tables.social_connections[0].status = 'needs_action';
    expect(await retryGoogleVersion({ contentId: postId })).toMatchObject({ success: false });
    expect(await skipGoogleVersion({ contentId: postId })).toMatchObject({ success: false });
    expect(row(postId).state).toBe('failed');
  });

  it('needs the plan to allow publishing to release or retry', async () => {
    const postId = addVersion('failed');
    entitled = false;
    await expect(retryGoogleVersion({ contentId: postId })).rejects.toThrow(/plan/);
    expect(auth.requireEntitledContext).toHaveBeenCalledWith('publish');
    await expect(editGoogleVersionWording({ contentId: postId, summary: 'x words' })).rejects.toThrow(/plan/);
    expect(auth.requireEntitledContext).toHaveBeenCalledWith('create');
    expect(row(postId).state).toBe('failed');
  });

  it('refuses a malformed request before reading anything', async () => {
    expect(await skipGoogleVersion({ contentId: 'not-a-uuid' })).toMatchObject({ success: false });
    expect(auth.requireAuthContext).not.toHaveBeenCalled();
  });

  it('a version changed by the cron meanwhile is refused, not overwritten', async () => {
    const postId = addVersion('pending');
    world.db.beforeUpdate = () => {
      world.db.beforeUpdate = null;
      row(postId).state = 'claimed';
      row(postId).claimed_at = '2026-11-16T10:00:00.000Z';
    };
    expect(await skipGoogleVersion({ contentId: postId })).toEqual({ success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.changed });
    expect(row(postId).state).toBe('claimed');
  });
});
