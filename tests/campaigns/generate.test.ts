import { describe, it, expect } from 'vitest';
import { enforceAdSetConstraints } from '@/lib/campaigns/generate';
import type { AiCampaignPayload } from '@/types/campaigns';

type AdSetInput = AiCampaignPayload['ad_sets'][number];

function makeAd(overrides: Partial<AdSetInput['ads'][number]> = {}): AdSetInput['ads'][number] {
  return {
    name: 'Variation 1',
    headline: 'Test headline',
    primary_text: 'Test primary text for this ad variation.',
    description: 'Test desc',
    cta: 'LEARN_MORE',
    angle: 'Value for money',
    creative_brief: 'Show a happy group',
    ...overrides,
  };
}

function makeAdSet(ads: AdSetInput['ads']): AdSetInput {
  return {
    name: 'Test Ad Set',
    phase_label: 'Run-up',
    phase_start: '2026-03-10',
    phase_end: '2026-03-16',
    audience_description: 'Local adults 25-45',
    targeting: {
      age_min: 25,
      age_max: 45,
      geo_locations: { countries: ['GB'] },
      interests: [{ id: 'invented-interest', name: 'Pubs' }],
    },
    placements: 'AUTO',
    optimisation_goal: 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    ads,
  };
}

describe('enforceAdSetConstraints', () => {
  it('trims to exactly 3 ads when AI returns more', () => {
    const adSet = makeAdSet([makeAd(), makeAd(), makeAd(), makeAd(), makeAd()]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(3);
  });

  it('pads to 3 ads when AI returns fewer (duplicates last)', () => {
    const adSet = makeAdSet([makeAd({ headline: 'Only one' })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(3);
    expect(result.ads[1].headline).toBe('Only one');
    expect(result.ads[2].headline).toBe('Only one');
  });

  it('keeps exactly 3 ads unchanged', () => {
    const ads = [makeAd({ angle: 'A' }), makeAd({ angle: 'B' }), makeAd({ angle: 'C' })];
    const adSet = makeAdSet(ads);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(3);
    expect(result.ads[0].angle).toBe('A');
  });

  it('throws if AI returns 0 ads', () => {
    const adSet = makeAdSet([]);
    expect(() => enforceAdSetConstraints(adSet)).toThrow();
  });

  it('truncates headline to 40 chars', () => {
    const adSet = makeAdSet([makeAd({ headline: 'A'.repeat(50) })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].headline).toHaveLength(40);
  });

  it('truncates primary_text to 350 chars', () => {
    const adSet = makeAdSet([makeAd({ primary_text: 'A'.repeat(400) })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].primary_text).toHaveLength(350);
  });

  it('truncates description to 25 chars', () => {
    const adSet = makeAdSet([makeAd({ description: 'A'.repeat(30) })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].description).toHaveLength(25);
  });

  it('overwrites AI targeting with deterministic broad Meta defaults', () => {
    const adSet = makeAdSet([makeAd()]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.targeting).toEqual({
      age_min: 18,
      age_max: 65,
      geo_locations: { countries: ['GB'] },
    });
    expect(result.optimisation_goal).toBe('LINK_CLICKS');
    expect(result.placements).toBe('AUTO');
  });
});
