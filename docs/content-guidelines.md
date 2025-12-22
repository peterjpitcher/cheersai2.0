# AI Prompt & Content Guidelines

## 1. Prompt Architecture
Each content variant is generated using a structured prompt composed of:
1. **System Message** – Defines assistant persona (e.g. "You are CheersAI, crafting social posts for a lively UK pub with warm, witty tone").
2. **Brand Context** – Injects tone sliders, key phrases, banned topics, default hashtags/emojis, CTA defaults.
3. **Campaign Context** – Event/promotion details, dates, offer specifics, hero media description.
4. **Platform Instructions** – Character limits, structure expectations, location tagging cues, CTA requirements.
5. **Output Schema** – Request JSON with fields `headline`, `body`, `hashtags`, `cta`, optionally `storyCaption`.

## 2. Tone Controls
- Convert tone slider values into descriptors, e.g. `tone_formal=0.2` => "very casual", `tone_playful=0.8` => "highly playful".
- Ensure British English spelling, pub vernacular encouraged when appropriate.
- Avoid "AI" references; keep language human and hospitality-focused.

## 3. Campaign Type Templates
### 3.1 Events
- Emphasise urgency and atmosphere; include event name, date/time, location.
- Provide progressive messaging for timeline (save-the-date, reminder, last call).
- Suggest imagery cues (e.g. "Pair with photo of live band").

**Prompt Snippet**:
```
You are preparing multiple posts for an upcoming event. Use the schedule_context to adapt tone:
- save_the_date: focus on anticipation and booking early
- reminder: highlight key attraction and limited availability
- day_of: energising call to action, mention door opening time
- last_call: urgent language, highlight final chance
```

### 3.2 Promotions
- Showcase offer value, include CTA such as "Book now" or "Call us".
- Mention start/end dates; emphasise exclusivity or limited availability.

### 3.3 Weekly Recurring
- Maintain consistent hook each week with slight variation (e.g. Quiz Night themes).
- Encourage regular attendance; reference recurring day/time and any running deals.

### 3.4 Instant Posts
- Respond to ad-hoc prompts; keep copy concise, timely, and tied to provided media.
- Allow owner to dictate mood (e.g. "celebratory", "thank-you post").

## 4. Platform-Specific Guidance
### 4.1 Facebook
- Post body target 40–80 words; include emojis sparingly.
- Add CTA in closing sentence ("Book your table", "Call us on ...").
- Provide recommended hashtags (3–5) but optional.
- For stories, craft snappy 1–2 line caption encouraging swipe.

### 4.2 Instagram
- Caption length up to 150 words; include curated hashtag set (8–12) using defaults + campaign specifics.
- Encourage line breaks for readability.
- For stories, provide overlay text ideas and sticker suggestions (e.g. poll, countdown).

### 4.3 Google Business Profile
- Keep text under 1,000 characters; highlight offer or event specifics early.
- CTA must align with allowed buttons: `BOOK`, `CALL`, `LEARN_MORE`, etc.
- Include redemption code or link for offers where applicable.

## 5. Validation Rules
- No banned topics; check against `brand_profile.banned_topics`.
- Avoid alcohol promotion restrictions language (stay within platform policies).
- Ensure CTA present for GBP posts; fallback to default if missing.
- Flag over-length content; provide suggestions for trimming.

## 6. Regeneration & Adjustments
- Expose controls in UI for "More formal", "More playful", "Shorter", "Add emoji" tweaks.
- Regeneration preserves previously approved copy for other platforms to prevent accidental overwrite.

## 7. Media Suggestions
- Provide short alt-text suggestions for accessibility.
- Recommend story layout ideas (e.g. "Use full-bleed bottle shot with overlay text").
- When multiple images, suggest ordering ("Start with hero image, follow with team photo").

## 8. Testing Prompts
- Maintain a suite of sample prompts per campaign type to regression-test AI outputs.
- Document expected characteristics (tone, length, CTA inclusion) for QA.

## 9. Future Enhancements
- Incorporate performance feedback loop once analytics reinstated (out of scope now).
- Enable reusable prompt presets saved in Library for recurring styles.
