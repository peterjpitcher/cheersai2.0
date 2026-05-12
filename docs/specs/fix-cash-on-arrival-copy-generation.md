# Spec: Fix cash-on-arrival copy generation for Meta campaigns

## Problem

When creating a Meta campaign for an imported event that has `paymentMode: 'cash_only'`, the AI (gpt-4o) does not reliably include "No payment now" or "pay on arrival" language. Validation catches this and throws an unrecoverable error that repeats for every ad:

```
AI returned weak booking copy: Cash-on-arrival event ads need no-payment-now or pay-on-arrival reassurance. [x6] Avoid generic phrase "don't miss".
```

The user sees this as a toast error with no option to retry — they must re-submit the entire form.

## Root Cause

The payment reassurance instruction is unreliable because:

1. **Prompt dilution** — the instruction is a single line (line 80 of `generate.ts`) buried in a 40-line system prompt with 15+ other rules. The payment mode appears as one context field among 14 in the user prompt.

2. **No retry mechanism** — `generateCampaign()` calls OpenAI once, validates, and throws on failure. The error propagates through `generateCampaignAction` back to the form as a generic error toast.

3. **No post-processing** — when `cashOnArrival` is true, there's no fallback to inject or repair the missing language.

## Affected Files

| File | Role |
|------|------|
| `src/lib/campaigns/generate.ts:60-99` | System prompt (SYSTEM_PROMPT constant) |
| `src/lib/campaigns/generate.ts:244-309` | User prompt construction |
| `src/lib/campaigns/generate.ts:311-369` | AI call, validation, error throw |
| `src/lib/campaigns/generate.ts:456-462` | `hasCashOnArrivalContext()` detection |
| `src/features/campaigns/CampaignBriefForm.tsx:293-312` | sourceSnapshot construction from import |

## Proposed Fix

Three changes, ordered by impact:

### 1. Elevate payment mode in the prompt (high impact, low risk)

**In the system prompt** (`SYSTEM_PROMPT`, line 80):
- Move the cash-on-arrival rule to a dedicated `MANDATORY REQUIREMENTS` section at the TOP of the copy rules, before the general rules.
- Make the instruction more emphatic with explicit consequences.

Before:
```
- If payment mode is cash_only or the brief says pay on arrival, include "No payment now" or "pay on arrival" in the primary text.
```

After (new section before COPY RULES):
```
MANDATORY — PAYMENT REASSURANCE (when payment_mode is cash_only):
Every ad's primary_text MUST contain one of these phrases: "No payment now", "pay on arrival", "pay on the night", "pay at the door", "cash on arrival". This is non-negotiable — ads without this phrase will be rejected.
```

**In the user prompt** (lines 259-262):
- When `hasCashOnArrivalContext(input.sourceSnapshot)` is true, add a prominent `⚠️ PAYMENT MODE` block directly after the business brief, not buried in the generic event context.

```typescript
${cashOnArrival ? `
⚠️ PAYMENT MODE: Cash on arrival — every ad primary_text MUST include "No payment now" or "pay on arrival".
` : ''}
```

### 2. Add a correction retry for validation failures (high impact, medium risk)

When `validateCampaignCopy` returns `missing_payment_reassurance` issues, retry ONCE with a targeted correction prompt instead of throwing immediately.

In `generateCampaign()`, after the initial validation at line 358:

```typescript
const copyIssues = validateCampaignCopy(payload, validationOptions);
const hardIssues = copyIssues.filter((issue) => issue.code !== 'over_limit');

if (hardIssues.length > 0) {
  // Attempt ONE correction pass for fixable issues
  const corrected = await attemptCopyCorrection(client, payload, hardIssues, validationOptions);
  if (corrected) {
    return corrected;
  }
  throw new Error(`AI returned weak booking copy: ${hardIssues.map((i) => i.message).join(' ')}`);
}
```

The `attemptCopyCorrection` function sends a focused follow-up message to OpenAI with:
- The current payload as context
- The specific validation failures
- A targeted instruction to fix only the failing ads

```typescript
async function attemptCopyCorrection(
  client: OpenAI,
  payload: AiCampaignPayload,
  issues: AdCopyValidationIssue[],
  validationOptions: Parameters<typeof validateCampaignCopy>[1],
): Promise<AiCampaignPayload | null> {
  const issuesByAd = issues.map((i) =>
    `Ad set "${i.adSetName}", ad "${i.adName}": ${i.message}`
  ).join('\n');

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are fixing Meta ad copy that failed validation. Return the COMPLETE campaign JSON with corrections applied. Change ONLY the failing ads — preserve all other fields exactly.',
      },
      {
        role: 'user',
        content: `The following campaign payload failed validation:\n\n${JSON.stringify(payload, null, 2)}\n\nIssues:\n${issuesByAd}\n\nFix each issue and return the corrected JSON.`,
      },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return null;

  try {
    const corrected = JSON.parse(content) as AiCampaignPayload;
    const recheck = validateCampaignCopy(corrected, validationOptions);
    const hardRecheck = recheck.filter((i) => i.code !== 'over_limit');
    return hardRecheck.length === 0 ? corrected : null;
  } catch {
    return null;
  }
}
```

Key design decisions:
- Lower temperature (0.3) for the correction pass — we want compliance, not creativity
- Re-validate after correction — if it still fails, return null and let the original error throw
- Only ONE retry — avoids infinite loops and keeps latency reasonable
- Correction prompt is short and focused — no prompt dilution

### 3. De-duplicate validation error messages (low impact, low risk)

The thrown error concatenates every issue's message, producing a wall of repeated text. De-duplicate before throwing:

```typescript
const uniqueMessages = [...new Set(hardIssues.map((i) => i.message))];
throw new Error(`AI returned weak booking copy: ${uniqueMessages.join(' ')}`);
```

## What NOT to change

- **Form fields** — no new form inputs needed. Payment mode already flows correctly from the management app import.
- **sourceSnapshot construction** — already includes `paymentMode` (line 304 of CampaignBriefForm.tsx).
- **`hasCashOnArrivalContext()`** — detection logic is correct.
- **Validation rules** — the rules are correct; the AI just needs to follow them.

## Testing

### Unit tests (new in `src/lib/campaigns/generate.test.ts`)

1. **`attemptCopyCorrection` returns corrected payload when fixable** — mock OpenAI to return copy with payment reassurance, verify re-validation passes
2. **`attemptCopyCorrection` returns null when correction still fails** — mock OpenAI to return still-invalid copy, verify null returned
3. **De-duplicated error messages** — verify repeated validation messages are collapsed
4. **Payment reassurance in prompt** — verify that when sourceSnapshot has `paymentMode: 'cash_only'`, the user prompt includes the payment mode warning block

### Manual testing

1. Import a cash-on-arrival event from management app
2. Generate a Meta campaign
3. Verify the AI copy includes payment reassurance language
4. Verify the campaign generates successfully without the error

## Complexity

**Score: 2 (S)** — 1-2 files changed, no schema changes, no new dependencies. The retry function is new but self-contained within generate.ts.

## Risks

- **Additional OpenAI cost** — the retry adds a second API call when validation fails. Mitigated by: only retrying once, and only when there are hard issues (most campaigns won't trigger this).
- **Increased latency** — ~2-4s extra on retry. Acceptable since the alternative is a full re-submission by the user.
- **Prompt changes could affect non-cash events** — mitigated by making the mandatory section conditional in the system prompt (only included when cash-on-arrival is detected), or by keeping it general enough that it's a no-op when payment mode isn't cash_only.
