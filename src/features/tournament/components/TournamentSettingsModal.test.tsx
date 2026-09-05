// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentSettingsModal } from './TournamentSettingsModal';
import { getTournamentBaseImageUploads } from '@/app/actions/tournament-images';
import { updateTournament } from '@/app/actions/tournament';
import type { Tournament } from '@/types/tournament';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/actions/tournament-images', () => ({ getTournamentBaseImageUploads: vi.fn() }));
vi.mock('@/app/actions/tournament', () => ({
  updateTournament: vi.fn(), updateTournamentStatus: vi.fn(), deleteTournament: vi.fn(),
  regenerateFeedApiKey: vi.fn(), disableFeedApiKey: vi.fn(),
}));
const tournament: Tournament = {
  id: 'tournament-1', accountId: 'account-1', name: 'Test tournament', slug: 'test-tournament', status: 'draft',
  baseImageSquareId: null, baseImageStoryId: null, houseRulesText: null, postTemplate: 'Test template',
  platforms: ['facebook'], postLeadHours: 24, feedApiKey: null, createdAt: '', updatedAt: '',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTournamentBaseImageUploads).mockResolvedValue([]);
  vi.mocked(updateTournament).mockResolvedValue({ success: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('tournament settings with immediate image uploads', () => {
  it('saves the three-day preset as 72 hours for this tournament', async () => {
    const close = vi.fn();
    render(<TournamentSettingsModal tournament={tournament} open onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: '3 days before' }));
    expect(screen.getByText('Schedule new content 3 days before each game kicks off.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(updateTournament).toHaveBeenCalledWith(tournament.id, expect.objectContaining({ postLeadHours: 72 })));
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves a legacy custom hour value and resets from the tournament on reopening', async () => {
    const close = vi.fn();
    const custom = { ...tournament, postLeadHours: 25 };
    const { rerender } = render(<TournamentSettingsModal tournament={custom} open onClose={close} />);
    expect((screen.getByLabelText('Hours before kick-off') as HTMLInputElement).value).toBe('25');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(updateTournament).toHaveBeenCalledWith(tournament.id, expect.objectContaining({ postLeadHours: 25 })));
    fireEvent.click(screen.getByRole('button', { name: '3 days before' }));
    rerender(<TournamentSettingsModal tournament={custom} open={false} onClose={close} />);
    rerender(<TournamentSettingsModal tournament={custom} open onClose={close} />);
    expect((screen.getByLabelText('Hours before kick-off') as HTMLInputElement).value).toBe('25');
  });

  it.each(['', '0', '169', '1.5'])('rejects invalid hours %j without clamping or saving', async value => {
    render(<TournamentSettingsModal tournament={tournament} open onClose={vi.fn()} />);
    const input = screen.getByLabelText('Hours before kick-off') as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
    expect(input.value).toBe(value);
    expect(screen.getByText('Enter a whole number from 1 to 168 hours (up to 7 days).')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it('keeps the modal open and explains a failed save', async () => {
    vi.mocked(updateTournament).mockResolvedValue({ success: false, error: 'Unable to save tournament' });
    const close = vi.fn();
    render(<TournamentSettingsModal tournament={tournament} open onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: '3 days before' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Unable to save tournament')).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it('prevents closing or saving while an upload is pending, then saves other settings without changing images', async () => {
    let complete!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { complete = resolve; })));
    const close = vi.fn();
    render(<TournamentSettingsModal tournament={tournament} open onClose={close} />);
    const input = screen.getByLabelText('Upload square image') as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { files: [new File(['image'], 'rugby.png', { type: 'image/png' })] } });
    expect((screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Close settings' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(close).not.toHaveBeenCalled();
    complete({ ok: true, json: async () => ({ success: true }) });
    await screen.findByText('Square image saved for this tournament.');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(updateTournament).toHaveBeenCalledWith('tournament-1', {
      name: 'Test tournament', houseRulesText: null, postTemplate: 'Test template', postLeadHours: 24, platforms: ['facebook'],
    });
  });
});
