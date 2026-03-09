# 09 — AI and Content Strategy

**Document status**: Engineering-ready specification
**Success criterion**: AI-generated copy accepted without edits for ≥70% of posts
**Scope**: Prompt engineering, brand voice data model, output schema, validation, regeneration UX, quality measurement, and API configuration

---

## 1. Current AI Implementation Audit

### What exists

The current implementation covers a single code path: instant posts and any campaign variant are all routed through `buildInstantPostPrompt()` in `src/lib/ai/prompts.ts`. The function constructs a two-part prompt (system + user message) using `BrandProfile` from settings and the `InstantPostInput` schema from `src/lib/create/schema.ts`.

Post-generation, two processing layers run:

1. **`postProcessGeneratedCopy()`** (`src/lib/ai/postprocess.ts`): normalises whitespace, formats times (e.g. `6 PM` → `6pm`), strips countdown language when the promotion end date is far away, and removes link-in-bio language when no link is provided.

2. **`applyChannelRules()`** (`src/lib/ai/content-rules.ts`): enforces the contract for each platform/placement combination — strips blocked tokens, removes disallowed factual claims (capacity, end times, age restrictions unless proof points allow), scrubs banned phrases, reduces hype language, normalises day names against the scheduled date, applies proof points, removes URLs, enforces word/char limits, caps hashtags and emojis, and appends final punctuation.

A linting pass (`lintContent()`) runs after to produce a structured `LintResult` that flags issues without modifying copy — the editor UI can surface these.

Brand voice data lives in `src/lib/settings/data.ts` as `BrandProfile`:
- `toneFormal: number` (0–1)
- `tonePlayful: number` (0–1)
- `keyPhrases: string[]`
- `bannedTopics: string[]`
- `bannedPhrases: string[]`
- `defaultHashtags: string[]`
- `defaultEmojis: string[]`
- `instagramSignature?: string`
- `facebookSignature?: string`
- `gbpCta?: string`

The system-level banned phrase list (`BANNED_PHRASES` in `src/lib/ai/voice.ts`) covers 23 generic AI clichés ("unforgettable experience", "electrifying night", etc.) and is merged with user-defined phrases at prompt-build time. Hype vocabulary ("the best", "legendary", "epic") is caught by a separate `HYPE_REPLACEMENTS` list and auto-corrected post-generation.

A proof-point system (`src/lib/ai/proof-points.ts`) manages 10 factual venue claims (e.g. free parking, dog-friendly, near Heathrow T5) with variant text, allowed channels, and allowed use cases. Proof points can be injected in `auto` or `selected` mode.

The OpenAI API call uses `client.responses.create` with model `gpt-4.1-mini` and no explicit temperature, max_tokens, or timeout. No structured output schema (`response_format`) is specified — the model is asked to return plain text only.

### What is missing

| Gap | Impact on quality |
|-----|------------------|
| **Single prompt template for all campaign types.** Event, promotion, weekly, and instant campaigns all use `buildInstantPostPrompt()` with context differences injected via a generic `context: Record<string, unknown>`. There are no distinct prompt templates for event vs promotion vs weekly campaign types. | Copy for events lacks urgency cadence (save-the-date vs day-of tone). Promotions miss the structural difference between "announcing an offer" and "last chance" messaging. Weekly posts do not reference the recurring identity of the slot. |
| **No structured output.** The model returns free text. Hashtags, CTA text, body copy, and metadata are not separated at generation time. | Post-processing must extract hashtags by regex, appending them to the bottom of the body. This is error-prone and prevents per-field validation. |
| **No temperature control.** All generations use the model default (~1.0). | Factual/CTA-heavy GBP updates benefit from lower temperature; creative event posts benefit from higher. |
| **No timeout or retry at the AI call level.** | A slow OpenAI response hangs the server action indefinitely. No user-facing fallback message if the call fails. |
| **No per-platform max_tokens.** | GBP updates capped at 900 chars could be generated at 2000 tokens and truncated at the post-processing stage, wasting tokens and risking abrupt copy cutoffs. |
| **Platform guidance for GBP is a single string literal**, not a proper template. | GBP event and GBP offer posts have different structural requirements (event has title/start/end; offer has coupon code logic) but receive identical guidance. |
| **No campaign phase awareness in prompts.** | A "day-of" event post and a "save-the-date" post 7 days out receive the same instructions. The phase string is passed in `context.phase` but the prompt does not branch on it. |
| **`banned_phrases` not stored in the database schema.** | The `brand_profile` table in `technical-design.md` does not include a `banned_phrases` column (only `banned_topics`). The code reads `brand.bannedPhrases` — if this is not migrated, it defaults to an empty array and user-defined phrases are never applied. |
| **Hashtag limits are inconsistent.** | `resolveContract()` caps Instagram at 6 hashtags; `buildInstantPostPrompt()` asks for up to 10. The prompt guidance and the validation contract disagree. |
| **No acceptance rate measurement.** | There is no database field or event tracking to determine whether a generated variant was accepted as-is, lightly edited, or heavily rewritten. The 70% target cannot be measured. |
| **Stories receive empty body copy by design but no story overlay text is generated.** | `applyChannelRules()` immediately returns `body: ""` for story placement. There is no generation path for story overlay text (short 1-2 line captions for image overlay). |

### What produces poor output

Based on code review:

1. **Claim patterns are stripped post-generation** ("limited spaces", "ends at 9pm", "family friendly") rather than being excluded from prompts. The model generates plausible-sounding copy that then has content silently removed, producing grammatically incomplete sentences.

2. **Day name normalisation** replaces any day name that does not match the scheduled date, which can delete useful references like "every Thursday" from weekly recurring posts.

3. **The few-shot examples in `getFewShotExamples()`** are hardcoded to Sunday roast, Six Nations, and burger-and-pint contexts. For a jazz night event or a BOGO food promotion these examples may push the model toward the wrong register.

4. **Key phrases are listed with `if natural` qualifier** but there is no enforcement. The model can and does ignore them.

---

## 2. Brand Voice Data Model

### Complete `brand_profile` field specification

```typescript
interface BrandProfile {
  // Tone axis 1: 0.0 = very casual, 0.5 = balanced, 1.0 = formal
  toneFormal: number;

  // Tone axis 2: 0.0 = straightforward/serious, 0.5 = lightly playful, 1.0 = playful and lively
  tonePlayful: number;

  // Phrases the owner wants woven into copy when contextually appropriate (e.g. "cracking Sunday session")
  keyPhrases: string[];

  // Topics the AI must not mention at all (e.g. "competitors", "Wetherspoons", "parking charges")
  bannedTopics: string[];

  // Specific phrases to never generate (supplements the system-level BANNED_PHRASES list)
  bannedPhrases: string[];

  // Default hashtags for Instagram posts, stored with or without # prefix, normalised at prompt time
  defaultHashtags: string[];

  // Preferred emojis to use when includeEmojis is true
  defaultEmojis: string[];

  // Optional fixed text appended to every Instagram feed post (e.g. "Find us on Bath Road, Longford")
  instagramSignature?: string;

  // Optional fixed text appended to every Facebook feed post (e.g. "Book a table: 020 xxxx xxxx")
  facebookSignature?: string;

  // Default GBP CTA button type for standard updates ("LEARN_MORE" | "BOOK" | "CALL")
  gbpCta?: string;
}
```

