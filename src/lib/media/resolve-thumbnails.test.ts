import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the import under test
// ---------------------------------------------------------------------------

const mockFrom = vi.fn();
const mockStorageFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  tryCreateServiceSupabaseClient: vi.fn(() => ({
    from: (...args: unknown[]) => mockFrom(...args),
    storage: { from: (...args: unknown[]) => mockStorageFrom(...args) },
  })),
}));

vi.mock('@/lib/library/data', () => ({
  resolvePreviewCandidates: vi.fn(({ storagePath }: { storagePath: string }) => [
    { path: storagePath, shape: 'square' as const },
  ]),
}));

vi.mock('@/lib/supabase/errors', () => ({
  isSchemaMissingError: vi.fn(() => false),
}));

import { resolveThumbnails } from '@/lib/media/resolve-thumbnails';
import { resolvePreviewCandidates } from '@/lib/library/data';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';
import { isSchemaMissingError } from '@/lib/supabase/errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chainable(data: unknown[] | null, error: unknown = null) {
  const obj: Record<string, ReturnType<typeof vi.fn>> = {};
  obj.select = vi.fn().mockReturnValue(obj);
  obj.in = vi.fn().mockReturnValue(obj);
  obj.order = vi.fn().mockReturnValue(obj);
  obj.returns = vi.fn().mockResolvedValue({ data, error });
  return obj;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveThumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolvePreviewCandidates).mockImplementation(({ storagePath }) => [
      { path: storagePath, shape: 'square' as const },
    ]);
  });

  it('returns empty map for empty input', async () => {
    const result = await resolveThumbnails([]);
    expect(result).toEqual(new Map());
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns empty map when service client is unavailable', async () => {
    vi.mocked(tryCreateServiceSupabaseClient).mockReturnValueOnce(null);

    const result = await resolveThumbnails(['content-1']);
    expect(result).toEqual(new Map());
  });

  it('resolves thumbnails via v2 attachments (preferred path)', async () => {
    const v2Chain = chainable([
      { content_item_id: 'c-1', media_id: 'media-1', position: 0 },
    ]);
    const assetChain = chainable([
      { id: 'media-1', storage_path: 'uploads/photo.jpg', derived_variants: null },
    ]);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'content_media_attachments') return v2Chain;
      if (table === 'media_assets') return assetChain;
      return chainable(null);
    });

    mockStorageFrom.mockReturnValue({
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [{ path: 'uploads/photo.jpg', signedUrl: 'https://signed/photo.jpg', error: null }],
        error: null,
      }),
    });

    const result = await resolveThumbnails(['c-1']);
    expect(result.get('c-1')).toBe('https://signed/photo.jpg');
  });

  it('prefers v2 attachments over v1 fallback', async () => {
    const v2Chain = chainable([
      { content_item_id: 'c-1', media_id: 'v2-media', position: 0 },
    ]);
    const v1Chain = chainable([
      { content_item_id: 'c-1', media_ids: ['v1-media'] },
    ]);
    const assetChain = chainable([
      { id: 'v2-media', storage_path: 'uploads/v2.jpg', derived_variants: null },
    ]);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'content_media_attachments') return v2Chain;
      if (table === 'content_variants') return v1Chain;
      if (table === 'media_assets') return assetChain;
      return chainable(null);
    });

    mockStorageFrom.mockReturnValue({
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [{ path: 'uploads/v2.jpg', signedUrl: 'https://signed/v2.jpg', error: null }],
        error: null,
      }),
    });

    const result = await resolveThumbnails(['c-1']);
    expect(result.get('c-1')).toBe('https://signed/v2.jpg');
  });

  it('falls back to v1 content_variants.media_ids when no v2 attachments', async () => {
    const v2Chain = chainable([]);
    const v1Chain = chainable([
      { content_item_id: 'c-1', media_ids: ['v1-media'] },
    ]);
    const assetChain = chainable([
      { id: 'v1-media', storage_path: 'uploads/v1.jpg', derived_variants: null },
    ]);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'content_media_attachments') return v2Chain;
      if (table === 'content_variants') return v1Chain;
      if (table === 'media_assets') return assetChain;
      return chainable(null);
    });

    mockStorageFrom.mockReturnValue({
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [{ path: 'uploads/v1.jpg', signedUrl: 'https://signed/v1.jpg', error: null }],
        error: null,
      }),
    });

    const result = await resolveThumbnails(['c-1']);
    expect(result.get('c-1')).toBe('https://signed/v1.jpg');
  });

  it('handles missing media_assets gracefully (schema error)', async () => {
    const v2Chain = chainable([
      { content_item_id: 'c-1', media_id: 'media-1', position: 0 },
    ]);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'content_media_attachments') return v2Chain;
      if (table === 'media_assets') {
        return chainable(null, { code: '42P01', message: 'relation does not exist' });
      }
      return chainable(null);
    });

    vi.mocked(isSchemaMissingError).mockReturnValue(true);

    const result = await resolveThumbnails(['c-1']);
    expect(result).toEqual(new Map());
  });

  it('respects attachment position ordering (lowest position wins)', async () => {
    const assetChain = chainable([
      { id: 'first-media', storage_path: 'uploads/first.jpg', derived_variants: null },
      { id: 'second-media', storage_path: 'uploads/second.jpg', derived_variants: null },
    ]);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'content_media_attachments') {
        // Simulate the DB returning rows ordered by position (ascending)
        const ordered = chainable([
          { content_item_id: 'c-1', media_id: 'first-media', position: 0 },
          { content_item_id: 'c-1', media_id: 'second-media', position: 1 },
        ]);
        return ordered;
      }
      if (table === 'media_assets') return assetChain;
      return chainable(null);
    });

    mockStorageFrom.mockReturnValue({
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [
          { path: 'uploads/first.jpg', signedUrl: 'https://signed/first.jpg', error: null },
          { path: 'uploads/second.jpg', signedUrl: 'https://signed/second.jpg', error: null },
        ],
        error: null,
      }),
    });

    const result = await resolveThumbnails(['c-1']);
    expect(result.get('c-1')).toBe('https://signed/first.jpg');
  });

  it('resolves multiple content items in a single call', async () => {
    const v2Chain = chainable([
      { content_item_id: 'c-1', media_id: 'media-a', position: 0 },
      { content_item_id: 'c-2', media_id: 'media-b', position: 0 },
    ]);
    const assetChain = chainable([
      { id: 'media-a', storage_path: 'uploads/a.jpg', derived_variants: null },
      { id: 'media-b', storage_path: 'uploads/b.jpg', derived_variants: null },
    ]);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'content_media_attachments') return v2Chain;
      if (table === 'media_assets') return assetChain;
      return chainable(null);
    });

    mockStorageFrom.mockReturnValue({
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [
          { path: 'uploads/a.jpg', signedUrl: 'https://signed/a.jpg', error: null },
          { path: 'uploads/b.jpg', signedUrl: 'https://signed/b.jpg', error: null },
        ],
        error: null,
      }),
    });

    const result = await resolveThumbnails(['c-1', 'c-2']);
    expect(result.size).toBe(2);
    expect(result.get('c-1')).toBe('https://signed/a.jpg');
    expect(result.get('c-2')).toBe('https://signed/b.jpg');
  });

  it('chooses placement-specific preview paths when the same asset is reused', async () => {
    vi.mocked(resolvePreviewCandidates).mockImplementation(({ storagePath, derivedVariants, placement }) => {
      const base = [
        { path: derivedVariants.square, shape: 'square' as const },
        { path: derivedVariants.story, shape: 'story' as const },
        { path: storagePath, shape: 'square' as const },
      ].filter((candidate): candidate is { path: string; shape: 'square' | 'story' } =>
        Boolean(candidate.path),
      );

      if (placement === 'story') {
        return [
          ...base.filter((candidate) => candidate.shape === 'story'),
          ...base.filter((candidate) => candidate.shape !== 'story'),
        ];
      }

      if (placement === 'feed') {
        return [
          ...base.filter((candidate) => candidate.path === storagePath),
          ...base.filter((candidate) => candidate.path !== storagePath),
        ];
      }

      return base;
    });

    const v2Chain = chainable([
      { content_item_id: 'c-feed', media_id: 'media-1', position: 0 },
      { content_item_id: 'c-story', media_id: 'media-1', position: 0 },
    ]);
    const contentChain = chainable([
      { id: 'c-feed', placement: 'feed', content_type: 'instant_post' },
      { id: 'c-story', placement: 'story', content_type: 'story' },
    ]);
    const assetChain = chainable([
      {
        id: 'media-1',
        storage_path: 'uploads/original.jpg',
        derived_variants: {
          square: 'derived/media-1/square.jpg',
          story: 'derived/media-1/story.jpg',
        },
      },
    ]);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'content_media_attachments') return v2Chain;
      if (table === 'content_items') return contentChain;
      if (table === 'media_assets') return assetChain;
      return chainable(null);
    });

    mockStorageFrom.mockReturnValue({
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [
          { path: 'uploads/original.jpg', signedUrl: 'https://signed/original.jpg', error: null },
          { path: 'derived/media-1/square.jpg', signedUrl: 'https://signed/square.jpg', error: null },
          { path: 'derived/media-1/story.jpg', signedUrl: 'https://signed/story.jpg', error: null },
        ],
        error: null,
      }),
    });

    const result = await resolveThumbnails(['c-feed', 'c-story']);

    expect(result.get('c-feed')).toBe('https://signed/original.jpg');
    expect(result.get('c-story')).toBe('https://signed/story.jpg');
    expect(resolvePreviewCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ placement: 'feed' }),
    );
    expect(resolvePreviewCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ placement: 'story' }),
    );
  });
});
