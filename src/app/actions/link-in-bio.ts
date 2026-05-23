'use server';

/**
 * Server actions for the link-in-bio editor.
 * All mutations require authentication via requireAuthContext.
 */

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import {
  getLinkInBioProfileWithTiles,
  upsertLinkInBioProfile,
  createLinkInBioTile,
  updateLinkInBioTile,
  deleteLinkInBioTile,
  reorderLinkInBioTiles,
} from '@/lib/link-in-bio/profile';
import { isSchemaMissingError } from '@/lib/supabase/errors';
import type {
  LinkInBioProfileWithTiles,
  UpdateLinkInBioProfileInput,
  UpsertLinkInBioTileInput,
} from '@/lib/link-in-bio/types';

export async function getProfileWithTiles(): Promise<LinkInBioProfileWithTiles> {
  try {
    return await getLinkInBioProfileWithTiles();
  } catch (error) {
    console.error('[link-in-bio] getProfileWithTiles error:', error);
    return { profile: null, tiles: [] };
  }
}

export async function saveProfile(
  input: UpdateLinkInBioProfileInput,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const result = await upsertLinkInBioProfile(input);
    if (!result) {
      return { error: 'Failed to save profile' };
    }
    revalidatePath(`/l/${result.slug}`);
    return { success: true };
  } catch (error) {
    console.error('[link-in-bio] saveProfile error:', error);
    return { error: 'Failed to save profile' };
  }
}

export async function publishPage(
  slug: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    await upsertLinkInBioProfile({ slug, isPublished: true });
    revalidatePath(`/l/${slug}`);
    return { success: true };
  } catch (error) {
    console.error('[link-in-bio] publishPage error:', error);
    return { error: 'Failed to publish page' };
  }
}

export async function unpublishPage(
  slug: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    await upsertLinkInBioProfile({ slug, isPublished: false });
    revalidatePath(`/l/${slug}`);
    return { success: true };
  } catch (error) {
    console.error('[link-in-bio] unpublishPage error:', error);
    return { error: 'Failed to unpublish page' };
  }
}

export async function checkSlugAvailability(
  slug: string,
): Promise<{ available: boolean }> {
  try {
    const { supabase, accountId } = await requireAuthContext();
    const { data, error } = await supabase
      .from('link_in_bio_profiles')
      .select('account_id')
      .eq('slug', slug.toLowerCase())
      .neq('account_id', accountId)
      .maybeSingle<{ account_id: string }>();

    if (error) {
      if (isSchemaMissingError(error)) {
        return { available: true };
      }
      throw error;
    }

    return { available: !data };
  } catch (error) {
    console.error('[link-in-bio] checkSlugAvailability error:', error);
    return { available: false };
  }
}

export async function saveTile(
  input: UpsertLinkInBioTileInput,
): Promise<{ success?: boolean; error?: string }> {
  try {
    if (input.id) {
      await updateLinkInBioTile(input.id, input);
    } else {
      await createLinkInBioTile(input);
    }
    const { profile } = await getLinkInBioProfileWithTiles();
    if (profile?.slug) {
      revalidatePath(`/l/${profile.slug}`);
    }
    return { success: true };
  } catch (error) {
    console.error('[link-in-bio] saveTile error:', error);
    return { error: 'Failed to save tile' };
  }
}

export async function deleteTile(
  tileId: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    await deleteLinkInBioTile(tileId);
    const { profile } = await getLinkInBioProfileWithTiles();
    if (profile?.slug) {
      revalidatePath(`/l/${profile.slug}`);
    }
    return { success: true };
  } catch (error) {
    console.error('[link-in-bio] deleteTile error:', error);
    return { error: 'Failed to delete tile' };
  }
}

export async function reorderTiles(
  tileIdsInOrder: string[],
): Promise<{ success?: boolean; error?: string }> {
  try {
    await reorderLinkInBioTiles({ tileIdsInOrder });
    const { profile } = await getLinkInBioProfileWithTiles();
    if (profile?.slug) {
      revalidatePath(`/l/${profile.slug}`);
    }
    return { success: true };
  } catch (error) {
    console.error('[link-in-bio] reorderTiles error:', error);
    return { error: 'Failed to reorder tiles' };
  }
}
