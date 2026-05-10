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
import { areBothTeamsConfirmed } from '@/lib/tournament/placeholder';
import { enqueuePublishJob } from '@/lib/publishing/queue';
import type { Tournament } from '@/types/tournament';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
      // Unique constraint violation — duplicate slug for this account
      if (error.code === '23505') {
        return { success: false, error: 'A tournament with this slug already exists.' };
      }
      return { success: false, error: error.message };
    }

    revalidatePath('/dashboard/tournaments');

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

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    revalidatePath('/dashboard/tournaments');

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

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    revalidatePath('/dashboard/tournaments');

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// updateTournamentBaseImages
// ---------------------------------------------------------------------------

export async function updateTournamentBaseImages(
  tournamentId: string,
  squareImageId: string | null,
  storyImageId: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    // Validate each image belongs to this account with correct properties
    const idsToValidate: Array<{ id: string; expectedAspect: string }> = [];
    if (squareImageId) idsToValidate.push({ id: squareImageId, expectedAspect: 'square' });
    if (storyImageId) idsToValidate.push({ id: storyImageId, expectedAspect: 'story' });

    for (const { id, expectedAspect } of idsToValidate) {
      const { data: asset, error: assetError } = await supabase
        .from('media_assets')
        .select('id, account_id, media_type, aspect_class, hidden_at')
        .eq('id', id)
        .maybeSingle();

      if (assetError || !asset) {
        return { success: false, error: `Image not found: ${id}` };
      }
      if (asset.account_id !== accountId) {
        return { success: false, error: 'Image does not belong to this account' };
      }
      if (asset.media_type !== 'image') {
        return { success: false, error: 'Selected asset is not an image' };
      }
      if (asset.aspect_class !== expectedAspect) {
        return { success: false, error: `Expected ${expectedAspect} image, got ${asset.aspect_class}` };
      }
      if (asset.hidden_at !== null) {
        return { success: false, error: 'Selected image has been hidden' };
      }
    }

    const { error } = await supabase
      .from('tournaments')
      .update({
        base_image_square_id: squareImageId,
        base_image_story_id: storyImageId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) return { success: false, error: error.message };

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);

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
    const teamsConfirmed = areBothTeamsConfirmed(parsed.teamA, parsed.teamB);

    const { data, error } = await supabase
      .from('tournament_fixtures')
      .insert({
        tournament_id: tournamentId,
        match_number: parsed.matchNumber,
        round: parsed.round,
        group_name: parsed.groupName ?? null,
        team_a: parsed.teamA,
        team_b: parsed.teamB,
        teams_confirmed: teamsConfirmed,
        kick_off_at: parsed.kickOffAt,
        venue_city: parsed.venueCity ?? null,
        showing: parsed.showing,
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

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);

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

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);

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

    const { error } = await supabase
      .from('tournament_fixtures')
      .update({
        team_a: parsed.teamA,
        team_b: parsed.teamB,
        teams_confirmed: teamsConfirmed,
        showing: parsed.showing,
        showing_note: parsed.showingNote ?? null,
        booking_url: bookingUrl,
        kick_off_at: parsed.kickOffAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fixtureId)
      .eq('tournament_id', tournamentId);

    if (error) return { success: false, error: error.message };

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);

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

    // Save fixture first
    const { error: saveError } = await supabase
      .from('tournament_fixtures')
      .update({
        team_a: parsed.teamA,
        team_b: parsed.teamB,
        teams_confirmed: teamsConfirmed,
        showing: parsed.showing,
        showing_note: parsed.showingNote ?? null,
        booking_url: bookingUrl,
        kick_off_at: parsed.kickOffAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fixtureId)
      .eq('tournament_id', tournamentId);

    if (saveError) return { success: false, error: saveError.message };

    // Re-fetch the saved fixture for generation
    const savedFixture = await getFixtureById(supabase, fixtureId, tournamentId);
    if (!savedFixture) return { success: false, error: 'Fixture not found after save' };

    // Handle regeneration: if already generated, delete unpublished content items first
    if (fixture.contentGenerated) {
      await deleteFixtureContentItems(supabase, fixtureId, accountId, true /* onlyUnpublished */);

      // Reset content_generated if no unpublished content remains (track via deletedCount)
      // The generate function will re-mark as generated after completing
      await supabase
        .from('tournament_fixtures')
        .update({ content_generated: false })
        .eq('id', fixtureId);
    }

    await generateFixtureContent(tournament, savedFixture);

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);

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
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    // Check social connection preconditions
    const connections = await buildConnectionsMap(accountId, tournament.platforms);
    const { ready, missing } = checkTournamentPreconditions(tournament, connections);

    if (!ready) {
      return { success: false, preconditionErrors: missing, error: missing.join(', ') };
    }

    const fixtures = await getFixturesByTournament(supabase, tournamentId);
    const result = await bulkGenerateContent(tournament, fixtures);

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);

    return {
      success: true,
      generated: result.generated,
      skipped: result.skipped,
      errors: result.errors,
    };
  } catch (err) {
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
      .select('id, status, placement, prompt_context')
      .eq('account_id', accountId);

    if (fetchError) return { success: false, error: fetchError.message };

    const fixtureItems = (allItems ?? []).filter((item: Record<string, unknown>) => {
      const ctx = item.prompt_context as Record<string, unknown> | null;
      return ctx?.tournament_fixture_id === fixtureId && ctx?.source === 'tournament';
    });

    // Only target unpublished (non-succeeded) items
    const unpublishedItems = fixtureItems.filter(
      (item: Record<string, unknown>) =>
        item.status !== 'published' && item.status !== 'succeeded',
    );

    if (!unpublishedItems.length) {
      return { success: false, error: 'No unpublished content found for this fixture' };
    }

    let enqueuedCount = 0;

    for (const item of unpublishedItems) {
      const itemId = item.id as string;

      // Check for existing queued or in_progress jobs — skip if already queued
      const { data: existingJobs } = await supabase
        .from('publish_jobs')
        .select('id')
        .eq('content_item_id', itemId)
        .in('status', ['queued', 'in_progress'])
        .limit(1);

      if (existingJobs && existingJobs.length > 0) {
        continue; // already queued
      }

      await enqueuePublishJob({
        contentItemId: itemId,
        scheduledFor: null, // publish immediately
      });

      enqueuedCount++;
    }

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);

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
        .eq('account_id', accountId);

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

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// getMediaAssetsForPicker
// ---------------------------------------------------------------------------

