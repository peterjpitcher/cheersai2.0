export type ProofPointPlatform = "facebook" | "instagram" | "gbp";
export type ProofPointUseCase = "event" | "promotion" | "weekly" | "instant";
export type ProofPointMode = "off" | "auto" | "selected";
export type ProofPointIntentTag = "convenience" | "location" | "food" | "community" | "family" | "travel";

export interface ProofPoint {
  id: string;
  variants: string[];
  allowedChannels: ProofPointPlatform[];
  allowedUseCases: ProofPointUseCase[];
  intentTags: ProofPointIntentTag[];
  bannedCombinations?: string[];
}

export interface ProofPointUsage {
  id: string;
  text: string;
  source: "existing" | "selected" | "auto";
}

export const DEFAULT_PROOF_POINT_MODE: ProofPointMode = "off";
export const DEFAULT_SELECTED_PROOF_POINTS: Partial<Record<ProofPointUseCase, string[]>> = {};

export const PROOF_POINTS: ProofPoint[] = [
  {
    id: "free-parking",
    variants: [
      "Free on-site parking for guests.",
      "On-site parking is free for guests.",
      "Layover guests can register for free parking.",
    ],
    allowedChannels: ["facebook", "instagram", "gbp"],
    allowedUseCases: ["promotion", "weekly", "event"],
    intentTags: ["convenience", "travel"],
  },
  {
    id: "dog-friendly",
    variants: [
      "Dog friendly - well-behaved dogs welcome.",
      "Well-behaved dogs are welcome in the garden terrace.",
      "Water bowls and treats available for dogs.",
    ],
    allowedChannels: ["facebook", "instagram", "gbp"],
    allowedUseCases: ["weekly", "promotion", "event"],
    intentTags: ["family", "community"],
  },
  {
    id: "family-friendly",
    variants: [
      "Family friendly with a big enclosed garden.",
      "Kids' menu, high chairs, and baby-changing available.",
      "A safe garden space for children to play.",
    ],
    allowedChannels: ["facebook", "instagram", "gbp"],
    allowedUseCases: ["weekly", "promotion", "event"],
    intentTags: ["family", "community"],
  },
  {
    id: "near-heathrow-t5",
    variants: [
      "Closest traditional pub to Heathrow T5.",
      "Just minutes from Heathrow T5.",
      "Handy for Heathrow layovers.",
    ],
    allowedChannels: ["facebook", "instagram", "gbp"],
    allowedUseCases: ["promotion", "weekly", "instant"],
    intentTags: ["location", "travel"],
  },
  {
    id: "stone-baked-pizzas",
    variants: [
      "Stone-baked pizzas and classic pub dishes.",
      "Veggie, vegan, and gluten-free options available.",
      "Stone-baked pizzas made with quality ingredients.",
    ],
    allowedChannels: ["facebook", "instagram", "gbp"],
    allowedUseCases: ["weekly", "promotion", "event"],
    intentTags: ["food"],
  },
  {
    id: "sunday-roasts",
    variants: [
      "Sunday roasts served every Sunday.",
      "Classic Sunday roasts with meat or veggie options.",
      "Book ahead for Sunday roasts.",
    ],
    allowedChannels: ["facebook", "instagram", "gbp"],
    allowedUseCases: ["weekly", "promotion", "event"],
    intentTags: ["food"],
  },
  {
    id: "beer-garden-flightpath",
    variants: [
      "Beer garden under the Heathrow flight path.",
      "Plane-spotting from the garden.",
      "Heated garden seating with full bar service.",
      "A dog- and family-friendly garden space.",
    ],
    allowedChannels: ["facebook", "instagram", "gbp"],
    allowedUseCases: ["weekly", "promotion", "event"],
    intentTags: ["location", "travel", "community"],
  },
  {
    id: "step-free-access",
    variants: [
      "Step-free access to most areas.",
      "Ramp access available for buggies and pushchairs.",
    ],
    allowedChannels: ["facebook", "instagram", "gbp"],
    allowedUseCases: ["weekly", "instant"],
    intentTags: ["convenience"],
  },
  {
    id: "free-wifi",
    variants: [
      "Free Wi-Fi and plug sockets available.",
      "Luggage-friendly seating for travellers.",
      "Quiet corners for a quick work break.",
    ],
    allowedChannels: ["facebook", "instagram", "gbp"],
    allowedUseCases: ["promotion", "weekly"],
    intentTags: ["convenience", "travel"],
  },
  {
    id: "outside-ulez",
    variants: [
      "Outside the ULEZ zone.",
      "Easy for drivers outside ULEZ.",
    ],
    allowedChannels: ["facebook", "gbp"],
    allowedUseCases: ["weekly", "promotion"],
    intentTags: ["convenience", "travel"],
  },
];

