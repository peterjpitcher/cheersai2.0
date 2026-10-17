import { NATIONS_TEMPLATE_VERSION, nationsContentLinks } from '../../../supabase/functions/_shared/nations-content-contract';
import { projectTournamentFixtures, type ScreenedFixture } from './screening-service';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';
import pLimit from 'p-limit';

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { enqueueAndDispatch } from '@/lib/publishing/queue';
import { getPublishReadinessIssues } from '@/lib/publishing/preflight';
import { applyChannelRules } from '@/lib/ai/content-rules';
import { compositeOverlay } from '@/lib/tournament/overlay';
import { displayTeamName } from '@/lib/tournament/team-display';
import { interpolatePostTemplate } from '@/lib/tournament/template';
import { buildRugbyMatchCopy, buildRugbyMenuLine, buildRugbyRoundupCopy, joinRugbyParagraphs } from '@/lib/tournament/rugby-copy';
import { findContentCoveringFixture } from '@/lib/tournament/content-freshness';
import { coveredFixtureIds } from '../../../supabase/functions/_shared/tournament-roundup';
import { getFixturesByTournament, getPublishedPlacements } from '@/lib/tournament/queries';
import { PUBLISHED_JOB_STATUSES, isPublishedContentStatus } from '@/lib/tournament/published-status';
import { formatEventDateLong } from '@/lib/utils/date';
import { DEFAULT_TIMEZONE, MEDIA_BUCKET } from '@/lib/constants';
import { redactId, tournamentDebug, tournamentDebugError } from '@/lib/tournament/debug';
import type { Tournament, TournamentFixture, TournamentPlatform, ContentPlacement } from '@/types/tournament';
import type { OverlayData } from '@/lib/tournament/overlay';

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

const STAGGER_MS = 5 * 60 * 1000; // 5 minutes between posts sharing a kick-off time
const DEFAULT_TOURNAMENT_BOOKING_URL = 'https://www.the-anchor.pub/book-table';

/** Returns the stagger offset in milliseconds for a given index within a kick-off group. */
export function computeStaggerOffset(index: number): number {
  return index * STAGGER_MS;
}

/**
 * Computes the scheduled-for timestamp: kick-off minus the lead, plus stagger.
 *
 * A whole-day lead (24, 48, 72, 168 hours; the UI calls these "N days before")
 * means the same London clock time N calendar days earlier, so a lead that
 * crosses a clock change keeps the kick-off's clock time instead of drifting
 * an hour. Any other lead is elapsed hours. The stagger is elapsed time.
 * Only kick-offs between 01:00 and 02:00 hit an odd post-day time: in the
 * spring gap Luxon moves the post an hour later; in the repeated autumn hour
 * it keeps the kick-off's own offset.
 */
export function computeScheduledFor(
  kickOff: Date,
  leadHours: number,
  staggerIndex: number,
): Date {
  const lead = leadHours % 24 === 0 ? { days: leadHours / 24 } : { hours: leadHours };
  const base = DateTime.fromJSDate(kickOff, { zone: DEFAULT_TIMEZONE }).minus(lead);
  return new Date(base.toMillis() + computeStaggerOffset(staggerIndex));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Deterministic integer hash of a UUID, used as an advisory lock key. */
function hashUuidToInt(uuid: string): number {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    const char = uuid.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // convert to 32-bit int
  }
  return Math.abs(hash);
}

const ROUND_LABELS: Record<string, string> = {
  group_stage: 'Group',
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-Final',
  semi_final: 'Semi-Final',
  third_place: 'Third Place Play-Off',
  final: 'Final',
  league_round: 'League round',
  placement_final: 'Placement final',
};

export function formatRoundLabel(round: string, groupName: string | null): string {
  if (round === 'group_stage' && groupName) {
    const name = groupName.replace(/^\s*group\s+/i, '').trim();
    return `Group ${name}`;
  }
  return ROUND_LABELS[round] ?? round;
}

interface TournamentContentPayload {
  body: string;
  promptContext: Record<string, unknown>;
}

