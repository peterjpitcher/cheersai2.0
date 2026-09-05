// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateTournamentModal } from './CreateTournamentModal';
import { createTournament } from '@/app/actions/tournament';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/app/actions/tournament', () => ({ createTournament: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createTournament).mockResolvedValue({ success: true, tournamentId: 'created-tournament' });
});
afterEach(cleanup);

function fillName() {
  fireEvent.change(screen.getByPlaceholderText('e.g. FIFA World Cup 2026'), { target: { value: 'Nations Championship' } });
}

describe('tournament creation scheduling default', () => {
  it('creates a tournament with the selected three-day default', async () => {
    const close = vi.fn();
    render(<CreateTournamentModal open onClose={close} />);
    fillName();
    fireEvent.click(screen.getByRole('button', { name: '3 days before' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Tournament' }));
    await waitFor(() => expect(createTournament).toHaveBeenCalledWith(expect.objectContaining({ name: 'Nations Championship', postLeadHours: 72 })));
    expect(close).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith('/tournaments/created-tournament');
  });

  it('starts at one day and accepts custom hours without rounding', async () => {
    render(<CreateTournamentModal open onClose={vi.fn()} />);
    fillName();
    expect(screen.getByText('Schedule new content 1 day before each game kicks off.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Hours before kick-off'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Tournament' }));
    await waitFor(() => expect(createTournament).toHaveBeenCalledWith(expect.objectContaining({ postLeadHours: 25 })));
  });

  it('blocks invalid scheduling defaults and recovers when a valid preset is chosen', async () => {
    render(<CreateTournamentModal open onClose={vi.fn()} />);
    fillName();
    fireEvent.change(screen.getByLabelText('Hours before kick-off'), { target: { value: '169' } });
    const create = screen.getByRole('button', { name: 'Create Tournament' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(createTournament).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '7 days before' }));
    fireEvent.click(create);
    await waitFor(() => expect(createTournament).toHaveBeenCalledWith(expect.objectContaining({ postLeadHours: 168 })));
  });

  it('shows server failures without closing or navigating', async () => {
    vi.mocked(createTournament).mockResolvedValue({ success: false, error: 'Unable to create tournament' });
    const close = vi.fn();
    render(<CreateTournamentModal open onClose={close} />);
    fillName();
    fireEvent.click(screen.getByRole('button', { name: 'Create Tournament' }));
    expect(await screen.findByText('Unable to create tournament')).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
