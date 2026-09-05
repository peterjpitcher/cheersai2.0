'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { MEDIA_BUCKET } from '@/lib/constants';
import {
  tournamentCreateSchema,
  tournamentUpdateSchema,
  fixtureCreateSchema,
  fixtureUpdateSchema,
  checkTournamentPreconditions,
} from '@/lib/tournament/validation';
import {
  getTournamentById,
  getFixtureById,
  getFixturesByTournament,
} from '@/lib/tournament/queries';
import {
  generateFixtureContent,
  bulkGenerateContent,
  deleteFixtureContentItems,
} from '@/lib/tournament/generate';
import { redactId, tournamentDebug, tournamentDebugError } from '@/lib/tournament/debug';
import { areBothTeamsConfirmed } from '@/lib/tournament/placeholder';
import { dispatchToQStash } from '@/lib/publishing/dispatch';
import { enqueueAndDispatch, enqueuePublishJob } from '@/lib/publishing/queue';
import { prepareRugbyFixture, saveRugbyFixture } from '@/lib/tournament/screening-mutation';
import { checkTournamentContentById } from '@/lib/tournament/content-freshness';
import { projectTournamentFixtures } from '@/lib/tournament/screening-service';
import type { TournamentFixture } from '@/types/tournament';
import type { Tournament } from '@/types/tournament';
import type { Platform } from '@/types/content';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const PUBLISHED_CONTENT_STATUSES = new Set(['published', 'posted', 'succeeded']);
const PUBLISHED_JOB_STATUSES = new Set(['published', 'posted', 'succeeded']);
const LOCKED_JOB_STATUSES = new Set(['publishing', 'in_progress']);

function isPublishedContentStatus(status: unknown): boolean {
  return typeof status === 'string' && PUBLISHED_CONTENT_STATUSES.has(status);
}

function isPublishedJobStatus(status: unknown): boolean {
  return typeof status === 'string' && PUBLISHED_JOB_STATUSES.has(status);
}

function isLockedJobStatus(status: unknown): boolean {
  return typeof status === 'string' && LOCKED_JOB_STATUSES.has(status);
}

async function isLegacyPublishQueue(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
): Promise<boolean> {
  const { error } = await supabase
    .from('publish_jobs')
    .select('platform')
    .limit(0);

  if (!error) return false;
  if (error.code === '42703' || /column .*platform.* does not exist/i.test(error.message)) {
    return true;
  }
  throw error;
}

async function buildConnectionsMap(
  accountId: string,
  platforms: string[],
): Promise<Record<string, boolean>> {
  const supabase = createServiceSupabaseClient();
  const connections: Record<string, boolean> = {};
  for (const platform of platforms) {
    const { data: conn } = await supabase
      .from('social_connections')
      .select('id')
      .eq('account_id', accountId)
      .eq('provider', platform)
      .limit(1);
    connections[platform] = (conn?.length ?? 0) > 0;
  }
  return connections;
}

// ---------------------------------------------------------------------------
// createTournament
// ---------------------------------------------------------------------------