function buildTournamentFeedBody({
  templateBody,
  fixture,
}: {
  templateBody: string;
  fixture: Pick<TournamentFixture, 'teamA' | 'teamB'>;
}): string {
  const base = templateBody.trim();
  const fallback = `${fixture.teamA} vs ${fixture.teamB}`;

  return [
    base || fallback,
    'Settle in at The Anchor for the build-up, the match, and a proper pub atmosphere.',
    'Book a table if you want a spot sorted, or come along and enjoy it with us on the night.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Instagram word limit for a round-up: its fixture list and notes are never cut. */
const ROUNDUP_CAPTION_WORD_LIMIT = 200;

/** Whether a screening has verified kitchen service to promote. */
function hasVerifiedFood(screened: ScreenedFixture): boolean {
  const food = screened.screening.foodPromotion;
  const windows = food.kind === 'during_screening' ? food.overlapWindows : food.kind === 'before_match' ? food.serviceWindows : [];
  return screened.hours.kitchenState === 'known' && windows.some(window => Date.parse(window.endAt) > Date.parse(window.startAt));
}

export function buildTournamentContentPayload({
  tournament,
  fixture,
  platform,
  placement,
  scheduledFor,
  screened,
  roundup,
}: {
  tournament: Pick<Tournament, 'id' | 'houseRulesText' | 'postTemplate'> & Partial<Pick<Tournament, 'updatedAt'>>;
  screened?: ScreenedFixture;
  fixture: Pick<TournamentFixture, 'id' | 'teamA' | 'teamB' | 'kickOffAt' | 'round' | 'groupName' | 'bookingUrl'>;
  platform: TournamentPlatform;
  placement: ContentPlacement;
  scheduledFor: Date;
  /** Every screened game that day, lead first. Two or more make the post a match-day round-up. */
  roundup?: ScreenedFixture[];
}): TournamentContentPayload {
  const kickOff = new Date(fixture.kickOffAt);
  const kickOffDt = DateTime.fromJSDate(kickOff, { zone: 'Europe/London' });
  const games = screened && roundup && roundup.length > 1 ? roundup : null;
  const title = games ? `Rugby on ${formatEventDateLong(kickOffDt)}` : `${fixture.teamA} vs ${fixture.teamB}`;

  const templateVars = {
    team_a: fixture.teamA,
    team_b: fixture.teamB,
    date: kickOffDt.toFormat('EEEE d MMMM'),
    time: kickOffDt.toFormat('h:mm a'),
    group_round: formatRoundLabel(fixture.round, fixture.groupName),
    house_rules: tournament.houseRulesText ?? '',
    booking_url: '',
  };

  const promptContext: Record<string, unknown> = {
    tournament_fixture_id: fixture.id,
    tournament_id: tournament.id,
    source: 'tournament',
    useCase: 'event',
    eventStart: kickOff.toISOString(),
    placement,
    title,
    ctaUrl: DEFAULT_TOURNAMENT_BOOKING_URL,
    linkInBioUrl: DEFAULT_TOURNAMENT_BOOKING_URL,
    ctaLabel: 'Book a table',
  };

  if (screened) {
    promptContext.screening_revision = screened.contentRevision;
    promptContext.screening_hours_fingerprint = screened.hours.fingerprint;
    promptContext.tournament_updated_at = tournament.updatedAt;
    promptContext.screening_sport = 'rugby_union';
    promptContext.screening_template_version = NATIONS_TEMPLATE_VERSION;
    Object.assign(promptContext, nationsContentLinks(fixture.id, kickOffDt.toISODate()!, fixture.bookingUrl));
    templateVars.booking_url = String(promptContext.booking_url);
    if (games) {
      // The lead keeps tournament_fixture_id; every game the post covers, and
      // the revision it was written from, is recorded for the safety checks.
      promptContext.roundup_fixture_ids = games.map(game => game.id);
      promptContext.roundup_revisions = Object.fromEntries(games.map(game => [game.id, game.contentRevision]));
      promptContext.caption_word_limit = ROUNDUP_CAPTION_WORD_LIMIT;
    }
  }
  const templateBody = interpolatePostTemplate(tournament.postTemplate, templateVars);
  const hasFoodService = screened ? (games ?? [screened]).some(hasVerifiedFood) : false;
  const menuUrl = hasFoodService
    ? kickOffDt.weekday === 7
      ? 'https://www.the-anchor.pub/sunday-roast'
      : 'https://www.the-anchor.pub/food-menu'
    : null;
  if (menuUrl) promptContext.screening_menu_url = menuUrl;
  const rugbyCopy = games
    ? buildRugbyRoundupCopy(games.map(game => ({ fixture: game, screened: game })))
    : screened ? buildRugbyMatchCopy({ fixture, screened }) : null;
  const rawBody = rugbyCopy
    ? joinRugbyParagraphs(rugbyCopy.lines)
    : placement === 'feed'
    ? buildTournamentFeedBody({ templateBody, fixture })
    : templateBody;
  if (rugbyCopy) promptContext.screening_caption = rawBody;
  const { body: processedBody } = applyChannelRules({
    body: rawBody,
    platform,
    placement,
    context: promptContext,
    scheduledFor,
  });

  const body = rugbyCopy
    ? finishRugbyBody(processedBody, {
      menuLine: platform === 'facebook' && placement === 'feed' ? buildRugbyMenuLine(fixture.kickOffAt, menuUrl) : null,
      ctaUrl: String(promptContext.ctaUrl),
    })
    : processedBody;

  if (rugbyCopy && placement === 'feed' && rugbyCopy.requiredLines.some(line => !body.includes(line))) {
    throw new Error('Screening opening or kitchen details were shortened. Review the generated copy before publishing.');
  }
  return { body, promptContext };
}

/**
 * Channel rules return one paragraph per line with the booking line last. Rugby
 * copy reads better with a blank line between paragraphs (a round-up's fixture
 * list stays a tight list), and the verified menu link (Facebook only,
 * tasks/SPEC-nations-sunday-menu.md) goes just above the booking line, so the
 * post carries one booking link and at most one menu link.
 */
function finishRugbyBody(processedBody: string, { menuLine, ctaUrl }: { menuLine: string | null; ctaUrl: string }): string {
  const lines = processedBody.split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.length) return '';
  if (menuLine) {
    const ctaIndex = lines.findIndex(line => line.includes(ctaUrl));
    lines.splice(ctaIndex >= 0 ? ctaIndex : lines.length, 0, menuLine);
  }
  return joinRugbyParagraphs(lines);
}

export function buildTournamentOverlayData({
  tournament,
  fixture,
  roundup,
}: {
  tournament: Pick<Tournament, 'name' | 'houseRulesText'>;
  fixture: Pick<TournamentFixture, 'teamA' | 'teamB' | 'kickOffAt' | 'round' | 'groupName'>;
  /** Every game in a match-day round-up, in kick-off order. */
  roundup?: Array<Pick<TournamentFixture, 'teamA' | 'teamB' | 'kickOffAt'>>;
}): OverlayData {
  const kickOff = new Date(fixture.kickOffAt);
  const kickOffDt = DateTime.fromJSDate(kickOff, { zone: 'Europe/London' });

  return {
    tournamentName: tournament.name,
    teamA: displayTeamName(fixture.teamA),
    teamB: displayTeamName(fixture.teamB),
    dateDisplay: kickOffDt.toFormat('EEEE d MMMM'),
    timeDisplay: kickOffDt.toFormat('h:mm a'),
    roundLabel: formatRoundLabel(fixture.round, fixture.groupName),
    houseRulesText: tournament.houseRulesText,
    ...(roundup && roundup.length > 1
      ? {
        matches: roundup.map(game => ({
          timeDisplay: DateTime.fromISO(game.kickOffAt, { zone: 'Europe/London' }).toFormat('h:mm a'),
          teamA: displayTeamName(game.teamA),
          teamB: displayTeamName(game.teamB),
        })),
      }
      : {}),
  };
}

interface PlacementSpec {
  platform: TournamentPlatform;
  placement: ContentPlacement;
  dimensions: { width: number; height: number };
  baseImageId: string;
  aspectClass: 'square' | 'story';
}

function buildPlacementSpecs(
  tournament: Tournament,
): PlacementSpec[] {
  const specs: PlacementSpec[] = [];

  for (const platform of tournament.platforms) {
    // Feed (square)
    if (tournament.baseImageSquareId) {
      specs.push({
        platform,
        placement: 'feed',
        dimensions: { width: 1080, height: 1080 },
        baseImageId: tournament.baseImageSquareId,
        aspectClass: 'square',
      });
    }

    // Story (9:16)
    if (tournament.baseImageStoryId) {
      specs.push({
        platform,
        placement: 'story',
        dimensions: { width: 1080, height: 1920 },
        baseImageId: tournament.baseImageStoryId,
        aspectClass: 'story',
      });
    }
  }

  return specs;
}

async function downloadBaseImage(
  supabase: SupabaseClient,
  mediaAssetId: string,
): Promise<Buffer> {
  tournamentDebug('generate.base-image.download.start', {
    mediaAssetId: redactId(mediaAssetId),
  });

  // Look up the storage path from media_assets
  const { data: asset, error: assetError } = await supabase
    .from('media_assets')
    .select('storage_path')
    .eq('id', mediaAssetId)
    .single();

  if (assetError || !asset) {
    tournamentDebugError('generate.base-image.lookup-failed', assetError ?? new Error('missing asset'), {
      mediaAssetId: redactId(mediaAssetId),
    });
    throw new Error(`Base image asset not found: ${mediaAssetId}`);
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .download(asset.storage_path);

  if (downloadError || !blob) {
    tournamentDebugError('generate.base-image.download-failed', downloadError ?? new Error('missing blob'), {
      mediaAssetId: redactId(mediaAssetId),
      storagePath: asset.storage_path,
    });
    throw new Error(`Failed to download base image: ${downloadError?.message ?? 'unknown'}`);
  }

  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  tournamentDebug('generate.base-image.download.success', {
    mediaAssetId: redactId(mediaAssetId),
    storagePath: asset.storage_path,
    bytes: buffer.byteLength,
  });
  return buffer;
}

// ---------------------------------------------------------------------------
// Main generation function
// ---------------------------------------------------------------------------

interface GenerateFixtureContentOptions {
  /** When true, skip placements that already have a succeeded publish job. */
  skipPublished?: boolean;
  /** When true, skip advisory lock (safe in single-threaded bulk operations). */
  skipLock?: boolean;
  /** Pre-downloaded base images keyed by media asset ID , avoids redundant downloads. */
  baseImageCache?: Map<string, Buffer>;
}

/** A fixture's match day: its kick-off date in London. */
export function matchDayKey(kickOffAt: string): string {
  return DateTime.fromISO(kickOffAt, { zone: 'Europe/London' }).toISODate() ?? kickOffAt.slice(0, 10);
}

/** Kick-off order, then match number, so a day's lead game is stable. */
export function compareKickOff(
  first: Pick<TournamentFixture, 'kickOffAt' | 'matchNumber'>,
  second: Pick<TournamentFixture, 'kickOffAt' | 'matchNumber'>,
): number {
  return Date.parse(first.kickOffAt) - Date.parse(second.kickOffAt) || first.matchNumber - second.matchNumber;
}

/** Fixtures grouped by London match day, days in date order, games in kick-off order. */
export function groupByMatchDay<T extends Pick<TournamentFixture, 'kickOffAt' | 'matchNumber'>>(fixtures: T[]): Array<[string, T[]]> {
  const days = new Map<string, T[]>();
  for (const fixture of fixtures) {
    const day = matchDayKey(fixture.kickOffAt);
    days.set(day, [...(days.get(day) ?? []), fixture]);
  }
  return [...days.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([day, games]) => [day, [...games].sort(compareKickOff)]);
}

interface MatchDayGame {
  fixture: TournamentFixture;
  screened: ScreenedFixture;
}

/**
 * The games on a fixture's match day that can be promoted (showing, teams
 * confirmed, screening eligible), in kick-off order then match number. The
 * first one leads the day's round-up (tasks/SPEC-rugby-match-posts.md part 2).
 */
async function resolveMatchDay(
  supabase: SupabaseClient,
  tournament: Tournament,
  fixture: TournamentFixture,
): Promise<MatchDayGame[]> {
  const day = matchDayKey(fixture.kickOffAt);
  const candidates = (await getFixturesByTournament(supabase, tournament.id))
    .filter(other => other.id !== fixture.id && matchDayKey(other.kickOffAt) === day);
  // The caller's copy of the fixture wins, as it may have just been saved.
  candidates.push(fixture);
  const promotable = candidates.filter(game => game.showing && game.teamsConfirmed);
  if (!promotable.length) return [];
  const projected = await projectTournamentFixtures(supabase, tournament, promotable);
  return promotable
    .map((game, index) => ({ fixture: game, screened: projected[index] }))
    .filter(({ screened }) => screened.screening.canGenerateTeamPromotion)
    .sort((first, second) => compareKickOff(first.fixture, second.fixture));
}

export async function generateFixtureContent(
  tournament: Tournament,
  requestedFixture: TournamentFixture,
  staggerIndex = 0,
  options: GenerateFixtureContentOptions = {},
): Promise<void> {
  const supabase = createServiceSupabaseClient();
  let fixture = requestedFixture;
  let screened: ScreenedFixture | undefined;
  let dayGames: MatchDayGame[] = [];
  if (tournament.sport === 'rugby_union') {
    // Rugby posts once per match day: the day's first game leads a round-up of
    // every promotable game that day, and the others carry no posts of their own.
    dayGames = await resolveMatchDay(supabase, tournament, requestedFixture);
    if (tournament.status !== 'active' || !dayGames.some(game => game.fixture.id === requestedFixture.id)) throw new Error('Confirm teams, broadcast and screening within existing hours before generating.');
    fixture = dayGames[0].fixture;
    screened = dayGames[0].screened;
  }
  const roundup = dayGames.length > 1 ? dayGames.map(game => game.screened) : undefined;
  const coveredIds = dayGames.length ? dayGames.map(game => game.fixture.id) : [fixture.id];
  const lockKey = hashUuidToInt(fixture.id);
  const fixtureDebug = {
    tournamentId: redactId(tournament.id),
    fixtureId: redactId(fixture.id),
    matchNumber: fixture.matchNumber,
    teamA: fixture.teamA,
    teamB: fixture.teamB,
  };

  tournamentDebug('generate.fixture.start', {
    ...fixtureDebug,
    staggerIndex,
    skipPublished: options.skipPublished === true,
    skipLock: options.skipLock === true,
    lockKey,
  });

  if (!options.skipLock) {
    // Acquire advisory lock , prevents concurrent generation for same fixture
    const { error: lockError } = await supabase.rpc('advisory_lock_fixture', {
      lock_key: lockKey,
    });
    if (lockError) {
      tournamentDebugError('generate.fixture.lock-failed', lockError, fixtureDebug);
      throw new Error(`Failed to acquire advisory lock: ${lockError.message}`);
    }
    tournamentDebug('generate.fixture.lock-acquired', fixtureDebug);
  }

  // Re-check , another worker may have already generated
  const { data: freshFixture, error: refetchError } = await supabase
    .from('tournament_fixtures')
    .select('content_generated')
    .eq('id', fixture.id)
    .single();

  if (refetchError) {
    tournamentDebugError('generate.fixture.refetch-failed', refetchError, fixtureDebug);
    throw refetchError;
  }
  if (freshFixture?.content_generated) {
    tournamentDebug('generate.fixture.already-generated', fixtureDebug);
    return;
  }

  // Track created resources for rollback on failure
  const createdStoragePaths: string[] = [];
  const createdMediaAssetIds: string[] = [];
  const createdContentItemIds: string[] = [];

  try {
    // Determine which placements to generate
    const allSpecs = buildPlacementSpecs(tournament);
    let specs = allSpecs;

    tournamentDebug('generate.fixture.specs-built', {
      ...fixtureDebug,
      allSpecs: allSpecs.map((spec) => ({
        platform: spec.platform,
        placement: spec.placement,
        dimensions: spec.dimensions,
        baseImageId: redactId(spec.baseImageId),
      })),
    });

    if (options.skipPublished || tournament.sport === 'rugby_union') {
      // A placement already published for any game that day is not posted again.
      const published = new Set<string>();
      for (const id of coveredIds) {
        for (const placement of await getPublishedPlacements(supabase, id, tournament.accountId)) published.add(placement);
      }
      specs = allSpecs.filter(
        (s) => !published.has(`${s.platform}:${s.placement}`),
      );
      tournamentDebug('generate.fixture.skip-published-filtered', {
        ...fixtureDebug,
        publishedPlacements: [...published],
        remainingSpecCount: specs.length,
      });
    }

    if (!specs.length) {
      // Nothing to generate , mark as done
      await supabase
        .from('tournament_fixtures')
        .update({ content_generated: true })
        .in('id', coveredIds);
      tournamentDebug('generate.fixture.no-specs-marked-generated', fixtureDebug);
      return;
    }

    // Prepare overlay data
    const kickOff = new Date(fixture.kickOffAt);
    const overlayData = buildTournamentOverlayData({ tournament, fixture, roundup: dayGames.map(game => game.fixture) });
    if (screened) {
      const { imageNote } = roundup
        ? buildRugbyRoundupCopy(roundup.map(game => ({ fixture: game, screened: game })))
        : buildRugbyMatchCopy({ fixture, screened });
      overlayData.houseRulesText = imageNote;
      overlayData.bookingLabel = roundup ? 'Book your table at' : 'Book a table for this game';
      overlayData.footerNote = imageNote;
    }

    // Download base images (use cache if provided, otherwise fetch and de-duplicate)
    const uniqueBaseIds = [...new Set(specs.map((s) => s.baseImageId))];
    const baseImageBuffers = new Map<string, Buffer>();
    for (const baseId of uniqueBaseIds) {
      const cached = options.baseImageCache?.get(baseId);
      if (cached) {
        baseImageBuffers.set(baseId, cached);
      } else {
        baseImageBuffers.set(baseId, await downloadBaseImage(supabase, baseId));
      }
    }
    tournamentDebug('generate.fixture.base-images-ready', {
      ...fixtureDebug,
      baseImageIds: uniqueBaseIds.map(redactId),
      fromCache: options.baseImageCache ? uniqueBaseIds.filter((id) => options.baseImageCache!.has(id)).length : 0,
    });

    // Process each placement
    for (const spec of specs) {
      const baseBuffer = baseImageBuffers.get(spec.baseImageId)!;
      const placementDebug = {
        ...fixtureDebug,
        platform: spec.platform,
        placement: spec.placement,
        dimensions: spec.dimensions,
        baseImageId: redactId(spec.baseImageId),
      };

      // Render overlay composite
      tournamentDebug('generate.fixture.render-placement.start', placementDebug);
      const composited = await compositeOverlay(baseBuffer, overlayData, spec.dimensions);
      tournamentDebug('generate.fixture.render-placement.success', {
        ...placementDebug,
        outputBytes: composited.byteLength,
      });

      // A rugby day has one post per placement, so it never needs staggering.
      const scheduledFor = computeScheduledFor(kickOff, tournament.postLeadHours, dayGames.length ? 0 : staggerIndex);
      const isPastDue = scheduledFor.getTime() < Date.now();
      const { body, promptContext } = buildTournamentContentPayload({
        screened,
        tournament,
        fixture,
        platform: spec.platform,
        placement: spec.placement,
        scheduledFor,
        roundup,
      });

      // Upload to storage
      const storagePath = `tournaments/${tournament.id}/${fixture.id}/${spec.platform}-${spec.placement}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(storagePath, composited, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (uploadError) {
        tournamentDebugError('generate.fixture.storage-upload-failed', uploadError, {
          ...placementDebug,
          storagePath,
        });
        throw new Error(`Storage upload failed: ${uploadError.message}`);
      }
      createdStoragePaths.push(storagePath);
      tournamentDebug('generate.fixture.storage-uploaded', {
        ...placementDebug,
        storagePath,
      });

      // Create media_asset
      const { data: mediaAsset, error: mediaError } = await supabase
        .from('media_assets')
        .insert({
          account_id: tournament.accountId,
          storage_path: storagePath,
          file_name: roundup
            ? `rugby-${matchDayKey(fixture.kickOffAt)}-${roundup.length}-games-${spec.placement}.jpg`
            : `${fixture.teamA}-vs-${fixture.teamB}-${spec.placement}.jpg`,
          media_type: 'image',
          mime_type: 'image/jpeg',
          size_bytes: composited.byteLength,
          tags: ['Tournament'],
          processed_status: 'ready',
          processed_at: new Date().toISOString(),
          aspect_class: spec.aspectClass,
          derived_variants: spec.aspectClass === 'story'
            ? { story: storagePath }
            : {},
        })
        .select('id')
        .single();

      if (mediaError || !mediaAsset) {
        tournamentDebugError('generate.fixture.media-asset-failed', mediaError ?? new Error('missing media asset'), placementDebug);
        throw new Error(`Media asset creation failed: ${mediaError?.message ?? 'unknown'}`);
      }
      createdMediaAssetIds.push(mediaAsset.id);
      tournamentDebug('generate.fixture.media-asset-created', {
        ...placementDebug,
        mediaAssetId: redactId(mediaAsset.id),
      });

      // Create content_item
      const { data: contentItem, error: contentError } = await supabase
        .from('content_items')
        .insert({
          account_id: tournament.accountId,
          platform: spec.platform,
          placement: spec.placement,
          scheduled_for: scheduledFor.toISOString(),
          scheduled_at: scheduledFor.toISOString(),
          status: 'draft',
          auto_generated: true,
          prompt_context: promptContext,
        })
        .select('id')
        .single();

      if (contentError || !contentItem) {
        tournamentDebugError('generate.fixture.content-item-failed', contentError ?? new Error('missing content item'), placementDebug);
        throw new Error(`Content item creation failed: ${contentError?.message ?? 'unknown'}`);
      }
      createdContentItemIds.push(contentItem.id);
      tournamentDebug('generate.fixture.content-item-created', {
        ...placementDebug,
        contentItemId: redactId(contentItem.id),
        scheduledFor: scheduledFor.toISOString(),
        status: 'draft',
      });

      // Create content_variant
      const { data: variant, error: variantError } = await supabase
        .from('content_variants')
        .insert({
          content_item_id: contentItem.id,
          body,
          media_ids: [mediaAsset.id],
        })
        .select('id')
        .single();

      if (variantError || !variant) {
        tournamentDebugError('generate.fixture.content-variant-failed', variantError ?? new Error('missing content variant'), {
          ...placementDebug,
          contentItemId: redactId(contentItem.id),
        });
        throw new Error(`Content variant creation failed: ${variantError?.message ?? 'unknown'}`);
      }
      tournamentDebug('generate.fixture.content-variant-created', {
        ...placementDebug,
        contentItemId: redactId(contentItem.id),
        variantId: redactId(variant.id),
      });

      // Run preflight check
      const issues = await getPublishReadinessIssues({
        supabase,
        accountId: tournament.accountId,
        contentId: contentItem.id,
        platform: spec.platform,
        placement: spec.placement,
      });

      // Enqueue if preflight passes and not past due
      if (!issues.length && !isPastDue) {
        // The post becomes "scheduled" before its job exists: the publish
        // worker refuses a job whose post is still a draft
        // (CONTENT_NOT_PUBLISHABLE), and a fixture due within the worker's
        // lead window could otherwise be picked up in between and never
        // retried. If the enqueue then fails, the worker recreates missing
        // jobs for scheduled posts on its next run.
        const scheduledNowIso = new Date().toISOString();
        const { error: statusError } = await supabase
          .from('content_items')
          .update({ status: 'scheduled', updated_at: scheduledNowIso })
          .eq('id', contentItem.id);
        if (statusError) {
          tournamentDebugError('generate.fixture.content-status-update-failed', statusError, {
            ...placementDebug,
            contentItemId: redactId(contentItem.id),
          });
          throw statusError;
        }
        await enqueueAndDispatch({
          contentItemId: contentItem.id,
          accountId: tournament.accountId,
          platform: spec.platform,
          scheduledAt: scheduledFor,
          placement: spec.placement,
          variantId: variant.id,
        });
        tournamentDebug('generate.fixture.publish-job-enqueued', {
          ...placementDebug,
          contentItemId: redactId(contentItem.id),
          variantId: redactId(variant.id),
          scheduledFor: scheduledFor.toISOString(),
        });
      } else {
        if (issues.length) {
          const blockedNowIso = new Date().toISOString();
          const { error: blockedStatusError } = await supabase
            .from('content_items')
            .update({
              status: 'failed',
              updated_at: blockedNowIso,
              prompt_context: {
                ...promptContext,
                readinessIssues: issues,
              },
            })
            .eq('id', contentItem.id);

          if (blockedStatusError) {
            tournamentDebugError('generate.fixture.content-status-update-failed', blockedStatusError, {
              ...placementDebug,
              contentItemId: redactId(contentItem.id),
            });
            throw blockedStatusError;
          }
        }
        tournamentDebug('generate.fixture.publish-job-skipped', {
          ...placementDebug,
          contentItemId: redactId(contentItem.id),
          isPastDue,
          readinessIssueCount: issues.length,
          readinessIssues: issues,
        });
      }
    }

    // Mark the fixture, and every other game a round-up covers, as generated
    await supabase
      .from('tournament_fixtures')
      .update({ content_generated: true })
      .in('id', coveredIds);
    tournamentDebug('generate.fixture.success', fixtureDebug);
  } catch (error) {
    // Rollback: clean up any resources created during this attempt
    tournamentDebugError('generate.fixture.failed-rolling-back', error, {
      ...fixtureDebug,
      createdStoragePathCount: createdStoragePaths.length,
      createdMediaAssetCount: createdMediaAssetIds.length,
      createdContentItemCount: createdContentItemIds.length,
    });
    await cleanupFailedGeneration(supabase, createdStoragePaths, createdMediaAssetIds, createdContentItemIds);
    tournamentDebug('generate.fixture.rollback-complete', fixtureDebug);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Rollback helper
// ---------------------------------------------------------------------------

async function cleanupFailedGeneration(
  supabase: SupabaseClient,
  storagePaths: string[],
  mediaAssetIds: string[],
  contentItemIds: string[],
): Promise<void> {
  tournamentDebug('generate.cleanup.start', {
    storagePathCount: storagePaths.length,
    mediaAssetCount: mediaAssetIds.length,
    contentItemCount: contentItemIds.length,
  });

  // Delete content items first (cascades to variants and jobs)
  if (contentItemIds.length) {
    await supabase
      .from('content_items')
      .delete()
      .in('id', contentItemIds);
  }

  // Delete media assets
  if (mediaAssetIds.length) {
    await supabase
      .from('media_assets')
      .delete()
      .in('id', mediaAssetIds);
  }

  // Remove uploaded storage objects
  if (storagePaths.length) {
    await supabase.storage
      .from(MEDIA_BUCKET)
      .remove(storagePaths);
  }

  tournamentDebug('generate.cleanup.success', {
    storagePathCount: storagePaths.length,
    mediaAssetCount: mediaAssetIds.length,
    contentItemCount: contentItemIds.length,
  });
}

// ---------------------------------------------------------------------------
// Bulk generation
// ---------------------------------------------------------------------------

const BULK_CONCURRENCY = 3;

export async function bulkGenerateContent(
  tournament: Tournament,
  fixtures: TournamentFixture[],
): Promise<{ generated: number; skipped: number; errors: Array<{ fixtureId: string; error: string }> }> {
  // Filter eligible fixtures: showing, teams confirmed, not yet generated
  const eligible = fixtures.filter(
    (f) => f.showing && f.teamsConfirmed && !f.contentGenerated,
  );
  tournamentDebug('bulk.generate.start', {
    tournamentId: redactId(tournament.id),
    totalFixtures: fixtures.length,
    eligibleFixtures: eligible.length,
    showingFixtures: fixtures.filter((fixture) => fixture.showing).length,
    confirmedFixtures: fixtures.filter((fixture) => fixture.teamsConfirmed).length,
    alreadyGeneratedFixtures: fixtures.filter((fixture) => fixture.contentGenerated).length,
  });

  if (!eligible.length) {
    tournamentDebug('bulk.generate.complete', {
      tournamentId: redactId(tournament.id),
      generated: 0,
      skipped: fixtures.length,
      failed: 0,
      firstError: null,
    });
    return { generated: 0, skipped: fixtures.length, errors: [] };
  }

  // Pre-download base images once for the entire bulk run
  const supabase = createServiceSupabaseClient();
  const baseImageIds = new Set<string>();
  if (tournament.baseImageSquareId) baseImageIds.add(tournament.baseImageSquareId);
  if (tournament.baseImageStoryId) baseImageIds.add(tournament.baseImageStoryId);

  const baseImageCache = new Map<string, Buffer>();
  tournamentDebug('bulk.generate.downloading-base-images', {
    tournamentId: redactId(tournament.id),
    imageCount: baseImageIds.size,
  });
  for (const imageId of baseImageIds) {
    baseImageCache.set(imageId, await downloadBaseImage(supabase, imageId));
  }
  tournamentDebug('bulk.generate.base-images-cached', {
    tournamentId: redactId(tournament.id),
    imageCount: baseImageCache.size,
    totalBytes: [...baseImageCache.values()].reduce((sum, buf) => sum + buf.byteLength, 0),
  });

  if (tournament.sport === 'rugby_union') {
    return bulkGenerateMatchDays(tournament, fixtures, eligible, baseImageCache);
  }

  // Group by kick-off time, then sort within each group by match_number for
  // deterministic stagger ordering
  const byKickOff = new Map<string, TournamentFixture[]>();
  for (const f of eligible) {
    const key = f.kickOffAt;
    if (!byKickOff.has(key)) byKickOff.set(key, []);
    byKickOff.get(key)!.push(f);
  }

  // Sort groups by kick-off time (ascending)
  const sortedGroups = [...byKickOff.entries()].sort(
    ([a], [b]) => new Date(a).getTime() - new Date(b).getTime(),
  );
  tournamentDebug('bulk.generate.groups-ready', {
    tournamentId: redactId(tournament.id),
    groupCount: sortedGroups.length,
    groups: sortedGroups.map(([kickOffAt, group]) => ({
      kickOffAt,
      fixtureCount: group.length,
      matchNumbers: group.map((fixture) => fixture.matchNumber),
    })),
  });

  // Flatten into ordered tasks with stagger indices
  const tasks: Array<{ fixture: TournamentFixture; staggerIndex: number }> = [];
  for (const [, group] of sortedGroups) {
    group.sort((a, b) => a.matchNumber - b.matchNumber);
    for (let i = 0; i < group.length; i++) {
      tasks.push({ fixture: group[i], staggerIndex: i });
    }
  }

  // Process fixtures concurrently with controlled parallelism
  const limit = pLimit(BULK_CONCURRENCY);
  let generated = 0;
  const skipped = fixtures.length - eligible.length;
  const errors: Array<{ fixtureId: string; error: string }> = [];

  const results = await Promise.allSettled(
    tasks.map(({ fixture, staggerIndex }) =>
      limit(async () => {
        await generateFixtureContent(tournament, fixture, staggerIndex, {
          skipLock: true,
          baseImageCache,
        });
        return fixture.id;
      }),
    ),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      generated++;
    } else {
      const fixture = tasks[i].fixture;
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      tournamentDebugError('bulk.generate.fixture-failed', result.reason, {
        tournamentId: redactId(tournament.id),
        fixtureId: redactId(fixture.id),
        matchNumber: fixture.matchNumber,
        teamA: fixture.teamA,
        teamB: fixture.teamB,
        message,
      });
      errors.push({ fixtureId: fixture.id, error: message });
    }
  }

  tournamentDebug('bulk.generate.complete', {
    tournamentId: redactId(tournament.id),
    generated,
    skipped,
    failed: errors.length,
    firstError: errors[0]?.error ?? null,
  });

  return { generated, skipped, errors };
}

/**
 * Rugby bulk generation: each match day with a game that has no posts yet is
 * rebuilt as one round-up, so a newly confirmed game joins its day's post.
 */
async function bulkGenerateMatchDays(
  tournament: Tournament,
  fixtures: TournamentFixture[],
  eligible: TournamentFixture[],
  baseImageCache: Map<string, Buffer>,
): Promise<{ generated: number; skipped: number; errors: Array<{ fixtureId: string; error: string }> }> {
  const ordered = groupByMatchDay(eligible);
  // A game moved to another day still sits in its old day's round-up, which
  // rebuilding the new day removes, so the old day is rebuilt in this run too.
  // Each day is rebuilt exactly once, so concurrent jobs never share a day.
  const supabase = createServiceSupabaseClient();
  const days = new Set(ordered.map(([day]) => day));
  for (const fixture of eligible) {
    for (const lead of await gamesLeftBehind(supabase, tournament.accountId, fixture, fixtures)) {
      const day = matchDayKey(lead.kickOffAt);
      if (!days.has(day)) {
        days.add(day);
        ordered.push([day, [lead]]);
      }
    }
  }
  const limit = pLimit(BULK_CONCURRENCY);
  const results = await Promise.allSettled(ordered.map(([, dayFixtures]) => limit(() =>
    regenerateMatchDay(tournament, dayFixtures[0], { baseImageCache, rebuildDaysLeftBehind: false }))));

  let generated = 0;
  const errors: Array<{ fixtureId: string; error: string }> = [];
  const eligibleIds = new Set(eligible.map((fixture) => fixture.id));
  results.forEach((result, index) => {
    const dayFixtures = ordered[index][1].filter((fixture) => eligibleIds.has(fixture.id));
    if (result.status === 'fulfilled') {
      // Count what the round-up covers; a game the screening rules exclude
      // gets no post and is reported, not counted.
      const covered = new Set(result.value);
      for (const fixture of dayFixtures) {
        if (covered.has(fixture.id)) generated += 1;
        else errors.push({ fixtureId: fixture.id, error: NOT_PROMOTABLE_MESSAGE });
      }
      return;
    }
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    tournamentDebugError('bulk.generate.match-day-failed', result.reason, {
      tournamentId: redactId(tournament.id),
      day: ordered[index][0],
      message,
    });
    for (const fixture of dayFixtures) errors.push({ fixtureId: fixture.id, error: message });
  });

  tournamentDebug('bulk.generate.complete', {
    tournamentId: redactId(tournament.id),
    generated,
    skipped: fixtures.length - eligible.length,
    failed: errors.length,
    firstError: errors[0]?.error ?? null,
  });
  return { generated, skipped: fixtures.length - eligible.length, errors };
}

const NOT_PROMOTABLE_MESSAGE = 'Confirm teams, broadcast and screening within existing hours before generating.';

/**
 * One game from each other match day whose unpublished round-up still lists
 * this game, because the game has since moved day. Rebuilding this game's day
 * deletes that round-up, so those days must be rebuilt as well.
 */
export async function gamesLeftBehind(
  supabase: SupabaseClient,
  accountId: string,
  fixture: TournamentFixture,
  fixtures: TournamentFixture[],
): Promise<TournamentFixture[]> {
  const day = matchDayKey(fixture.kickOffAt);
  const byId = new Map(fixtures.map((other) => [other.id, other]));
  const leads = new Map<string, TournamentFixture>();
  for (const item of await findContentCoveringFixture(supabase, accountId, fixture.id)) {
    if (isPublishedContentStatus(item.status)) continue;
    for (const id of coveredFixtureIds(item.prompt_context)) {
      const other = byId.get(id);
      if (!other || id === fixture.id) continue;
      const otherDay = matchDayKey(other.kickOffAt);
      if (otherDay !== day && !leads.has(otherDay)) leads.set(otherDay, other);
    }
  }
  return [...leads.values()];
}

/**
 * Rebuild a rugby match day's round-up from scratch: delete the day's
 * unpublished posts, then generate one round-up for every promotable game that
 * day. Placements already published are not posted again. With requireFixture,
 * the given game must itself be promotable, checked before anything is deleted.
 * When the game has moved from another day, that day's round-up (which still
 * lists it) is deleted here, so that day is rebuilt too unless the caller
 * rebuilds it itself (rebuildDaysLeftBehind: false, as Generate All does).
 * Returns the ids of the games the new round-up covers (none when no game is
 * promotable).
 */
export async function regenerateMatchDay(
  tournament: Tournament,
  fixture: TournamentFixture,
  { requireFixture = false, baseImageCache, rebuildDaysLeftBehind = true }: {
    requireFixture?: boolean;
    baseImageCache?: Map<string, Buffer>;
    rebuildDaysLeftBehind?: boolean;
  } = {},
): Promise<string[]> {
  const supabase = createServiceSupabaseClient();
  const games = await resolveMatchDay(supabase, tournament, fixture);
  if (requireFixture && !games.some(game => game.fixture.id === fixture.id)) {
    throw new Error(NOT_PROMOTABLE_MESSAGE);
  }

  const day = matchDayKey(fixture.kickOffAt);
  const fixtures = await getFixturesByTournament(supabase, tournament.id);
  const leftBehind = rebuildDaysLeftBehind ? await gamesLeftBehind(supabase, tournament.accountId, fixture, fixtures) : [];
  const dayIds = fixtures
    .filter(other => matchDayKey(other.kickOffAt) === day)
    .map(other => other.id);
  for (const id of new Set([...dayIds, fixture.id])) {
    await deleteFixtureContentItems(supabase, id, tournament.accountId, true);
  }
  const { error: resetError } = await supabase
    .from('tournament_fixtures')
    .update({ content_generated: false })
    .eq('tournament_id', tournament.id)
    .in('id', [...new Set([...dayIds, fixture.id])]);
  if (resetError) throw resetError;

  if (games.length) {
    await generateFixtureContent(tournament, games[0].fixture, 0, { skipPublished: true, baseImageCache });
  }
  for (const lead of leftBehind) {
    await regenerateMatchDay(tournament, lead, { baseImageCache, rebuildDaysLeftBehind: false });
  }
  return games.map(game => game.fixture.id);
}

// ---------------------------------------------------------------------------
// Content deletion / cleanup
// ---------------------------------------------------------------------------

export async function deleteFixtureContentItems(
  supabase: SupabaseClient,
  fixtureId: string,
  accountId: string,
  onlyUnpublished = false,
): Promise<number> {
  // Includes any match-day round-up that lists this fixture, and binned posts.
  const fixtureItems = await findContentCoveringFixture(supabase, accountId, fixtureId, { includeDeleted: true });

  if (!fixtureItems.length) return 0;

  let itemsToDelete = fixtureItems;

  if (onlyUnpublished) {
    // Preserve placements that have already gone out. The live worker marks
    // them 'posted' (job 'succeeded'); checking 'published' alone deleted them.
    const itemIds = fixtureItems.map((i: Record<string, unknown>) => i.id as string);
    const { data: succeededJobs, error: jobsError } = await supabase
      .from('publish_jobs')
      .select('content_item_id')
      .in('content_item_id', itemIds)
      .eq('account_id', accountId)
      .in('status', [...PUBLISHED_JOB_STATUSES]);
    // Without the job list, nothing can be shown to be unpublished: delete nothing.
    if (jobsError) throw jobsError;

    const publishedIds = new Set(
      (succeededJobs ?? []).map((j: Record<string, unknown>) => j.content_item_id as string),
    );
    for (const item of fixtureItems) {
      if (isPublishedContentStatus((item as Record<string, unknown>).status)) {
        publishedIds.add((item as Record<string, unknown>).id as string);
      }
    }
    itemsToDelete = fixtureItems.filter(
      (i: Record<string, unknown>) => !publishedIds.has(i.id as string),
    );
  }

  if (!itemsToDelete.length) return 0;

  const deleteIds = itemsToDelete.map((i: Record<string, unknown>) => i.id as string);

  // Collect media asset IDs to clean up
  const { data: variants } = await supabase
    .from('content_variants')
    .select('media_ids')
    .in('content_item_id', deleteIds);

  const mediaIds = new Set<string>();
  for (const v of variants ?? []) {
    const ids = (v as Record<string, unknown>).media_ids as string[] | null;
    if (ids) ids.forEach((id) => mediaIds.add(id));
  }

  // Collect storage paths before deleting media assets
  const storagePaths: string[] = [];
  if (mediaIds.size) {
    const { data: assets } = await supabase
      .from('media_assets')
      .select('id, storage_path')
      .in('id', [...mediaIds]);

    for (const asset of assets ?? []) {
      const path = (asset as Record<string, unknown>).storage_path as string;
      if (path) storagePaths.push(path);
    }
  }

  // Delete content items (cascades to content_variants and publish_jobs)
  await supabase
    .from('content_items')
    .delete()
    .in('id', deleteIds);

  // Delete media assets
  if (mediaIds.size) {
    await supabase
      .from('media_assets')
      .delete()
      .in('id', [...mediaIds]);
  }

  // Remove storage objects
  if (storagePaths.length) {
    await supabase.storage
      .from(MEDIA_BUCKET)
      .remove(storagePaths);
  }

  // A deleted round-up also leaves the other games it listed without a post, so
  // every fixture it covered is re-checked, not only the one asked for.
  const affectedFixtureIds = new Set<string>([fixtureId]);
  for (const item of itemsToDelete) {
    for (const id of coveredFixtureIds(item.prompt_context)) affectedFixtureIds.add(id);
  }
  for (const id of affectedFixtureIds) {
    const keepsPosts = onlyUnpublished || id !== fixtureId
      ? (await findContentCoveringFixture(supabase, accountId, id)).length > 0
      : false;
    if (!keepsPosts) {
      await supabase
        .from('tournament_fixtures')
        .update({ content_generated: false })
        .eq('id', id);
    }
  }

  return deleteIds.length;
}
