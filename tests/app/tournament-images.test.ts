import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTournamentBaseImageUploads, uploadTournamentBaseImage } from '@/app/actions/tournament-images';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), tournament: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: mocks.auth }));
vi.mock('@/lib/tournament/queries', () => ({ getTournamentById: mocks.tournament }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));

const tournamentId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const oldSquare = '33333333-3333-4333-8333-333333333333';
const oldStory = '44444444-4444-4444-8444-444444444444';
const bucket = { upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() };
const media = { insert: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn() };
const update = { eq: vi.fn(), is: vi.fn(), select: vi.fn(), maybeSingle: vi.fn() };
const tournaments = { update: vi.fn() };
const supabase = { from: vi.fn(), storage: { from: vi.fn() } };

async function imageFile(width = 100, height = 100): Promise<File> {
  const bytes = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).png().toBuffer();
  return new File([new Uint8Array(bytes)], 'artwork.png', { type: 'image/png' });
}
function form(file?: File, aspect = 'square'): FormData {
  const data = new FormData();
  data.set('tournamentId', tournamentId);
  data.set('aspect', aspect);
  if (file) data.set('file', file);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.auth.mockResolvedValue({ supabase, accountId });
  mocks.tournament.mockResolvedValue({ baseImageSquareId: oldSquare, baseImageStoryId: oldStory });
  supabase.from.mockImplementation((table: string) => {
    if (table === 'media_assets') return media;
    if (table === 'tournaments') return tournaments;
    throw new Error(`Unexpected table: ${table}`);
  });
  supabase.storage.from.mockReturnValue(bucket);
  bucket.upload.mockResolvedValue({ error: null });
  bucket.remove.mockResolvedValue({ error: null });
  bucket.createSignedUrl.mockImplementation(async (path: string) => ({ data: { signedUrl: `https://example.test/${path}` }, error: null }));
  media.insert.mockResolvedValue({ error: null });
  media.select.mockReturnValue(media);
  media.eq.mockReturnValue(media);
  media.in.mockResolvedValue({ data: [
    { id: oldSquare, file_name: 'square.png', storage_path: 'square.webp' },
    { id: oldStory, file_name: 'story.png', storage_path: 'story.webp' },
  ], error: null });
  tournaments.update.mockReturnValue(update);
  update.eq.mockReturnValue(update);
  update.is.mockReturnValue(update);
  update.select.mockReturnValue(update);
  update.maybeSingle.mockResolvedValue({ data: { id: tournamentId }, error: null });
});

