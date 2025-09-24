# OpenAI Content Prompting Overview

This report documents how Cheers AI currently builds prompts for OpenAI-powered content generation, the data each endpoint feeds into those prompts, and notable issues that require follow-up. The intended audience is a senior developer who does not have the code in front of them, so key snippets and contextual notes are included throughout.

## Entry Points That Generate Marketing Copy

| Endpoint | Purpose | Where the prompt is assembled |
| --- | --- | --- |
| `POST /api/generate` | Main campaign post generator for a single platform run. | `app/api/generate/route.ts` |
| `POST /api/generate/quick` | “Quick post” generator used for ad-hoc updates across one or more platforms. | `app/api/generate/quick/route.ts` |
| `POST /api/campaigns/:id/generate-batch` | Bulk scheduler that creates multiple posts (per timing × platform). | `app/api/campaigns/[id]/generate-batch/route.ts` |
| `GET /api/admin/ai-prompts/preview` | Super-admin helper that shows raw prompts without calling OpenAI (no generation). | `app/api/admin/ai-prompts/preview/route.ts` |

All production endpoints call `getOpenAIClient()` from `lib/openai/client.ts`, which lazily initialises the official SDK with `process.env.OPENAI_API_KEY`. Every generation request uses the [Chat Completions API](https://platform.openai.com/docs/api-reference/chat/create) with the `gpt-4o-mini` model.

```ts
// lib/openai/client.ts
let openaiClient: OpenAI | null = null;

export function getOpenAIClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return openaiClient;
}
```

## Shared Prompt Builder

All three generation routes defer to `buildStructuredPostPrompt()` (`lib/openai/prompts.ts`). This helper composes both the system and user messages by stitching together brand metadata, campaign context, and guardrails.

Key building blocks inside `buildStructuredPostPrompt`:

- **Platform metadata** (`PLATFORM_META`) sets expectations for tone, link policy, emoji allowance, and default CTAs per platform (Facebook, Instagram Business, Google Business Profile, LinkedIn). If an unknown platform is requested, it defaults to the Facebook guidance.
- **System preamble** fixes the persona and hard rules:

  ```ts
  const SYSTEM_PREAMBLE = [
    'You are the dedicated social media strategist for UK hospitality venues.',
    '- Use British English spelling and UK terminology in every sentence.',
    '- Ground every statement in the supplied context; if a fact is missing, omit it rather than inventing details.',
    '- Output plain text ready for publishing: no markdown, lists, headings, numbering, or surrounding quotes.',
  ].join('\n');
  ```

- **Structured user prompt** is divided into three sections:
  - `CONTEXT` – key/value data about the business and campaign, including opening hours, menus, links, and guardrails transformed into bullet lists.
  - `TASK` – a numbered list of copy-writing goals (promote campaign, align with brand, avoid invention, address target audience, vary paragraphs, etc.).
  - `OUTPUT RULES` – platform-specific formatting instructions (paragraph count, relative timing phrasing, date mentions, link/emoji/hashtag policy, CTA options, phone-number rules, and a reminder to respect guardrails).

- **Event timing helpers** – `computeScheduledDate`, `getRelativeTimingLabel`, and internal utilities calculate relative phrases like “this Friday” or “tomorrow” so the copy feels time-appropriate.
- **Guardrail plumbing** – brand/content guardrails from Supabase are merged into `mustInclude`, `mustAvoid`, `tone`, `style`, `format`, and `legal` buckets, which are then surfaced in both the `CONTEXT` and `OUTPUT RULES` sections.

### Example Prompt Output

Running the helper with a real campaign produces the following prompt (abridged for readability):

```
SYSTEM
You are the dedicated social media strategist for UK hospitality venues.
- Use British English spelling and UK terminology in every sentence.
...

USER
CONTEXT
business:
  name: The Fox & Hound
  type: gastropub
  servesFood: yes
  servesDrinks: yes
  brandVoice: Warm, witty, local favourite
  toneDescriptors: welcoming, cheeky
  targetAudience: families and locals in Richmond
  identityHighlights: award-winning Sunday roast; riverside terrace
  additionalContext: Currently highlighting late summer terrace dining.
  preferredLink: https://foxandhound.example.com/book
  phone: 020 1234 5678
  whatsapp: 07700 900123
  openingHours:
    - Mon: 11:00–23:00
    - Sun: 11:00–22:00
  menus:
    food: Menu highlights: Yorkshire puddings, sharing boards
    drink: Craft ales, English sparkling wine
  contentBoundaries:
    - No mention of live music
campaign:
  name: Summer Sundowners
  ...

TASK
1. Produce an Instagram post...
2. Align the message...
...

OUTPUT RULES
- Structure: 2 short paragraphs separated by a single blank line.
- Use natural relative timing language ...
- Include the phrase "this Friday" once ...
- Explicitly mention the date Friday 15 August ...
- Links: do not include URLs; direct followers to 'link in bio'.
- Include a clear call-to-action using one of: Tap the link in bio; Send us a DM.
- Do not include hashtags.
- Use emojis sparingly...
```

This structure is identical regardless of endpoint; only the underlying data differs (targets, guardrails, scheduling, etc.).

## Endpoint-Specific Data Hydration

### `POST /api/generate`

1. **Authentication and tenancy** – looks up the signed-in Supabase user, enforces tenant rate limits, and checks monthly AI budgets (`checkTenantBudget`).
2. **Data loading** – fetches:
   - `brand_profiles` (name, type, target audience, brand identity/voice, links, menus, contact numbers, content boundaries, opening hours).
   - `brand_voice_profiles` (tone attributes, sentence length, emoji usage).
   - `content_guardrails` for both campaign-specific and general guidance.
   - Optional `campaigns.description` if a campaign ID is supplied.
3. **Prompt prep** – calls `deriveToneDescriptors` and `buildBrandVoiceSummary`, formats phones via `formatUkPhoneDisplay`, and passes everything into `buildStructuredPostPrompt` with `{ paragraphCount: 2 }` and default CTAs for the platform.
4. **Platform overrides** – if an `ai_platform_prompts` row exists for the platform/content type, it template-renders additional system/user instructions and appends them under “CUSTOM … INSTRUCTIONS”.
5. **OpenAI call** – sends a single request:

   ```ts
   const completion = await openai.chat.completions.create({
     model: 'gpt-4o-mini',
     messages: [
       { role: 'system', content: systemPrompt },
       { role: 'user', content: userPrompt },
     ],
     temperature: 0.8,
     max_tokens: 500,
   });
   ```

6. **Post-processing** – the raw response goes through `postProcessContent` (see below) to enforce link policies, offer phrasing, same-day language, and character limits before returning `{ content }`.

### `POST /api/generate/quick`

- Designed for fast, multi-platform updates (default platform: Facebook). It allows the caller to supply a free-form prompt and a desired tone.
- Loads the same brand/voice/guardrail data as the main generator **except** it does not retrieve `target_audience` from `brand_profiles` (see “Issues” below).
- For each requested platform, the route builds a fresh prompt via `buildStructuredPostPrompt`, then calls OpenAI with `max_tokens: 220` (shorter copy) and the same `temperature: 0.8`.
- Responses are post-processed individually and returned in a map keyed by platform.

### `POST /api/campaigns/:id/generate-batch`

- Accepts campaign timings (preset offsets such as “6 weeks before” or custom dates) and platforms, then expands these into a worklist.
- Loads campaign, brand, voice, guardrail, posting schedule, and tenant data up front. Phone/WhatsApp numbers are reformatted exactly as in the other routes.
- For each work item the generator:
  1. Calculates the final scheduled time (including posting schedule overrides).
  2. Builds a structured prompt with the scheduled date injected so the model can talk about the timing.
  3. Optionally renders `ai_platform_prompts` templates.
  4. Calls OpenAI **inside** a `withRetry(..., PLATFORM_RETRY_CONFIGS.openai)` wrapper to handle rate limits and transient failures. The request payload matches the single-generator call (temperature 0.8, max tokens 500).
  5. Runs the result through `postProcessContent` and upserts into `campaign_posts` (status `draft`, approval `pending`). A simple hand-written fallback copy is injected if OpenAI fails after retries.

### `GET /api/admin/ai-prompts/preview`

This helper reuses `buildStructuredPostPrompt` to show admins exactly what would be sent to OpenAI for a given campaign/platform but never hits the API. It is useful for debugging the context the model receives.

## Post-Processing Pipeline

All generators call `postProcessContent()` (`lib/openai/post-processor.ts`) before sending copy back to the client:

```ts
export function postProcessContent(input: PostProcessorInput): { content: string } {
  const { platform, brand, campaignType, campaignName, eventDate, scheduledFor } = input;
  let content = input.content || '';
  content = enforcePlatformLimits(content, platform);
  content = enforceOfferRules(content, campaignType, campaignName, eventDate, scheduledFor);
  content = normalizeLinks(content, platform, brand);
  content = normalizeSameDay(content, scheduledFor, eventDate);
  content = enforceVoiceHints(content, input.voiceBaton);
  content = tidyGeneratedContent(content);
  if (input.relativeTiming) {
    content = ensureSingleMention(content, input.relativeTiming, { fallbackLine: `Happening ${input.relativeTiming}.` });
  }
  if (input.explicitDate) {
    content = ensureSingleMention(content, input.explicitDate, { fallbackLine: `Event date: ${input.explicitDate}.` });
  }
  content = tidyGeneratedContent(content);
  return { content };
}
```

Notable behaviours:

- **Length enforcement** via `enforcePlatformLimits` trims to platform-specific character budgets while trying to keep whole words.
- **Offer-specific clean-up** removes clock times, normalises “Offer ends …” copy, and standardises “Manager’s Special”.
- **Link handling** strips URLs entirely for Instagram and Google Business Profile, and attempts to ensure a single approved link elsewhere (either replacing the first URL or appending the preferred link as a new paragraph).
- **Same-day language** rewrites phrases like “this Saturday” to “today/tonight” when posts are scheduled on the day itself.
- **Voice hygiene** removes unapproved hype words and injects at least one descriptor from the brand voice baton when missing.
- **Relative timing guard** ensures the configured `relativeLabel` and explicit date each appear exactly once, adding a short fallback line if needed.
- **Whitespace tidy** normalises punctuation spacing and removes extraneous blank lines.

## Reliability, Budgets, and Rate Limiting

- Every route enforces per-user and per-tenant rate limits via `enforceUserAndTenantLimits`.
- Monthly AI spend is tracked using `checkTenantBudget`/`incrementUsage`, with rough token estimates (500 for single/batch posts, 300 × platform for quick posts).
- All generators now wrap OpenAI calls with `withRetry(…, PLATFORM_RETRY_CONFIGS.openai)` and supply explicit request timeouts (60s for full generate, 45s for quick, batch already covered).

## Current Issues and Gaps

1. **Link normalisation can contradict prompt rules** – when the model omits the preferred link for inline platforms (e.g. Facebook), `normalizeLinks` appends the link on its own line, even though the prompt explicitly told the model to include it “exactly once” inline. This keeps compliance but creates copy/commands mismatch that reviewers should assess.
2. **No automatic guardrail verification** – guardrail instructions are passed to the model, but we do not validate the output for required inclusions/exclusions before returning it. Senior review should consider whether light-weight pattern checks are needed.
3. **Limited observability into prompt health** – apart from optional debug logs, we do not store prompt or completion metadata. Diagnosing content quality issues today requires reproducing requests manually.
4. **Model choice fixed to `gpt-4o-mini`** – there is no configuration surface to switch models per tenant or scenario (e.g. fallback to `gpt-4.1` for premium tiers). This may limit content richness.

## Suggested Review Questions for the Senior Dev

1. Do we want to persist prompts/completions (with appropriate redaction) to audit model behaviour over time?
2. Is the post-processing step strict enough, or should we add detection for missing guardrail requirements before surfacing copy to users?
3. Would dynamically adjusting `paragraphCount`, `max_tokens`, or CTA lists per platform/event type improve output quality?
4. Should we expose a configuration layer for model/temperature selection so we can experiment without code changes?

---

Feel free to reach out if you need deeper traces or sample responses for specific tenants or campaigns.