The database `brand_profile` table must include `banned_phrases text[]` — this column is missing from the current schema definition in `technical-design.md` and must be added in the migration.

### How each field maps to prompt behaviour

**Tone sliders**

Both sliders use a 0–1 normalised scale, bucketed into three descriptors in `describeToneTargets()`. The bucketing thresholds (0.3 and 0.7) should remain. The prompt instruction produced is:

```
Tone targets: Formality is {descriptor}; Playfulness is {descriptor}.
```

| `toneFormal` range | Descriptor |
|--------------------|------------|
| 0.0–0.29 | very casual |
| 0.30–0.69 | balanced |
| 0.70–1.0 | formal |

| `tonePlayful` range | Descriptor |
|---------------------|------------|
| 0.0–0.29 | straightforward |
| 0.30–0.69 | lightly playful |
| 0.70–1.0 | playful and lively |

These descriptors appear in the system message so they govern the entire generation, not just a single paragraph. Do not move them to the user message.

**Key phrases**

Instruction in user message:
```
Key phrases to weave in if natural: {phrases joined by ", "}.
```

The current implementation includes these but the model treats them as optional. To increase uptake: move one key phrase into the user message as a concrete directive — "Try to include the phrase '{phrase}' in the copy" — for whichever phrase the owner has marked as primary, if that distinction is added to the data model. For now, list all phrases and accept that natural inclusion will not be guaranteed.

Do not include key phrases in the system message; they are context-specific, not persona-level instructions.

**Banned topics**

These are hard constraints and must appear in both layers:

- **System message**: "Do not mention any of the following topics: {topics}." This sets a general prohibition the model must not violate.
- **Post-processing**: `scrubBannedTopics()` in `postprocess.ts` runs a word-boundary regex replace over the output. This is the safety net, not the primary enforcement.

A purely regex-based post-processing scrub is insufficient for multi-word topics or concepts (e.g. banning "Wetherspoons" works; banning "cheap beer" may not catch "budget lagers"). For topics that are conceptual rather than lexical, the system message prohibition is the only viable mechanism.

**Banned phrases**

Two levels:
1. **System-level** (`BANNED_PHRASES` in `voice.ts`): 23 AI clichés, enforced via the system message instruction "Avoid these phrases" and post-generation auto-replacement.
2. **User-level** (`brand.bannedPhrases`): merged with system list via `mergedBannedPhrases()` and included in the same system message instruction.

No semantic checking is performed. The current approach (regex replacement) is the right choice for phrase-level bans — semantic analysis would require a second API call and is disproportionate.

**Default hashtags**

Rules by platform:
- **Instagram**: include up to 10 hashtags, defaulting to `brand.defaultHashtags` then supplemented with campaign-relevant tags generated by the model. The prompt must be explicit: "Include hashtags as a separate block at the end of the caption, not in the body text."
- **Facebook**: include 2–3 hashtags maximum when `includeHashtags` is true, otherwise none. Do not list default hashtags in the Facebook prompt if the owner has not enabled hashtags.
- **GBP**: never include hashtags. The prompt must state this explicitly and `resolveContract()` enforces `maxHashtags: 0`.

**IMPORTANT**: Align `resolveContract()` (which caps Instagram at 6) with the prompt guidance (which says up to 10). The correct target is **up to 10** for Instagram — update `resolveContract()` to use `maxHashtags: 10` when `includeHashtags` is true.

**Platform signatures**

Signatures are appended to the generated body after all other post-processing. They must be included in the character count check.

Rules:
- `instagramSignature`: append on every Instagram feed post (not stories). Check that `signature.length + body.length` does not exceed 2,200. If it would, trim the body to accommodate.
- `facebookSignature`: append on every Facebook feed post. No hard character limit (Facebook allows 63,206) but the prompt should target 60–120 words in the body so signatures remain legible.
- GBP: no signature field. GBP posts have CTA buttons, not inline signatures.

The signature must not be passed to the AI for generation — it is appended in post-processing after the `applyChannelRules()` pass.

---

## 3. Prompt Templates (Complete, Usable)

### Shared system message base

All prompts share the following system message preamble, then append campaign-type and platform-specific instructions.

```
You are CheersAI, writing social media content for a single-owner pub or restaurant in London.
Use British English throughout.
Write as the venue team using "we" and "us" — never "I" or third person.
{{#if venueName}}Refer to the venue as "{{venueName}}" when it feels natural. Do not overuse the name.{{/if}}
{{#unless venueName}}Do not name the venue explicitly.{{/unless}}
Keep copy warm, human, and practical. Sound like a real pub team: friendly, welcoming, grounded.
Avoid hype, corporate marketing language, grand claims, or superlatives.
Tone targets: Formality is {{toneFormalDescriptor}}; Playfulness is {{tonePlayfulDescriptor}}.
Do not mention any of the following topics: {{bannedTopics}}.
Avoid these phrases entirely: {{mergedBannedPhrases}}.
Never refer to yourself as an AI or language model.
Output only the final copy. No labels, no quotes, no commentary, no markdown formatting.
```

---

### 3.1 Event × Facebook feed post

**System message**: Shared base above.

**User message**:
```
Write a Facebook post announcing or promoting the following event.

Event: {{eventName}}
Date and time: {{eventDateFormatted}} at {{eventTimeFormatted}}
Details: {{eventDescription}}
{{#if prompt}}Additional context: {{prompt}}{{/if}}
{{#if heroMedia}}Media attached: {{heroMediaDescription}}{{/if}}
Campaign phase: {{phase}}
{{#if phase == "save_the_date"}}This post is early promotion — build anticipation and encourage people to save the date. Do not use urgent language yet.{{/if}}
{{#if phase == "reminder"}}This is a reminder post 3 days before the event. Mention key details and encourage booking.{{/if}}
{{#if phase == "day_of"}}This post goes out on the day. Use energising language. Mention the door time if known. Encourage people to come tonight.{{/if}}
{{#if phase == "last_call"}}This is the final push post. Use warm urgency. Suggest it would be a shame to miss it.{{/if}}

Brand voice:
Key phrases to weave in if natural: {{keyPhrases}}.
{{#if includeEmojis}}Preferred emojis: {{defaultEmojis}}. Use sparingly — one or two maximum.{{/if}}
{{#unless includeEmojis}}Do not use emojis.{{/unless}}

Platform guidance:
Write 60–120 words. Use a warm, inviting tone.
{{#if ctaUrl}}Close with a clear call to action aligned with "{{ctaLabel}}". Do not include the URL in the copy — our system appends it separately.{{/if}}
{{#unless ctaUrl}}Close with a clear call to action suited to the event (e.g. "Book your table", "Pop by and see us").{{/unless}}
{{#if includeHashtags}}Include 2–3 relevant hashtags at the very end of the post, after the main copy.{{/if}}
{{#unless includeHashtags}}Do not include hashtags.{{/unless}}
{{#if facebookSignature}}The following line will be appended automatically after your copy — do not include it yourself: "{{facebookSignature}}"{{/if}}
Format times as 6pm or 7:30pm (no space, lowercase am/pm).
```

