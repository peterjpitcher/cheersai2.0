import OpenAI from 'openai';

import { env } from '@/env';
import type { AdTargeting, AiCampaignPayload, BudgetType, PaidCampaignKind, PaidMediaPlan } from '@/types/campaigns';
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
  mediaPlan?: PaidMediaPlan | null;
  eventBookingInsights?: string | null;
}

export const DEFAULT_META_TARGETING: AdTargeting = {
  age_min: 18,
  age_max: 65,
  geo_locations: { countries: ['GB'] },
};

export interface AdCopyValidationIssue {
  code:
    | 'generic_phrase'
    | 'raw_url'
    | 'missing_booking_intent'
    | 'duplicate_angle'
    | 'over_limit'
    | 'date_mismatch'
    | 'walk_in_language'
    | 'cta_mismatch'
    | 'missing_payment_reassurance';
  message: string;
  adSetName?: string;
  adName?: string;
}

const BOOKING_INTENT_PATTERN = /\b(book|book_now|booking|reserve|reserved|ticket|tickets|seat|seats|table|tables|spot|spots|secure|buy|purchase)\b/i;
const RAW_URL_PATTERN = /https?:\/\//i;
const WALK_IN_PATTERN = /\bwalk-?ins?\s+(welcome|available|if space allows)\b/i;
const PAY_ON_ARRIVAL_PATTERN = /\b(no payment now|pay.{0,40}(arrival|night|door)|cash.{0,30}(arrival|night|door))\b/i;
const TEXT_DATE_PATTERN = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi;
const GENERIC_PHRASES = [
  "don't miss out",
  "don't miss",
  'join the fun',
  'exciting',
  'amazing',
  'hurry',
];
const TRACKABLE_BOOKING_HOSTS = new Set(['the-anchor.pub', 'www.the-anchor.pub']);
const TRACKABLE_SHORT_LINK_HOSTS = new Set(['l.the-anchor.pub', 'vip-club.uk', 'www.vip-club.uk']);

const SYSTEM_PROMPT = `You are an expert Meta (Facebook/Instagram) advertising strategist specialising in high-performing paid social campaigns for UK hospitality venues.

Before writing any copy:
1. Identify the 3–5 strongest USPs from the brief (specific names, prices, mechanics, atmosphere details)
2. Identify the booking decision: why should someone book now instead of just clicking, browsing, or waiting?
3. Suggest 3–5 plain-language audience interest keywords for Meta lookup. Use interest/search phrases only, never numeric IDs.
4. Assign each ad a distinct booking angle — no two ads in the same ad set may share an angle

MANDATORY — CASH-ON-ARRIVAL PAYMENT REASSURANCE:
When payment_mode is "cash_only" or the brief mentions pay on arrival, EVERY ad's primary_text MUST contain one of: "No payment now", "pay on arrival", "pay on the night", "pay at the door", or "cash on arrival". Ads missing this phrase will be rejected. This rule overrides length concerns — include the phrase even if it means shortening other copy.

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
- For imported events, use the supplied event date/time exactly. Do not invent or substitute another date.
- Do not say "walk-ins welcome" in paid event ads. Paid ads should make reservation feel useful.
- Valid CTAs: LEARN_MORE, SIGN_UP, BOOK_NOW, GET_QUOTE, CONTACT_US, SUBSCRIBE
- Do not paste raw URLs into primary text. The Meta button carries the destination URL.
- Every event ad must include at least one booking-intent word in headline, primary_text, description, or CTA: book, booking, reserve, ticket, tickets, seat, seats, table, spot, secure, buy

PHASE STRATEGY (adjust tone per phase):
- run-up: build awareness and excitement, lead with the strongest hooks
- day-before: tomorrow urgency — last chance to plan ahead, tables/seats filling, momentum building
- day-of: final last-chance urgency — tonight/today only when the supplied event date is today
- booking-push: direct booking push across the full event window; ask people to book now without pretending every day is "tonight"
- closeout: combined tomorrow + final push; use urgency but keep timing accurate for the dates supplied
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
  options?: {
    requireBookingIntent?: boolean;
    eventDate?: string | null;
    requireBookNow?: boolean;
    cashOnArrival?: boolean;
  },
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
      if (options?.eventDate && hasDateMismatch(options.eventDate, text)) {
        issues.push({
          code: 'date_mismatch',
          message: 'Ad copy includes a date that does not match the imported event date.',
          adSetName: adSet.name,
          adName: ad.name,
        });
      }
      if (WALK_IN_PATTERN.test(text)) {
        issues.push({
          code: 'walk_in_language',
          message: 'Remove walk-ins-welcome wording from paid booking ads.',
          adSetName: adSet.name,
          adName: ad.name,
        });
      }
      if (options?.requireBookNow && ad.cta !== 'BOOK_NOW') {
        issues.push({
          code: 'cta_mismatch',
          message: 'Event booking ads must use BOOK_NOW.',
          adSetName: adSet.name,
          adName: ad.name,
        });
      }
      if (options?.cashOnArrival && !PAY_ON_ARRIVAL_PATTERN.test(text)) {
        issues.push({
          code: 'missing_payment_reassurance',
          message: 'Cash-on-arrival event ads need no-payment-now or pay-on-arrival reassurance.',
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
  const cashOnArrival = input.campaignKind === 'event' && hasCashOnArrivalContext(input.sourceSnapshot);
  const mediaPlanContext = input.mediaPlan ? formatMediaPlanForPrompt(input.mediaPlan) : '';

  const userPrompt = `Campaign type: ${input.campaignKind}
