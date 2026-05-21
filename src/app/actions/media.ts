'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { MEDIA_BUCKET } from '@/lib/constants';
import { normaliseTags } from '@/lib/library/tags';
import { isSchemaMissingError } from '@/lib/supabase/errors';
import type { MediaItem } from '@/types/media';

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapMediaRow(row: Record<string, unknown>): MediaItem {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    fileName: (row.file_name as string) ?? '',
    fileUrl: (row.storage_path as string) ?? (row.file_url as string) ?? '',
    fileType: (row.mime_type as string) ?? (row.file_type as string) ?? '',
    fileSizeBytes: (row.size_bytes as number) ?? (row.file_size_bytes as number) ?? null,
    width: (row.width as number) ?? null,
    height: (row.height as number) ?? null,
    tags: normaliseTags(row.tags as string[] | null),
    createdAt: new Date((row.uploaded_at as string) ?? (row.created_at as string)),
  };
}

// ---------------------------------------------------------------------------
// uploadMediaAction
// ---------------------------------------------------------------------------

/**
 * Server action to upload a media file.
 * Receives FormData with a 'file' field, uploads to Supabase Storage,
 * and inserts a record into the media_assets table.
 */
export async function uploadMediaAction(
  formData: FormData,
): Promise<{ data?: MediaItem; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return { error: 'No file provided' };
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return { error: `File is too large. Maximum size is 10 MB.` };
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return { error: `File type "${file.type}" is not supported. Allowed: JPEG, PNG, WebP, GIF.` };
    }

    // Generate storage path
    const ext = extractExtension(file.name, file.type);
    const assetId = crypto.randomUUID();
    const storagePath = `${accountId}/${assetId}/${sanitiseFileName(file.name)}.${ext}`;

    // Upload to Supabase Storage
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, arrayBuffer, {
        contentType: file.type,
        cacheControl: '31536000',
        upsert: false,
      });

    if (uploadError) {
      return { error: `Upload failed: ${uploadError.message}` };
    }

    // Insert record into media_assets table
    const now = new Date().toISOString();
    const { data, error: insertError } = await supabase
      .from('media_assets')
      .insert({
        id: assetId,
        account_id: accountId,
        storage_path: storagePath,
        file_name: file.name,
        media_type: 'image',
        mime_type: file.type,
        size_bytes: file.size,
        tags: [],
        processed_status: 'ready',
        processed_at: now,
        derived_variants: { original: storagePath },
      })
      .select('*')
      .single();

    if (insertError) {
      if (isSchemaMissingError(insertError)) {
        return { error: 'Database schema not ready. Please run migrations.' };
      }
      return { error: insertError.message };
    }

    revalidatePath('/library');
    revalidatePath('/create');

    return { data: mapMediaRow(data as Record<string, unknown>) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// deleteMediaAction
// ---------------------------------------------------------------------------

/**
 * Delete a media asset from the library and storage.
 * Checks that the asset belongs to the current account before deleting.
 */
export async function deleteMediaAction(
  mediaId: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    // Fetch the asset to get its storage path
    const { data: asset, error: fetchError } = await supabase
      .from('media_assets')
      .select('id, storage_path, derived_variants')
      .eq('id', mediaId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (fetchError) {
      return { error: fetchError.message };
    }

    if (!asset) {
      return { error: 'Media not found or access denied' };
    }

    // Collect all storage paths (original + derivatives)
    const pathsToDelete: string[] = [];
    if (asset.storage_path) {
      pathsToDelete.push(asset.storage_path);
    }
    const derived = (asset.derived_variants ?? {}) as Record<string, string>;
    for (const variantPath of Object.values(derived)) {
      if (variantPath && variantPath !== asset.storage_path) {
        pathsToDelete.push(variantPath);
      }
    }

    // Delete from storage
    if (pathsToDelete.length) {
      const { error: storageError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .remove(pathsToDelete);
      if (storageError) {
        console.error('[media] failed to delete storage objects:', storageError);
      }
    }

    // Delete from database
    const { error: deleteError } = await supabase
      .from('media_assets')
      .delete()
      .eq('id', mediaId)
      .eq('account_id', accountId);

    if (deleteError) {
      return { error: deleteError.message };
    }

    revalidatePath('/library');
    revalidatePath('/create');

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// updateMediaTags
// ---------------------------------------------------------------------------

/**
 * Update tags on a media asset.
 * Normalises tags before saving.
 */
export async function updateMediaTags(
  mediaId: string,
  tags: string[],
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const normalised = normaliseTags(tags);

    const { error } = await supabase
      .from('media_assets')
      .update({ tags: normalised })
      .eq('id', mediaId)
      .eq('account_id', accountId);

    if (error) {
      return { error: error.message };
    }

    revalidatePath('/library');
    revalidatePath('/create');

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// attachMediaToContent
// ---------------------------------------------------------------------------

/**
 * Attach media items to a content item via the content_media_attachments table.
 * Replaces existing attachments with the new set, preserving order via position.
 */
export async function attachMediaToContent(
  contentItemId: string,
  mediaIds: string[],
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    // Verify content item belongs to this account before modifying attachments
    const { data: item, error: itemError } = await supabase
      .from('content_items')
      .select('id')
      .eq('id', contentItemId)
      .eq('account_id', accountId)
      .single();

    if (itemError || !item) {
      return { error: 'Content item not found or access denied' };
    }

    // Verify all media-library rows belong to this account. The attachment
    // table references media_library, not media_assets.
    if (mediaIds.length > 0) {
      const { data: ownedMedia, error: mediaError } = await supabase
        .from('media_library')
        .select('id')
        .in('id', mediaIds)
        .eq('account_id', accountId);

      if (mediaError) {
        return { error: 'Failed to verify media ownership' };
      }

      const ownedIds = new Set((ownedMedia ?? []).map((m: { id: string }) => m.id));
      const unowned = mediaIds.filter((id) => !ownedIds.has(id));
      if (unowned.length > 0) {
        return { error: 'Some media assets do not belong to this account' };
      }
    }

    // Delete existing attachments for this content item
    const { error: deleteError } = await supabase
      .from('content_media_attachments')
      .delete()
      .eq('content_item_id', contentItemId);

    if (deleteError) {
      if (!isSchemaMissingError(deleteError)) {
        return { error: deleteError.message };
      }
    }

    // Insert new attachments with position = array index
    if (mediaIds.length) {
      const rows = mediaIds.map((mediaId, index) => ({
        content_item_id: contentItemId,
        media_id: mediaId,
        position: index,
      }));

      const { error: insertError } = await supabase
        .from('content_media_attachments')
        .insert(rows);

      if (insertError) {
        if (!isSchemaMissingError(insertError)) {
          return { error: insertError.message };
        }
      }
    }

    revalidatePath('/create');

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractExtension(fileName: string, mimeType: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex > 0 && dotIndex < fileName.length - 1) {
    return fileName.slice(dotIndex + 1).toLowerCase();
  }

  const mimeExtMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };

  return mimeExtMap[mimeType] ?? 'bin';
}

function sanitiseFileName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/\.[^.]+$/, '') // remove extension
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