---

### 3.2 Event × Instagram feed post

**System message**: Shared base above.

**User message**:
```
Write an Instagram caption for the following event.

Event: {{eventName}}
Date and time: {{eventDateFormatted}} at {{eventTimeFormatted}}
Details: {{eventDescription}}
{{#if prompt}}Additional context: {{prompt}}{{/if}}
{{#if heroMedia}}Media attached: {{heroMediaDescription}}{{/if}}
Campaign phase: {{phase}}
{{#if phase == "save_the_date"}}Build excitement. Keep it short and intriguing. End with an invitation to follow for updates.{{/if}}
{{#if phase == "reminder"}}Warm reminder tone. Key details in the first line — Instagram captions get cut off. Encourage people to secure their spot.{{/if}}
{{#if phase == "day_of"}}High energy but not shouty. Today-focused. Ends with a reason to come tonight.{{/if}}
{{#if phase == "last_call"}}Final call — warm, not pushy. Give one compelling reason to come.{{/if}}

Brand voice:
Key phrases to weave in if natural: {{keyPhrases}}.
{{#if includeEmojis}}Preferred emojis: {{defaultEmojis}}. Use sparingly — two maximum in the body text.{{/if}}
{{#unless includeEmojis}}Do not use emojis.{{/unless}}

Platform guidance:
Write up to 80 words. Use line breaks between short paragraphs to aid readability on mobile.
Do not include any URLs in the copy.
{{#if linkInBioUrl or ctaUrl}}End with a natural link-in-bio line, e.g. "Link in bio to book" or "Find out more via our bio link". Align the line with the CTA label "{{ctaLabel}}" if provided.{{/if}}
{{#unless linkInBioUrl or ctaUrl}}Do not mention link in bio.{{/unless}}
{{#if includeHashtags}}Add hashtags as a separate block after the caption body. Use up to 10 hashtags. Include these defaults if relevant: {{defaultHashtags}}. Add campaign-specific tags.{{/if}}
{{#unless includeHashtags}}Do not include hashtags.{{/unless}}
{{#if instagramSignature}}The following line will be appended automatically — do not include it: "{{instagramSignature}}"{{/if}}
Format times as 6pm or 7:30pm.
```

---

### 3.3 Event × GBP event post

**System message**: Shared base above, plus: "You are writing for Google Business Profile. Google reviews content for policy compliance. Keep language factual, professional, and free from superlatives."

**User message**:
```
Write a Google Business Profile event post.

Event title (max 58 characters — keep it concise): {{eventName}}
Date: {{eventDateFormatted}}
Time: {{eventTimeFormatted}}
Description: {{eventDescription}}
{{#if prompt}}Additional detail: {{prompt}}{{/if}}

Platform guidance:
Write 80–150 words. Lead with the most important information (what, when).
Use plain, factual language. No hashtags. No emojis.
End with a clear call to action: "{{gbpCtaEvent}}" (one of: LEARN_MORE, BOOK, CALL).
Do not include URLs — they are configured separately in the GBP post settings.
Format times as 6pm or 7:30pm.
Do not mention link in bio.

Output format:
Return the event description body only (not the title — that is set separately).
The description must be under 1,500 characters.
```

---

### 3.4 Promotion × Facebook feed post

**System message**: Shared base above.

**User message**:
```
Write a Facebook post promoting the following offer.

Promotion name: {{promotionName}}
Offer: {{offerSummary}}
Runs: {{promotionStartFormatted}} to {{promotionEndFormatted}}
{{#if prompt}}Additional context: {{prompt}}{{/if}}
{{#if heroMedia}}Media attached: {{heroMediaDescription}}{{/if}}
Campaign phase: {{phase}}
{{#if phase == "announce"}}This is the launch post. Focus on the value of the offer and encourage immediate action.{{/if}}
{{#if phase == "reminder"}}Mid-promotion reminder. Mention the offer is still available. Reinforce the value.{{/if}}
{{#if phase == "last_chance"}}Final push. The offer ends soon. Use warm urgency — "last few days", "wrapping up soon".{{/if}}

Brand voice:
Key phrases to weave in if natural: {{keyPhrases}}.
{{#if includeEmojis}}Preferred emojis: {{defaultEmojis}}. Use one or two maximum.{{/if}}
{{#unless includeEmojis}}Do not use emojis.{{/unless}}

Platform guidance:
Write 50–100 words. Lead with the offer, not the venue name.
Include the specific offer detail (e.g. price, discount amount) exactly as provided above — do not omit or paraphrase it.
{{#if ctaUrl}}Close with a call to action aligned with "{{ctaLabel}}". Do not include the URL — our system appends it.{{/if}}
{{#unless ctaUrl}}Close with a direct call to action (e.g. "Book a table", "Call us to reserve").{{/unless}}
{{#if includeHashtags}}Include 2–3 relevant hashtags at the end.{{/if}}
{{#unless includeHashtags}}Do not include hashtags.{{/unless}}
```

---

### 3.5 Promotion × Instagram feed post

**System message**: Shared base above.

