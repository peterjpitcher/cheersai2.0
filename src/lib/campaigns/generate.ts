import OpenAI from 'openai';

import { env } from '@/env';
import type { AdTargeting, AiCampaignPayload, BudgetType, PaidCampaignKind } from '@/types/campaigns';
import { normaliseAudienceKeywords } from '@/lib/campaigns/interest-targeting';
import type { CampaignPhase } from './phases'; // ← must import from phases.ts

interface GenerateInput {
  campaignKind: PaidCampaignKind;
  promotionName: string;
  problemBrief: string;
  destinationUrl: string;
  sourceSnapshot?: Record<string, unknown> | null;
  venueName: string;
  venueLocation: string;
  budgetAmount: number;
  budgetType: BudgetType;
  phases: CampaignPhase[]; // ← pre-calculated, replaces startDate/endDate
  eventBookingInsights?: string | null;
}

export const DEFAULT_META_TARGETING: AdTargeting = {
  age_min: 18,
  age_max: 65,
  geo_locations: { countries: ['GB'] },
};

export interface AdCopyValidationIssue {
  code: 'generic_phrase' | 'raw_url' | 'missing_booking_intent' | 'duplicate_angle' | 'over_limit';
  message: string;
  adSetName?: string;
  adName?: string;
}

const BOOKING_INTENT_PATTERN = /\b(book|book_now|booking|reserve|reserved|ticket|tickets|seat|seats|table|tables|spot|spots|secure|buy|purchase)\b/i;
const RAW_URL_PATTERN = /https?:\/\//i;
const GENERIC_PHRASES = [
  "don't miss out",
  "don't miss",
  'join the fun',
  'exciting',
  'amazing',
  'hurry',
];
const TRACKABLE_BOOKING_HOSTS = new Set(['the-anchor.pub', 'www.the-anchor.pub']);

const SYSTEM_PROMPT = `You are an expert Meta (Facebook/Instagram) advertising strategist specialising in high-performing paid social campaigns for UK hospitality venues.

Before writing any copy:
1. Identify the 3–5 strongest USPs from the brief (specific names, prices, mechanics, atmosphere details)
2. Identify the booking decision: why should someone book now instead of just clicking, browsing, or waiting?
3. Suggest 3–5 plain-language audience interest keywords for Meta lookup. Use interest/search phrases only, never numeric IDs.
4. Assign each ad a distinct booking angle — no two ads in the same ad set may share an angle

COPY RULES:
- headline: max 40 characters — punchy, specific, no generic phrases
- primary_text: 120–260 characters — front-load booking intent because Meta truncates copy:
  • Line 1: the concrete reason to book/reserve/buy seats now; name a number, prize, price, date, time, limited capacity, or mechanic from the brief
  • Line 2: specific proof/detail from the brief — prices, mechanics, atmosphere, social context, category, performer, food angle, or value
  • Final sentence: a clear booking nudge that supports the BOOK_NOW button without pasting a URL
- description: max 25 characters
- BANNED phrases (do not use any of these): "don't miss out", "join the fun", "exciting", "amazing", "don't miss", "hurry" — earn engagement through specifics, not adjectives
- Each ad must have a distinct angle from this list (or a more relevant one from the brief): "Booking urgency", "Specific prize or mechanic", "Social group plan", "Value for money", "Food before/after", "Performer or theme", "Ease of reserving"
- CTA should be BOOK_NOW for event/booking destinations unless the brief clearly is not bookable
- Valid CTAs: LEARN_MORE, SIGN_UP, BOOK_NOW, GET_QUOTE, CONTACT_US, SUBSCRIBE
- Do not paste raw URLs into primary text. The Meta button carries the destination URL.
- Every event ad must include at least one booking-intent word in headline, primary_text, description, or CTA: book, booking, reserve, ticket, tickets, seat, seats, table, spot, secure, buy

PHASE STRATEGY (adjust tone per phase):
- run-up: build awareness and excitement, lead with the strongest hooks
- day-before: urgency — last chance, spots running out, momentum building
- day-of: immediacy — tonight, get there, doors open soon
- evergreen: durable offer-led creative that can run for up to 30 days without date-specific urgency unless the brief includes a real deadline

META API VALUES:
- If the destination is bookable, write for OUTCOME_SALES / OFFSITE_CONVERSIONS even if the final JSON schema still allows traffic values
- Use objective OUTCOME_TRAFFIC only as a fallback when no booking/conversion destination exists
- Use optimisation goal LINK_CLICKS only as a fallback when no booking/conversion destination exists
- Use placements AUTO
- audience_keywords must be plain phrases such as "pub quiz", "live music", "cocktails", or "private dining"; do not include Meta IDs, local town names, URLs, or postcodes
- Return ONLY valid JSON matching the specified schema, no markdown, no code fences

SPECIAL AD CATEGORIES: If the brief relates to housing, employment, credit, or political issues, set special_ad_category accordingly. Otherwise use "NONE".`;