describe('tournament-only image uploads', () => {
  it.each([['square', 100, 100, 'base_image_square_id', oldSquare, 1080], ['story', 90, 160, 'base_image_story_id', oldStory, 1920]] as const)(
    'normalises a valid %s image and updates only its slot', async (aspect, width, height, column, previous, outputHeight) => {
      expect(await uploadTournamentBaseImage(form(await imageFile(width, height), aspect))).toEqual({ success: true });
      expect(mocks.tournament).toHaveBeenCalledWith(supabase, tournamentId, accountId);
      const row = media.insert.mock.calls[0][0];
      expect(row).toMatchObject({ account_id: accountId, tags: ['Tournament'], aspect_class: aspect, mime_type: 'image/webp', source_metadata: { purpose: 'tournament_base', tournament_id: tournamentId } });
      expect(row.storage_path).toBe(`tournaments/${tournamentId}/base/${accountId}/${row.id}.webp`);
      expect(row.derived_variants).toEqual({ original: row.storage_path });
      const metadata = await sharp(bucket.upload.mock.calls[0][1]).metadata();
      expect(metadata).toMatchObject({ format: 'webp', width: 1080, height: outputHeight });
      expect(tournaments.update).toHaveBeenCalledWith({ [column]: row.id, updated_at: expect.any(String) });
      expect(update.eq).toHaveBeenCalledWith('account_id', accountId);
      expect(update.eq).toHaveBeenCalledWith(column, previous);
      expect(supabase.from.mock.calls.map(([table]) => table)).toEqual(['media_assets', 'tournaments']);
      expect(mocks.revalidate).toHaveBeenCalledWith(`/tournaments/${tournamentId}`);
    },
  );
  it('uses an empty-slot guard on first upload', async () => {
    mocks.tournament.mockResolvedValue({ baseImageSquareId: null, baseImageStoryId: oldStory });
    expect((await uploadTournamentBaseImage(form(await imageFile()))).success).toBe(true);
    expect(update.is).toHaveBeenCalledWith('base_image_square_id', null);
  });
  it('rejects tournaments outside the authenticated account before uploading', async () => {
    mocks.tournament.mockResolvedValue(null);
    expect(await uploadTournamentBaseImage(form())).toEqual({ success: false, error: 'Tournament not found' });
    expect(bucket.upload).not.toHaveBeenCalled();
  });
  it('fails closed if authentication fails', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    expect(await uploadTournamentBaseImage(form())).toEqual({ success: false, error: 'Please sign in again and retry.' });
    expect(supabase.from).not.toHaveBeenCalled();
  });
  it.each([
    ['missing', undefined, 'Choose an image'],
    ['empty', new File([], 'empty.png', { type: 'image/png' }), 'Choose an image'],
    ['large', new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }), '4 MB'],
    ['unsupported', new File(['text'], 'file.svg', { type: 'image/svg+xml' }), 'PNG, JPEG or WebP'],
    ['corrupt', new File(['not an image'], 'file.png', { type: 'image/png' }), 'could not be read'],
  ])('rejects %s input without saving', async (_label, file, error) => {
    const result = await uploadTournamentBaseImage(form(file as File | undefined));
    expect(result.success).toBe(false);
    expect(result.error).toContain(error);
    expect(bucket.upload).not.toHaveBeenCalled();
    expect(media.insert).not.toHaveBeenCalled();
  });
  it.each(['square', 'story'])('rejects incorrect dimensions for %s', async (aspect) => {
    expect(await uploadTournamentBaseImage(form(await imageFile(200, 100), aspect))).toMatchObject({ success: false, error: expect.stringContaining(aspect) });
    expect(bucket.upload).not.toHaveBeenCalled();
  });
  it('reports storage upload failure without creating asset records', async () => {
    bucket.upload.mockResolvedValue({ error: { message: 'storage down' } });
    expect(await uploadTournamentBaseImage(form(await imageFile()))).toEqual({ success: false, error: 'Image upload failed. Please retry.' });
    expect(media.insert).not.toHaveBeenCalled();
  });
  it('removes the new object when asset insertion fails', async () => {
    media.insert.mockResolvedValue({ error: { message: 'database down' } });
    expect(await uploadTournamentBaseImage(form(await imageFile()))).toEqual({ success: false, error: 'Could not save the image. Please retry.' });
    expect(bucket.remove).toHaveBeenCalledWith([bucket.upload.mock.calls[0][0]]);
    expect(tournaments.update).not.toHaveBeenCalled();
  });
  it.each([{ data: null, error: { message: 'connection lost' } }, { data: null, error: null }])('reports failed or concurrent saves and preserves potentially attached image', async (result) => {
    update.maybeSingle.mockResolvedValue(result);
    expect(await uploadTournamentBaseImage(form(await imageFile()))).toEqual({ success: false, error: 'Could not confirm the image was saved. Reload settings before retrying.' });
    expect(bucket.remove).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe('attached tournament image previews', () => {
  it('loads only attached IDs scoped to the owner and signs both slots', async () => {
    expect(await getTournamentBaseImageUploads(tournamentId)).toEqual([
      { id: oldSquare, fileName: 'square.png', aspectClass: 'square', previewUrl: 'https://example.test/square.webp' },
      { id: oldStory, fileName: 'story.png', aspectClass: 'story', previewUrl: 'https://example.test/story.webp' },
    ]);
    expect(media.eq).toHaveBeenCalledWith('account_id', accountId);
    expect(media.in).toHaveBeenCalledWith('id', [oldSquare, oldStory]);
    expect(bucket.createSignedUrl).toHaveBeenCalledWith('square.webp', 600);
    expect(media.insert).not.toHaveBeenCalled();
  });
  it('does not browse media when no images are attached', async () => {
    mocks.tournament.mockResolvedValue({ baseImageSquareId: null, baseImageStoryId: null });
    expect(await getTournamentBaseImageUploads(tournamentId)).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });
  it('rejects a missing or other-account tournament before reading media', async () => {
    mocks.tournament.mockResolvedValue(null);
    await expect(getTournamentBaseImageUploads(tournamentId)).rejects.toThrow('Tournament not found');
    expect(supabase.from).not.toHaveBeenCalled();
  });
  it('reports a media query failure', async () => {
    media.in.mockResolvedValue({ data: null, error: { message: 'failed' } });
    await expect(getTournamentBaseImageUploads(tournamentId)).rejects.toThrow('Could not load tournament images');
  });
  it('reports inaccessible attached assets without signing them', async () => {
    media.in.mockResolvedValue({ data: [], error: null });
    await expect(getTournamentBaseImageUploads(tournamentId)).rejects.toThrow('upload a replacement');
    expect(bucket.createSignedUrl).not.toHaveBeenCalled();
  });
  it('reports signing failure rather than returning a broken preview', async () => {
    bucket.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'failed' } });
    await expect(getTournamentBaseImageUploads(tournamentId)).rejects.toThrow('Could not load image preview');
  });
});