**User message**:
```
Write an Instagram caption promoting the following offer.

Promotion: {{promotionName}}
Offer: {{offerSummary}}
Runs: {{promotionStartFormatted}} to {{promotionEndFormatted}}
{{#if prompt}}Additional context: {{prompt}}{{/if}}
{{#if heroMedia}}Media attached: {{heroMediaDescription}}{{/if}}
Campaign phase: {{phase}}
{{#if phase == "announce"}}Launch post. Lead with the offer value. Punchy first line — it appears in the feed preview.{{/if}}
{{#if phase == "reminder"}}Friendly reminder. Short and direct.{{/if}}
{{#if phase == "last_chance"}}Final days. Warm urgency without pressure.{{/if}}

Brand voice:
Key phrases to weave in if natural: {{keyPhrases}}.
{{#if includeEmojis}}Preferred emojis: {{defaultEmojis}}. Maximum two in body text.{{/if}}
{{#unless includeEmojis}}Do not use emojis.{{/unless}}

Platform guidance:
Write up to 80 words. First line must be compelling — it is the only text visible in feed.
Include the exact offer detail as provided — do not paraphrase discount amounts or prices.
No URLs in the copy.
{{#if linkInBioUrl or ctaUrl}}End with a link-in-bio line aligned with "{{ctaLabel}}".{{/if}}
{{#unless linkInBioUrl or ctaUrl}}Do not mention link in bio.{{/unless}}
{{#if includeHashtags}}Hashtag block after caption. Up to 10 tags. Prefer: {{defaultHashtags}}.{{/if}}
{{#unless includeHashtags}}No hashtags.{{/unless}}
```

---

### 3.6 Promotion × GBP offer post

**System message**: Shared base above, plus GBP factual style note.

**User message**:
```
Write a Google Business Profile offer post.

Offer title (max 58 characters): {{promotionName}}
Offer details: {{offerSummary}}
Valid: {{promotionStartFormatted}} to {{promotionEndFormatted}}
{{#if couponCode}}Coupon code: {{couponCode}}{{/if}}
{{#if prompt}}Additional detail: {{prompt}}{{/if}}

Platform guidance:
Write 80–150 words. State the offer clearly in the first sentence.
Include the exact discount or offer detail — do not paraphrase.
{{#if couponCode}}Mention the coupon code: "{{couponCode}}".{{/if}}
No hashtags. No emojis. No URLs in body text.
End with a call to action aligned with "{{gbpCtaOffer}}" (one of: REDEEM, CALL, LEARN_MORE).
Output must be under 1,500 characters.
Do not mention link in bio or social media.
```

---

### 3.7 Weekly Recurring × Facebook feed post

**System message**: Shared base above.

**User message**:
```
Write a Facebook post for a recurring weekly event slot.

Event name: {{campaignName}}
Occurs every: {{dayOfWeekName}}
Time: {{eventTimeFormatted}}
Description: {{description}}
Week number (for context only, do not state in copy): {{occurrenceIndex}}
{{#if prompt}}Additional context this week: {{prompt}}{{/if}}
{{#if heroMedia}}Media attached: {{heroMediaDescription}}{{/if}}

Brand voice:
Key phrases to weave in if natural: {{keyPhrases}}.
{{#if includeEmojis}}Preferred emojis: {{defaultEmojis}}. One or two maximum.{{/if}}
{{#unless includeEmojis}}Do not use emojis.{{/unless}}

Platform guidance:
Write 50–100 words. The post should feel fresh even though the event is recurring — vary the angle each week (e.g. one week focus on the food, another on the atmosphere, another on who to bring).
Do not say "every week" or "weekly" — it sounds like filler. Describe the event as if it is this week's.
Include the day name naturally (e.g. "Join us this Thursday").
{{#if ctaUrl}}Close with a call to action for "{{ctaLabel}}". URL appended by system.{{/if}}
{{#unless ctaUrl}}Close with an inviting call to action.{{/unless}}
{{#if includeHashtags}}2–3 relevant hashtags at the end.{{/if}}
{{#unless includeHashtags}}No hashtags.{{/unless}}
```

---

### 3.8 Weekly Recurring × Instagram feed post

**System message**: Shared base above.

**User message**:
```
Write an Instagram caption for a recurring weekly slot.

Event: {{campaignName}}
Day: {{dayOfWeekName}} at {{eventTimeFormatted}}
Description: {{description}}
Week number (internal only, do not state): {{occurrenceIndex}}
{{#if prompt}}This week's angle: {{prompt}}{{/if}}
{{#if heroMedia}}Media: {{heroMediaDescription}}{{/if}}

Brand voice:
Key phrases to weave in if natural: {{keyPhrases}}.
{{#if includeEmojis}}Preferred emojis: {{defaultEmojis}}. Maximum two.{{/if}}
{{#unless includeEmojis}}No emojis.{{/unless}}

Platform guidance:
Up to 80 words. Vary the copy angle each week — do not reuse the same structure.
First sentence must be a hook that works without seeing the image.
Include the day name naturally. Do not say "every week".
No URLs.
{{#if linkInBioUrl or ctaUrl}}End with a link-in-bio line for "{{ctaLabel}}".{{/if}}
{{#unless linkInBioUrl or ctaUrl}}No link-in-bio mention.{{/unless}}
{{#if includeHashtags}}Hashtag block after caption. Up to 10 tags. Start with: {{defaultHashtags}}.{{/if}}
{{#unless includeHashtags}}No hashtags.{{/unless}}
```

---

### 3.9 Weekly Recurring × GBP update post

**System message**: Shared base above, plus GBP factual style note.

**User message**:
```
Write a Google Business Profile update for a recurring weekly event.

Event: {{campaignName}}
Day: {{dayOfWeekName}} at {{eventTimeFormatted}}
Description: {{description}}
{{#if prompt}}Additional detail: {{prompt}}{{/if}}

Platform guidance:
Write 80–150 words. Factual, professional tone.
State the day and time clearly in the first paragraph.
No hashtags. No emojis. No URLs in body.
End with a call to action: "{{gbpCtaStandard}}".
Output under 1,500 characters.
```

---

### 3.10 Instant Post × Facebook

**System message**: Shared base above.

**User message**:
```
Write a Facebook post based on the following request.

Title or subject: {{title}}
Owner's prompt: {{prompt}}
{{#if heroMedia}}Media: {{heroMediaDescription}}{{/if}}
{{#if scheduledFor}}Post scheduled for: {{scheduledForFormatted}}.{{/if}}

Brand voice:
Key phrases to weave in if natural: {{keyPhrases}}.
{{#if includeEmojis}}Preferred emojis: {{defaultEmojis}}. One or two maximum.{{/if}}
{{#unless includeEmojis}}No emojis.{{/unless}}

Platform guidance:
Write 40–120 words depending on how much the prompt gives you. Keep it concise.
{{#if ctaUrl}}Close with a call to action for "{{ctaLabel}}". Do not include the URL.{{/if}}
{{#unless ctaUrl}}Close with an appropriate call to action if one fits naturally.{{/unless}}
{{#if includeHashtags}}2–3 hashtags at the end.{{/if}}
{{#unless includeHashtags}}No hashtags.{{/unless}}
{{#if toneAdjust == "more_formal"}}Lean more formal than usual while staying warm and welcoming.{{/if}}
{{#if toneAdjust == "more_casual"}}Use extra casual phrasing and relaxed contractions.{{/if}}
{{#if toneAdjust == "more_playful"}}Amp up playful wording and energy without sounding forced.{{/if}}
{{#if toneAdjust == "more_serious"}}Dial down jokes; focus on trust and credibility.{{/if}}
{{#if lengthPreference == "short"}}Keep it to one or two punchy sentences.{{/if}}
{{#if lengthPreference == "detailed"}}Offer a richer description with specific details.{{/if}}
Format times as 6pm or 7:30pm.
```

