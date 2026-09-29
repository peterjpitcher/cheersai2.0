# SPEC: Let sign-in redirects through error handlers

Status: requested in the 29 September 2026 brief. The bug was verified live that day: a signed-out
`GET /api/oauth/facebook/callback?state=x&code=y` redirected to
`/connections?oauth=error&provider=facebook&message=NEXT_REDIRECT`.
Complexity 3 (M): 15 source files, but the same one-line change at every site; no schema, no
environment variables, no integrations.

## What changes

`requireAuthContext()` (`src/lib/auth/server.ts`) sends a signed-out visitor to `/auth/login`, and a
signed-in person with no brand to `/no-access`, by calling `redirect()`, which throws Next's redirect
signal. Error handlers that catch everything turned that signal into an error result, so an owner
whose session had ended saw "NEXT_REDIRECT" (or a misleading fallback) instead of the sign-in page.

Each such handler in a server action, page, layout or browser-navigated route now calls
`unstable_rethrow(error)` from `next/navigation` (Next 16.2) at the top of the catch. Redirect and
not-found signals pass through; every real error keeps its current handling and message.

One deliberate variation: `applyOptimisationRecommendation` claims the recommendation before its
try block. A redirect thrown inside (only possible from the click-link step, before anything is
written or sent to Meta) now hands the claim back with the message "Your session ended before this
was applied. Sign in and apply it again." and then lets the redirect through. A bare rethrow would
have left the recommendation marked applied with nothing applied.

## How the sites were found

A TypeScript call-graph scan of `src/` (test files excluded): every `try`/`catch`, promise
`.catch()` and `Promise.allSettled` whose protected code can reach `redirect`, `permanentRedirect`,
`notFound`, `forbidden` or `unauthorized`, directly or through `requireAuthContext`,
`requireOwnerContext`, `requireFeatureContext`, `requireEntitledContext` or anything that calls
them. The scan was re-run after the change: the only remaining matches are the sites listed under
"Checked and left alone".

## Sites changed (64 handlers)

- Route handler: `src/app/api/oauth/[provider]/callback/route.ts` (the catch around the connect step
  and the Page choice).
- Layout and pages: `src/app/(app)/layout.tsx` (connection health, notification count);
  `src/app/(app)/planner/page.tsx` (failed-post count, notifications feed, failed-post list);
  `src/app/(app)/settings/page.tsx` (team invitations).
- `src/app/actions/content.ts` (10): createDraft, saveDraft, getDraft, listDrafts, deleteDraft,
  getScheduledContentAction, scheduleContent, approveForQueue, getCalendarItemsAction,
  createScheduledBatch.
- `src/app/actions/media.ts` (4): uploadMediaAction, deleteMediaAction, updateMediaTags,
  attachMediaToContent.
- `src/app/actions/analytics.ts` (4): getAnalyticsData, getPlatformComparison,
  getContentTypeComparison, getBestTimes.
- `src/app/actions/link-in-bio.ts` (8): getProfileWithTiles, saveProfile, publishPage,
  unpublishPage, checkSlugAvailability, saveTile, deleteTile, reorderTiles.
- `src/app/actions/ai-generate.ts` (2): generateContent, regenerateWithModifier.
- `src/app/actions/tournament.ts` (17): createTournament, updateTournament, updateTournamentStatus,
  createFixture, deleteFixture, updateFixture, saveAndGenerateFixture, bulkGenerateAction,
  publishNowFixture, toggleFixtureShowing, deleteTournament, getFixturePreview, importFixtures
  (outer and per-row), regenerateFeedApiKey, disableFeedApiKey, getFixtureScreeningPreview.
- `src/app/(app)/create/actions.ts` (4): listManagementEventOptions, getManagementEventPrefill,
  listManagementPromotionOptions, getManagementPromotionPrefill.
- `src/app/(app)/library/actions.ts` (1): autoNameAndTagMediaAsset.
- `src/app/(app)/settings/actions.ts` (2): testManagementConnectionSettings (outer catch and the
  catch around recording the test result).
- `src/app/(app)/campaigns/[id]/actions.ts` (2): publishCampaign (click-link step; the redirect is
  no longer saved as the publish error), syncCampaignPerformance.
- `src/app/(app)/campaigns/actions.ts` (3): generateCampaignAction,
  runCampaignDashboardOptimisation, applyOptimisationRecommendation (claim handed back, above).

## Checked and left alone

- Already rethrow unknown errors: `settings/billing-actions.ts` ownerContext;
  `api/admin/brand-export/route.ts`; `settings/team-actions.ts` (inviteTeamMember,
  cancelTeamInvitation, removeTeamMember, setTeamMemberRole: `ownerError()` only handles
  OwnerRequiredError and the catch rethrows the rest); `lib/settings/owner-access.ts`
  ownerActionContext; `planner/actions.ts` publishPlannerContentNow;
  `lib/campaigns/management-tracking.ts` (its mapper returns the same Error object for anything that
  is not a ManagementApiError).
- Cannot receive the redirect: `lib/planner/notifications.ts` getFailedPublishCount (its own sign-in
  check is outside the try, and the fallback count's promise is returned without `await`, so its
  rejection bypasses the catch).
- JSON routes the browser calls with `fetch`, where a redirect response would hand the caller the
  HTML sign-in page: `api/content/[id]/route.ts` and `api/planner/activity/route.ts` (already answer
  a sign-in redirect with 401 JSON); `api/create/event-artwork/route.ts` (checks sign-in first with
  `getCurrentUser()` and answers 401; a later redirect needs the session to end mid-request);
  `actions/tournament-images.ts` with `api/tournaments/base-image/route.ts` (the upload runs only
  through that route, and the action already answers "Please sign in again and retry.").
- Client components: out of scope. When a server action redirects, Next's router navigates even if
  the calling code catches the rejected promise.

## Rollback

Revert the PR. Nothing to undo in the database, environment or deployment order.

## Tests

- OAuth callback: a redirect thrown by the connect step comes out as a 307 to `/auth/login` (or
  `/no-access`), not a redirect to `/connections`; a real error still lands on `/connections` with
  its message.
- `tests/lib/auth/sign-in-redirects.test.ts`: 47 server actions rethrow the real redirect signal
  from a mocked `requireAuthContext` (both targets) without touching the database; six keep their
  usual answer for a real error.
- Layout, planner page and settings page: a redirect from a fallback lookup goes through; any other
  failure still falls back.
- `publishCampaign` does not save the redirect as the publish error; `applyOptimisationRecommendation`
  hands the claim back.
- Each new redirect test was run against the old code and failed there.
