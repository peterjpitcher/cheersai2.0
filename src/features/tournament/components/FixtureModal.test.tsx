// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FixtureModal } from './FixtureModal';
import { getFixtureScreeningPreview } from '@/app/actions/tournament';
vi.mock('@/app/actions/tournament', () => ({ getFixtureScreeningPreview: vi.fn() }));
afterEach(cleanup);
describe('rugby fixture editor', () => {
  it('shows read-only hours, records confirmations and keeps London dates', async () => {
    const save = vi.fn().mockResolvedValue({ success: false, error: 'Confirmation rejected: closing conflict' });
    vi.mocked(getFixtureScreeningPreview).mockResolvedValue({ success: true, screening: { openingLabel: 'Showing from 12:00; start missed', kitchenLabel: 'Kitchen service 12:00 to 19:00', foodPromotion: { message: 'Book for food and rugby' } } as NonNullable<Awaited<ReturnType<typeof getFixtureScreeningPreview>>['screening']> });
    render(<FixtureModal open sport="rugby_union" tournamentId="t" onClose={() => {}} onSave={save} title="Edit test game" initial={{ matchNumber: 1, round: 'league_round', teamA: 'Italy', teamB: 'South Africa', teamsConfirmed: true, kickOffAt: '2026-11-07T11:40:00Z', contentRevision: 2 }} />);
    expect(screen.getByText(/Opening and kitchen times remain unchanged/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Verified linear TV channel'), { target: { value: 'Synthetic channel' } });
    fireEvent.change(screen.getByLabelText('Screen allocation'), { target: { value: 'Main' } });
    fireEvent.change(screen.getByLabelText('Broadcast verification'), { target: { value: 'confirmed' } });
    fireEvent.change(screen.getByLabelText('Pub screening decision'), { target: { value: 'confirmed' } });
    fireEvent.click(screen.getByText('Check current opening and food service'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Kitchen service 12:00 to 19:00'));
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({ screeningDecision: 'confirmed', broadcastDecision: 'confirmed', contentRevision: 2, kickOffAt: '2026-11-07T11:40:00.000Z' });
    expect(save.mock.calls[0][0].broadcastCheckedAt).toBeTruthy();
    expect(screen.getByText('Confirmation rejected: closing conflict')).toBeTruthy();
  });
});