---

### 3.11 Instant Post × Instagram

**System message**: Shared base above.

**User message**:
```
Write an Instagram caption based on the following request.

Title or subject: {{title}}
Owner's prompt: {{prompt}}
{{#if heroMedia}}Media: {{heroMediaDescription}}{{/if}}
{{#if scheduledFor}}Post scheduled for: {{scheduledForFormatted}}.{{/if}}

Brand voice:
Key phrases to weave in if natural: {{keyPhrases}}.
{{#if includeEmojis}}Preferred emojis: {{defaultEmojis}}. Maximum two in body.{{/if}}
{{#unless includeEmojis}}No emojis.{{/unless}}

Platform guidance:
Up to 80 words. Use line breaks between short paragraphs.
No URLs in the copy.
{{#if linkInBioUrl or ctaUrl}}End with a link-in-bio line: e.g. "Link in bio for details". Align with "{{ctaLabel}}" if provided.{{/if}}
{{#unless linkInBioUrl or ctaUrl}}Do not mention link in bio.{{/unless}}
{{#if includeHashtags}}Hashtag block after caption. Up to 10 tags. Start with: {{defaultHashtags}}.{{/if}}
{{#unless includeHashtags}}No hashtags.{{/unless}}
{{#if toneAdjust != "default"}}Tone adjustment: {{toneAdjustInstruction}}.{{/if}}
{{#if lengthPreference == "short"}}Keep it to one or two punchy sentences.{{/if}}
{{#if lengthPreference == "detailed"}}Richer description with specific sensory details.{{/if}}
```

---

### 3.12 Instant Post × GBP

**System message**: Shared base above, plus GBP factual style note.

**User message**:
```
Write a Google Business Profile update based on the following request.

Subject: {{title}}
Owner's prompt: {{prompt}}
{{#if scheduledFor}}Post date: {{scheduledForFormatted}}.{{/if}}

Platform guidance:
Write 80–200 words. Lead with the most relevant information.
Factual, professional tone. No hashtags. No emojis. No URLs in body text.
End with a call to action: "{{gbpCtaStandard}}".
Output under 1,500 characters.
Do not mention link in bio or social media accounts.
```

---

### 3.13 Facebook story caption template (text overlay)

Stories have no feed caption — the AI generates short overlay text for the image. This is a separate generation request, not routed through the standard feed template.

**System message**:
```
You are CheersAI writing short text overlay copy for Facebook Stories.
Use British English. Write as the venue team ("we", "us").
Keep it punchy — stories are viewed for 5 seconds.
Output only the final text. No labels, quotes, or commentary.
```

**User message**:
```
Write a 1–2 line text overlay for a Facebook Story.

Subject: {{title}}
{{#if prompt}}Context: {{prompt}}{{/if}}
{{#if eventName}}Event: {{eventName}} on {{eventDateFormatted}}{{/if}}

Rules:
Maximum 10 words per line. Maximum 2 lines.
No hashtags. No URLs.
Use a call to action on the second line if space allows (e.g. "Book now", "Join us tonight").
{{#if includeEmojis}}One emoji is acceptable if it fits.{{/if}}
{{#unless includeEmojis}}No emojis.{{/unless}}
```

---

### 3.14 Instagram story caption template (text overlay)

**System message**:
```
You are CheersAI writing short text overlay copy for Instagram Stories.
Use British English. Write as the venue team.
Stories are viewed in seconds — every word must earn its place.
Output only the final text. No labels, no commentary.
```

**User message**:
```
Write a 1–2 line text overlay for an Instagram Story.

Subject: {{title}}
{{#if prompt}}Context: {{prompt}}{{/if}}
{{#if eventName}}Event: {{eventName}} on {{eventDateFormatted}}{{/if}}

Rules:
Maximum 8 words per line. Maximum 2 lines.
No hashtags. No URLs.
End with a short action phrase if relevant (e.g. "Tap to find out more", "Link in bio").
{{#if includeEmojis}}One emoji allowed.{{/if}}
{{#unless includeEmojis}}No emojis.{{/unless}}
```

---

## 4. Structured Output Schema

Switch from plain text to structured outputs. This eliminates the regex hashtag extraction hack and allows per-field validation before post-processing.

### API call configuration

```typescript
const response = await client.chat.completions.create({
  model: "gpt-4o",
  temperature: resolveTemperature(campaignType, platform),
  max_tokens: resolveMaxTokens(platform),
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "social_post",
      strict: true,
      schema: SOCIAL_POST_SCHEMA,
    },
  },
  messages: [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ],
});
const parsed = JSON.parse(response.choices[0].message.content ?? "{}");
```

### JSON schema (`SOCIAL_POST_SCHEMA`)

```json
{
  "type": "object",
  "properties": {
    "body": {
      "type": "string",
      "description": "Main caption or post body text. Plain text only. No hashtags embedded in the body. No URLs."
    },
    "hashtags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Hashtags as individual strings, each starting with #. Empty array if not applicable."
    },
    "cta_text": {
      "type": ["string", "null"],
      "description": "The call-to-action text the post should convey (e.g. 'Book a table', 'Call us'). Null if no CTA is appropriate."
    },
    "story_overlay_line_1": {
      "type": ["string", "null"],
      "description": "For story placements only: first overlay text line. Null for feed posts."
    },
    "story_overlay_line_2": {
      "type": ["string", "null"],
      "description": "For story placements only: second overlay text line. Null for feed posts or if one line is sufficient."
    },
    "character_count_warning": {
      "type": "boolean",
      "description": "True if the model believes the body is approaching or exceeding the platform character limit."
    },
    "gbp_topic_type": {
      "type": ["string", "null"],
      "enum": ["STANDARD", "EVENT", "OFFER", null],
      "description": "GBP post type. Null for non-GBP platforms."
    },
    "gbp_cta_action": {
      "type": ["string", "null"],
      "enum": ["LEARN_MORE", "BOOK", "CALL", "REDEEM", "ORDER", "SIGN_UP", null],
      "description": "GBP CTA button action type. Null for non-GBP platforms."
    },
    "word_count": {
      "type": "integer",
      "description": "Approximate word count of the body field (excluding hashtags)."
    }
  },
  "required": [
    "body",
    "hashtags",
    "cta_text",
    "story_overlay_line_1",
    "story_overlay_line_2",
    "character_count_warning",
    "gbp_topic_type",
    "gbp_cta_action",
    "word_count"
  ],
  "additionalProperties": false
}
```

