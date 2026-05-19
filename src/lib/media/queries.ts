/**
 * Media library data access — search, filter, and retrieve media assets.
 *
 * Queries the media_assets table (account-scoped via service-role client).
 * Provides tag overlap filtering and text search on file_name and tags.
 */

import { requireAuthContext } from '@/lib/auth/server';
import { normaliseTags } from '@/lib/library/tags';
import { isSchemaMissingError } from '@/lib/supabase/errors';
import type { MediaItem } from '@/types/media';

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/**
 * Map a media_assets DB row to the MediaItem interface.
 * Handles snake_case -> camelCase conversion.
 */
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
// getMediaByAccount
// ---------------------------------------------------------------------------

/**
 * Fetch media items for the current account with optional filtering.
 *
 * @param options.tags - Filter by tag overlap (items matching ANY of these tags)
 * @param options.search - Filter by ILIKE on file_name or tags
 * @param options.limit - Max results (default 50)
 * @param options.offset - Pagination offset (default 0)
 */
export async function getMediaByAccount(options?: {
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<MediaItem[]> {
  const { supabase, accountId } = await requireAuthContext();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  try {
    let query = supabase
      .from('media_assets')
      .select(
        'id, account_id, file_name, storage_path, mime_type, size_bytes, width, height, tags, uploaded_at',
      )
      .eq('account_id', accountId)
      .is('hidden_at', null);

    // Tag overlap filter: items matching ANY of the provided tags
    if (options?.tags?.length) {
      const normalised = normaliseTags(options.tags);
      if (normalised.length) {
        query = query.overlaps('tags', normalised);
      }
    }

    // Text search on file_name (ILIKE)
    if (options?.search?.trim()) {
      const searchTerm = `%${options.search.trim()}%`;
      query = query.ilike('file_name', searchTerm);
    }

    const { data, error } = await query
      .order('uploaded_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      if (isSchemaMissingError(error)) {
        return [];
      }
      throw error;
    }

    if (!data?.length) {
      return [];
    }

    return (data as Record<string, unknown>[]).map(mapMediaRow);
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return [];
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// getMediaById
// ---------------------------------------------------------------------------

/**
 * Retrieve a single media item by ID (account-scoped).
 */
export async function getMediaById(id: string): Promise<MediaItem | null> {
  const { supabase, accountId } = await requireAuthContext();

  try {
    const { data, error } = await supabase
      .from('media_assets')
      .select(
        'id, account_id, file_name, storage_path, mime_type, size_bytes, width, height, tags, uploaded_at',
      )
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) {
      if (isSchemaMissingError(error)) {
        return null;
      }
      throw error;
    }

    if (!data) {
      return null;
    }

    return mapMediaRow(data as Record<string, unknown>);
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return null;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// searchMedia
// ---------------------------------------------------------------------------

/**
 * Full-text search on file_name and tags array.
 * Returns up to 50 results ordered by most recent.
 */
export async function searchMedia(query: string): Promise<MediaItem[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return getMediaByAccount({ limit: 50 });
  }

  const { supabase, accountId } = await requireAuthContext();

  try {
    // Search file_name with ILIKE
    const searchTerm = `%${trimmed}%`;

    const { data, error } = await supabase
      .from('media_assets')
      .select(
        'id, account_id, file_name, storage_path, mime_type, size_bytes, width, height, tags, uploaded_at',
      )
      .eq('account_id', accountId)
      .is('hidden_at', null)
      .ilike('file_name', searchTerm)
      .order('uploaded_at', { ascending: false })
      .limit(50);

    if (error) {
      if (isSchemaMissingError(error)) {
        return [];
      }
      throw error;
    }

    if (!data?.length) {
      return [];
    }

    return (data as Record<string, unknown>[]).map(mapMediaRow);
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return [];
    }
    throw error;
  }
}