export interface PickerAsset {
  id: string;
  fileName: string;
  aspectClass: 'square' | 'story' | 'landscape';
  previewUrl: string;
}

export async function getMediaAssetsForPicker(): Promise<PickerAsset[]> {
  const { supabase, accountId } = await requireAuthContext();

  const { data, error } = await supabase
    .from('media_assets')
    .select('id, file_name, aspect_class, storage_path')
    .eq('account_id', accountId)
    .eq('media_type', 'image')
    .in('aspect_class', ['square', 'story'])
    .is('hidden_at', null)
    .order('uploaded_at', { ascending: false })
    .limit(50);

  if (error || !data?.length) return [];

  const paths = data.map((r) => r.storage_path as string);
  const { data: signed } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(paths, 600);

  const urlMap = new Map<string, string>();
  if (signed) {
    for (const entry of signed) {
      if (entry?.path && entry.signedUrl && !entry.error) {
        urlMap.set(entry.path, entry.signedUrl);
      }
    }
  }

  return data
    .map((row) => ({
      id: row.id as string,
      fileName: row.file_name as string,
      aspectClass: (row.aspect_class ?? 'square') as PickerAsset['aspectClass'],
      previewUrl: urlMap.get(row.storage_path as string) ?? '',
    }))
    .filter((a) => a.previewUrl);
}
