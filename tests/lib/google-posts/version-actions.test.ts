import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GOOGLE_VERSION_ACTION_MESSAGES } from '@/lib/google-posts/data';

import { ACCOUNT, addPost, createWorld, OTHER_ACCOUNT, PARENT, type World } from './world';

let world: World;
let googlePosts = true;
let entitled = true;

const auth = vi.hoisted(() => ({
  requireAuthContext: vi.fn(),
  requireEntitledContext: vi.fn(),
  EntitlementError: class EntitlementError extends Error {},
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: auth.requireAuthContext }));
vi.mock('@/lib/billing/entitlement-server', () => ({
  requireEntitledContext: auth.requireEntitledContext,
  EntitlementError: auth.EntitlementError,
}));

import {
  editGoogleVersionWording,
  loadGoogleVersion,
  moveGoogleVersion,
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
    if (!entitled) throw new auth.EntitlementError('This brand is on hold because its subscription has lapsed.');
    return context();
  });
});

describe('Google version actions', () => {
  it('loads the version for the active brand only', async () => {
    const own = addVersion('pending');
    const other = addVersion('pending', {}, OTHER_ACCOUNT);
    expect((await loadGoogleVersion({ contentId: own })).version).toMatchObject({
      state: 'pending',
      summary: 'Quiz night.',
      summaryEdited: false,
    });
    expect((await loadGoogleVersion({ contentId: other })).version).toBeNull();
  });

  it('edits the wording through the copy rules and stops it following Facebook', async () => {
    const postId = addVersion('held', { hold_reason: 'no_wording', summary: '' });
    const result = await editGoogleVersionWording({ contentId: postId, summary: 'Quiz tonight! Call 01234 567890 #quiz' });
    expect(result).toMatchObject({ success: true, version: { summary: 'Quiz tonight!', summaryEdited: true } });
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

  it('releases an unedited held version with the Facebook wording as it is now', async () => {
    const postId = addVersion('held', { summary: 'Old words.' });
    world.db.tables.content_variants.find((variant) => variant.content_item_id === postId)!.body = 'New words for Google. #quiz';
    expect(await releaseGoogleVersion({ contentId: postId })).toMatchObject({ success: true });
    expect(row(postId)).toMatchObject({ state: 'pending', summary: 'New words for Google.' });
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
    expect(await retryGoogleVersion({ contentId: postId })).toEqual({ success: false, error: 'This brand is on hold because its subscription has lapsed.' });
    expect(auth.requireEntitledContext).toHaveBeenCalledWith('publish');
    expect(await editGoogleVersionWording({ contentId: postId, summary: 'x words' })).toMatchObject({ success: false, error: expect.stringMatching(/lapsed/) });
    expect(auth.requireEntitledContext).toHaveBeenCalledWith('create');
    expect(row(postId).state).toBe('failed');
  });

  it('gives a waiting Google post its own time, and puts it back on the Facebook time', async () => {
    const postId = addVersion('pending', { next_attempt_at: '2026-11-16T10:30:00.000Z' });
    const moved = await moveGoogleVersion({ contentId: postId, scheduledFor: '2099-06-01T11:30:00.000+01:00' });
    expect(moved).toMatchObject({ success: true, version: { ownTime: '2099-06-01T10:30:00.000Z', canMove: true } });
    // The instant is stored in UTC, and an old backoff does not follow it to the new time.
    expect(row(postId)).toMatchObject({ scheduled_for: '2099-06-01T10:30:00.000Z', next_attempt_at: null, state: 'pending' });
    expect(revalidatePath).toHaveBeenCalledWith(`/planner/google/${row(postId).id}`);

    const back = await moveGoogleVersion({ contentId: postId, scheduledFor: null });
    expect(back).toMatchObject({ success: true, version: { ownTime: null } });
    expect(row(postId).scheduled_for).toBeNull();
  });

  it('refuses a time in the past, a time after the event, and a post already sent', async () => {
    const postId = addVersion('pending', { event_end: '2099-06-01T21:00:00.000Z' });
    expect(await moveGoogleVersion({ contentId: postId, scheduledFor: '2000-01-01T10:00:00.000Z' })).toEqual({
      success: false,
      error: GOOGLE_VERSION_ACTION_MESSAGES.timePast,
    });
    expect(await moveGoogleVersion({ contentId: postId, scheduledFor: '2099-06-01T21:00:00.000Z' })).toEqual({
      success: false,
      error: GOOGLE_VERSION_ACTION_MESSAGES.afterEvent,
    });
    expect(row(postId).scheduled_for ?? null).toBeNull();

    const sent = addVersion('sent', { google_post_name: 'accounts/111/locations/999/localPosts/1', sent_at: '2026-11-16T09:00:00.000Z' });
    expect(await moveGoogleVersion({ contentId: sent, scheduledFor: '2099-06-01T10:00:00.000Z' })).toEqual({
      success: false,
      error: GOOGLE_VERSION_ACTION_MESSAGES.notMovable,
    });
  });

  it('moving needs the plan to allow publishing, the switch on, and a real time; another brand\'s post is not found', async () => {
    const postId = addVersion('pending');
    expect((await moveGoogleVersion({ contentId: postId, scheduledFor: 'tomorrow at ten' })).success).toBe(false);
    expect((await moveGoogleVersion({ contentId: postId, scheduledFor: '2099-06-01T10:00:00' })).success).toBe(false);

    entitled = false;
    expect(await moveGoogleVersion({ contentId: postId, scheduledFor: '2099-06-01T10:00:00.000Z' })).toMatchObject({ success: false });
    entitled = true;
    googlePosts = false;
    expect(await moveGoogleVersion({ contentId: postId, scheduledFor: '2099-06-01T10:00:00.000Z' })).toMatchObject({ success: false });
    googlePosts = true;

    const other = addVersion('pending', {}, OTHER_ACCOUNT);
    expect(await moveGoogleVersion({ contentId: other, scheduledFor: '2099-06-01T10:00:00.000Z' })).toEqual({
      success: false,
      error: GOOGLE_VERSION_ACTION_MESSAGES.notFound,
    });
    expect(row(postId).scheduled_for ?? null).toBeNull();
    expect(row(other).scheduled_for ?? null).toBeNull();
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
