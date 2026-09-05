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
