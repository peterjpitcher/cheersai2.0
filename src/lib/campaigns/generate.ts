import OpenAI from 'openai';

import { env } from '@/env';
import type { AiCampaignPayload, BudgetType } from '@/types/campaigns';
import type { CampaignPhase } from './phases'; // ← must import from phases.ts

interface GenerateInput {
  problemBrief: string;
  venueName: string;
  venueLocation: string;
  budgetAmount: number;
  budgetType: BudgetType;
  phases: CampaignPhase[]; // ← pre-calculated, replaces startDate/endDate
}

const SYSTEM_PROMPT = `You are an expert Meta (Facebook/Instagram) advertising strategist specialising in conversion-focused ad copy for UK hospitality venues.

Before writing any copy:
1. Identify the 3–5 strongest USPs from the brief (specific names, prices, mechanics, atmosphere details)
2. Assign each ad a distinct angle — no two ads in the same ad set may share an angle

COPY RULES:
- headline: max 40 characters — punchy, specific, no generic phrases
- primary_text: 250–350 characters — follow this 3-part formula:
  • Line 1 (hook): bold statement, provocative question, or single most compelling specific detail — must name a number, prize, price, or mechanic from the brief
  • Lines 2–3 (USP detail): specific facts from the brief — prices, mechanics, atmosphere, social context
  • Final sentence (soft CTA): conversational nudge specific to the event — not a duplicate of the button
- description: max 25 characters
- BANNED phrases (do not use any of these): "don't miss out", "join the fun", "exciting", "amazing", "don't miss", "hurry" — earn engagement through specifics, not adjectives
- Each ad must have a distinct angle from this list (or a more relevant one from the brief): "Jackpot & prize mechanic", "Social & group night", "Value for money", "Urgency & FOMO", "Food & atmosphere", "Accessibility & ease"
- CTA can vary across variations (treat as a learning dimension)
- Valid CTAs: LEARN_MORE, SIGN_UP, BOOK_NOW, GET_QUOTE, CONTACT_US, SUBSCRIBE

PHASE STRATEGY (adjust tone per phase):
- run-up: build awareness and excitement, lead with the strongest hooks
- day-before: urgency — last chance, spots running out, momentum building
- day-of: immediacy — tonight, get there, doors open soon

META API VALUES:
- Use real Meta API objective values: OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES
- Use real Meta optimisation goals: REACH, LINK_CLICKS, LEAD_GENERATION, OFFSITE_CONVERSIONS, POST_ENGAGEMENT
- Targeting geo_locations should use UK cities or country code 'GB'
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

  // Pad to 3 by duplicating last entry
  while (ads.length < 3) {
    ads.push({ ...ads[ads.length - 1]! });
  }

  // Enforce character limits
  ads = ads.map((ad) => ({
    ...ad,
    headline:     ad.headline.length > 40  ? ad.headline.slice(0, 40)       : ad.headline,
    primary_text: ad.primary_text.length > 350 ? ad.primary_text.slice(0, 350) : ad.primary_text,
    description:  ad.description.length > 25 ? ad.description.slice(0, 25)  : ad.description,
  }));

  return { ...adSet, ads };
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

  const userPrompt = `Business brief: ${input.problemBrief}
Venue: ${input.venueName}, ${input.venueLocation}
Budget: £${input.budgetAmount} (${input.budgetType})

Phase structure (pre-calculated — use EXACTLY these dates, do not modify):
${phaseDescriptions}

Generate a Meta campaign with one ad set per phase above. Each ad set must contain EXACTLY 3 ads, each with a different angle.

Return JSON matching this exact schema:
{
  "objective": "OUTCOME_LEADS",
  "rationale": "string explaining strategy and why each phase is structured this way",
  "campaign_name": "string",
  "special_ad_category": "NONE",
  "ad_sets": [
    {
      "name": "string (e.g. 'Run-up — Jackpot Night 18 Mar')",
      "phase_label": "Run-up",
      "phase_start": "YYYY-MM-DD",
      "phase_end": "YYYY-MM-DD or null",
      "audience_description": "string describing who this targets",
      "targeting": {
        "age_min": 25,
        "age_max": 55,
        "genders": [1, 2],
        "geo_locations": { "countries": ["GB"] },
        "interests": [{ "id": "string", "name": "string" }]
      },
      "placements": "AUTO",
      "optimisation_goal": "LINK_CLICKS",
      "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
      "ads": [
        {
          "name": "Variation 1",
          "headline": "string (max 40 chars, specific detail from brief)",
          "primary_text": "string (250–350 chars, hook + USP detail + soft CTA)",
          "description": "string (max 25 chars)",
          "cta": "LEARN_MORE",
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

  const payload = JSON.parse(content) as AiCampaignPayload;

  // Enforce 3 ads per ad set and character limits
  payload.ad_sets = payload.ad_sets.map(enforceAdSetConstraints);

  return payload;
}