### Field handling after parsing

| Field | How it is used |
|-------|---------------|
| `body` | Passed through `applyChannelRules()` for banned-phrase scrub, claim removal, day-name normalisation, etc. |
| `hashtags` | Validated against platform limits (Instagram ≤10, Facebook ≤3, GBP = 0). Appended to body after all post-processing. |
| `cta_text` | Stored in `content_variants.preview_data` for UI display. Not appended to body unless it is a GBP post. |
| `story_overlay_line_1/2` | Stored separately; rendered as text overlays in the story preview UI. |
| `character_count_warning` | Surfaces a UI warning indicator even if the copy passes the hard char limit check. |
| `gbp_topic_type` | Used by the GBP publishing adapter to set the correct post type in the API call. |
| `gbp_cta_action` | Used by the GBP publishing adapter to set the CTA button. Falls back to `brand.gbpCta` default if null. |

---

## 5. Content Rules and Validation

### Per-platform character and word limits

| Platform | Content type | Body char limit | Body word target | Notes |
|----------|-------------|----------------|-----------------|-------|
| Facebook | Feed post | 63,206 | 60–120 words | Hard limit not practically constraining; target word count is the UX guardrail |
| Facebook | Story overlay | — | 10 words per line, 2 lines | No text field limit; visual constraint |
| Instagram | Feed post | 2,200 | ≤80 words | Hard char limit enforced; word limit is the practical cap |
| Instagram | Story overlay | — | 8 words per line, 2 lines | Visual constraint |
| GBP | Standard update | 1,500 | 80–200 words | `resolveContract()` enforces `maxChars: 900` — this should be raised to 1,500 |
| GBP | Event description | 1,500 | 80–150 words | Event title separate field, max 58 chars |
| GBP | Offer details | 1,500 | 80–150 words | Offer title separate field, max 58 chars |

**Action required**: Update `resolveContract()` `maxChars` for GBP from `900` to `1500`.

### Banned topic detection

Three-layer approach:

1. **System prompt prohibition** (primary): topics listed in the system message. The model is instructed not to mention them. This is the most effective layer for conceptual bans.

2. **Post-generation regex scrub** (secondary): `scrubBannedTopics()` in `postprocess.ts` applies word-boundary regex for single-word topics and literal string matching for multi-word topics. Sentences containing a banned topic match are not removed — only the matched phrase is deleted, which can leave grammatically incomplete sentences. This is an acceptable trade-off for the current use case.

3. **Post-scrub detection check** (tertiary): `containsBannedTopic()` in `service.ts` runs after scrubbing. If a banned topic string is still found in the output, the entire generation is rejected with an error (no copy returned to the user). This prevents banned content from reaching the editor.

Semantic banned topic detection (e.g. banning a concept without naming it explicitly) is not implemented and is out of scope. If the owner needs conceptual bans (e.g. "do not mention anything related to football"), the topic string should be broad enough to catch likely phrasings ("football", "Premier League", "match day").

### CTA presence check for GBP

- **Hard requirement**: all GBP posts must have a CTA button. The `gbp_cta_action` field in the structured output schema captures the model's recommendation.
- If `gbp_cta_action` is null after parsing, fall back to `brand.gbpCta` (which defaults to `LEARN_MORE`).
- The lint check `lintContent()` does not currently check for GBP CTA presence — this check is implicit in the publishing adapter. Add an explicit lint rule: if `platform === "gbp"` and `gbp_cta_action` is null and `brand.gbpCta` is undefined, flag `gbp_cta_missing`.

### Hashtag count limits

| Platform | `includeHashtags: true` | `includeHashtags: false` |
|----------|------------------------|-------------------------|
| Instagram | Max 10 (update from current cap of 6) | 0 |
| Facebook | Max 3 | 0 |
| GBP | 0 (always) | 0 |

The `resolveContract()` function must be updated: change `platform === "instagram" ? includeHashtags ? 6 : 0` to `includeHashtags ? 10 : 0`.

### Profanity filter

No dedicated profanity filter library is currently implemented. The `BLOCKED_WORDS` list in `content-rules.ts` catches `["undefined", "null", "nan"]` (template artefacts, not profanity).

Recommended approach: add a small hardcoded list of the most commonly problematic words to `BLOCKED_WORDS` as a safety net. A full profanity filter library (e.g. `bad-words`) is disproportionate for this use case — the system prompt prohibition of inappropriate language, combined with GPT-4o's built-in content filtering, is sufficient. If a profanity is detected in the `BLOCKED_WORDS` check, treat it as a hard block (same as current `blocked_tokens` handling).

### Validation: warning vs hard block

| Rule | Severity | Behaviour |
|------|----------|-----------|
| Banned topic found after scrub (`containsBannedTopic`) | Hard block | No copy returned; error shown to user; regeneration offered |
| Blocked token (template artefact, AI self-reference) | Hard block | Same |
| Empty body after post-processing | Hard block | Same |
| `character_count_warning` flag from model | Warning | UI indicator shown; owner can still schedule |
| Body exceeds platform char limit | Warning (Facebook) / Hard trim (Instagram, GBP) | Instagram and GBP: copy truncated in `applyChannelRules()` and warning shown. Facebook: UI warning only |
| Word count exceeds target | Warning | UI indicator; no blocking |
| Hashtag count exceeds limit | Auto-corrected | Excess hashtags silently dropped; repair logged |
| Emoji count exceeds limit | Auto-corrected | Excess emojis silently dropped; repair logged |
| CTA missing on GBP post | Warning | UI indicator; owner prompted to check CTA button setting before scheduling |
| Banned phrase found | Auto-corrected | Phrase replaced silently; repair logged; no UI indicator unless `DEBUG_CONTENT_GENERATION` is true |
| Day name mismatch | Auto-corrected | Day name replaced; repair logged |
| Link-in-bio used on wrong platform | Auto-corrected | Phrase stripped; repair logged |
| Disallowed claim (capacity, end time, age) | Auto-corrected | Claim stripped; repair logged |
| Trailing ellipsis | Auto-corrected | Removed |
| Repeated word sequence | Auto-corrected | Collapsed |

---

## 6. Regeneration and Refinement UX

### Regeneration flow

When the owner clicks "Regenerate" on a platform variant:

1. The original campaign inputs (title, prompt, dates, media, platform, tone settings) are retrieved from the stored `content_items.prompt_context`.
2. Any user-provided modifier is appended to the prompt.
3. A new AI call is made; the resulting copy replaces the current draft in the editor.
4. The previous copy is stored as the last-accepted draft (one level of undo) so the owner can revert if the regeneration is worse.
5. The generation ID, regeneration count, and timestamp are recorded on the `content_variants` row.

