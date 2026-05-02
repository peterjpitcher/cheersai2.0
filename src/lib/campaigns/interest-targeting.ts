import type { MetaInterest } from '@/lib/meta/marketing';
import type { ResolvedMetaInterest } from '@/types/campaigns';

export const MAX_AUDIENCE_KEYWORDS = 5;
export const MAX_RESOLVED_INTERESTS = 3;
export const MIN_INTEREST_AUDIENCE_SIZE = 1_000;

export interface InterestResolutionResult {
  keywords: string[];
  resolvedInterests: ResolvedMetaInterest[];
  unresolvedKeywords: string[];
  hadLookupError: boolean;
}

export function normaliseAudienceKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') continue;

    const keyword = item
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    const canonical = keyword.toLowerCase();

    if (
      !keyword ||
      keyword.length < 3 ||
      /^\d{6,}$/.test(keyword) ||
      canonical.includes('id:') ||
      seen.has(canonical)
    ) {
      continue;
    }

    seen.add(canonical);
    keywords.push(keyword);
    if (keywords.length >= MAX_AUDIENCE_KEYWORDS) break;
  }

  return keywords;
}

export function normaliseResolvedInterests(value: unknown): ResolvedMetaInterest[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const interests: ResolvedMetaInterest[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' || typeof record.id === 'number'
      ? String(record.id).trim()
      : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;

    seen.add(id);
    interests.push({
      id,
      name,
      path: Array.isArray(record.path)
        ? record.path.filter((pathItem): pathItem is string => typeof pathItem === 'string')
        : undefined,
      description: typeof record.description === 'string' ? record.description : null,
      audienceSize: normaliseNumber(record.audienceSize ?? record.audience_size),
      audienceSizeLowerBound: normaliseNumber(record.audienceSizeLowerBound ?? record.audience_size_lower_bound),
      audienceSizeUpperBound: normaliseNumber(record.audienceSizeUpperBound ?? record.audience_size_upper_bound),
    });

    if (interests.length >= MAX_RESOLVED_INTERESTS) break;
  }

  return interests;
}

export async function resolveMetaInterestsForKeywords(
  accessToken: string,
  keywords: string[],
  search: (accessToken: string, query: string, options?: { limit?: number }) => Promise<MetaInterest[]>,
): Promise<InterestResolutionResult> {
  const normalisedKeywords = normaliseAudienceKeywords(keywords);
  const resolvedInterests: ResolvedMetaInterest[] = [];
  const unresolvedKeywords: string[] = [];
  const seenInterestIds = new Set<string>();
  let hadLookupError = false;

  for (const keyword of normalisedKeywords) {
    if (resolvedInterests.length >= MAX_RESOLVED_INTERESTS) break;

    let results: MetaInterest[];
    try {
      results = await search(accessToken, keyword, { limit: 10 });
    } catch {
      hadLookupError = true;
      unresolvedKeywords.push(keyword);
      continue;
    }

    const match = results.find((interest) => {
      if (!isUsableInterest(interest)) return false;
      return !seenInterestIds.has(interest.id);
    });

    if (!match) {
      unresolvedKeywords.push(keyword);
      continue;
    }

    seenInterestIds.add(match.id);
    resolvedInterests.push(mapMetaInterest(match));
  }

  return {
    keywords: normalisedKeywords,
    resolvedInterests,
    unresolvedKeywords,
    hadLookupError,
  };
}

export function applyInterestTargeting(
  localTargeting: Record<string, unknown>,
  interests: ResolvedMetaInterest[],
): Record<string, unknown> {
  const resolved = normaliseResolvedInterests(interests);
  if (!resolved.length) return localTargeting;

  return {
    ...localTargeting,
    flexible_spec: [
      {
        interests: resolved.map((interest) => ({
          id: interest.id,
          name: interest.name,
        })),
      },
    ],
  };
}

function mapMetaInterest(interest: MetaInterest): ResolvedMetaInterest {
  return {
    id: interest.id,
    name: interest.name,
    path: interest.path,
    description: interest.description ?? null,
    audienceSize: interest.audience_size ?? null,
    audienceSizeLowerBound: interest.audience_size_lower_bound ?? null,
    audienceSizeUpperBound: interest.audience_size_upper_bound ?? null,
  };
}

function isUsableInterest(interest: MetaInterest): boolean {
  if (!interest.id || !interest.name) return false;

  const sizeSignals = [
    interest.audience_size,
    interest.audience_size_lower_bound,
    interest.audience_size_upper_bound,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (sizeSignals.length === 0) return true;
  return Math.max(...sizeSignals) >= MIN_INTEREST_AUDIENCE_SIZE;
}

function normaliseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
