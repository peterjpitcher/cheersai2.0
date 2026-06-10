import { describe, it, expect } from 'vitest';
import { validateCampaignCopy, type AdCopyValidationIssue } from '@/lib/campaigns/generate';
import type { AiCampaignPayload, CtaType, FoodDecisionStage, FoodServiceKey } from '@/types/campaigns';

// ---------------------------------------------------------------------------
// The REAL validateCampaignCopy signature is
//   validateCampaignCopy(payload: AiCampaignPayload, options?) => AdCopyValidationIssue[]
// The plan's snippet (validateCampaignCopy({ campaignKind, cta, primaryText }) -> { hardIssues })
// is illustrative only. We build a real single-ad AiCampaignPayload and treat the
// returned issues array (minus soft `over_limit`) as the "hard issues" the plan asserts.
// ---------------------------------------------------------------------------

interface FoodCopyCase {
  primaryText: string;
  cta?: CtaType;
  serviceKey: FoodServiceKey;
  decisionStage: FoodDecisionStage;
  headline?: string;
  description?: string;
}

function buildPayload(args: FoodCopyCase): AiCampaignPayload {
  return {
    objective: 'OUTCOME_SALES',
    rationale: 'Food booking test',
    campaign_name: 'Food Booking',
    special_ad_category: 'NONE',
    ad_sets: [
      {
        name: 'Window',
        phase_label: 'Window',
        phase_start: '2026-06-09',
        phase_end: null,
        audience_description: 'Local diners',
        targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
        placements: 'AUTO',
        optimisation_goal: 'OFFSITE_CONVERSIONS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        ads: [
          {
            name: 'Ad 1',
            headline: args.headline ?? 'Table for two',
            primary_text: args.primaryText,
            description: args.description ?? 'Reserve now',
            cta: args.cta ?? 'BOOK_NOW',
            angle: 'Booking urgency',
            creative_brief: 'Warm dining room',
          },
        ],
      },
    ],
  };
}

function hardIssues(args: FoodCopyCase): AdCopyValidationIssue[] {
  const issues = validateCampaignCopy(buildPayload(args), {
    campaignKind: 'food_booking',
    requireBookingIntent: true,
    requireBookNow: true,
    serviceKey: args.serviceKey,
    decisionStage: args.decisionStage,
  });
  // Mirror generate.ts: `over_limit` is the only soft issue.
  return issues.filter((issue) => issue.code !== 'over_limit');
}

describe('food_booking copy validation', () => {
  it('passes copy with booking intent and BOOK_NOW', () => {
    const res = hardIssues({
      serviceKey: 'weekday_dinner',
      decisionStage: 'lunch_decision',
      primaryText: 'Book a table for dinner tonight, served from 4pm.',
    });
    expect(res).toHaveLength(0);
  });

  it('fails copy with no booking/table language', () => {
    const res = hardIssues({
      serviceKey: 'weekday_dinner',
      decisionStage: 'lunch_decision',
      headline: 'Great food',
      description: 'Tasty meals',
      primaryText: 'Come and try our delicious food.',
    });
    // Reuses the existing event booking-intent rule (code `missing_booking_intent`).
    expect(res.some((i) => i.code === 'missing_booking_intent')).toBe(true);
  });

  it('fails when CTA is not BOOK_NOW', () => {
    const res = hardIssues({
      cta: 'LEARN_MORE',
      serviceKey: 'weekday_dinner',
      decisionStage: 'lunch_decision',
      primaryText: 'Book a table tonight.',
    });
    expect(res.some((i) => /BOOK_NOW/i.test(i.message))).toBe(true);
  });

  it('fails Sunday roast copy that says "tonight"', () => {
    const res = hardIssues({
      serviceKey: 'sunday_roast',
      decisionStage: 'morning_commit',
      primaryText: 'Book your roast tonight.',
    });
    expect(res.some((i) => /tonight/i.test(i.message))).toBe(true);
  });

  it('fails last-orders mention outside Sunday day-of', () => {
    const res = hardIssues({
      serviceKey: 'sunday_roast',
      decisionStage: 'tomorrow',
      primaryText: 'Last orders 5:30pm — reserve a table.',
    });
    expect(res.some((i) => /last orders/i.test(i.message))).toBe(true);
  });

  it('allows last-orders mention for Sunday day-of windows', () => {
    const morning = hardIssues({
      serviceKey: 'sunday_roast',
      decisionStage: 'morning_commit',
      primaryText: 'Last orders 5:30pm — reserve a table for the roast.',
    });
    expect(morning.some((i) => /last orders/i.test(i.message))).toBe(false);

    const lastTables = hardIssues({
      serviceKey: 'sunday_roast',
      decisionStage: 'last_tables',
      primaryText: 'Last orders 5:30pm — book while tables remain for the roast.',
    });
    expect(lastTables.some((i) => /last orders/i.test(i.message))).toBe(false);
  });

  it('fails weekday copy mentioning Sunday roast', () => {
    const res = hardIssues({
      serviceKey: 'weekday_dinner',
      decisionStage: 'lunch_decision',
      primaryText: 'Book a table for our Sunday roast.',
    });
    expect(res.some((i) => /sunday roast/i.test(i.message))).toBe(true);
  });

  it('allows Sunday roast wording for the Sunday roast service', () => {
    const res = hardIssues({
      serviceKey: 'sunday_roast',
      decisionStage: 'morning_commit',
      primaryText: 'Book a table for our Sunday roast, served from 1pm.',
    });
    expect(res.some((i) => /sunday roast/i.test(i.message))).toBe(false);
  });

  it('reuses the existing banned-phrase rule', () => {
    const res = hardIssues({
      serviceKey: 'weekday_dinner',
      decisionStage: 'lunch_decision',
      primaryText: "Book a table — don't miss out!",
    });
    expect(res.some((i) => i.code === 'generic_phrase')).toBe(true);
  });

  it('reuses the existing no-raw-URL rule', () => {
    const res = hardIssues({
      serviceKey: 'weekday_dinner',
      decisionStage: 'lunch_decision',
      primaryText: 'Book a table at https://book.example.com tonight.',
    });
    expect(res.some((i) => i.code === 'raw_url')).toBe(true);
  });

  it('leaves event copy unaffected by food rules', () => {
    // An event ad that mentions "sunday roast" and "tonight" must NOT trip food rules.
    const issues = validateCampaignCopy(
      buildPayload({
        serviceKey: 'weekday_dinner',
        decisionStage: 'lunch_decision',
        primaryText: 'Book seats for the Sunday roast quiz tonight.',
      }),
      { campaignKind: 'event', requireBookingIntent: true, requireBookNow: true },
    ).filter((i) => i.code !== 'over_limit');
    expect(issues.some((i) => i.code === 'food_wrong_service' || i.code === 'food_tonight')).toBe(false);
  });
});
