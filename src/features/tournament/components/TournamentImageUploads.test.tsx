// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentImageUploads } from './TournamentImageUploads';
import { getTournamentBaseImageUploads } from '@/app/actions/tournament-images';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/app/actions/tournament-images', () => ({ getTournamentBaseImageUploads: vi.fn() }));
const fetchMock = vi.fn();
const square = { id: 'image-1', fileName: 'rugby-square.png', aspectClass: 'square' as const, previewUrl: '/test-square.png' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(getTournamentBaseImageUploads).mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function chooseImage(aspect = 'square', file = new File(['image'], 'rugby.png', { type: 'image/png' })) {
  const input = screen.getByLabelText(new RegExp(`^(Upload|Replace) ${aspect} image$`)) as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  fireEvent.change(input, { target: { files: [file] } });
}

describe('tournament image uploads', () => {
  it('shows only attached images with upload and replacement controls', async () => {
    vi.mocked(getTournamentBaseImageUploads).mockResolvedValue([square]);
    render(<TournamentImageUploads tournamentId="tournament-1" />);
    expect(await screen.findByText('rugby-square.png')).toBeTruthy();
    expect(getTournamentBaseImageUploads).toHaveBeenCalledWith('tournament-1');
    expect(screen.getByLabelText('Replace square image')).toBeTruthy();
    expect(screen.getByLabelText('Upload story image')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText(/not added to the Library/)).toBeTruthy();
  });

  it('uploads immediately to the tournament endpoint and refreshes the attached preview', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.mocked(getTournamentBaseImageUploads).mockResolvedValueOnce([]).mockResolvedValue([square]);
    render(<TournamentImageUploads tournamentId="tournament-1" />);
    await chooseImage();
    expect(await screen.findByText('Square image saved for this tournament.')).toBeTruthy();
    expect(await screen.findByText('rugby-square.png')).toBeTruthy();
    expect(refresh).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tournaments/base-image');
    expect(request.method).toBe('POST');
    expect(request.body.get('tournamentId')).toBe('tournament-1');
    expect(request.body.get('aspect')).toBe('square');
    expect(request.body.get('file').name).toBe('rugby.png');
  });

  it('shows server validation errors and preserves the current image', async () => {
    vi.mocked(getTournamentBaseImageUploads).mockResolvedValue([square]);
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ success: false, error: 'Use a square image with a 1:1 ratio.' }) });
    render(<TournamentImageUploads tournamentId="tournament-1" />);
    await screen.findByText('rugby-square.png');
    await chooseImage();
    expect((await screen.findByRole('alert')).textContent).toContain('Use a square image with a 1:1 ratio.');
    expect(screen.getByText('rugby-square.png')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports a network failure without claiming the image was saved', async () => {
    fetchMock.mockRejectedValue(new Error('Offline'));
    render(<TournamentImageUploads tournamentId="tournament-1" />);
    await chooseImage('story');
    expect((await screen.findByRole('alert')).textContent).toContain('The upload could not be confirmed');
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText(/image saved/)).toBeNull();
  });

  it('rejects unsupported and oversized files before sending them', async () => {
    render(<TournamentImageUploads tournamentId="tournament-1" />);
    await chooseImage('square', new File(['gif'], 'image.gif', { type: 'image/gif' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Choose a PNG, JPEG or WebP image');
    const large = new File(['png'], 'large.png', { type: 'image/png' });
    Object.defineProperty(large, 'size', { value: 4 * 1024 * 1024 + 1 });
    await chooseImage('square', large);
    expect((await screen.findByRole('alert')).textContent).toContain('4 MB');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disables both uploads while one is pending', async () => {
    let complete!: (value: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    render(<TournamentImageUploads tournamentId="tournament-1" />);
    await chooseImage();
    expect((screen.getByLabelText('Upload square image') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Upload story image') as HTMLInputElement).disabled).toBe(true);
    complete({ ok: true, json: async () => ({ success: true }) });
    await screen.findByText('Square image saved for this tournament.');
  });

  it('allows retry after an initial image load failure', async () => {
    vi.mocked(getTournamentBaseImageUploads).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue([square]);
    render(<TournamentImageUploads tournamentId="tournament-1" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load tournament images');
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading images' }));
    expect(await screen.findByText('rugby-square.png')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
