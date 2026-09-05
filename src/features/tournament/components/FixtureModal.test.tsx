// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FixtureModal } from './FixtureModal';
import { getFixtureScreeningPreview } from '@/app/actions/tournament';
vi.mock('@/app/actions/tournament', () => ({ getFixtureScreeningPreview: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('rugby fixture editor', () => {
  it('shows read-only hours, records confirmations and keeps London dates', async () => {
    const save = vi.fn().mockResolvedValue({ success: false, error: 'Confirmation rejected: closing conflict' });
    vi.mocked(getFixtureScreeningPreview).mockResolvedValue({ success: true, screening: { openingLabel: 'Showing from 12:00; start missed', kitchenLabel: 'Kitchen service 12:00 to 19:00', foodPromotion: { message: 'Book for food and rugby' } } as NonNullable<Awaited<ReturnType<typeof getFixtureScreeningPreview>>['screening']> });
    render(<FixtureModal open sport="rugby_union" tournamentId="t" onClose={() => {}} onSave={save} title="Edit test game" initial={{ matchNumber: 1, round: 'league_round', teamA: 'Italy', teamB: 'South Africa', teamsConfirmed: true, kickOffAt: '2026-11-07T11:40:00Z', contentRevision: 2 }} />);
    expect(screen.getByText(/Opening and kitchen times remain unchanged/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('TV channel (optional)'), { target: { value: 'Synthetic channel' } });
    fireEvent.change(screen.getByLabelText('Screen allocation (optional)'), { target: { value: 'Main' } });
    fireEvent.change(screen.getByLabelText('Broadcast verification'), { target: { value: 'confirmed' } });
    fireEvent.click(screen.getByLabelText('Showing at venue: approve match bookings'));
    fireEvent.change(screen.getByLabelText('Detailed screen setup'), { target: { value: 'confirmed' } });
    fireEvent.click(screen.getByText('Check current opening and food service'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Kitchen service 12:00 to 19:00'));
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({ screeningDecision: 'confirmed', broadcastDecision: 'confirmed', contentRevision: 2, kickOffAt: '2026-11-07T11:40:00.000Z' });
    expect(save.mock.calls[0][0].showing).toBe(true);
    expect(save.mock.calls[0][0].screeningConfirmedAt).toBeTruthy();
    expect(save.mock.calls[0][0].broadcastCheckedAt).toBeTruthy();
    expect(screen.getByText('Confirmation rejected: closing conflict')).toBeTruthy();
  });

  it('approves bookings and generation without inventing detailed screen setup', async () => {
    const save = vi.fn().mockResolvedValue({ success: true });
    const generate = vi.fn().mockResolvedValue({ success: true });
    render(<FixtureModal open sport="rugby_union" onClose={() => {}} onSave={save} onSaveAndGenerate={generate} title="Edit game" initial={{ matchNumber: 1, round: 'league_round', teamA: 'Italy', teamB: 'South Africa', teamsConfirmed: true, kickOffAt: '2026-11-07T11:40:00Z', showing: false, screeningDecision: 'not_showing', linearChannel: null, screenLabel: null, plannedEndAt: null, commentary: 'unconfirmed', broadcastDecision: 'confirmed' }} />);
    expect((screen.getByRole('button', { name: 'Save & Generate' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Showing at venue: approve match bookings'));
    expect((screen.getByRole('button', { name: 'Save & Generate' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save & Generate' }));
    await waitFor(() => expect(generate).toHaveBeenCalledOnce());
    expect(generate.mock.calls[0][0]).toMatchObject({ showing: true, screeningDecision: 'unconfirmed', broadcastDecision: 'confirmed', linearChannel: null, screenLabel: null, plannedEndAt: null, commentary: 'unconfirmed' });
    expect(generate.mock.calls[0][0].screeningConfirmedAt).toEqual(expect.any(String));
    expect(save).not.toHaveBeenCalled();
  });

  it('withdraws booking approval explicitly when showing is unchecked', async () => {
    const save = vi.fn().mockResolvedValue({ success: true });
    render(<FixtureModal open sport="rugby_union" onClose={() => {}} onSave={save} title="Edit game" initial={{ matchNumber: 1, teamA: 'Italy', teamB: 'South Africa', kickOffAt: '2026-11-07T11:40:00Z', showing: true, screeningDecision: 'confirmed', screeningConfirmedAt: '2026-09-05T10:00:00Z' }} />);
    fireEvent.click(screen.getByLabelText('Showing at venue: approve match bookings'));
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ showing: false, screeningDecision: 'not_showing', screeningConfirmedAt: null });
  });

  it('keeps owner approval when detailed setup is still unconfirmed', async () => {
    const save = vi.fn().mockResolvedValue({ success: true });
    render(<FixtureModal open sport="rugby_union" onClose={() => {}} onSave={save} title="Edit game" initial={{ matchNumber: 1, teamA: 'Italy', teamB: 'South Africa', kickOffAt: '2026-11-07T11:40:00Z', showing: true, screeningDecision: 'confirmed', screeningConfirmedAt: '2026-09-05T10:00:00Z' }} />);
    fireEvent.change(screen.getByLabelText('Detailed screen setup'), { target: { value: 'unconfirmed' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ showing: true, screeningDecision: 'unconfirmed', screeningConfirmedAt: '2026-09-05T10:00:00Z' });
  });
});
