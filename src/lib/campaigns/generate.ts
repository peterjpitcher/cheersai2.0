import OpenAI from 'openai';

import { env } from '@/env';
import type { AiCampaignPayload, BudgetType } from '@/types/campaigns';

interface GenerateInput {
  problemBrief: string;
  venueName: string;
  venueLocation: string;
  budgetAmount: number;
  budgetType: BudgetType;
  startDate: string;
  endDate: string | null;
}

const SYSTEM_PROMPT = `You are an expert Meta (Facebook/Instagram) advertising strategist.
Given a campaign brief and date range, generate a time-phased campaign structure.

RULES:
- headline: max 40 characters
- primary_text: max 125 characters
- description: max 25 characters
- Decide how many phases make sense given the campaign dates (typically 2–4; use more phases when the date range allows)
- Each phase is an ad set with a date window, a phase label (e.g. "Early Awareness", "Urgency Push"), and EXACTLY 5 ads
- Each of the 5 ads is a copy variation — same audience, different messaging angle
- CTA can vary across the 5 variations (treat it as a learning dimension)
- Valid CTA values: LEARN_MORE, SIGN_UP, BOOK_NOW, GET_QUOTE, CONTACT_US, SUBSCRIBE
- Use real Meta API objective values: OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES
- Use real Meta optimisation goals: REACH, LINK_CLICKS, LEAD_GENERATION, OFFSITE_CONVERSIONS, POST_ENGAGEMENT
- Targeting geo_locations should use UK cities or country code 'GB'
- Return ONLY valid JSON matching the specified schema, no markdown

SPECIAL AD CATEGORIES: If the brief relates to housing, employment, credit, or political issues, set special_ad_category to the relevant value. Otherwise use "NONE".`;

export function enforceAdSetConstraints(
  adSet: AiCampaignPayload['ad_sets'][number],
): AiCampaignPayload['ad_sets'][number] {
  let ads = [...adSet.ads];

  if (ads.length === 0) throw new Error(`Ad set "${adSet.name}" returned no ads from AI — cannot enforce constraints.`);

  // Trim to 5
  if (ads.length > 5) ads = ads.slice(0, 5);

  // Pad to 5 by duplicating last entry
  while (ads.length < 5) {
    ads.push({ ...ads[ads.length - 1] });
  }

  // Enforce character limits
  ads = ads.map((ad) => ({
    ...ad,
    headline: ad.headline.length > 40 ? ad.headline.slice(0, 40) : ad.headline,
    primary_text: ad.primary_text.length > 125 ? ad.primary_text.slice(0, 125) : ad.primary_text,
    description: ad.description.length > 25 ? ad.description.slice(0, 25) : ad.description,
  }));

  return { ...adSet, ads };
}

export async function generateCampaign(input: GenerateInput): Promise<AiCampaignPayload> {
  const client = new OpenAI({ apiKey: env.server.OPENAI_API_KEY });

  const userPrompt = `
Business problem: ${input.problemBrief}
Venue: ${input.venueName}, ${input.venueLocation}
Budget: £${input.budgetAmount} (${input.budgetType})
Campaign dates: ${input.startDate} to ${input.endDate ?? 'ongoing'}

Generate a time-phased Meta campaign. Return JSON matching this schema:
{
  "objective": "OUTCOME_LEADS",
  "rationale": "string explaining the strategy and phase structure",
  "campaign_name": "string",
  "special_ad_category": "NONE",
  "ad_sets": [
    {
      "name": "string (e.g. 'Early Awareness - 1 Mar')",
      "phase_label": "string (e.g. 'Early Awareness')",
      "phase_start": "YYYY-MM-DD",
      "phase_end": "YYYY-MM-DD or null for last phase",
      "audience_description": "string",
      "targeting": {
        "age_min": number,
        "age_max": number,
        "genders": [1, 2],
        "geo_locations": { "countries": ["GB"] },
        "interests": [{ "id": "string", "name": "string" }]
      },
      "placements": "AUTO",
      "optimisation_goal": "string",
      "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
      "ads": [
        {
          "name": "Variation 1",
          "headline": "string (max 40 chars)",
          "primary_text": "string (max 125 chars)",
          "description": "string (max 25 chars)",
          "cta": "LEARN_MORE",
          "creative_brief": "string describing ideal image/video"
        }
      ]
    }
  ]
}
The ads array must contain EXACTLY 5 entries per ad set, each with a different messaging angle.`;

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

  // Defensive enforcement: pad/trim to 5 ads per adset; enforce character limits
  payload.ad_sets = payload.ad_sets.map(enforceAdSetConstraints);

  return payload;
}
