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
Given a business problem brief, you generate a complete campaign structure.

RULES:
- headline: max 40 characters
- primary_text: max 125 characters
- description: max 25 characters
- Generate 2-3 ad sets with 2 ads each
- Use real Meta API objective values: OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES
- Use real Meta optimisation goals: REACH, LINK_CLICKS, LEAD_GENERATION, OFFSITE_CONVERSIONS, POST_ENGAGEMENT
- Targeting geo_locations should use UK cities or country code 'GB'
- Return ONLY valid JSON matching the specified schema, no markdown

SPECIAL AD CATEGORIES: If the brief relates to housing, employment, credit, or political issues, set special_ad_category to the relevant value. Otherwise use "NONE".`;

export async function generateCampaign(input: GenerateInput): Promise<AiCampaignPayload> {
  const client = new OpenAI({ apiKey: env.server.OPENAI_API_KEY });

  const userPrompt = `
Business problem: ${input.problemBrief}
Venue: ${input.venueName}, ${input.venueLocation}
Budget: £${input.budgetAmount} (${input.budgetType})
Campaign dates: ${input.startDate} to ${input.endDate ?? 'ongoing'}

Generate a Meta campaign to solve this problem. Return JSON matching this schema:
{
  "objective": "OUTCOME_LEADS",
  "rationale": "string explaining the strategy",
  "campaign_name": "string",
  "special_ad_category": "NONE",
  "ad_sets": [
    {
      "name": "string",
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
          "name": "string",
          "headline": "string (max 40 chars)",
          "primary_text": "string (max 125 chars)",
          "description": "string (max 25 chars)",
          "cta": "LEARN_MORE",
          "creative_brief": "string describing ideal image/video"
        }
      ]
    }
  ]
}`;

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

  // Enforce character limits defensively — AI may exceed them despite instructions
  for (const adSet of payload.ad_sets) {
    for (const ad of adSet.ads) {
      if (ad.headline.length > 40) ad.headline = ad.headline.slice(0, 40);
      if (ad.primary_text.length > 125) ad.primary_text = ad.primary_text.slice(0, 125);
      if (ad.description.length > 25) ad.description = ad.description.slice(0, 25);
    }
  }

  return payload;
}
