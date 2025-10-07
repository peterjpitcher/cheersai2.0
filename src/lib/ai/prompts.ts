import type { InstantPostInput } from "@/lib/create/schema";
import type { BrandProfile } from "@/lib/settings/data";

interface PromptContext {
  brand: BrandProfile;
  input: InstantPostInput;
  platform: "facebook" | "instagram" | "gbp";
}

export function buildInstantPostPrompt({ brand, input, platform }: PromptContext) {
  const sharedTone = `You are CheersAI, crafting social content for a single-owner pub. Use British English, write as the venue team using “we” or “us”, never name the venue explicitly, avoid banned topics, and keep copy human.`;
  const toneDescriptors = `Tone sliders => Formal:${brand.toneFormal.toFixed(2)}, Playful:${brand.tonePlayful.toFixed(2)}.`;
  const brandDetails = `Key phrases: ${brand.keyPhrases.join(", ") || "(none)"}.
Banned topics: ${brand.bannedTopics.join(", ") || "(none)"}.
Default hashtags: ${brand.defaultHashtags.join(" ") || "(none)"}.
Default emojis: ${brand.defaultEmojis.join(" ") || "(none)"}.`;

  const mediaInfo = input.media?.length
    ? `Media context: ${input.media
        .map((asset) => `${asset.mediaType} asset ${asset.assetId}`)
        .join("; ")}`
    : "Media context: none provided";

  const platformGuidance = buildPlatformGuidance(platform, brand, input);
  const adjustments = describeAdjustments(platform, input);

  return `SYSTEM: ${sharedTone} ${toneDescriptors}
BRAND: ${brandDetails}
REQUEST: ${input.prompt}
MEDIA: ${mediaInfo}
PLATFORM: ${platformGuidance}
ADJUSTMENTS: ${adjustments}`;
}

function buildPlatformGuidance(
  platform: "facebook" | "instagram" | "gbp",
  brand: BrandProfile,
  input: InstantPostInput,
) {
  switch (platform) {
    case "facebook":
      return `Write 40-80 words, conversational.${
        input.includeHashtags
          ? " Include a CTA and 2-3 relevant hashtags if it feels natural."
          : " Include a CTA and keep copy hashtag-free."
      }
Optional signature: ${brand.facebookSignature ?? "(none)"}`;
    case "instagram":
      return `Write up to 150 words with line breaks. Do not include URLs. Always finish with the exact sentence “See the link in our bio for details.”${
        input.includeHashtags
          ? ` Include up to 10 hashtags using defaults: ${brand.defaultHashtags.join(" ") || "(none)"}.`
          : " Do not add hashtags — rely on copy only."
      }
Optional signature: ${brand.instagramSignature ?? "(none)"}`;
    case "gbp":
      return `Write concise GBP update under 250 words. Include CTA ${brand.gbpCta ?? "LEARN_MORE"}. Avoid hashtags.`;
    default:
      return "";
  }
}

function describeAdjustments(
  platform: "facebook" | "instagram" | "gbp",
  input: InstantPostInput,
) {
  const lines: string[] = [];

  switch (input.toneAdjust) {
    case "more_formal":
      lines.push("Lean more formal than usual while staying warm and welcoming.");
      break;
    case "more_casual":
      lines.push("Use extra casual phrasing and relaxed contractions.");
      break;
    case "more_serious":
      lines.push("Dial down jokes or slang; focus on trust and credibility.");
      break;
    case "more_playful":
      lines.push("Amp up playful wording and energy without sounding forced.");
      break;
  }

  switch (input.lengthPreference) {
    case "short":
      lines.push("Keep it to one or two punchy sentences.");
      break;
    case "detailed":
      lines.push("Offer a richer description with specific details that help guests imagine the experience.");
      break;
  }

  if (!input.includeEmojis) {
    lines.push("Avoid emojis entirely.");
  } else {
    lines.push("Use emojis sparingly and only where they enhance the message.");
  }

  if (!input.includeHashtags || platform === "gbp") {
    lines.push("Do not include hashtags in the copy.");
  }

  switch (input.ctaStyle) {
    case "direct":
      if (platform !== "instagram") {
        lines.push("Close with a clear, direct call to action (e.g. Book now, Reserve your table).");
      }
      break;
    case "urgent":
      if (platform !== "instagram") {
        lines.push("Close with an urgent CTA highlighting limited availability or time.");
      }
      break;
  }

  lines.push("Format any times like 6pm or 7:30pm (no spaces, lowercase am/pm).");

  if (platform === "facebook") {
    if (input.ctaUrl) {
      lines.push(`Explicitly include this CTA link in the copy: ${input.ctaUrl}`);
    } else {
      lines.push("Include a clear CTA suited to the venue (link optional).");
    }
  } else if (platform === "instagram") {
    lines.push("Do not include any URLs—reference our link in bio instead.");
  }

  if (!lines.length) {
    lines.push("Follow the brand defaults for tone, pacing, and CTA style.");
  }

  return lines.join("\n");
}
