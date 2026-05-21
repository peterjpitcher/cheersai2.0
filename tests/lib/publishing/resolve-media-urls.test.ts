import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock Supabase service client before importing the module under test
const mockFrom = vi.fn();
const mockStorageFrom = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({
    from: mockFrom,
    storage: { from: mockStorageFrom },
  })),
}));

vi.mock('@/lib/constants', () => ({
  MEDIA_BUCKET: 'media',
}));

const { resolveMediaUrls } = await import('@/lib/publishing/resolve-media-urls');

describe('resolveMediaUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty arrays when no mediaIds provided', async () => {
    const result = await resolveMediaUrls({ mediaIds: [] });
    expect(result).toEqual({ signedUrls: [], failedCount: 0 });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('should sign storage paths via batch createSignedUrls', async () => {
    const mockAssets = [
      { id: 'asset-1', storage_path: 'uploads/photo1.jpg', derived_variants: null },
      { id: 'asset-2', storage_path: 'uploads/photo2.png', derived_variants: null },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: mockAssets, error: null }),
      }),
    });

    mockStorageFrom.mockReturnValue({
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [
          { path: 'uploads/photo1.jpg', signedUrl: 'https://signed.example.com/photo1', error: null },
          { path: 'uploads/photo2.png', signedUrl: 'https://signed.example.com/photo2', error: null },
        ],
        error: null,
      }),
    });

    const result = await resolveMediaUrls({ mediaIds: ['asset-1', 'asset-2'] });

    expect(result.signedUrls).toEqual([
      'https://signed.example.com/photo1',
      'https://signed.example.com/photo2',
    ]);
    expect(result.failedCount).toBe(0);
    expect(mockStorageFrom).toHaveBeenCalledWith('media');
  });

  it('should prefer story derived variant when placement is story', async () => {
    const mockAssets = [
      {
        id: 'asset-1',
        storage_path: 'uploads/photo1.jpg',
        derived_variants: { story: 'uploads/photo1-story.jpg', feed: 'uploads/photo1-feed.jpg' },
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: mockAssets, error: null }),
      }),
    });

    mockStorageFrom.mockReturnValue({
      createSignedUrls: vi.fn().mockImplementation((paths: string[]) => {
        return Promise.resolve({
          data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example.com/${p}`, error: null })),
          error: null,
        });
      }),
    });

    const result = await resolveMediaUrls({ mediaIds: ['asset-1'], placement: 'story' });

    expect(result.signedUrls).toHaveLength(1);
    expect(result.signedUrls[0]).toContain('photo1-story.jpg');
  });

  it('should prefer feed derived variant when placement is feed', async () => {
    const mockAssets = [
      {
        id: 'asset-1',
        storage_path: 'uploads/photo1.jpg',
        derived_variants: { story: 'uploads/photo1-story.jpg', feed: 'uploads/photo1-feed.jpg' },
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: mockAssets, error: null }),
      }),
    });

    mockStorageFrom.mockReturnValue({
      createSignedUrls: vi.fn().mockImplementation((paths: string[]) => {
        return Promise.resolve({
          data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example.com/${p}`, error: null })),
          error: null,
        });
      }),
    });

    const result = await resolveMediaUrls({ mediaIds: ['asset-1'], placement: 'feed' });

    expect(result.signedUrls).toHaveLength(1);
    expect(result.signedUrls[0]).toContain('photo1-feed.jpg');
  });

  it('should fall back to banner derived variant when no placement-specific variant exists', async () => {
    const mockAssets = [
      {
        id: 'asset-1',
        storage_path: 'uploads/photo1.jpg',
        derived_variants: { banner: 'uploads/photo1-banner.jpg' },
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: mockAssets, error: null }),
      }),
    });

    mockStorageFrom.mockReturnValue({
      createSignedUrls: vi.fn().mockImplementation((paths: string[]) => {
        return Promise.resolve({
          data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example.com/${p}`, error: null })),
          error: null,
        });
      }),
    });

    const result = await resolveMediaUrls({ mediaIds: ['asset-1'], placement: 'feed' });

    expect(result.signedUrls).toHaveLength(1);
    expect(result.signedUrls[0]).toContain('photo1-banner.jpg');
  });

  it('should strip media bucket prefix from storage paths', async () => {
    const mockAssets = [
      { id: 'asset-1', storage_path: 'media/uploads/photo1.jpg', derived_variants: null },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: mockAssets, error: null }),
      }),
    });

    const createSignedUrlsFn = vi.fn().mockResolvedValue({
      data: [{ path: 'uploads/photo1.jpg', signedUrl: 'https://signed.example.com/photo1', error: null }],
      error: null,
    });

    mockStorageFrom.mockReturnValue({ createSignedUrls: createSignedUrlsFn });

    await resolveMediaUrls({ mediaIds: ['asset-1'] });

    // Should have stripped 'media/' prefix before signing
    expect(createSignedUrlsFn).toHaveBeenCalledWith(
      ['uploads/photo1.jpg'],
      3600,
    );
  });

  it('should count failed assets when media_assets query fails', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      }),
    });

    const result = await resolveMediaUrls({ mediaIds: ['asset-1', 'asset-2'] });

    expect(result.signedUrls).toEqual([]);
    expect(result.failedCount).toBe(2);
  });

  it('should count failed assets when signing fails', async () => {
    const mockAssets = [
      { id: 'asset-1', storage_path: 'uploads/photo1.jpg', derived_variants: null },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: mockAssets, error: null }),
      }),
    });

    mockStorageFrom.mockReturnValue({
      createSignedUrls: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Signing failed' },
      }),
    });

    const result = await resolveMediaUrls({ mediaIds: ['asset-1'] });

    expect(result.signedUrls).toEqual([]);
    expect(result.failedCount).toBe(1);
  });

  it('should preserve input order when returning signed URLs', async () => {
    const mockAssets = [
      { id: 'asset-2', storage_path: 'uploads/b.jpg', derived_variants: null },
      { id: 'asset-1', storage_path: 'uploads/a.jpg', derived_variants: null },
      { id: 'asset-3', storage_path: 'uploads/c.jpg', derived_variants: null },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: mockAssets, error: null }),
      }),
    });

    mockStorageFrom.mockReturnValue({
      createSignedUrls: vi.fn().mockImplementation((paths: string[]) => {
        return Promise.resolve({
          data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}`, error: null })),
          error: null,
        });
      }),
    });

    // Request in a specific order
    const result = await resolveMediaUrls({ mediaIds: ['asset-1', 'asset-2', 'asset-3'] });

    expect(result.signedUrls).toEqual([
      'https://signed/uploads/a.jpg',
      'https://signed/uploads/b.jpg',
      'https://signed/uploads/c.jpg',
    ]);
  });
});
