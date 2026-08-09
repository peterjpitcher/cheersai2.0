import { describe, expect, it } from 'vitest';
import { headlineStatesAConcreteFact, validateCampaignCopy } from '@/lib/campaigns/generate';
import type { AiCampaignPayload } from '@/types/campaigns';

// Terms a Cowboys & Queens style brief would supply.
const BRIEF = 'Cowboys & Queens Country Music Bingo on Friday with Nikki Manfadge. '
  + 'Two rounds of country hits, prizes on the night, dress western for extra points.';
const terms = new Set(
  BRIEF.toLowerCase().split(/[^a-z']+/).filter((w) => w.length >= 4),
);

describe('headlineStatesAConcreteFact', () => {
  it('rejects headlines that only convey mood or urgency', () => {
    // The four examples called out in the August 2026 Meta ads change brief.
    for (const headline of [
      'Instant Fun Awaits!',
      'Quiz Night Awaits!',
      'Quiz & Laughs!',
      'Tonight Only: Book Now!',
    ]) {
      expect(headlineStatesAConcreteFact(headline, terms), headline).toBe(false);
    }
  });

  it('accepts a price, a number, or a date', () => {
    for (const headline of [
      'Nikki Hosts Country Bingo, £5',
      '£5 Country Bingo, Two Rounds',
      'Dinner 4pm, Bingo 7pm, £5',
      'Country Music Bingo, Fri 14 Aug',
      'Free Entry Before 7pm',
    ]) {
      expect(headlineStatesAConcreteFact(headline, terms), headline).toBe(true);
    }
  });

  it('accepts a host name or named theme drawn from the brief', () => {
    expect(headlineStatesAConcreteFact('Dress Western for Extra Points', terms)).toBe(true);
    expect(headlineStatesAConcreteFact("Nikki's Country Bingo", terms)).toBe(true);
  });

  it('does not credit a word the brief never used', () => {
    expect(headlineStatesAConcreteFact('Karaoke Legends Return', terms)).toBe(false);
  });

  it('falls back to self-evident signals when no brief is supplied', () => {
    const none = new Set<string>();
    expect(headlineStatesAConcreteFact('£5 Bingo Night', none)).toBe(true);
    expect(headlineStatesAConcreteFact('Quiz Night Awaits!', none)).toBe(false);
  });
});

describe('validateCampaignCopy vague_headline', () => {
  const payload = (headline: string): AiCampaignPayload => ({
    objective: 'OUTCOME_TRAFFIC',
    special_ad_category: 'NONE',
    ad_sets: [{
      name: 'Booking Push',
      optimisation_goal: 'LINK_CLICKS',
      targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
      placements: 'AUTO',
      ads: [{
        name: 'Var 1',
        headline,
        primary_text: 'Cowboys & Queens Music Bingo on Friday, £5 entry, pay on arrival. Book your table for two rounds of country hits.',
        description: 'Two rounds, prizes',
        cta: 'BOOK_NOW',
        angle: 'Specific prize or mechanic',
        creative_format: 'venue_photo',
      }],
    }],
  } as unknown as AiCampaignPayload);

  it('flags a vague headline as a hard issue', () => {
    const issues = validateCampaignCopy(payload('Quiz Night Awaits!'), { campaignKind: 'event', problemBrief: BRIEF });
    expect(issues.map((i) => i.code)).toContain('vague_headline');
  });

  it('passes a headline carrying a price', () => {
    const issues = validateCampaignCopy(payload('£5 Country Bingo, Two Rounds'), { campaignKind: 'event', problemBrief: BRIEF });
    expect(issues.map((i) => i.code)).not.toContain('vague_headline');
  });

  it('leaves food_booking headlines to their own service rules', () => {
    const issues = validateCampaignCopy(payload('Quiz Night Awaits!'), { campaignKind: 'food_booking', problemBrief: BRIEF });
    expect(issues.map((i) => i.code)).not.toContain('vague_headline');
  });
});
