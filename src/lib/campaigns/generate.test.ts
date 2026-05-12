import { describe, it, expect, vi } from 'vitest';

import type { AiCampaignPayload } from '@/types/campaigns';
import { validateCampaignCopy, attemptCopyCorrection } from './generate';

function makeAd(overrides: Partial<AiCampaignPayload['ad_sets'][number]['ads'][number]> = {}) {
  return {
    name: 'Ad 1',
    headline: 'Book your seats now',
    primary_text: 'Grab your table for Quiz Night this Thursday. No payment now — just reserve and pay on the night. Teams of up to 6, £2 per person.',
    description: 'Reserve your table',
    cta: 'BOOK_NOW' as const,
    creative_brief: 'Fun quiz night atmosphere',
    angle: 'Booking urgency',
    ...overrides,
  };
}

function makePayload(ads: AiCampaignPayload['ad_sets'][number]['ads'][number][]): AiCampaignPayload {
  return {
    objective: 'OUTCOME_SALES',
    rationale: 'Test rationale',
    campaign_name: 'Test Campaign',
    special_ad_category: 'NONE',
    audience_keywords: ['pub quiz'],
    ad_sets: [
      {
        name: 'Run-up',
        phase_label: 'Run-up',
        phase_start: '2026-05-10',
        phase_end: '2026-05-12',
        audience_description: 'Local pub goers',
        targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
        placements: 'AUTO',
        optimisation_goal: 'LINK_CLICKS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        ads,
      },
    ],
  };
}

function makeMockClient(responseContent: string | null) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: responseContent } }],
        }),
      },
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('validateCampaignCopy', () => {
  describe('cash-on-arrival payment reassurance', () => {
    it('passes when primary_text includes "No payment now"', () => {
      const payload = makePayload([
        makeAd({ primary_text: 'Book your spot for Quiz Night. No payment now — just show up and pay at the door.' }),
      ]);
      const issues = validateCampaignCopy(payload, { cashOnArrival: true });
      const reassuranceIssues = issues.filter((i) => i.code === 'missing_payment_reassurance');
      expect(reassuranceIssues).toHaveLength(0);
    });

    it('passes when primary_text includes "pay on arrival"', () => {
      const payload = makePayload([
        makeAd({ primary_text: 'Reserve your table — pay on arrival. £2 per person, teams of 6.' }),
      ]);
      const issues = validateCampaignCopy(payload, { cashOnArrival: true });
      const reassuranceIssues = issues.filter((i) => i.code === 'missing_payment_reassurance');
      expect(reassuranceIssues).toHaveLength(0);
    });

    it('passes when primary_text includes "pay on the night"', () => {
      const payload = makePayload([
        makeAd({ primary_text: 'Book your team in for Thursday — pay on the night.' }),
      ]);
      const issues = validateCampaignCopy(payload, { cashOnArrival: true });
      const reassuranceIssues = issues.filter((i) => i.code === 'missing_payment_reassurance');
      expect(reassuranceIssues).toHaveLength(0);
    });

    it('fails when primary_text has no payment reassurance', () => {
      const payload = makePayload([
        makeAd({ primary_text: 'Book your spot for Quiz Night this Thursday. Teams of 6, prizes to be won.' }),
      ]);
      const issues = validateCampaignCopy(payload, { cashOnArrival: true });
      const reassuranceIssues = issues.filter((i) => i.code === 'missing_payment_reassurance');
      expect(reassuranceIssues).toHaveLength(1);
      expect(reassuranceIssues[0]!.message).toContain('pay-on-arrival reassurance');
    });

    it('skips payment check when cashOnArrival is false', () => {
      const payload = makePayload([
        makeAd({ primary_text: 'Book your spot for Quiz Night this Thursday. Teams of 6, prizes to be won.' }),
      ]);
      const issues = validateCampaignCopy(payload, { cashOnArrival: false });
      const reassuranceIssues = issues.filter((i) => i.code === 'missing_payment_reassurance');
      expect(reassuranceIssues).toHaveLength(0);
    });
  });

  describe('generic phrase detection', () => {
    it('flags "don\'t miss" in ad copy', () => {
      const payload = makePayload([
        makeAd({ primary_text: "Don't miss this Thursday's quiz night — book your table now." }),
      ]);
      const issues = validateCampaignCopy(payload);
      const genericIssues = issues.filter((i) => i.code === 'generic_phrase');
      expect(genericIssues).toHaveLength(1);
      expect(genericIssues[0]!.message).toContain("don't miss");
    });

    it('allows copy without generic phrases', () => {
      const payload = makePayload([
        makeAd({ primary_text: 'Book your table for Thursday quiz. £200 jackpot, teams of 6. Reserve now.' }),
      ]);
      const issues = validateCampaignCopy(payload);
      const genericIssues = issues.filter((i) => i.code === 'generic_phrase');
      expect(genericIssues).toHaveLength(0);
    });
  });

  describe('error message de-duplication', () => {
    it('produces repeated messages for multiple failing ads', () => {
      const payload = makePayload([
        makeAd({ name: 'Ad 1', primary_text: 'Come along Thursday.' }),
        makeAd({ name: 'Ad 2', primary_text: 'Join us Thursday.' }),
        makeAd({ name: 'Ad 3', primary_text: 'See you Thursday.' }),
      ]);
      const issues = validateCampaignCopy(payload, { cashOnArrival: true });
      const messages = issues.filter((i) => i.code === 'missing_payment_reassurance').map((i) => i.message);
      expect(messages.length).toBe(3);
      const unique = [...new Set(messages)];
      expect(unique).toHaveLength(1);
    });
  });
});

