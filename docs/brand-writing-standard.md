# CheersAI Brand Writing Standard
## Definitive Rules for AI Content Generation

**Version:** 1.0
**Date:** 2026-03-06
**Purpose:** Prescriptive rules for rewriting the CheersAI content generation prompt. Every rule in this document must be directly implementable as a prompt instruction or few-shot example. Vague guidance has been deliberately excluded.

---

## 1. POINT OF VIEW RULES

### 1.1 Primary Rule

All body copy is written from the first-person plural perspective of the venue team. The default pronoun is **"we"**, with **"our"** and **"us"** as the possessive and object forms.

The writer is a member of the pub team speaking directly to their local community. They are not a marketing agency writing about a client. They are not a PR copywriter describing a venue. They work there.

**Implementation rule for the prompt:**
> Write as a member of the pub team speaking directly to customers. Use "we", "our", and "us" throughout. The pub team is the narrator; customers are the audience.

---

### 1.2 When the Pub Name IS Allowed

The pub name ({venueName}) may appear in copy only in these five specific scenarios. Outside of these, it must not appear in body copy.

**Scenario 1 — The very opening of a post, when used as a location anchor, not as the subject of a verb.**
Permitted: "The Anchor, Rye — Sunday roast bookings are open."
Not permitted: "The Anchor loves its Sunday roasts." (The pub is performing an action — use "we" instead.)

**Scenario 2 — When directing someone to find or visit the venue as a place, not as the speaker.**
Permitted: "Find us at The Anchor on the High Street."
Permitted: "Tag a mate who hasn't been to The Anchor yet."
This works because the pub name is functioning as a location reference, not as the narrator.

**Scenario 3 — In a Google Business Profile (GBP) post, once, near the top, for SEO discoverability.**
GBP posts are indexed by Google and benefit from the venue name appearing early. One use is acceptable; two or more is not.
Permitted: "The Anchor is hosting a live music night this Saturday."
Not permitted: "The Anchor is proud to announce that The Anchor will be hosting..."

**Scenario 4 — In a post headline or title field (not body copy).**
If the platform or template structure includes a discrete headline or title field, the pub name may appear there. It does not count against the body copy rule.

**Scenario 5 — When quoting or referencing the venue as a third-party place that someone would recommend to others.**
Permitted: "Know someone who'd love The Anchor? Share this with them."
This is a referral/shareability framing where the name functions as a label, not a narrating voice.

---

### 1.3 When the Pub Name is NOT Allowed

The pub name must not appear in body copy in any of the following situations:

- As the subject of a verb that implies feeling, preference, or personality. (NEVER: "The Anchor loves...", "The Anchor believes...", "The Anchor is passionate about...")
- As a repeated reference after it has already appeared once in the same post.
- As a substitute for "we" or "our" in any sentence where "we/our" is grammatically and contextually correct.
- In Instagram captions — the account handle identifies the venue; naming it in copy is redundant.
- In Facebook general/lifestyle posts where first-person voice is already established.
- In the second sentence or later of any post body, unless it falls under Scenario 2 or 5 above.

---

### 1.4 Sentence-Level Rule

**A body copy sentence must never begin with the pub name.**

This is a hard rule with no exceptions in body copy. It is the single most common failure mode. Even where the pub name is permitted (e.g. GBP), it should not open a sentence — it should be embedded mid-sentence or used as a label/title before the sentence begins.

Wrong: "The Anchor is serving a special three-course Christmas menu this December."
Right: "We're serving a special three-course Christmas menu this December at The Anchor."
Also right (GBP opener label, not a sentence starting with the name): "The Anchor — Christmas Menu. We're serving a special three-course menu throughout December."

**Implementation rule for the prompt:**
> Never begin a body copy sentence with the venue name. If you need to name the venue, place it mid-sentence or after a pronoun-led opening.

---

## 2. USE CASES THE PROMPT MUST SUPPORT

### 2.1 Facebook Event Post

| Attribute | Detail |
|---|---|
| Platform | Facebook |
| Typical intent | Drive ticket sales, table bookings, or attendance for a named event with a date and time |
| Copy length | 50–120 words |
| POV requirement | First-person plural throughout. Venue name permitted once if needed for location clarity, but "we're hosting" is preferred over naming the venue as host |
| CTA requirement | Mandatory. Must reference the event action: "Book your table", "Grab your tickets", "Reserve your spot" |
| Structural notes | Lead with the event hook, not the venue name. Include date and time. Close with CTA. Emojis allowed sparingly. |

