/**
 * Client-side media upload helper for Supabase Storage.
 *
 * Validates file size (max 10MB) and type before upload.
 * Uses the existing signed-URL upload pattern from library actions.
 */

import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { MEDIA_BUCKET } from '@/lib/constants';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

const BUCKET_NAME = MEDIA_BUCKET;

export interface UploadResult {
  url: string;
  path: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
}

export interface UploadValidationError {
  code: 'FILE_TOO_LARGE' | 'INVALID_TYPE' | 'UPLOAD_FAILED';
  message: string;
}

/**
 * Validate a file before upload.
 * Returns null if valid, or an error object if invalid.
 */
export function validateMediaFile(file: File): UploadValidationError | null {
  if (file.size > MAX_FILE_SIZE) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      code: 'FILE_TOO_LARGE',
      message: `File is ${sizeMb} MB. Maximum allowed size is 10 MB.`,
    };
  }

  if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
    return {
      code: 'INVALID_TYPE',
      message: `File type "${file.type}" is not supported. Allowed: JPEG, PNG, WebP, GIF.`,
    };
  }

  return null;
}

/**
 * Upload a media file to Supabase Storage.
 *
 * Validates file size (max 10MB) and type (images only).
 * Generates a unique path: {accountId}/{uuid}.{ext}
 * Returns the upload result with URL and path, or an error string.
 */
export async function uploadMedia(
  file: File,
  accountId: string,
): Promise<{ data?: UploadResult; error?: string }> {
  const validationError = validateMediaFile(file);
  if (validationError) {
    return { error: validationError.message };
  }

  const ext = extractExtension(file.name, file.type);
  const uniqueId = crypto.randomUUID();
  const path = `${accountId}/${uniqueId}.${ext}`;

  const supabase = createBrowserSupabaseClient();

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
    });

  if (uploadError) {
    return { error: uploadError.message };
  }

  const { data: urlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(path);

  return {
    data: {
      url: urlData.publicUrl,
      path,
      fileName: file.name,
      fileType: file.type,
      fileSizeBytes: file.size,
    },
  };
}

/**
 * Delete a media file from Supabase Storage.
 */
export async function deleteMedia(
  path: string,
): Promise<{ success?: boolean; error?: string }> {
  const supabase = createBrowserSupabaseClient();

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([path]);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract a file extension from filename or mime type.
 */
function extractExtension(fileName: string, mimeType: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex > 0 && dotIndex < fileName.length - 1) {
    return fileName.slice(dotIndex + 1).toLowerCase();
  }

  // Fallback to mime type
  const mimeExtMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };

  return mimeExtMap[mimeType] ?? 'bin';
}