export function enforceAdSetConstraints(
  adSet: AiCampaignPayload['ad_sets'][number],
): AiCampaignPayload['ad_sets'][number] {
  let ads = [...adSet.ads];

  if (ads.length === 0) {
    throw new Error(`Ad set "${adSet.name}" returned no ads from AI — cannot enforce constraints.`);
  }

  // Trim to 3
  if (ads.length > 3) ads = ads.slice(0, 3);

  // Pad to 3 while keeping each generated angle distinct enough to validate.
  while (ads.length < 3) {
    const base = adSet.ads[adSet.ads.length - 1] ?? ads[ads.length - 1]!;
    const variantNumber = ads.length + 1;
    ads.push({
      ...base,
      name: `${base.name || 'Ad'} ${variantNumber}`,
      angle: `${base.angle || 'Booking angle'} variation ${variantNumber}`,
    });
  }

  // Enforce character limits
  ads = ads.map((ad) => ({
    ...ad,
    headline:     ad.headline.length > 40  ? ad.headline.slice(0, 40)       : ad.headline,
    primary_text: ad.primary_text.length > 300 ? ad.primary_text.slice(0, 300) : ad.primary_text,
    description:  ad.description.length > 25 ? ad.description.slice(0, 25)  : ad.description,
  }));

  return {
    ...adSet,
    targeting: DEFAULT_META_TARGETING,
    placements: 'AUTO',
    optimisation_goal: 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    ads,
  };
}

export function validateCampaignCopy(
  payload: AiCampaignPayload,
  options?: { requireBookingIntent?: boolean },
): AdCopyValidationIssue[] {
  const issues: AdCopyValidationIssue[] = [];

  for (const adSet of payload.ad_sets) {
    const seenAngles = new Set<string>();
    for (const ad of adSet.ads) {
      const text = `${ad.headline} ${ad.primary_text} ${ad.description} ${ad.cta}`;
      const lower = text.toLowerCase();
      const genericPhrase = GENERIC_PHRASES.find((phrase) => lower.includes(phrase));
      if (genericPhrase) {
        issues.push({
          code: 'generic_phrase',
          message: `Avoid generic phrase "${genericPhrase}".`,
          adSetName: adSet.name,
          adName: ad.name,
        });
      }
      if (RAW_URL_PATTERN.test(text)) {
        issues.push({
          code: 'raw_url',
          message: 'Do not paste raw URLs into ad copy.',
          adSetName: adSet.name,
          adName: ad.name,
        });
      }
      if (options?.requireBookingIntent && !BOOKING_INTENT_PATTERN.test(text)) {
        issues.push({
          code: 'missing_booking_intent',
          message: 'Booking campaigns need explicit booking, reservation, ticket, table, seat, or spot language.',
          adSetName: adSet.name,
          adName: ad.name,
        });
      }
      if (ad.headline.length > 40 || ad.primary_text.length > 300 || ad.description.length > 25) {
        issues.push({
          code: 'over_limit',
          message: 'Ad copy exceeds Meta length constraints.',
          adSetName: adSet.name,
          adName: ad.name,
        });
      }

      const angleKey = ad.angle.trim().toLowerCase();
      if (angleKey && seenAngles.has(angleKey)) {
        issues.push({
          code: 'duplicate_angle',
          message: `Duplicate angle "${ad.angle}" in the same ad set.`,
          adSetName: adSet.name,
          adName: ad.name,
        });
      }
      if (angleKey) seenAngles.add(angleKey);
    }
  }

  return issues;
}