Context carried forward on regeneration:
- All campaign inputs (event name, dates, description, CTA URL/label, media)
- Brand profile (tone sliders, key phrases, banned topics, banned phrases, hashtags)
- Platform and placement
- Original `phase` / `slot` context
- Previous `repairs` list (passed as an instruction note: "The previous generation required these auto-corrections: {{repairs}}. Try to avoid them.")

Context NOT carried forward:
- The previous generated text body (to prevent the model anchoring on the same structure)

### Modifier injection

The owner can type a modifier into a text field (e.g. "make it shorter", "focus on the food offer", "more exciting tone", "mention the live band").

The modifier is injected into the user message as a final section, after all other instructions, at the highest priority:

```
Owner refinement request (apply this instruction — it takes priority over general guidance):
{{modifier}}
```

This placement ensures the modifier is in the model's recency window. Brand voice instructions (banned topics, banned phrases, tone) remain in the system message and are not overridden by the modifier.

If the modifier contains a banned topic (e.g. the owner writes "mention Wetherspoons"), the system should detect this before sending to the API and show a validation error: "That topic is on your banned list — update your brand settings if you want to mention it."

### Regeneration limit

After **3 regenerations** of the same variant, the editor shifts from "Regenerate" to "Edit manually" as the primary action button. The "Regenerate" option remains available but is presented as a secondary action with a note: "You've regenerated this post 3 times — editing directly may be faster."

There is no hard technical block after 3 regenerations — the limit is a UX nudge only.

### Manual editing and future regeneration

If the owner edits the generated body copy directly in the editor:

- The `content_variants` row records `was_manually_edited: boolean = true` and stores the character-level edit distance between the original generated body and the final saved body.
- The "Regenerate" button remains available but shows a confirmation: "Regenerating will replace your edits. Continue?" This prevents accidental loss of manual work.
- Manual edits do not suppress future regeneration offers — the owner may want to regenerate with a modifier after making a small correction.
- If `was_manually_edited` is true and the owner regenerates, the new generation starts from scratch (not from the edited text).

---

## 7. Quality Targets and Measurement

### Target

AI-generated copy is accepted without edits for ≥70% of posts.

### Data to capture

Add the following fields to `content_variants`:

```sql
generation_id          uuid           -- unique ID for each AI call (for debugging)
generation_count       integer        -- how many times the variant was regenerated (starts at 1)
was_manually_edited    boolean        -- true if the owner changed the body text before scheduling
edit_distance          integer        -- Levenshtein distance between generated body and scheduled body
body_at_generation     text           -- snapshot of the body immediately after generation, before edits
scheduled_body         text           -- the body actually used when the post was scheduled
regeneration_modifiers text[]         -- array of modifier strings used in regenerations
```

Also capture an event on the `publish_jobs` table or a separate `content_events` table:

```sql
event_type   text  -- "generated" | "regenerated" | "edited" | "accepted" | "scheduled"
event_at     timestamptz
metadata     jsonb -- generation_id, platform, campaign_type, edit_distance
```

### Defining "accepted without edit"

| Outcome | Definition | Measurement |
|---------|-----------|-------------|
| Accepted without edit | Body scheduled is identical to body at generation | `edit_distance = 0` AND `was_manually_edited = false` |
| Lightly edited | Small changes: punctuation, one word swapped, emoji added | `edit_distance > 0` AND `edit_distance ≤ 20` |
| Significantly edited | Meaningful content change | `edit_distance > 20` AND `edit_distance < 100` |
| Heavily rewritten | Owner replaced most of the copy | `edit_distance ≥ 100` OR body length changed by >50% |

The 70% target applies to posts that are accepted without edit OR lightly edited (combined). Pure acceptance without any editing is a stretch goal.

### Measuring the target

Monthly calculation:

```
acceptance_rate = (posts_where_edit_distance = 0) / total_scheduled_posts
```

Review weekly for the first 3 months after launch. If the rate is below 60%, identify which campaign type / platform combination has the most edits and review the relevant prompt template.

### Feedback loop

- The owner can flag a generated post as "poor quality" via a thumbs-down icon in the editor. This sets `quality_flag: "poor"` on the `content_variants` row.
- Flagged generations are reviewed manually (by the developer/operator) quarterly to identify patterns in the system prompt or banned-phrase list that need updating.
- There is no automated prompt tuning from flags — the feedback loop is manual review and human prompt iteration.
- The `repairs` array (list of auto-corrections applied) is the most actionable signal: if `banned_phrases_removed` appears in >20% of generations, the system prompt phrasing needs strengthening.

---

## 8. OpenAI API Configuration

### Model recommendation

**Migrate from `gpt-4.1-mini` to `gpt-4o`.**

The current implementation uses `gpt-4.1-mini` (accessed via `client.responses.create`, which uses the Responses API rather than the Chat Completions API). For structured outputs (`response_format: { type: "json_schema" }`) and the quality target of 70% acceptance, `gpt-4o` is the correct choice.

`gpt-4o-mini` is an acceptable cost-saving option if quality testing confirms comparable output for pub/restaurant copy, but `gpt-4o` should be used as the default until the acceptance rate target is established.

**API endpoint migration**: change from `client.responses.create` to `client.chat.completions.create` to support `response_format: json_schema`. The Responses API does not support structured outputs in the same way.

### Temperature settings

| Campaign type | Platform | Temperature | Rationale |
|--------------|----------|-------------|-----------|
| Event (save_the_date, day_of) | Facebook, Instagram | 0.9 | Creative event copy benefits from variety |
| Event | GBP | 0.5 | Factual event descriptions should be consistent |
| Promotion | Facebook, Instagram | 0.8 | Engaging promotional copy needs creative variation |
| Promotion | GBP | 0.4 | Offer details must be accurately stated |
| Weekly Recurring | Facebook, Instagram | 0.95 | Variation across weeks is essential; same event, different angle every time |
| Weekly Recurring | GBP | 0.5 | Factual recurring update |
| Instant Post | Facebook, Instagram | 0.85 | Ad-hoc; creative latitude expected |
| Instant Post | GBP | 0.5 | Concise factual update |
| Story overlays | Facebook, Instagram | 1.0 | Very short creative text; high variation beneficial |

Implement as `resolveTemperature(campaignType: string, platform: string): number`.

### Max tokens

| Platform | Max tokens | Reasoning |
|----------|-----------|-----------|
| Facebook feed | 350 | ~120 words body + hashtags + JSON wrapper |
| Instagram feed | 350 | ~80 words body + 10 hashtags + JSON wrapper |
| GBP update | 400 | Up to 200 words + structured fields |
| Facebook story | 80 | 2 lines, 10 words each + JSON wrapper |
| Instagram story | 80 | 2 lines, 8 words each + JSON wrapper |