Promotion name: ${input.promotionName}
Business brief: ${input.problemBrief}
Venue: ${input.venueName}, ${input.venueLocation}
Budget: £${input.budgetAmount} (${input.budgetType})
Paid CTA URL: ${input.destinationUrl}
${cashOnArrival ? `
PAYMENT MODE: Cash on arrival — every ad primary_text MUST include "No payment now" or "pay on arrival". Ads without this will be rejected.
` : ''}${eventContext ? `
Imported/event context:
${eventContext}
` : ''}
${input.campaignKind === 'event' && input.eventBookingInsights ? `
Historical booking insight summary:
${input.eventBookingInsights}
` : ''}
${mediaPlanContext ? `
Media plan:
${mediaPlanContext}
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

  if (input.mediaPlan) {
    payload.media_plan = input.mediaPlan;
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

  const validationOptions = {
    requireBookingIntent: input.campaignKind === 'event',
    requireBookNow: input.campaignKind === 'event',
    eventDate: textValue(input.sourceSnapshot?.eventDate),
    cashOnArrival,
  };

  const copyIssues = validateCampaignCopy(payload, validationOptions);
  const hardIssues = copyIssues.filter((issue) => issue.code !== 'over_limit');
  if (hardIssues.length > 0) {
    const corrected = await attemptCopyCorrection(client, payload, hardIssues, validationOptions);
    if (corrected) return corrected;
    const uniqueMessages = [...new Set(hardIssues.map((issue) => issue.message))];
    throw new Error(`AI returned weak booking copy: ${uniqueMessages.join(' ')}`);
  }

  return payload;
}

function formatSourceSnapshotForPrompt(sourceSnapshot: Record<string, unknown> | null | undefined): string {
  if (!sourceSnapshot) return '';
  const lines = [
    formatContextLine('Event name', sourceSnapshot.eventName),
    formatContextLine('Event date', formatContextDate(sourceSnapshot.eventDate)),
    formatContextLine('Event time', sourceSnapshot.eventTime),
    formatContextLine('Event category', sourceSnapshot.eventCategoryName),
    formatContextLine('Event category slug', sourceSnapshot.eventCategorySlug),
    formatContextLine('Booking mode', sourceSnapshot.bookingMode),
    formatContextLine('Payment mode', sourceSnapshot.paymentMode),
    formatContextLine('Price', formatContextPrice(sourceSnapshot)),
    formatContextLine('Seats remaining', sourceSnapshot.seatsRemaining),
    formatContextLine('Capacity', sourceSnapshot.capacity),
    formatContextLine('Booking URL', sourceSnapshot.bookingUrl),
    formatContextLine('Meta ads short link', sourceSnapshot.metaAdsShortLink),
    formatContextLine('Meta ads final destination', sourceSnapshot.metaAdsDestinationUrl),
    formatContextLine('Imported notes', sourceSnapshot.managementPrompt),
  ].filter(Boolean);
  return lines.join('\n');
}

function formatMediaPlanForPrompt(mediaPlan: PaidMediaPlan): string {
  const strategic = mediaPlan.strategicPhases
    .map((phase) => `${phase.phaseLabel} (${phase.phaseType})`)
    .join(' → ');
  const execution = mediaPlan.executionPhases
    .map((phase) => `${phase.phaseLabel} (${phase.phaseType})`)
    .join(' → ');
  const budgetNote = mediaPlan.budgetRecommendation
    ? `Budget note: ${mediaPlan.budgetRecommendation.reason}`
    : 'Budget note: current budget supports the planned execution structure.';

  return [
    `Strategic booking journey: ${strategic}`,
    `Actual Meta execution: ${execution}`,
    `Execution mode: ${mediaPlan.executionMode}`,
    mediaPlan.rationale,
    budgetNote,
  ].join('\n');
}

function formatContextLine(label: string, value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return `${label}: ${value}`;
  if (typeof value === 'boolean') return `${label}: ${value ? 'yes' : 'no'}`;
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
    textValue(snapshot.metaAdsDestinationUrl),
  ].filter((value): value is string => Boolean(value));

  return urls.some((value) => {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return TRACKABLE_BOOKING_HOSTS.has(host) || TRACKABLE_SHORT_LINK_HOSTS.has(host);
    } catch {
      return false;
    }
  });
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatContextPrice(snapshot: Record<string, unknown>): string | null {
  const value = numericValue(snapshot.pricePerSeat) ?? numericValue(snapshot.price) ?? numericValue(snapshot.eventPrice);
  if (value === null) return null;
  return value % 1 === 0 ? `£${value}` : `£${value.toFixed(2)}`;
}

function formatContextDate(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;

  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).formatToParts(parsed);

  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const year = parts.find((part) => part.type === 'year')?.value;
  return [weekday, day, month, year].filter(Boolean).join(' ');
}

function hasCashOnArrivalContext(sourceSnapshot: Record<string, unknown> | null | undefined) {
  const snapshot = sourceSnapshot ?? {};
  const paymentMode = textValue(snapshot.paymentMode) ?? textValue(snapshot.payment_mode);
  if (paymentMode === 'cash_only') return true;
  const prompt = textValue(snapshot.managementPrompt) ?? '';
  return PAY_ON_ARRIVAL_PATTERN.test(prompt);
}

function hasDateMismatch(eventDate: string, text: string) {
  const expected = eventDateParts(eventDate);
  if (!expected) return false;

  for (const match of text.matchAll(TEXT_DATE_PATTERN)) {
    const day = Number(match[1]);
    const month = monthNumber(match[2]);
    if (Number.isFinite(day) && month && (day !== expected.day || month !== expected.month)) {
      return true;
    }
  }

  return false;
}

function eventDateParts(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    day: parsed.getDate(),
    month: parsed.getMonth() + 1,
  };
}

function monthNumber(value: string | undefined) {
  const key = value?.slice(0, 3).toLowerCase();
  if (!key) return null;
  return {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  }[key] ?? null;
}

export async function attemptCopyCorrection(
  client: OpenAI,
  payload: AiCampaignPayload,
  issues: AdCopyValidationIssue[],
  validationOptions: Parameters<typeof validateCampaignCopy>[1],
): Promise<AiCampaignPayload | null> {
  const issueList = issues
    .map((i) => `Ad set "${i.adSetName}", ad "${i.adName}": ${i.message}`)
    .join('\n');

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are fixing Meta ad copy that failed validation. Return the COMPLETE campaign JSON with corrections applied. Change ONLY the failing ads — preserve every other field exactly as given.',
        },
        {
          role: 'user',
          content: `This campaign payload failed copy validation:\n\n${JSON.stringify(payload, null, 2)}\n\nValidation issues:\n${issueList}\n\nFix each issue. Return the corrected full JSON only.`,
        },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const raw = JSON.parse(content) as AiCampaignPayload;
    if (!Array.isArray(raw.ad_sets) || raw.ad_sets.length !== payload.ad_sets.length) return null;

    const corrected: AiCampaignPayload = {
      ...payload,
      ad_sets: payload.ad_sets.map((originalAdSet, i) => {
        const correctedAdSet = raw.ad_sets[i]!;
        return {
          ...originalAdSet,
          ads: originalAdSet.ads.map((originalAd, j) => {
            const correctedAd = correctedAdSet.ads?.[j];
            if (!correctedAd) return originalAd;
            return {
              ...originalAd,
              headline: correctedAd.headline ?? originalAd.headline,
              primary_text: correctedAd.primary_text ?? originalAd.primary_text,
              description: correctedAd.description ?? originalAd.description,
            };
          }),
        };
      }),
    };

    const recheck = validateCampaignCopy(corrected, validationOptions);
    const hardRecheck = recheck.filter((i) => i.code !== 'over_limit');
    return hardRecheck.length === 0 ? corrected : null;
  } catch {
    return null;
  }
}

function numericValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}
