import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * requireAuthContext() sends a signed-out visitor to /auth/login, and a
 * signed-in person with no brand to /no-access, by throwing Next's redirect
 * signal. Every server action below wraps it in a try/catch that turns errors
 * into a result, so each one used to hand the owner an error reading
 * "NEXT_REDIRECT" instead of the sign-in page. They must let the signal
 * through (unstable_rethrow) and keep their usual answer for real errors.
 */

const mockRequireAuthContext = vi.fn();
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: () => mockRequireAuthContext() }));

// Nothing past the sign-in check may run: any database access fails the test.
const mockServiceClient = vi.fn(() => {
  throw new Error('database must not be touched');
});
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: () => mockServiceClient(),
  tryCreateServiceSupabaseClient: () => mockServiceClient(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/** The error requireAuthContext() throws: Next's real redirect signal. */
function redirectSignal(path: string): unknown {
  try {
    redirect(path);
  } catch (error) {
    return error;
  }
  throw new Error('redirect() did not throw');
}

const RANGE = { start: '2026-10-01', end: '2026-10-31' };

type ActionCase = [name: string, run: () => Promise<unknown>];

const actions: ActionCase[] = [
  ['content: createDraft', async () => (await import('@/app/actions/content')).createDraft({})],
  ['content: saveDraft', async () => (await import('@/app/actions/content')).saveDraft('content-1', {})],
  ['content: getDraft', async () => (await import('@/app/actions/content')).getDraft('content-1')],
  ['content: listDrafts', async () => (await import('@/app/actions/content')).listDrafts()],
  ['content: deleteDraft', async () => (await import('@/app/actions/content')).deleteDraft('content-1')],
  ['content: getScheduledContentAction', async () => (await import('@/app/actions/content')).getScheduledContentAction(RANGE.start, RANGE.end)],
  ['content: scheduleContent', async () => (await import('@/app/actions/content')).scheduleContent('content-1', '2026-10-01T09:00:00Z')],
  ['content: approveForQueue', async () => (await import('@/app/actions/content')).approveForQueue('content-1')],
  ['content: getCalendarItemsAction', async () => (await import('@/app/actions/content')).getCalendarItemsAction(RANGE.start, RANGE.end)],
  ['content: createScheduledBatch', async () => (await import('@/app/actions/content')).createScheduledBatch({} as never)],
  ['media: uploadMediaAction', async () => (await import('@/app/actions/media')).uploadMediaAction(new FormData())],
  ['media: deleteMediaAction', async () => (await import('@/app/actions/media')).deleteMediaAction('media-1')],
  ['media: updateMediaTags', async () => (await import('@/app/actions/media')).updateMediaTags('media-1', ['Food'])],
  ['media: attachMediaToContent', async () => (await import('@/app/actions/media')).attachMediaToContent('content-1', ['media-1'])],
  ['analytics: getAnalyticsData', async () => (await import('@/app/actions/analytics')).getAnalyticsData(RANGE)],
  ['analytics: getPlatformComparison', async () => (await import('@/app/actions/analytics')).getPlatformComparison(RANGE)],
  ['analytics: getContentTypeComparison', async () => (await import('@/app/actions/analytics')).getContentTypeComparison(RANGE)],
  ['analytics: getBestTimes', async () => (await import('@/app/actions/analytics')).getBestTimes()],
  ['link-in-bio: getProfileWithTiles', async () => (await import('@/app/actions/link-in-bio')).getProfileWithTiles()],
  ['link-in-bio: saveProfile', async () => (await import('@/app/actions/link-in-bio')).saveProfile({ slug: 'the-anchor' } as never)],
  ['link-in-bio: publishPage', async () => (await import('@/app/actions/link-in-bio')).publishPage('the-anchor')],
  ['link-in-bio: unpublishPage', async () => (await import('@/app/actions/link-in-bio')).unpublishPage('the-anchor')],
  ['link-in-bio: checkSlugAvailability', async () => (await import('@/app/actions/link-in-bio')).checkSlugAvailability('the-anchor')],
  ['link-in-bio: saveTile', async () => (await import('@/app/actions/link-in-bio')).saveTile({ title: 'Menu' } as never)],
  ['link-in-bio: deleteTile', async () => (await import('@/app/actions/link-in-bio')).deleteTile('tile-1')],
  ['link-in-bio: reorderTiles', async () => (await import('@/app/actions/link-in-bio')).reorderTiles(['tile-1'])],
  ['ai-generate: generateContent', async () => (await import('@/app/actions/ai-generate')).generateContent('content-1', {} as never)],
  ['ai-generate: regenerateWithModifier', async () => (await import('@/app/actions/ai-generate')).regenerateWithModifier('content-1', {} as never, 'Shorter')],
  ['tournament: updateTournamentStatus', async () => (await import('@/app/actions/tournament')).updateTournamentStatus('t-1', 'active' as never)],
  ['tournament: deleteFixture', async () => (await import('@/app/actions/tournament')).deleteFixture('t-1', 'f-1')],
  ['tournament: bulkGenerateAction', async () => (await import('@/app/actions/tournament')).bulkGenerateAction('t-1')],
  ['tournament: publishNowFixture', async () => (await import('@/app/actions/tournament')).publishNowFixture('t-1', 'f-1')],
  ['tournament: toggleFixtureShowing', async () => (await import('@/app/actions/tournament')).toggleFixtureShowing('t-1', 'f-1', true)],
  ['tournament: deleteTournament', async () => (await import('@/app/actions/tournament')).deleteTournament('t-1')],
  ['tournament: getFixturePreview', async () => (await import('@/app/actions/tournament')).getFixturePreview('t-1', 'f-1')],
  ['tournament: importFixtures', async () => (await import('@/app/actions/tournament')).importFixtures('t-1', [])],
  ['tournament: regenerateFeedApiKey', async () => (await import('@/app/actions/tournament')).regenerateFeedApiKey('t-1')],
  ['tournament: disableFeedApiKey', async () => (await import('@/app/actions/tournament')).disableFeedApiKey('t-1')],
  ['tournament: getFixtureScreeningPreview', async () => (await import('@/app/actions/tournament')).getFixtureScreeningPreview('t-1', {})],
  ['create: listManagementEventOptions', async () => (await import('@/app/(app)/create/actions')).listManagementEventOptions()],
  ['create: getManagementEventPrefill', async () => (await import('@/app/(app)/create/actions')).getManagementEventPrefill({ eventId: 'event-1' })],
  ['create: listManagementPromotionOptions', async () => (await import('@/app/(app)/create/actions')).listManagementPromotionOptions()],
  ['create: getManagementPromotionPrefill', async () => (await import('@/app/(app)/create/actions')).getManagementPromotionPrefill({ specialId: 'special-1' })],
  ['library: autoNameAndTagMediaAsset', async () => (await import('@/app/(app)/library/actions')).autoNameAndTagMediaAsset('media-1')],
  ['settings: testManagementConnectionSettings', async () => (await import('@/app/(app)/settings/actions')).testManagementConnectionSettings()],
  ['campaigns: syncCampaignPerformance', async () => (await import('@/app/(app)/campaigns/[id]/actions')).syncCampaignPerformance('campaign-1')],
  ['campaigns: runCampaignDashboardOptimisation', async () => (await import('@/app/(app)/campaigns/actions')).runCampaignDashboardOptimisation()],
];

beforeEach(() => {
  mockRequireAuthContext.mockReset();
  mockServiceClient.mockClear();
});

describe.each([
  ['signed out', '/auth/login'],
  ['signed in with no brand', '/no-access'],
])('server actions for an owner who is %s', (_state, path) => {
  it.each(actions)(`%s sends them to ${path} instead of returning NEXT_REDIRECT`, async (_name, run) => {
    const signal = redirectSignal(path);
    mockRequireAuthContext.mockRejectedValue(signal);

    await expect(run()).rejects.toBe(signal);
    expect(mockServiceClient).not.toHaveBeenCalled();
  });
});

describe('server actions keep their usual answer for a real error', () => {
  beforeEach(() => {
    mockRequireAuthContext.mockRejectedValue(new Error('sign-in lookup failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('content: getDraft returns the error message', async () => {
    const { getDraft } = await import('@/app/actions/content');
    expect(await getDraft('content-1')).toEqual({ error: 'sign-in lookup failed' });
  });

  it('analytics: getAnalyticsData returns its generic message', async () => {
    const { getAnalyticsData } = await import('@/app/actions/analytics');
    expect(await getAnalyticsData(RANGE)).toEqual({ error: 'Failed to load analytics data' });
  });

  it('link-in-bio: checkSlugAvailability reports the slug as unavailable', async () => {
    const { checkSlugAvailability } = await import('@/app/actions/link-in-bio');
    expect(await checkSlugAvailability('the-anchor')).toEqual({ available: false });
  });

  it('tournament: deleteTournament returns the error message', async () => {
    const { deleteTournament } = await import('@/app/actions/tournament');
    expect(await deleteTournament('t-1')).toEqual({ success: false, error: 'sign-in lookup failed' });
  });

  it('create: listManagementEventOptions returns a failed result', async () => {
    const { listManagementEventOptions } = await import('@/app/(app)/create/actions');
    expect(await listManagementEventOptions()).toMatchObject({ ok: false });
  });

  it('library: autoNameAndTagMediaAsset fails soft with null', async () => {
    const { autoNameAndTagMediaAsset } = await import('@/app/(app)/library/actions');
    expect(await autoNameAndTagMediaAsset('media-1')).toBeNull();
  });
});