const VALID_MODES = new Set<ProofPointMode>(["off", "auto", "selected"]);
const VALID_INTENT_TAGS = new Set<ProofPointIntentTag>([
  "convenience",
  "location",
  "food",
  "community",
  "family",
  "travel",
]);

export function resolveProofPointContext(context?: Record<string, unknown> | null) {
  const mode = resolveMode(context);
  const useCase = resolveUseCase(context);
  const selectedIds = resolveSelectedIds(context, useCase);
  const intentTags = resolveIntentTags(context);

  let effectiveMode = mode;
  if (effectiveMode === "selected" && selectedIds.length === 0) {
    effectiveMode = "off";
  }
  if (effectiveMode === "auto" && intentTags.length === 0) {
    effectiveMode = "off";
  }

  return {
    mode: effectiveMode,
    useCase,
    selectedIds,
    intentTags,
  };
}

export function applyProofPoints({
  body,
  platform,
  context,
  proofPoints = PROOF_POINTS,
}: {
  body: string;
  platform: ProofPointPlatform;
  context?: Record<string, unknown> | null;
  proofPoints?: ProofPoint[];
}): { value: string; used: ProofPointUsage | null; removedIds: string[] } {
  if (!proofPoints.length) {
    return { value: body, used: null, removedIds: [] };
  }

  const { mode, useCase, selectedIds, intentTags } = resolveProofPointContext(context);
  const allowed = getAllowedProofPoints(platform, useCase, proofPoints);
  const allowedIds = new Set(allowed.map((point) => point.id));

  const mentions = findProofPointMentions(body, proofPoints);
  const allowedMention = mentions.find((mention) => allowedIds.has(mention.id));

  let desired: ProofPoint | null = null;
  let source: ProofPointUsage["source"] | null = null;

  if (mode === "selected") {
    const selectedAllowed = allowed.filter((point) => selectedIds.includes(point.id));
    if (allowedMention && selectedIds.includes(allowedMention.id)) {
      desired = selectedAllowed.find((point) => point.id === allowedMention.id) ?? null;
      source = "existing";
    } else if (selectedAllowed.length) {
      desired = selectedAllowed[0] ?? null;
      source = "selected";
    }
  } else if (mode === "auto") {
    const tagSet = new Set(intentTags);
    const autoCandidates = allowed.filter((point) =>
      point.intentTags.some((tag) => tagSet.has(tag)),
    );
    if (allowedMention && autoCandidates.some((point) => point.id === allowedMention.id)) {
      desired = autoCandidates.find((point) => point.id === allowedMention.id) ?? null;
      source = "existing";
    }
  }

  const { value: stripped, removedIds } = stripProofPointLines(body, proofPoints);
  let output = stripped;
  let used: ProofPointUsage | null = null;

  if (desired) {
    const line = (desired.variants[0] ?? "").trim();
    if (line.length) {
      output = appendLine(output, line);
      used = { id: desired.id, text: line, source: source ?? "selected" };
    }
  }

  return { value: output, used, removedIds };
}

export function lintProofPoints({
  body,
  platform,
  context,
  proofPoints = PROOF_POINTS,
}: {
  body: string;
  platform: ProofPointPlatform;
  context?: Record<string, unknown> | null;
  proofPoints?: ProofPoint[];
}): { issues: string[]; usedId: string | null } {
  if (!proofPoints.length) {
    return { issues: [], usedId: null };
  }

  const { mode, useCase, selectedIds, intentTags } = resolveProofPointContext(context);
  const allowed = getAllowedProofPoints(platform, useCase, proofPoints);
  const allowedIds = new Set(allowed.map((point) => point.id));
  const mentions = findProofPointMentions(body, proofPoints);
  const mentionIds = mentions.map((mention) => mention.id);
  const uniqueMentionIds = new Set(mentionIds);
  const mentionCount = countProofPointMentions(body, proofPoints);
  const issues: string[] = [];

  const allowedByMode = (id: string) => {
    if (!allowedIds.has(id)) return false;
    if (mode === "selected") {
      return selectedIds.includes(id);
    }
    if (mode === "auto") {
      const tagSet = new Set(intentTags);
      const point = allowed.find((item) => item.id === id);
      if (!point) return false;
      return point.intentTags.some((tag) => tagSet.has(tag));
    }
    return false;
  };

  if (mode === "off") {
    if (mentions.length) {
      issues.push("proof_point_disallowed");
    }
    return { issues, usedId: null };
  }

  if (mode === "selected" && selectedIds.length && mentionCount === 0) {
    issues.push("proof_point_missing");
  }

  if (mentionCount > 1 || uniqueMentionIds.size > 1) {
    issues.push("proof_point_limit");
  }

  for (const id of uniqueMentionIds) {
    if (!allowedByMode(id)) {
      issues.push("proof_point_disallowed");
      break;
    }
  }

  const usedId = mentionIds.length ? mentionIds[0] ?? null : null;
  return { issues, usedId };
}