---

### 2.2 Facebook Promotion Post

| Attribute | Detail |
|---|---|
| Platform | Facebook |
| Typical intent | Promote a time-limited offer, deal, or discount |
| Copy length | 40–80 words |
| POV requirement | First-person plural. The pub team is offering the deal, not the venue as a branded entity |
| CTA requirement | Mandatory. Align with the offer mechanic: "Book now to claim it", "Pop by this week", "Call us to reserve" |
| Structural notes | Lead with the offer benefit, not the venue name. State the offer value (price, % off, what's included) clearly. Include end date if known. |

---

### 2.3 Facebook General / Lifestyle Post

| Attribute | Detail |
|---|---|
| Platform | Facebook |
| Typical intent | Build community warmth, seasonal content, casual engagement — no hard sell |
| Copy length | 30–80 words |
| POV requirement | First-person plural, strictly. No venue name in body copy. The account itself carries the identity. |
| CTA requirement | Soft or optional. Conversational: "See you this weekend", "What's your order?", "Join us" |
| Structural notes | Can open with a question, observation, or seasonal hook. Should feel like something a real pub landlord would post on a Sunday morning. |

---

### 2.4 Instagram Caption (without link in bio)

| Attribute | Detail |
|---|---|
| Platform | Instagram |
| Typical intent | Visual-led post where the image carries the main story; caption adds warmth and context |
| Copy length | Up to 80 words (body only, before hashtags) |
| POV requirement | First-person plural throughout. Venue name must NOT appear — the handle covers venue identity |
| CTA requirement | Soft close — no URL, no "link in bio". End warmly: "See you there", "We'd love to see you", "Come and join us" |
| Structural notes | Line breaks for readability. Hashtags on separate lines after body copy. Do not mention URL or link in bio. |

---

### 2.5 Instagram Caption (with link in bio)

| Attribute | Detail |
|---|---|
| Platform | Instagram |
| Typical intent | Visual-led post with a bookable action — event, reservation, or promotion with a destination URL |
| Copy length | Up to 80 words (body only, before hashtags) |
| POV requirement | First-person plural throughout. Venue name must NOT appear. |
| CTA requirement | Mandatory link-in-bio close. Must be a natural sentence — not a label. E.g. "Details and booking via the link in our bio." NOT "LINK IN BIO" as a standalone shout. |
| Structural notes | Body copy first, then one natural link-in-bio sentence, then hashtags on separate lines. |

---

### 2.6 Google Business Profile (GBP) Update

| Attribute | Detail |
|---|---|
| Platform | Google Business Profile |
| Typical intent | SEO-visible update about an event, offer, or general news; also used for building search presence |
| Copy length | Under 250 words; aim for 80–150 words for optimal display |
| POV requirement | Modified first-person: the venue name may appear once near the top for SEO, but remaining copy uses "we/our/us". Never use venue name as the subject of a feeling or personality verb. |
| CTA requirement | Mandatory. Must use one of the allowed GBP CTA button types: BOOK, CALL, LEARN_MORE, ORDER, SHOP, SIGN_UP. Align copy CTA language with the button. |
| Structural notes | No hashtags. No emojis beyond 2 maximum. Copy should be descriptive and factual — GBP readers are often deciding whether to visit, not already fans. Start with the "what" (event/offer), not a personality statement. |

---

### 2.7 Quick / Instant Post (no structured template)

| Attribute | Detail |
|---|---|
| Platform | Facebook, Instagram, or GBP (platform-specific rules apply) |
| Typical intent | Ad-hoc post triggered by the owner typing a short free-text prompt — e.g. "we've got a table free tonight" or "photo of today's special" |
| Copy length | 20–60 words — concise, reactive |
| POV requirement | First-person plural, no exceptions. These posts feel most like genuine team communication; any third-person slip is most jarring here. |
| CTA requirement | Optional, soft. Match the spontaneous register: "Pop in and grab one", "Give us a ring" |
| Structural notes | Match the energy of the prompt. If the owner sounds casual, the copy should be casual. If they've given a price, include it. Do not over-produce — a quick post should feel quick. |

---

## 3. APPROVED EXAMPLES

All examples below demonstrate correct first-person voice. No example begins the same way as the one immediately before or after it. These are formatted for direct use as few-shot examples in the prompt.

---

### 3.1 Facebook Event Post

**Example A — Quiz Night**
> Our weekly pub quiz is back this Thursday from 7pm. Teams of up to six, a pound a head, and a proper prize for the winners. Rounds cover everything from sport to pop culture, so there's a strategy for every team. Book your table or just turn up — we'll find you a spot.

**Example B — Live Music**
> Saturday night we've got a live set from The Copper Tones starting at 8pm. Expect a mix of classic rock and a few surprises. Get here early if you want a seat near the front. Doors open at 6pm — see you there.

---

### 3.2 Facebook Promotion Post

**Example A — Burger and Pint Deal**
> Mondays just got easier. Our burger and a pint deal is back — choose any burger from the menu, add a pint of your choice, and pay just £14. Available every Monday from 5pm while the kitchen's open. No need to book; just come as you are.

**Example B — Sunday Roast Early Bird**
> Fancy a proper Sunday roast without the wait? Book before Thursday and get 10% off your table. We're doing all the classics — beef, chicken, and a veggie wellington that people keep coming back for. Slots fill up fast, so get in early.

---

### 3.3 Facebook General / Lifestyle Post

**Example A — Seasonal / Autumnal**
> There's a proper chill in the air this week, which means one thing: soup is back on the menu. We've got a hearty leek and potato on today, served with thick crusty bread. Come in from the cold and warm up with us.

**Example B — Community warmth**
> Quiet Tuesday? We reckon that's a good reason to pop by. The fire's on, there's a stool at the bar with your name on it, and we've just tapped a fresh cask of our house bitter. Come and say hello.

---

### 3.4 Instagram Caption (without link in bio)

**Example A — Food photo**
> Slow-cooked for six hours. Worth every minute. Our lamb shank is back on the menu this week, served with creamy mash and a rich rosemary jus. Come in and try it — we'd love to see you.

**Example B — Atmospheric / lifestyle**
> Sunday done right. Good food, good company, and nowhere else to be. Our kitchen is open until 5pm today if you're still deciding. Pull up a chair.

---

### 3.5 Instagram Caption (with link in bio)

**Example A — Event booking**
> Valentine's evening is almost full, but we've got a handful of tables left. A set menu, candlelight, and a playlist that actually sets the mood. Book through the link in our bio before they're gone.

**Example B — New menu launch**
> Fresh menu. Fresh season. We've reworked our spring dishes and we're pretty pleased with how they've turned out — lighter, sharper, and full of things you'll want to order twice. Full menu and booking via the link in our bio.

---

### 3.6 Google Business Profile Update

**Example A — Event**
> The Crown is hosting a charity quiz night on Friday 14th March, starting at 7:30pm. Entry is £2 per person, with all proceeds going to the local food bank. We'll have teams of up to six, three rounds of questions, and a raffle on the night. Booking isn't required, but we recommend arriving by 7pm to get a table. Come and join us for a great evening.

**Example B — Seasonal offer**
> We're running a spring Sunday roast special throughout March — two courses for £22 per person, served every Sunday from noon until 4pm. Choose from slow-roast beef, free-range chicken, or our mushroom and lentil wellington. Tables book up quickly on Sundays, so we'd recommend reserving in advance. Call us or book online to secure your spot.

---

### 3.7 Quick / Instant Post

**Example A — Tonight availability**
> Last-minute plans? We've got space tonight from 6pm — no booking needed. Come in, grab a pint, stay for dinner. Kitchen's open until 9pm.

**Example B — Daily special**
> Today's lunch special: pan-fried sea bream with new potatoes and a caper butter sauce. £13.50 and well worth it. We're serving from noon — see you soon.

---

## 4. DISALLOWED EXAMPLES

---

**Failure mode: Pub-name-led sentence in body copy**

> WRONG: "The Anchor loves serving the local community and takes pride in every pint poured."
> Reason: The pub name is acting as the narrator, performing emotions and actions. Pubs do not "love" — people do. This is classic AI third-person slippage.
> RIGHT: "We love serving the local community and take pride in every pint poured."

---

**Failure mode: Third-person reference in first-person context**

> WRONG: "The Crown has been a favourite in the village for over 30 years and The Crown continues to welcome everyone through its doors."
> Reason: Double use of the pub name; reads like a press release written by someone who has never been inside. Completely disconnected from the warmth and directness the brand requires.
> RIGHT: "We've been a favourite in the village for over 30 years and we still love welcoming everyone through our doors."

---

**Failure mode: Corporate / marketing language**

> WRONG: "We are committed to delivering an exceptional dining experience that exceeds customer expectations at every touchpoint."
> Reason: "Committed to delivering", "exceptional experience", "exceeds expectations", "touchpoints" — this is agency boilerplate. No pub landlord has ever said this. It signals that the copy was written by a system, not a person.
> RIGHT: "Good food and a warm welcome — that's what we're here for. Come and see us."

---

**Failure mode: Hype phrasing**

> WRONG: "Get ready for the most epic night of the year — this is a once-in-a-lifetime event you absolutely cannot miss."
> Reason: Contains three banned-class phrases ("epic", "once-in-a-lifetime", "cannot miss"). Pubs do not need to oversell. Hype language destroys credibility and reads as desperate. Real warmth is understated.
> RIGHT: "This one's going to be a great night. Live music from 8pm, good company, and a cold pint waiting for you."

---

**Failure mode: Repetitive "we" overuse**

> WRONG: "We are so excited to share that we have just launched our new menu, which we think you're going to love. We worked really hard on it and we can't wait for you to try it. We hope you'll pop by and we'd love to hear what you think."
> Reason: Seven "we" references in three sentences. The pronoun becomes meaningless through repetition and the copy reads as self-absorbed. Vary with possessives, imperatives, and implied subject.
> RIGHT: "The new menu is here and we're pretty proud of it. Fresh dishes, seasonal ingredients, and a few things you won't find anywhere else round here. Pop by and let us know what you think."

---

**Failure mode: GBP-specific failure — personality-led opener without venue context**

> WRONG: "We are a vibrant and welcoming pub that prides itself on being the heart of the community, offering something for everyone."
> Reason: For GBP, this opener wastes the SEO opportunity (venue name should appear early), uses a banned phrase ("something for everyone"), and is vague to the point of being meaningless. GBP readers want facts, not personality statements.
> RIGHT: "The Bell is hosting a folk music evening on Saturday 22nd March from 7pm. We're welcoming all original local acts for a relaxed, acoustic night. Free entry, no need to book — just come along."

---

## 5. RULE HIERARCHY

When rules appear to conflict, apply them in this priority order:

**Priority 1 — Output integrity (always wins)**
Never produce copy that contains blocked tokens, placeholder text, hallucinated facts, or technical artifacts. This overrides every other rule. A clean, slightly off-voice post is better than a broken one.

**Priority 2 — First-person POV rule**
The "we/us/our" rule overrides SEO, structure, and preferred phrases. If following a structural template would require the pub name to act as narrator, break the template instead.

**Priority 3 — Never start a body sentence with the pub name**
This overrides the GBP SEO exception. Even on GBP, embed the venue name mid-sentence or use it as a pre-sentence label. The sentence itself must not open with the name.

**Priority 4 — Platform-specific hard rules**
Character limits, link-in-bio presence/absence, hashtag rules, and CTA requirements are hard contracts. They override tone preferences and copy length desires. A post that violates a platform contract will fail downstream processing.

**Priority 5 — Include stated prices and offer details**
If the owner has provided a price, discount amount, or specific offer mechanic, it must appear in the copy. This overrides length preferences — go slightly long before cutting a price.

**Priority 6 — Tone and style preferences**
Tone slider settings, banned phrases, preferred phrases, and length preferences operate within the space left by rules 1–5. They are preferences, not contracts. When in doubt, default to warm, direct, and concise.

**Priority 7 — Preferred phrases**
Weave in preferred phrases ("pop by", "join us", "we'd love to see you") where they are natural. Never force them. If including a preferred phrase makes a sentence feel awkward or repetitive, omit it.

---

## 6. EXCEPTIONS

### 6.1 Headings and Titles

**Pub name in headings: Permitted.**
If a post template includes a discrete headline or title field (separate from body copy), the pub name may appear there. Treat this as label/signage, not as narrator.

Example: Title field — "The Anchor — Spring Menu Launch"
Body copy — "Our new spring menu is here, and we've gone seasonal from top to bottom."

**Starting a heading with the pub name: Permitted.**
The sentence-level rule applies to body copy only. Headlines and titles can be structured as labels.

### 6.2 GBP Posts — Modified Rule

GBP posts operate under a modified POV rule:

- The venue name may appear once, near the top of the copy, for SEO value.
- It must be used as a location reference or label, not as a narrator performing actions or emotions.
- From the second sentence onward, all copy returns to "we/our/us".
- The venue name must never appear as the subject of a sentiment or personality verb on GBP (e.g. "The Crown prides itself on..." is wrong even in a GBP post).

### 6.3 SEO / Directory Copy

If copy is being written for a directory listing, website About page, or other context where the pub is being described to someone unfamiliar with it (not to existing followers), limited third-person is acceptable:

- Venue name as subject is permitted for factual statements: "The Crown is a 16th-century freehouse on the edge of the village green."
- Personality verbs in third-person are still not acceptable: "The Crown believes in quality."
- This exception does not apply to social media posts. Social posts are always first-person.

### 6.4 Referral and Share Framing

When the intent of a post is to encourage sharing or recommending the pub to others, the venue name may be used as a third-party label — because in this context, the audience is being asked to speak about the pub to someone else.

Permitted: "Know someone who'd love The Crown? Tag them below."
Permitted: "Share this with whoever needs a Sunday roast intervention."
Not permitted: "The Crown would love you to share this post."

### 6.5 Social Proof / Quote Integration

If a verified customer review or quote is being incorporated into a post, the review may refer to the venue in third-person (because it is a quotation). The pub team's framing around the quote must still use first-person.

Permitted: "'Best Sunday lunch in the county.' — That's one of our regulars, and we'll happily take it. Book your table this Sunday."

---

## 7. SUCCESS CRITERIA

### 7.1 Voice and POV — Pass Criteria

A post passes voice/POV review if ALL of the following are true:

- [ ] Every sentence in the body copy that has a subject uses "we", "our", "us", or an implied first-person (e.g. imperative "Come and join us", or subjectless "Great food. Cold pints. That's what we're here for.")
- [ ] The pub name does not appear as the subject of a verb in body copy.
- [ ] No body copy sentence begins with the pub name.
- [ ] The pub name appears no more than once in body copy (GBP exception: still only once).
- [ ] The pub name is absent from Instagram captions entirely.
- [ ] "We" does not appear more than 4 times in any single post (if over 4, at least one must be replaced with a possessive, an imperative, or a structural variation).

### 7.2 Tone — Pass Criteria

A post passes tone review if ALL of the following are true:

- [ ] No phrase from the BANNED_PHRASES list appears in the output.
- [ ] No hype-class phrase appears: "the best", "epic", "legendary", "world-class", "must-see", "can't miss", "once-in-a-lifetime".
- [ ] The copy contains no sentence that could only have been written by someone who has never visited a British pub (test: would a real landlord say this to a regular? If no, it fails).
- [ ] The copy does not describe the pub using abstract brand values ("passionate", "committed to excellence", "dedicated to quality") without grounding them in something specific.
- [ ] British English spelling is used throughout (recognise, flavour, colour, centre, practise, licence as noun, etc.).
- [ ] Time format follows 6pm / 7:30pm style (no spaces, lowercase am/pm, no 24-hour clock).

### 7.3 Platform Compliance — Pass Criteria

A post passes platform compliance review if ALL of the following are true:

- [ ] Instagram captions stay within 80 words (body, before hashtags).
- [ ] GBP posts stay within 900 characters.
- [ ] GBP posts contain no hashtags.
- [ ] GBP posts contain no link-in-bio language.
- [ ] Instagram captions contain no URLs.
- [ ] Instagram captions include a link-in-bio line if and only if a link was provided.
- [ ] Facebook posts include a CTA.
- [ ] GBP posts include a CTA aligned with an approved button type.

### 7.4 Failure Indicators — Automatic Rejection

A post must be regenerated (not edited) if ANY of the following are present:

- The pub name appears as the subject of a verb in body copy.
- A body copy sentence begins with the pub name.
- Any banned phrase or hype phrase is present and was not caught by post-processing.
- The copy contains a factual claim about capacity, end times, or kitchen hours that was not provided by the owner input (hallucinated specifics).
- The copy reads as if written about the venue from the outside ("The Anchor offers a wide range of..." / "Guests can enjoy...").
- The copy uses "Guests", "patrons", or "customers" as the audience noun. The correct register is "you", "everyone", or implied second-person. These terms are clinical and distancing.
- The word "atmosphere" appears (it is almost always followed by a banned modifier or used as a vague filler).
- The copy ends with a trailing ellipsis.
- Any placeholder text is visible (e.g. [venue name], {price}, EDIT THIS).