describe('attemptCopyCorrection', () => {
  it('should return corrected payload when AI fixes the copy', async () => {
    const original = makePayload([
      makeAd({ primary_text: 'Book your spot for Quiz Night.' }),
    ]);

    const correctionResponse = {
      ...original,
      ad_sets: [{
        ...original.ad_sets[0],
        ads: [{
          ...original.ad_sets[0]!.ads[0],
          primary_text: 'Book your spot for Quiz Night. No payment now — pay on the night.',
        }],
      }],
    };

    const client = makeMockClient(JSON.stringify(correctionResponse));

    const result = await attemptCopyCorrection(
      client,
      original,
      [{ code: 'missing_payment_reassurance', message: 'Cash-on-arrival needs reassurance.', adSetName: 'Run-up', adName: 'Ad 1' }],
      { cashOnArrival: true },
    );

    expect(result).not.toBeNull();
    expect(result!.ad_sets[0]!.ads[0]!.primary_text).toContain('No payment now');
  });

  it('should preserve structural fields from the original payload', async () => {
    const original = makePayload([
      makeAd({ primary_text: 'Book your spot for Quiz Night.' }),
    ]);

    const correctionResponse = {
      objective: 'OUTCOME_TRAFFIC',
      campaign_name: 'Tampered Name',
      ad_sets: [{
        name: 'Tampered Ad Set',
        targeting: { age_min: 13, age_max: 99, geo_locations: { countries: ['US'] } },
        optimisation_goal: 'IMPRESSIONS',
        ads: [{
          name: 'Tampered Ad',
          headline: 'Tampered headline',
          primary_text: 'Book your spot. No payment now — pay on arrival.',
          description: 'Fixed desc',
          cta: 'LEARN_MORE',
          angle: 'Tampered angle',
        }],
      }],
    };

    const client = makeMockClient(JSON.stringify(correctionResponse));

    const result = await attemptCopyCorrection(
      client,
      original,
      [{ code: 'missing_payment_reassurance', message: 'test', adSetName: 'Run-up', adName: 'Ad 1' }],
      { cashOnArrival: true },
    );

    expect(result).not.toBeNull();
    expect(result!.objective).toBe('OUTCOME_SALES');
    expect(result!.campaign_name).toBe('Test Campaign');
    expect(result!.ad_sets[0]!.name).toBe('Run-up');
    expect(result!.ad_sets[0]!.targeting.age_min).toBe(18);
    expect(result!.ad_sets[0]!.optimisation_goal).toBe('LINK_CLICKS');
    expect(result!.ad_sets[0]!.ads[0]!.cta).toBe('BOOK_NOW');
    expect(result!.ad_sets[0]!.ads[0]!.angle).toBe('Booking urgency');
    expect(result!.ad_sets[0]!.ads[0]!.primary_text).toContain('No payment now');
    expect(result!.ad_sets[0]!.ads[0]!.headline).toBe('Tampered headline');
    expect(result!.ad_sets[0]!.ads[0]!.description).toBe('Fixed desc');
  });

  it('should return null when correction still fails validation', async () => {
    const original = makePayload([
      makeAd({ primary_text: 'Book your spot for Quiz Night.' }),
    ]);

    const stillBadResponse = {
      ...original,
      ad_sets: [{
        ...original.ad_sets[0],
        ads: [{ ...original.ad_sets[0]!.ads[0], primary_text: 'Still no payment info here.' }],
      }],
    };

    const client = makeMockClient(JSON.stringify(stillBadResponse));

    const result = await attemptCopyCorrection(
      client,
      original,
      [{ code: 'missing_payment_reassurance', message: 'test', adSetName: 'Run-up', adName: 'Ad 1' }],
      { cashOnArrival: true },
    );

    expect(result).toBeNull();
  });

  it('should return null when AI returns no content', async () => {
    const original = makePayload([makeAd()]);
    const client = makeMockClient(null);

    const result = await attemptCopyCorrection(
      client, original, [{ code: 'generic_phrase', message: 'test', adSetName: 'Run-up', adName: 'Ad 1' }], {},
    );

    expect(result).toBeNull();
  });

  it('should return null when AI returns wrong ad set count', async () => {
    const original = makePayload([makeAd()]);
    const wrongResponse = { ...original, ad_sets: [] };
    const client = makeMockClient(JSON.stringify(wrongResponse));

    const result = await attemptCopyCorrection(
      client, original, [{ code: 'generic_phrase', message: 'test', adSetName: 'Run-up', adName: 'Ad 1' }], {},
    );

    expect(result).toBeNull();
  });
});