export async function createTournament(
  input: unknown,
): Promise<{ success: boolean; error?: string; tournamentId?: string }> {
  try {
    const parsed = tournamentCreateSchema.parse(input);
    const { supabase, accountId } = await requireAuthContext();

    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('tournaments')
      .insert({
        account_id: accountId,
        sport: parsed.sport ?? 'football',
        name: parsed.name,
        slug: parsed.slug,
        post_template: parsed.postTemplate,
        house_rules_text: parsed.houseRulesText ?? null,
        platforms: parsed.platforms,
        post_lead_hours: parsed.postLeadHours,
        status: 'draft',
        updated_at: nowIso,
      })
      .select('id')
      .single();

    if (error) {
      // Unique constraint violation , duplicate slug for this account
      if (error.code === '23505') {
        return { success: false, error: 'A tournament with this slug already exists.' };
      }
      return { success: false, error: error.message };
    }

    revalidatePath('/tournaments');

    return { success: true, tournamentId: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// updateTournament
// ---------------------------------------------------------------------------

export async function updateTournament(
  tournamentId: string,
  input: unknown,
): Promise<{ success: boolean; error?: string }> {
  try {
    const parsed = tournamentUpdateSchema.parse(input);
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (parsed.sport !== undefined && parsed.sport !== (tournament.sport ?? 'football')) return { success: false, error: 'Create a separate tournament to change sport.' };
    if (parsed.name !== undefined) updates.name = parsed.name;
    if (parsed.slug !== undefined) updates.slug = parsed.slug;
    if (parsed.postTemplate !== undefined) updates.post_template = parsed.postTemplate;
    if (parsed.houseRulesText !== undefined) updates.house_rules_text = parsed.houseRulesText;
    if (parsed.platforms !== undefined) updates.platforms = parsed.platforms;
    if (parsed.postLeadHours !== undefined) updates.post_lead_hours = parsed.postLeadHours;

    const { error } = await supabase
      .from('tournaments')
      .update(updates)
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'A tournament with this slug already exists.' };
      }
      return { success: false, error: error.message };
    }

    revalidatePath(`/tournaments/${tournamentId}`);
    revalidatePath('/tournaments');

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// updateTournamentStatus
// ---------------------------------------------------------------------------

export async function updateTournamentStatus(
  tournamentId: string,
  status: Tournament['status'],
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const { error } = await supabase
      .from('tournaments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) return { success: false, error: error.message };

    revalidatePath(`/tournaments/${tournamentId}`);
    revalidatePath('/tournaments');

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// createFixture
// ---------------------------------------------------------------------------

export async function createFixture(
  tournamentId: string,
  input: unknown,
): Promise<{ success: boolean; error?: string; fixtureId?: string }> {
  try {
    const parsed = fixtureCreateSchema.parse(input);
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const bookingUrl = parsed.bookingUrl === '' ? null : (parsed.bookingUrl ?? null);
    const teamsConfirmed = tournament.sport === 'rugby_union' ? parsed.teamsConfirmed === true && areBothTeamsConfirmed(parsed.teamA, parsed.teamB) : areBothTeamsConfirmed(parsed.teamA, parsed.teamB);
    const rugbyFields = tournament.sport === 'rugby_union' ? await prepareRugbyFixture(supabase, tournament, { ...parsed, id: '', tournamentId, teamsConfirmed, bookingUrl, contentGenerated: false, groupName: parsed.groupName ?? null, venueCity: parsed.venueCity ?? null, showingNote: parsed.showingNote ?? null, createdAt: '', updatedAt: '' } as TournamentFixture) : {};

    const { data, error } = await supabase
      .from('tournament_fixtures')
      .insert({
        ...rugbyFields,
        tournament_id: tournamentId,
        match_number: parsed.matchNumber,
        round: parsed.round,
        group_name: parsed.groupName ?? null,
        team_a: parsed.teamA,
        team_b: parsed.teamB,
        teams_confirmed: teamsConfirmed,
        kick_off_at: parsed.kickOffAt,
        venue_city: parsed.venueCity ?? null,
        showing: tournament.sport === 'rugby_union' ? rugbyFields.showing : parsed.showing,
        showing_note: parsed.showingNote ?? null,
        booking_url: bookingUrl,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'A fixture with this match number already exists in this tournament.' };
      }
      return { success: false, error: error.message };
    }

    revalidatePath(`/tournaments/${tournamentId}`);

    return { success: true, fixtureId: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// deleteFixture
// ---------------------------------------------------------------------------

export async function deleteFixture(
  tournamentId: string,
  fixtureId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const fixture = await getFixtureById(supabase, fixtureId, tournamentId);
    if (!fixture) return { success: false, error: 'Fixture not found' };

    if (fixture.contentGenerated) {
      await deleteFixtureContentItems(supabase, fixtureId, accountId);
    }

    const { error } = await supabase
      .from('tournament_fixtures')
      .delete()
      .eq('id', fixtureId)
      .eq('tournament_id', tournamentId);

    if (error) return { success: false, error: error.message };

    revalidatePath(`/tournaments/${tournamentId}`);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// updateFixture
// ---------------------------------------------------------------------------

export async function updateFixture(
  tournamentId: string,
  fixtureId: string,
  input: unknown,
): Promise<{ success: boolean; error?: string }> {
  try {
    const parsed = fixtureUpdateSchema.parse(input);
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const fixture = await getFixtureById(supabase, fixtureId, tournamentId);
    if (!fixture) return { success: false, error: 'Fixture not found' };

    // Sanitise empty bookingUrl to null
    const bookingUrl = parsed.bookingUrl === '' ? null : (parsed.bookingUrl ?? null);

    const teamsConfirmed = parsed.teamsConfirmed && areBothTeamsConfirmed(parsed.teamA, parsed.teamB);

    const updates: Record<string, unknown> = {
      team_a: parsed.teamA,
      team_b: parsed.teamB,
      teams_confirmed: teamsConfirmed,
      showing: parsed.showing,
      showing_note: parsed.showingNote ?? null,
      booking_url: bookingUrl,
      kick_off_at: parsed.kickOffAt,
      updated_at: new Date().toISOString(),
    };

    if (parsed.matchNumber !== undefined) updates.match_number = parsed.matchNumber;
    if (parsed.round !== undefined) updates.round = parsed.round;
    if (parsed.groupName !== undefined) updates.group_name = parsed.groupName;
    if (parsed.venueCity !== undefined) updates.venue_city = parsed.venueCity;

    if (tournament.sport === 'rugby_union') {
      await saveRugbyFixture(supabase, tournament, fixture, { ...fixture, ...parsed, bookingUrl, teamsConfirmed } as TournamentFixture, updates, parsed.contentRevision);
      revalidatePath(`/tournaments/${tournamentId}`);
      return { success: true };
    }

    const { error } = await supabase
      .from('tournament_fixtures')
      .update(updates)
      .eq('id', fixtureId)
      .eq('tournament_id', tournamentId);

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'A fixture with this match number already exists in this tournament.' };
      }
      return { success: false, error: error.message };
    }

    revalidatePath(`/tournaments/${tournamentId}`);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// saveAndGenerateFixture
// ---------------------------------------------------------------------------

export async function saveAndGenerateFixture(
  tournamentId: string,
  fixtureId: string,
  input: unknown,
): Promise<{ success: boolean; error?: string; preconditionErrors?: string[] }> {
  try {
    const parsed = fixtureUpdateSchema.parse(input);
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const fixture = await getFixtureById(supabase, fixtureId, tournamentId);
    if (!fixture) return { success: false, error: 'Fixture not found' };

    // Check social connection preconditions
    const connections = await buildConnectionsMap(accountId, tournament.platforms);
    const { ready, missing } = checkTournamentPreconditions(tournament, connections);

    if (!ready) {
      return { success: false, preconditionErrors: missing, error: missing.join(', ') };
    }

    // Sanitise empty bookingUrl to null
    const bookingUrl = parsed.bookingUrl === '' ? null : (parsed.bookingUrl ?? null);
    const teamsConfirmed = parsed.teamsConfirmed && areBothTeamsConfirmed(parsed.teamA, parsed.teamB);

    const updates: Record<string, unknown> = {
      team_a: parsed.teamA,
      team_b: parsed.teamB,
      teams_confirmed: teamsConfirmed,
      showing: parsed.showing,
      showing_note: parsed.showingNote ?? null,
      booking_url: bookingUrl,
      kick_off_at: parsed.kickOffAt,
      updated_at: new Date().toISOString(),
    };

    if (parsed.matchNumber !== undefined) updates.match_number = parsed.matchNumber;
    if (parsed.round !== undefined) updates.round = parsed.round;
    if (parsed.groupName !== undefined) updates.group_name = parsed.groupName;
    if (parsed.venueCity !== undefined) updates.venue_city = parsed.venueCity;

    if (tournament.sport === 'rugby_union') {
      await saveRugbyFixture(supabase, tournament, fixture, { ...fixture, ...parsed, bookingUrl, teamsConfirmed } as TournamentFixture, updates, parsed.contentRevision);
    } else {
    // Save fixture first
    const { error: saveError } = await supabase
      .from('tournament_fixtures')
      .update(updates)
      .eq('id', fixtureId)
      .eq('tournament_id', tournamentId);

    if (saveError) {
      if (saveError.code === '23505') {
        return { success: false, error: 'A fixture with this match number already exists in this tournament.' };
      }
      return { success: false, error: saveError.message };
    }

    }

    // Re-fetch the saved fixture for generation
    const savedFixture = await getFixtureById(supabase, fixtureId, tournamentId);
    if (!savedFixture) return { success: false, error: 'Fixture not found after save' };
    if (!savedFixture.showing) {
      return { success: false, error: 'Fixture must be marked as showing before content can be generated.' };
    }
    if (!savedFixture.teamsConfirmed) {
      return { success: false, error: 'Teams must be confirmed before content can be generated.' };
    }

    // Handle regeneration: if already generated, delete unpublished content items first
    const shouldSkipPublishedPlacements = fixture.contentGenerated;
    if (fixture.contentGenerated) {
      await deleteFixtureContentItems(supabase, fixtureId, accountId, true /* onlyUnpublished */);

      // Let the generator run again for unpublished placements. It will mark
      // the fixture generated after it has recreated the missing content.
      await supabase
        .from('tournament_fixtures')
        .update({ content_generated: false })
        .eq('id', fixtureId);
    }

    await generateFixtureContent(tournament, savedFixture, 0, {
      skipPublished: shouldSkipPublishedPlacements,
    });

    revalidatePath(`/tournaments/${tournamentId}`);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// bulkGenerateAction
// ---------------------------------------------------------------------------

export async function bulkGenerateAction(
  tournamentId: string,
): Promise<{
  success: boolean;
  error?: string;
  preconditionErrors?: string[];
  generated?: number;
  skipped?: number;
  errors?: Array<{ fixtureId: string; error: string }>;
}> {
  tournamentDebug('action.bulk-generate.start', {
    tournamentId: redactId(tournamentId),
  });

  try {
    const { supabase, accountId } = await requireAuthContext();
    tournamentDebug('action.bulk-generate.auth-ok', {
      tournamentId: redactId(tournamentId),
      accountId: redactId(accountId),
    });

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) {
      tournamentDebug('action.bulk-generate.tournament-not-found', {
        tournamentId: redactId(tournamentId),
        accountId: redactId(accountId),
      });
      return { success: false, error: 'Tournament not found' };
    }
    tournamentDebug('action.bulk-generate.tournament-loaded', {
      tournamentId: redactId(tournament.id),
      accountId: redactId(tournament.accountId),
      status: tournament.status,
      platforms: tournament.platforms,
      hasSquareImage: Boolean(tournament.baseImageSquareId),
      hasStoryImage: Boolean(tournament.baseImageStoryId),
    });

    // Check social connection preconditions
    const connections = await buildConnectionsMap(accountId, tournament.platforms);
    const { ready, missing } = checkTournamentPreconditions(tournament, connections);
    tournamentDebug('action.bulk-generate.preconditions-checked', {
      tournamentId: redactId(tournament.id),
      ready,
      missing,
      connections,
    });

    if (!ready) {
      return { success: false, preconditionErrors: missing, error: missing.join(', ') };
    }

    const fixtures = await getFixturesByTournament(supabase, tournamentId);
    tournamentDebug('action.bulk-generate.fixtures-loaded', {
      tournamentId: redactId(tournament.id),
      fixtureCount: fixtures.length,
      showingCount: fixtures.filter((fixture) => fixture.showing).length,
      confirmedCount: fixtures.filter((fixture) => fixture.teamsConfirmed).length,
      notGeneratedCount: fixtures.filter((fixture) => !fixture.contentGenerated).length,
    });
    const result = await bulkGenerateContent(tournament, fixtures);

    revalidatePath(`/tournaments/${tournamentId}`);
    tournamentDebug('action.bulk-generate.complete', {
      tournamentId: redactId(tournament.id),
      generated: result.generated,
      skipped: result.skipped,
      failed: result.errors.length,
      firstError: result.errors[0]?.error ?? null,
    });

    return {
      success: true,
      generated: result.generated,
      skipped: result.skipped,
      errors: result.errors,
    };
  } catch (err) {
    tournamentDebugError('action.bulk-generate.unhandled-error', err, {
      tournamentId: redactId(tournamentId),
    });
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// publishNowFixture
// ---------------------------------------------------------------------------

export async function publishNowFixture(
  tournamentId: string,
  fixtureId: string,
): Promise<{ success: boolean; error?: string; enqueuedCount?: number }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const fixture = await getFixtureById(supabase, fixtureId, tournamentId);
    if (!fixture) return { success: false, error: 'Fixture not found' };

    // Find all content items for this fixture via prompt_context filter
    const { data: allItems, error: fetchError } = await supabase
      .from('content_items')
      .select('id, status, placement, platform, prompt_context')
      .eq('account_id', accountId)
      .is('deleted_at', null);

    if (fetchError) return { success: false, error: fetchError.message };

    const fixtureItems = (allItems ?? []).filter((item: Record<string, unknown>) => {
      const ctx = item.prompt_context as Record<string, unknown> | null;
      return ctx?.tournament_fixture_id === fixtureId && ctx?.source === 'tournament';
    });

    // Only target content that has not already reached the published state.
    const unpublishedItems = fixtureItems.filter(
      (item: Record<string, unknown>) => !isPublishedContentStatus(item.status),
    );

    if (!unpublishedItems.length) {
      return { success: false, error: 'No unpublished content found for this fixture' };
    }

    const legacyQueue = await isLegacyPublishQueue(supabase);
    let enqueuedCount = 0;

    for (const item of unpublishedItems) {
      const itemId = item.id as string;
      if (tournament.sport === 'rugby_union') { const issue = await checkTournamentContentById(supabase, accountId, itemId); if (issue) return { success: false, error: issue }; }
      const itemPlatform = (item.platform as string) ?? 'facebook';
      const placement = (item.placement as 'feed' | 'story' | null) ?? 'feed';
      const nowIso = new Date().toISOString();
      const idempotencyKey = `${itemId}:${itemPlatform}:${nowIso}`;

      const { data: variantRow, error: variantError } = await supabase
        .from('content_variants')
        .select('id')
        .eq('content_item_id', itemId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();

      if (variantError) return { success: false, error: variantError.message };
      if (!variantRow?.id) {
        return { success: false, error: 'Variant missing for content item' };
      }

      const { data: existingJobs, error: existingJobsError } = await supabase
        .from('publish_jobs')
        .select('id, status')
        .eq('content_item_id', itemId)
        .order('created_at', { ascending: false });

      if (existingJobsError) return { success: false, error: existingJobsError.message };

      const alreadyPublished = (existingJobs ?? []).some((job: Record<string, unknown>) =>
        isPublishedJobStatus(job.status),
      );
      if (alreadyPublished) {
        continue;
      }

      const lockedJob = (existingJobs ?? []).find((job: Record<string, unknown>) =>
        isLockedJobStatus(job.status),
      );
      if (lockedJob) {
        continue;
      }

      const { error: contentUpdateError } = await supabase
        .from('content_items')
        .update({
          status: 'queued',
          scheduled_for: nowIso,
          scheduled_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', itemId);

      if (contentUpdateError) return { success: false, error: contentUpdateError.message };

      const reusableJob = (existingJobs ?? []).find((job: Record<string, unknown>) =>
        !isPublishedJobStatus(job.status) && !isLockedJobStatus(job.status),
      );

      if (reusableJob?.id) {
        const { error: jobUpdateError } = await supabase
          .from('publish_jobs')
          .update({
            account_id: accountId,
            variant_id: variantRow.id,
            placement,
            status: 'queued',
            scheduled_at: nowIso,
            next_attempt_at: nowIso,
            idempotency_key: idempotencyKey,
            last_error: null,
            error_message: null,
            error_code: null,
            attempt: 0,
            retry_count: 0,
            updated_at: nowIso,
          })
          .eq('id', reusableJob.id as string);

        if (jobUpdateError) return { success: false, error: jobUpdateError.message };

        if (!legacyQueue) {
          await dispatchToQStash({
            jobId: reusableJob.id as string,
            deduplicationId: idempotencyKey,
          });
        }

        enqueuedCount++;
        continue;
      }

      if (legacyQueue) {
        await enqueuePublishJob({
          contentItemId: itemId,
          accountId,
          platform: itemPlatform as Platform,
          scheduledAt: new Date(nowIso),
          placement,
          variantId: variantRow.id,
        });
      } else {
        await enqueueAndDispatch({
          contentItemId: itemId,
          accountId,
          platform: itemPlatform as Platform,
          scheduledAt: new Date(nowIso),
          placement,
          variantId: variantRow.id,
        });
      }

      enqueuedCount++;
    }

    if (legacyQueue && enqueuedCount > 0) {
      const { error: invokeError } = await supabase.functions.invoke('publish-queue', {
        body: {
          leadWindowMinutes: 5,
          source: 'tournament-publish-now',
        },
      });

      if (invokeError) return { success: false, error: invokeError.message };
    }

    if (enqueuedCount === 0) {
      return { success: false, error: 'No publishable content found for this fixture' };
    }

    revalidatePath(`/tournaments/${tournamentId}`);

    return { success: true, enqueuedCount };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// toggleFixtureShowing
// ---------------------------------------------------------------------------

export async function toggleFixtureShowing(
  tournamentId: string,
  fixtureId: string,
  showing: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const fixture = await getFixtureById(supabase, fixtureId, tournamentId);
    if (!fixture) return { success: false, error: 'Fixture not found' };

    if (tournament.sport === 'rugby_union') {
      await saveRugbyFixture(supabase, tournament, fixture, { ...fixture, showing, screeningDecision: showing ? (fixture.screeningDecision === 'confirmed' ? 'confirmed' : 'unconfirmed') : 'not_showing', screeningConfirmedAt: showing ? new Date().toISOString() : fixture.screeningConfirmedAt }, {}, fixture.contentRevision);
      revalidatePath(`/tournaments/${tournamentId}`);
      return { success: true };
    }
    const { error: toggleError } = await supabase
      .from('tournament_fixtures')
      .update({ showing, updated_at: new Date().toISOString() })
      .eq('id', fixtureId)
      .eq('tournament_id', tournamentId);

    if (toggleError) return { success: false, error: toggleError.message };

    // When turning off: delete unpublished content and reset content_generated if no published remain
    if (!showing && fixture.contentGenerated) {
      await deleteFixtureContentItems(supabase, fixtureId, accountId, true /* onlyUnpublished */);

      // Check if any published content remains
      const { data: remainingItems } = await supabase
        .from('content_items')
        .select('id, prompt_context')
        .eq('account_id', accountId)
        .is('deleted_at', null);

      const publishedRemain = (remainingItems ?? []).some((item: Record<string, unknown>) => {
        const ctx = item.prompt_context as Record<string, unknown> | null;
        return ctx?.tournament_fixture_id === fixtureId && ctx?.source === 'tournament';
      });

      if (!publishedRemain) {
        await supabase
          .from('tournament_fixtures')
          .update({ content_generated: false })
          .eq('id', fixtureId);
      }
    }

    revalidatePath(`/tournaments/${tournamentId}`);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// deleteTournament
// ---------------------------------------------------------------------------

export async function deleteTournament(
  tournamentId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const fixtures = await getFixturesByTournament(supabase, tournamentId);
    for (const fixture of fixtures) {
      if (fixture.contentGenerated) {
        await deleteFixtureContentItems(supabase, fixture.id, accountId);
      }
    }

    const { error } = await supabase
      .from('tournaments')
      .delete()
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) return { success: false, error: error.message };

    revalidatePath('/tournaments');

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// getFixturePreview
// ---------------------------------------------------------------------------

export interface PreviewItem {
  platform: string;
  placement: string;
  status: string;
  scheduledFor: string | null;
  imageUrl: string;
  captionText: string | null;
}

export async function getFixturePreview(
  tournamentId: string,
  fixtureId: string,
): Promise<{ success: boolean; items?: PreviewItem[]; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const { data: contentItems, error: fetchError } = await supabase
      .from('content_items')
      .select('id, platform, placement, status, scheduled_for, prompt_context')
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .contains('prompt_context', { tournament_fixture_id: fixtureId, source: 'tournament' });

    if (fetchError) return { success: false, error: fetchError.message };
    if (!contentItems?.length) return { success: true, items: [] };

    const itemIds = contentItems.map((i) => i.id as string);
    const { data: variants } = await supabase
      .from('content_variants')
      .select('content_item_id, body, media_ids')
      .in('content_item_id', itemIds);

    const allMediaIds = new Set<string>();
    const itemMediaMap = new Map<string, string[]>();
    const itemCaptionMap = new Map<string, string>();
    for (const v of variants ?? []) {
      const ids = (v as Record<string, unknown>).media_ids as string[] | null;
      const contentItemId = (v as Record<string, unknown>).content_item_id as string;
      const body = (v as Record<string, unknown>).body as string | null;
      if (body) {
        itemCaptionMap.set(contentItemId, body);
      }
      if (ids?.length) {
        itemMediaMap.set(contentItemId, ids);
        ids.forEach((id) => allMediaIds.add(id));
      }
    }

    const urlMap = new Map<string, string>();
    if (allMediaIds.size) {
      const { data: assets } = await supabase
        .from('media_assets')
        .select('id, storage_path')
        .in('id', [...allMediaIds]);

      const paths = (assets ?? []).map((a) => (a as Record<string, unknown>).storage_path as string);
      if (paths.length) {
        const { data: signed } = await supabase.storage
          .from(MEDIA_BUCKET)
          .createSignedUrls(paths, 3600);

        if (signed) {
          for (let i = 0; i < (assets ?? []).length; i++) {
            const asset = assets![i];
            const signedEntry = signed.find((s) => s.path === (asset as Record<string, unknown>).storage_path);
            if (signedEntry?.signedUrl && !signedEntry.error) {
              urlMap.set((asset as Record<string, unknown>).id as string, signedEntry.signedUrl);
            }
          }
        }
      }
    }

    const currentFixture = tournament.sport === 'rugby_union' ? await getFixtureById(supabase, fixtureId, tournamentId) : null;
    const currentScreening = currentFixture ? (await projectTournamentFixtures(supabase, tournament, [currentFixture]))[0] : null;
    const items: PreviewItem[] = contentItems.map((item) => {
      const mediaIds = itemMediaMap.get(item.id as string) ?? [];
      const imageUrl = mediaIds.length ? (urlMap.get(mediaIds[0]) ?? '') : '';

      return {
        platform: item.platform as string,
        placement: item.placement as string,
        status: currentFixture && ((item.prompt_context as Record<string, unknown> | null)?.screening_revision !== currentFixture.contentRevision || (item.prompt_context as Record<string, unknown> | null)?.tournament_updated_at !== tournament.updatedAt || (currentScreening?.hours.state !== 'unknown' && (item.prompt_context as Record<string, unknown> | null)?.screening_hours_fingerprint !== currentScreening?.hours.fingerprint)) ? `${item.status}: screening changed, review required` : item.status as string,
        scheduledFor: (item.scheduled_for as string) ?? null,
        imageUrl,
        captionText: itemCaptionMap.get(item.id as string) ?? ((item.prompt_context as Record<string, unknown> | null)?.screening_caption as string | undefined) ?? null,
      };
    });

    return { success: true, items };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// importFixtures
// ---------------------------------------------------------------------------

export interface ImportError {
  row: number;
  error: string;
}

export async function importFixtures(
  tournamentId: string,
  fixtures: Array<{
    importKey?: string | null;
    teamsConfirmed?: boolean;
    roundNumber?: number | null;
    finalPosition?: number | null;
    plannedEndAt?: string | null;
    sourceUrl?: string | null;
    sourceCheckedAt?: string | null;
    matchNumber: number;
    round: string;
    groupName: string | null;
    teamA: string;
    teamB: string;
    kickOffAt: string;
    venueCity: string | null;
    showing: boolean;
  }>,
): Promise<{ success: boolean; imported: number; skipped: number; errors: ImportError[] }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, imported: 0, skipped: 0, errors: [{ row: 0, error: 'Tournament not found' }] };

    if (fixtures.length > 500) {
      return { success: false, imported: 0, skipped: 0, errors: [{ row: 0, error: 'Maximum 500 fixtures per import' }] };
    }

    let imported = 0;
    const skipped = 0;
    const errors: ImportError[] = [];

    for (let i = 0; i < fixtures.length; i++) {
      const row = fixtures[i];
      try {
        const parsed = fixtureCreateSchema.parse(row);
        if (tournament.sport === 'rugby_union') {
          if (!parsed.importKey) throw new Error('Rugby imports require a stable import_key.');
          const existing = (await getFixturesByTournament(supabase, tournamentId)).find(f => f.importKey === parsed.importKey);
          const result = existing
            ? await updateFixture(tournamentId, existing.id, { ...existing, ...parsed, teamsConfirmed: parsed.teamsConfirmed === true, showing: false, screeningDecision: 'unconfirmed', contentRevision: existing.contentRevision })
            : await createFixture(tournamentId, { ...parsed, showing: false, screeningDecision: 'unconfirmed' });
          if (!result.success) throw new Error(result.error);
          imported++;
          continue;
        }
        const teamsConfirmed = areBothTeamsConfirmed(row.teamA, row.teamB);

        const { error: upsertError } = await supabase
          .from('tournament_fixtures')
          .upsert(
            {
              tournament_id: tournamentId,
              match_number: row.matchNumber,
              round: row.round,
              group_name: row.groupName,
              team_a: row.teamA,
              team_b: row.teamB,
              teams_confirmed: teamsConfirmed,
              kick_off_at: row.kickOffAt,
              venue_city: row.venueCity,
              showing: row.showing,
            },
            { onConflict: 'tournament_id,match_number' },
          );

        if (upsertError) {
          errors.push({ row: i + 1, error: upsertError.message });
        } else {
          imported++;
        }
      } catch (err) {
        errors.push({ row: i + 1, error: err instanceof Error ? err.message : String(err) });
      }
    }

    revalidatePath(`/tournaments/${tournamentId}`);

    return { success: true, imported, skipped, errors };
  } catch (err) {
    return { success: false, imported: 0, skipped: 0, errors: [{ row: 0, error: err instanceof Error ? err.message : String(err) }] };
  }
}

// ---------------------------------------------------------------------------
// regenerateFeedApiKey
// ---------------------------------------------------------------------------

export async function regenerateFeedApiKey(
  tournamentId: string,
): Promise<{ success: true; apiKey: string } | { success: false; error: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const crypto = await import('node:crypto');
    const apiKey = crypto.randomBytes(16).toString('hex');

    const db = createServiceSupabaseClient();
    const { error } = await db
      .from('tournaments')
      .update({ feed_api_key: apiKey, updated_at: new Date().toISOString() })
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) return { success: false, error: error.message };

    revalidatePath(`/tournaments/${tournamentId}`);
    return { success: true, apiKey };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// disableFeedApiKey
// ---------------------------------------------------------------------------

export async function disableFeedApiKey(
  tournamentId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const db = createServiceSupabaseClient();
    const { error } = await db
      .from('tournaments')
      .update({ feed_api_key: null, updated_at: new Date().toISOString() })
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) return { success: false, error: error.message };

    revalidatePath(`/tournaments/${tournamentId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getFixtureScreeningPreview(tournamentId: string, input: unknown): Promise<{ success: boolean; error?: string; screening?: import('@/lib/tournament/screening').ScreeningProjection }> {
  try {
    const { supabase, accountId } = await requireAuthContext();
    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) throw new Error('Tournament not found');
    const parsed = fixtureCreateSchema.parse(input);
    const [result] = await projectTournamentFixtures(supabase, tournament, [{ ...parsed, id: '', tournamentId, teamsConfirmed: parsed.teamsConfirmed ?? false, bookingUrl: parsed.bookingUrl || null } as TournamentFixture]);
    return { success: true, screening: result.screening };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Preview unavailable' }; }
}
