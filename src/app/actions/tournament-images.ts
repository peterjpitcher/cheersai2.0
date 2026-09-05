'use server';

import sharp from 'sharp';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/auth/server';
import { MEDIA_BUCKET } from '@/lib/constants';
import { getTournamentById } from '@/lib/tournament/queries';

export interface TournamentBaseImageUpload {
  id: string;
  fileName: string;
  aspectClass: 'square' | 'story';
  previewUrl: string;
}

export async function getTournamentBaseImageUploads(tournamentId: string): Promise<TournamentBaseImageUpload[]> {
  z.string().uuid().parse(tournamentId);
  const { supabase, accountId } = await requireAuthContext();
  const tournament = await getTournamentById(supabase, tournamentId, accountId);
  if (!tournament) throw new Error('Tournament not found');
  const slots = [
    { id: tournament.baseImageSquareId, aspectClass: 'square' as const },
    { id: tournament.baseImageStoryId, aspectClass: 'story' as const },
  ];
  const ids = slots.flatMap(({ id }) => id ? [id] : []);
  if (!ids.length) return [];
  const { data, error } = await supabase.from('media_assets')
    .select('id, file_name, storage_path').eq('account_id', accountId).in('id', ids);
  if (error) throw new Error('Could not load tournament images. Please retry.');
  return Promise.all(slots.filter((slot) => slot.id).map(async (slot) => {
    const asset = data?.find((row) => row.id === slot.id);
    if (!asset) throw new Error('Could not load tournament image. Please upload a replacement.');
    const { data: signed, error: signingError } = await supabase.storage.from(MEDIA_BUCKET)
      .createSignedUrl(asset.storage_path, 600);
    if (signingError || !signed?.signedUrl) throw new Error('Could not load image preview. Please retry.');
    return { id: asset.id, fileName: asset.file_name, aspectClass: slot.aspectClass, previewUrl: signed.signedUrl };
  }));
}

export async function uploadTournamentBaseImage(formData: FormData): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();
    const tournamentId = z.string().uuid().parse(formData.get('tournamentId'));
    const aspect = z.enum(['square', 'story']).parse(formData.get('aspect'));
    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { success: false, error: 'Choose an image to upload.' };
    if (file.size > 4 * 1024 * 1024) return { success: false, error: 'Images must be 4 MB or smaller.' };
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return { success: false, error: 'Upload a PNG, JPEG or WebP image.' };
    }
    let buffer: Buffer;
    try {
      const input = Buffer.from(await file.arrayBuffer());
      const image = sharp(input, { limitInputPixels: 40_000_000, failOn: 'warning' });
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) {
        return { success: false, error: 'Upload a single PNG, JPEG or WebP image.' };
      }
      const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
      const width = (rotated ? metadata.height : metadata.width) ?? 0;
      const height = (rotated ? metadata.width : metadata.height) ?? 0;
      const expected = aspect === 'square' ? 1 : 9 / 16;
      if (!height || Math.abs(width / height - expected) > 0.01) {
        return { success: false, error: `Use a ${aspect === 'square' ? 'square (1:1)' : 'story (9:16)'} image.` };
      }
      buffer = await image.rotate().resize(1080, aspect === 'square' ? 1080 : 1920).webp({ quality: 90 }).toBuffer();
    } catch {
      return { success: false, error: 'This image could not be read. Try another PNG, JPEG or WebP file.' };
    }

    const id = crypto.randomUUID();
    const path = `tournaments/${tournamentId}/base/${accountId}/${id}.webp`;
    const bucket = supabase.storage.from(MEDIA_BUCKET);
    const { error: uploadError } = await bucket.upload(path, buffer, { contentType: 'image/webp', upsert: false });
    if (uploadError) throw new Error('Image upload failed. Please retry.');
    const now = new Date().toISOString();
    const { error: insertError } = await supabase.from('media_assets').insert({
      id, account_id: accountId, storage_path: path, file_name: file.name,
      media_type: 'image', mime_type: 'image/webp', size_bytes: buffer.length,
      tags: ['Tournament'], aspect_class: aspect, processed_status: 'ready', processed_at: now,
      derived_variants: { original: path },
      source_metadata: { purpose: 'tournament_base', tournament_id: tournamentId },
    });
    if (insertError) {
      const { error } = await bucket.remove([path]);
      if (error) console.error('[tournament-images] Failed upload cleanup', { assetId: id });
      throw new Error('Could not save the image. Please retry.');
    }
    const column = aspect === 'square' ? 'base_image_square_id' : 'base_image_story_id';
    const previousId = aspect === 'square' ? tournament.baseImageSquareId : tournament.baseImageStoryId;
    let update = supabase.from('tournaments').update({ [column]: id, updated_at: now })
      .eq('id', tournamentId).eq('account_id', accountId);
    // Do not silently replace a newer upload from another open settings window.
    update = previousId ? update.eq(column, previousId) : update.is(column, null);
    const { data: saved, error: saveError } = await update.select('id').maybeSingle();
    if (saveError || !saved) {
      // Keep the unique original if the save result is uncertain: a lost response
      // must never delete an image which the tournament now references.
      throw new Error('Could not confirm the image was saved. Reload settings before retrying.');
    }
    revalidatePath(`/tournaments/${tournamentId}`);
    return { success: true };
  } catch (error) {
    console.error('[tournament-images] Upload failed', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: error instanceof z.ZodError ? 'Invalid tournament upload.' : error instanceof Error && !error.message.startsWith('NEXT_REDIRECT') ? error.message : 'Please sign in again and retry.' };
  }
}