export async function generateCampaign(input: GenerateInput): Promise<AiCampaignPayload> {
  const client = new OpenAI({ apiKey: env.server.OPENAI_API_KEY });

  const phaseDescriptions = input.phases
    .map((p, i) => {
      const dateRange = p.phaseEnd
        ? `${p.phaseStart} to ${p.phaseEnd}`
        : `${p.phaseStart}${p.adsStopTime ? ` (stop ads at ${p.adsStopTime})` : ''}`;
      return `  ${i + 1}. ${p.phaseLabel} (${p.phaseType}): ${dateRange}`;
    })
    .join('\n');
  const eventContext = formatSourceSnapshotForPrompt(input.sourceSnapshot);

  const userPrompt = `Campaign type: ${input.campaignKind}
Promotion name: ${input.promotionName}
Business brief: ${input.problemBrief}
Venue: ${input.venueName}, ${input.venueLocation}
Budget: £${input.budgetAmount} (${input.budgetType})
Paid CTA URL: ${input.destinationUrl}
${eventContext ? `
Imported/event context:
${eventContext}
` : ''}
${input.campaignKind === 'event' && input.eventBookingInsights ? `
Historical booking insight summary:
${input.eventBookingInsights}
` : ''}

Phase structure (pre-calculated — use EXACTLY these dates, do not modify):
${phaseDescriptions}

Generate a Meta campaign with one ad set per phase above. Each ad set must contain EXACTLY 3 ads, each with a different angle.

Return JSON matching this exact schema:
{
  "objective": "OUTCOME_SALES",
  "rationale": "string explaining strategy and why each phase is structured this way",
  "campaign_name": "string",
  "special_ad_category": "NONE",
  "audience_keywords": ["3 to 5 plain-language Meta interest lookup phrases, no IDs"],
  "ad_sets": [
    {
      "name": "string (e.g. 'Run-up — Jackpot Night 18 Mar')",
      "phase_label": "Run-up",
      "phase_start": "YYYY-MM-DD",
      "phase_end": "YYYY-MM-DD or null",
      "audience_description": "string describing who this targets",
      "targeting": {
        "age_min": 18,
        "age_max": 65,
        "geo_locations": { "countries": ["GB"] }
      },
      "placements": "AUTO",
      "optimisation_goal": "OFFSITE_CONVERSIONS",
      "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
      "ads": [
        {
          "name": "Variation 1",
          "headline": "string (max 40 chars, specific detail from brief)",
          "primary_text": "string (120–260 chars, booking hook + specific detail + booking nudge)",
          "description": "string (max 25 chars)",
          "cta": "BOOK_NOW",
          "angle": "Jackpot & prize mechanic",
          "creative_brief": "string describing the ideal image or video for this ad"
        }
      ]
    }
  ]
}
The ads array must contain EXACTLY 3 entries per ad set. Each must have a different angle.`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No content returned from AI');

  let payload: AiCampaignPayload;
  try {
    payload = JSON.parse(content) as AiCampaignPayload;
  } catch (e) {
    throw new Error(`Failed to parse AI response as JSON: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  if (!Array.isArray(payload.ad_sets) || payload.ad_sets.length !== input.phases.length) {
    throw new Error('AI returned the wrong number of ad sets for the campaign phase structure.');
  }

  const bookingOptimised = shouldGenerateForBookingConversions(input);
  payload.objective = bookingOptimised ? 'OUTCOME_SALES' : 'OUTCOME_TRAFFIC';
  payload.audience_keywords = normaliseAudienceKeywords(payload.audience_keywords);

  payload.ad_sets = payload.ad_sets.map((adSet, index) => {
    const phase = input.phases[index]!;
    const constrained = enforceAdSetConstraints({
      ...adSet,
      phase_label: phase.phaseLabel,
      phase_start: phase.phaseStart,
      phase_end: phase.phaseEnd,
      ads_stop_time: phase.adsStopTime ?? undefined,
      ads: adSet.ads.map((ad) => ({
        ...ad,
        cta: input.campaignKind === 'event' ? 'BOOK_NOW' : ad.cta,
      })),
    });
    return {
      ...constrained,
      optimisation_goal: bookingOptimised ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS',
    };
  });

  const copyIssues = validateCampaignCopy(payload, { requireBookingIntent: input.campaignKind === 'event' });
  const hardIssues = copyIssues.filter((issue) => issue.code !== 'over_limit');
  if (hardIssues.length > 0) {
    throw new Error(`AI returned weak booking copy: ${hardIssues.map((issue) => issue.message).join(' ')}`);
  }

  return payload;
}

function formatSourceSnapshotForPrompt(sourceSnapshot: Record<string, unknown> | null | undefined): string {
  if (!sourceSnapshot) return '';
  const lines = [
    formatContextLine('Event name', sourceSnapshot.eventName),
    formatContextLine('Event date', sourceSnapshot.eventDate),
    formatContextLine('Event time', sourceSnapshot.eventTime),
    formatContextLine('Event category', sourceSnapshot.eventCategoryName),
    formatContextLine('Event category slug', sourceSnapshot.eventCategorySlug),
    formatContextLine('Booking URL', sourceSnapshot.bookingUrl),
    formatContextLine('Meta ads short link', sourceSnapshot.metaAdsShortLink),
    formatContextLine('Imported notes', sourceSnapshot.managementPrompt),
  ].filter(Boolean);
  return lines.join('\n');
}

function formatContextLine(label: string, value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return `${label}: ${value.trim()}`;
}

function shouldGenerateForBookingConversions(input: GenerateInput): boolean {
  if (input.campaignKind === 'event') return true;

  const snapshot = input.sourceSnapshot ?? {};
  const urls = [
    input.destinationUrl,
    textValue(snapshot.originalDestinationUrl),
    textValue(snapshot.utmDestinationUrl),
    textValue(snapshot.paidCtaUrl),
    textValue(snapshot.bookingUrl),
    textValue(snapshot.metaAdsShortLink),
  ].filter((value): value is string => Boolean(value));

  return urls.some((value) => {
    try {
      return TRACKABLE_BOOKING_HOSTS.has(new URL(value).hostname.toLowerCase());
    } catch {
      return false;
    }
  });
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