These are conservative upper bounds. The JSON schema wrapper adds ~50 tokens of overhead. Implement as `resolveMaxTokens(platform: string, placement: string): number`.

### Timeout

Set a **25-second AbortController timeout** on the API call (leaving 5 seconds for post-processing within a 30-second server action budget):

```typescript
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 25_000);
try {
  const response = await client.chat.completions.create({
    ...,
    signal: controller.signal,
  });
} finally {
  clearTimeout(timer);
}
```

### Cost estimate

Based on GPT-4o pricing (approximate, as of 2025):
- Input: ~$2.50 per 1M tokens
- Output: ~$10.00 per 1M tokens

Per generation (single platform variant):
- Input: ~500–700 tokens (system + user prompt) ≈ $0.0015
- Output: ~200–350 tokens ≈ $0.003

Cost per full campaign post (3 platforms × 1 variant each): approximately **$0.015–$0.02**.

For a weekly plan with 7 days × 3 platforms × 1 post per day: approximately **$0.30–$0.40 per weekly plan generation**.

Story generations add minimal cost (~$0.002 per story overlay).

Monthly cost estimate (assuming 4 weekly plans + 4 event campaigns + miscellaneous instant posts): approximately **$3–$8/month**. This is negligible.

### Fallback behaviour

If the OpenAI call fails (timeout, API error, rate limit, or structured output parse failure):

1. **Do not silently return empty copy.** Show the owner a clear, plain-language error in the editor:
   > "We couldn't generate copy for this post right now. You can type your own copy below, or try generating again in a moment."

2. **Enable manual entry mode** immediately — the body text field becomes editable and focused so the owner can type their own copy without waiting.

3. **Log the error** with the generation ID, platform, campaign type, and error message for debugging. Do not expose raw API errors to the owner.

4. **Offer retry** via a "Try again" button. The retry should use the same prompt parameters (no modifications).

5. If retry also fails, present a **"Download template" fallback** — a pre-filled plain text file with the campaign details (event name, date, CTA) that the owner can use to write copy manually.

6. Do not block the scheduling flow. The owner can schedule a post with no body copy (validation will warn but not hard-block for Facebook/Instagram). GBP requires body copy and cannot be scheduled without it.

---

## Appendix A: Template variable reference

| Variable | Source |
|----------|--------|
| `{{venueName}}` | `account_settings.display_name` or `link_in_bio_profiles.display_name` |
| `{{toneFormalDescriptor}}` | Derived from `brand_profile.tone_formal` via `describeSlider()` |
| `{{tonePlayfulDescriptor}}` | Derived from `brand_profile.tone_playful` via `describeSlider()` |
| `{{bannedTopics}}` | `brand_profile.banned_topics` joined by ", " |
| `{{mergedBannedPhrases}}` | `mergedBannedPhrases(brand.bannedPhrases)` joined by ", " |
| `{{keyPhrases}}` | `brand_profile.key_phrases` joined by ", " |
| `{{defaultHashtags}}` | `brand_profile.default_hashtags` joined by " " |
| `{{defaultEmojis}}` | `brand_profile.default_emojis` joined by " " |
| `{{facebookSignature}}` | `brand_profile.facebook_signature` |
| `{{instagramSignature}}` | `brand_profile.instagram_signature` |
| `{{gbpCtaStandard}}` | `posting_defaults.gbp_cta_standard` |
| `{{gbpCtaEvent}}` | `posting_defaults.gbp_cta_event` |
| `{{gbpCtaOffer}}` | `posting_defaults.gbp_cta_offer` |
| `{{eventName}}` | `campaigns.name` (event type) |
| `{{eventDateFormatted}}` | `eventStart` formatted via Luxon, e.g. "Saturday 14 June" |
| `{{eventTimeFormatted}}` | Formatted time, e.g. "7pm" |
| `{{eventDescription}}` | `eventBaseSchema.description` |
| `{{phase}}` | Derived from schedule offset: "save_the_date" (-7d), "reminder" (-3d), "day_of" (0d AM), "last_call" (0d PM) |
| `{{promotionName}}` | `campaigns.name` (promotion type) |
| `{{offerSummary}}` | `promotionCampaignSchema.offerSummary` |
| `{{promotionStartFormatted}}` | Formatted promotion start date |
| `{{promotionEndFormatted}}` | Formatted promotion end date |
| `{{couponCode}}` | `campaigns.metadata.couponCode` (if applicable) |
| `{{campaignName}}` | `campaigns.name` (weekly type) |
| `{{dayOfWeekName}}` | e.g. "Thursday", derived from `weeklyCampaignSchema.dayOfWeek` |
| `{{occurrenceIndex}}` | 1-based week number within the weekly campaign |
| `{{heroMediaDescription}}` | Filename or type of attached media asset(s) |
| `{{title}}` | `instantPostSchema.title` |
| `{{prompt}}` | Owner's free-text prompt |
| `{{scheduledForFormatted}}` | Formatted scheduled date/time |
| `{{ctaUrl}}` | CTA URL from campaign or instant post input |
| `{{ctaLabel}}` | CTA label (e.g. "Book now") |
| `{{linkInBioUrl}}` | Instagram link-in-bio URL |
| `{{toneAdjust}}` | `advancedOptionsSchema.toneAdjust` |
| `{{toneAdjustInstruction}}` | Human-readable instruction derived from `toneAdjust` value |
| `{{lengthPreference}}` | `advancedOptionsSchema.lengthPreference` |
| `{{includeHashtags}}` | Boolean from advanced options |
| `{{includeEmojis}}` | Boolean from advanced options |
| `{{modifier}}` | Owner's regeneration modifier text (free input) |

---

## Appendix B: Required code changes (summary)

| File | Change |
|------|--------|
| `src/lib/ai/client.ts` | Add timeout wrapper; switch to `chat.completions.create`; add model constant |
| `src/lib/ai/prompts.ts` | Replace single template with campaign-type-branched templates (14 combinations); add `campaignType` parameter; add phase-aware instructions |
| `src/lib/ai/content-rules.ts` | Fix `maxHashtags` for Instagram from 6 to 10; fix `maxChars` for GBP from 900 to 1500; add GBP CTA missing lint rule |
| `src/lib/create/service.ts` | Pass `campaignType` and `phase` to prompt builder; handle structured output parsing; implement timeout; add acceptance tracking fields to DB writes |
| `src/lib/settings/data.ts` | No change required — `bannedPhrases` field already present |
| `supabase/migrations/` | Add `banned_phrases text[]` to `brand_profile` table; add acceptance tracking fields to `content_variants` |
| `docs/technical-design.md` | Update data model to include `banned_phrases`, generation tracking fields |
