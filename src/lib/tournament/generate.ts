import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { enqueuePublishJob } from '@/lib/publishing/queue';
import { getPublishReadinessIssues } from '@/lib/publishing/preflight';
import { compositeOverlay } from '@/lib/tournament/overlay';
import { interpolatePostTemplate } from '@/lib/tournament/template';
import { getPublishedPlacements } from '@/lib/tournament/queries';
import { MEDIA_BUCKET } from '@/lib/constants';
import { redactId, tournamentDebug, tournamentDebugError } from '@/lib/tournament/debug';
import type { Tournament, TournamentFixture, TournamentPlatform, ContentPlacement } from '@/types/tournament';
import type { OverlayData } from '@/lib/tournament/overlay';

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

const STAGGER_MS = 5 * 60 * 1000; // 5 minutes between posts sharing a kick-off time

/** Returns the stagger offset in milliseconds for a given index within a kick-off group. */
export function computeStaggerOffset(index: number): number {
  return index * STAGGER_MS;
}

/** Computes the scheduled-for timestamp: kick-off minus lead hours, plus stagger. */
export function computeScheduledFor(
  kickOff: Date,
  leadHours: number,
  staggerIndex: number,
): Date {
  const base = new Date(kickOff.getTime() - leadHours * 60 * 60 * 1000);
  return new Date(base.getTime() + computeStaggerOffset(staggerIndex));
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
};

function formatRoundLabel(round: string, groupName: string | null): string {
  if (round === 'group_stage' && groupName) {
    return `Group ${groupName}`;
  }
  return ROUND_LABELS[round] ?? round;
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
}

export async function generateFixtureContent(
  tournament: Tournament,
  fixture: TournamentFixture,
  staggerIndex = 0,
  options: GenerateFixtureContentOptions = {},
): Promise<void> {
  const supabase = createServiceSupabaseClient();
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
    lockKey,
  });

  // Acquire advisory lock — prevents concurrent generation for same fixture
  const { error: lockError } = await supabase.rpc('advisory_lock_fixture', {
    lock_key: lockKey,
  });
  if (lockError) {
    tournamentDebugError('generate.fixture.lock-failed', lockError, fixtureDebug);
    throw new Error(`Failed to acquire advisory lock: ${lockError.message}`);
  }
  tournamentDebug('generate.fixture.lock-acquired', fixtureDebug);

  // Re-check inside the lock — another worker may have already generated
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

    if (options.skipPublished) {
      const published = await getPublishedPlacements(supabase, fixture.id, tournament.accountId);
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
      // Nothing to generate — mark as done
      await supabase
        .from('tournament_fixtures')
        .update({ content_generated: true })
        .eq('id', fixture.id);
      tournamentDebug('generate.fixture.no-specs-marked-generated', fixtureDebug);
      return;
    }

    // Prepare overlay data
    const kickOff = new Date(fixture.kickOffAt);
    const kickOffDt = DateTime.fromJSDate(kickOff, { zone: 'Europe/London' });

    const overlayData: OverlayData = {
      teamA: fixture.teamA,
      teamB: fixture.teamB,
      dateDisplay: kickOffDt.toFormat('EEEE d MMMM'),
      timeDisplay: kickOffDt.toFormat('h:mm a'),
      roundLabel: formatRoundLabel(fixture.round, fixture.groupName),
      houseRulesText: tournament.houseRulesText,
    };

    // Template variables for post copy
    const templateVars = {
      team_a: fixture.teamA,
      team_b: fixture.teamB,
      date: kickOffDt.toFormat('EEEE d MMMM'),
      time: kickOffDt.toFormat('h:mm a'),
      group_round: formatRoundLabel(fixture.round, fixture.groupName),
      house_rules: tournament.houseRulesText ?? '',
      booking_url: fixture.bookingUrl ?? '',
    };

    // Download base images (de-duplicate by ID)
    const uniqueBaseIds = [...new Set(specs.map((s) => s.baseImageId))];
    const baseImageBuffers = new Map<string, Buffer>();
    for (const baseId of uniqueBaseIds) {
      baseImageBuffers.set(baseId, await downloadBaseImage(supabase, baseId));
    }
    tournamentDebug('generate.fixture.base-images-ready', {
      ...fixtureDebug,
      baseImageIds: uniqueBaseIds.map(redactId),
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

      const scheduledFor = computeScheduledFor(kickOff, tournament.postLeadHours, staggerIndex);
      const isPastDue = scheduledFor.getTime() < Date.now();

      // Interpolate post copy
      const body = interpolatePostTemplate(tournament.postTemplate, templateVars);

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
          file_name: `${fixture.teamA}-vs-${fixture.teamB}-${spec.placement}.jpg`,
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
          status: isPastDue ? 'draft' : 'scheduled',
          auto_generated: true,
          prompt_context: {
            tournament_fixture_id: fixture.id,
            tournament_id: tournament.id,
            source: 'tournament',
          },
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
        status: isPastDue ? 'draft' : 'scheduled',
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
        await enqueuePublishJob({
          contentItemId: contentItem.id,
          variantId: variant.id,
          placement: spec.placement,
          scheduledFor,
        });
        tournamentDebug('generate.fixture.publish-job-enqueued', {
          ...placementDebug,
          contentItemId: redactId(contentItem.id),
          variantId: redactId(variant.id),
          scheduledFor: scheduledFor.toISOString(),
        });
      } else {
        tournamentDebug('generate.fixture.publish-job-skipped', {
          ...placementDebug,
          contentItemId: redactId(contentItem.id),
          isPastDue,
          readinessIssueCount: issues.length,
          readinessIssues: issues,
        });
      }
    }

    // Mark fixture as generated
    await supabase
      .from('tournament_fixtures')
      .update({ content_generated: true })
      .eq('id', fixture.id);
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

  let generated = 0;
  const skipped = fixtures.length - eligible.length;
  const errors: Array<{ fixtureId: string; error: string }> = [];

  for (const [, group] of sortedGroups) {
    // Sort by match_number within each kick-off group
    group.sort((a, b) => a.matchNumber - b.matchNumber);

    for (let i = 0; i < group.length; i++) {
      const fixture = group[i];
      try {
        await generateFixtureContent(tournament, fixture, i);
        generated++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        tournamentDebugError('bulk.generate.fixture-failed', err, {
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

// ---------------------------------------------------------------------------
// Content deletion / cleanup
// ---------------------------------------------------------------------------

export async function deleteFixtureContentItems(
  supabase: SupabaseClient,
  fixtureId: string,
  accountId: string,
  onlyUnpublished = false,
): Promise<number> {
  const { data: fixtureItems, error: fetchError } = await supabase
    .from('content_items')
    .select('id')
    .eq('account_id', accountId)
    .contains('prompt_context', { tournament_fixture_id: fixtureId, source: 'tournament' });

  if (fetchError) throw fetchError;

  if (!fixtureItems.length) return 0;

  let itemsToDelete = fixtureItems;

  if (onlyUnpublished) {
    // Check which ones have succeeded publish jobs
    const itemIds = fixtureItems.map((i: Record<string, unknown>) => i.id as string);
    const { data: succeededJobs } = await supabase
      .from('publish_jobs')
      .select('content_item_id')
      .in('content_item_id', itemIds)
      .eq('status', 'succeeded');

    const publishedIds = new Set(
      (succeededJobs ?? []).map((j: Record<string, unknown>) => j.content_item_id as string),
    );
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

  // Reset content_generated flag on fixture
  await supabase
    .from('tournament_fixtures')
    .update({ content_generated: false })
    .eq('id', fixtureId);

  return deleteIds.length;
}