function resolveMode(context?: Record<string, unknown> | null): ProofPointMode {
  const raw = extractString(context, "proofPointMode");
  if (raw && VALID_MODES.has(raw as ProofPointMode)) {
    return raw as ProofPointMode;
  }
  return DEFAULT_PROOF_POINT_MODE;
}

function resolveUseCase(context?: Record<string, unknown> | null): ProofPointUseCase | null {
  const raw = extractString(context, "useCase")
    ?? extractString(context, "type")
    ?? extractString(context, "campaignType")
    ?? extractString(context, "createdWith");
  if (raw) {
    const normalized = raw.toLowerCase().replace(/_/g, "-");
    if (normalized === "event") return "event";
    if (normalized === "promotion" || normalized === "promo") return "promotion";
    if (normalized === "weekly") return "weekly";
    if (normalized === "instant") return "instant";
  }
  if (extractString(context, "eventStart")) return "event";
  if (extractString(context, "promotionStart") || extractString(context, "promotionEnd")) return "promotion";
  if (context && (context["dayOfWeek"] !== undefined || context["occurrenceIndex"] !== undefined)) return "weekly";
  if (extractString(context, "title") || extractString(context, "publishMode")) return "instant";
  return null;
}

function resolveSelectedIds(
  context: Record<string, unknown> | null | undefined,
  useCase: ProofPointUseCase | null,
) {
  const selected = extractStringArray(context, "proofPointsSelected");
  if (selected.length) return selected;
  if (!useCase) return [];
  return DEFAULT_SELECTED_PROOF_POINTS[useCase] ?? [];
}

function resolveIntentTags(context?: Record<string, unknown> | null) {
  const values = extractStringArray(context, "proofPointIntentTags");
  const fallback = values.length ? values : extractStringArray(context, "intentTags");
  return fallback.filter((tag): tag is ProofPointIntentTag => VALID_INTENT_TAGS.has(tag as ProofPointIntentTag));
}

function getAllowedProofPoints(
  platform: ProofPointPlatform,
  useCase: ProofPointUseCase | null,
  proofPoints: ProofPoint[],
) {
  if (!useCase) return [];
  return proofPoints.filter(
    (point) =>
      point.allowedChannels.includes(platform) && point.allowedUseCases.includes(useCase),
  );
}

function findProofPointMentions(value: string, proofPoints: ProofPoint[]) {
  const lower = value.toLowerCase();
  const mentions: Array<{ id: string; index: number }> = [];

  for (const point of proofPoints) {
    for (const variant of point.variants) {
      const normalized = variant.trim().toLowerCase();
      if (!normalized.length) continue;
      const index = lower.indexOf(normalized);
      if (index >= 0) {
        mentions.push({ id: point.id, index });
        break;
      }
    }
  }

  return mentions.sort((a, b) => a.index - b.index);
}

function countProofPointMentions(value: string, proofPoints: ProofPoint[]) {
  let total = 0;
  for (const point of proofPoints) {
    for (const variant of point.variants) {
      const normalized = variant.trim();
      if (!normalized.length) continue;
      total += countOccurrences(value, normalized);
    }
  }
  return total;
}

function stripProofPointLines(value: string, proofPoints: ProofPoint[]) {
  const removedIds: string[] = [];
  const lines = value.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const matches = findProofPointIdsInLine(line, proofPoints);
    if (matches.length) {
      removedIds.push(...matches);
      continue;
    }
    kept.push(line);
  }

  return {
    value: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    removedIds: [...new Set(removedIds)],
  };
}

function findProofPointIdsInLine(line: string, proofPoints: ProofPoint[]) {
  const lower = line.toLowerCase();
  const ids: string[] = [];
  for (const point of proofPoints) {
    for (const variant of point.variants) {
      const normalized = variant.trim().toLowerCase();
      if (!normalized.length) continue;
      if (lower.includes(normalized)) {
        ids.push(point.id);
        break;
      }
    }
  }
  return ids;
}

function appendLine(value: string, line: string) {
  const trimmed = line.trim();
  if (!trimmed.length) return value.trim();
  if (!value.trim().length) return trimmed;
  if (value.endsWith("\n")) return `${value}${trimmed}`;
  return `${value}\n${trimmed}`;
}

function extractString(context: Record<string, unknown> | null | undefined, key: string) {
  if (!context) return null;
  const value = context[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function extractStringArray(context: Record<string, unknown> | null | undefined, key: string) {
  if (!context) return [];
  const value = context[key];
  if (!Array.isArray(value)) return [];
  const output = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return output;
}

function countOccurrences(value: string, phrase: string) {
  const pattern = new RegExp(escapeRegExp(phrase), "gi");
  return value.match(pattern)?.length ?? 0;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
