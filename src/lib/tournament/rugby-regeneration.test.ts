import { describe, expect, it, vi } from 'vitest';
import { generateFixtureContent } from './generate';
import { getPublishedPlacements } from './queries';
import { compositeOverlay } from './overlay';
import type { Tournament, TournamentFixture } from '@/types/tournament';
vi.mock('./queries', () => ({ getPublishedPlacements: vi.fn().mockResolvedValue(new Set(['facebook:feed','facebook:story'])) }));
vi.mock('./screening-service', () => ({ projectTournamentFixtures: vi.fn().mockResolvedValue([{ screening: { canGenerateTeamPromotion: true } }]) }));
vi.mock('./overlay', () => ({ compositeOverlay: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => ({ rpc: vi.fn().mockResolvedValue({ error: null }), from: () => ({ update: () => ({ eq: async () => ({ error: null }) }), select: () => ({ eq: () => ({ single: async () => ({ data: { content_generated: false }, error: null }) }) }) }) }) }));
describe('rugby regeneration after an ordinary fixture save', () => {
  it('never recreates published placements when contentGenerated has been reset', async () => {
    const tournament = { id: 't', accountId: 'a', sport: 'rugby_union', status: 'active', platforms: ['facebook'], baseImageSquareId: 'square', baseImageStoryId: 'story' } as Tournament;
    await generateFixtureContent(tournament, { id: 'f', contentGenerated: false } as TournamentFixture, 0, { skipLock: true });
    expect(getPublishedPlacements).toHaveBeenCalledWith(expect.anything(), 'f', 'a');
    expect(compositeOverlay).not.toHaveBeenCalled();
  });
});
