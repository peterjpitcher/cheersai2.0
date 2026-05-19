/**
 * Media library types — maps to media_library and content_media tables.
 * Database columns are snake_case; TypeScript properties are camelCase.
 * Always use fromDb<T>() when converting raw DB rows.
 */

export interface MediaItem {
  id: string;
  accountId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSizeBytes: number | null;
  width: number | null;
  height: number | null;
  tags: string[];
  createdAt: Date;
}

export interface ContentMediaAttachment {
  id: string;
  contentItemId: string;
  mediaId: string;
  position: number;
  createdAt: Date;
}
