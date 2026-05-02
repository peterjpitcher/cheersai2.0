import type {
  AiCampaignPayload,
  AudienceMode,
  GeoRadiusMiles,
  ResolvedMetaInterest,
} from '@/types/campaigns';

interface ApplyCampaignNamingOptions {
  audienceMode: AudienceMode;
  geoRadiusMiles: GeoRadiusMiles;
  resolvedInterests?: ResolvedMetaInterest[];
}

export function applyDeterministicCampaignNames(
  payload: AiCampaignPayload,
  options: ApplyCampaignNamingOptions,
): AiCampaignPayload {
  const audienceModeLabel = options.audienceMode === 'local_interests' ? 'Local + interests' : 'Local only';
  const interestSummary = buildInterestSummary(options.audienceMode, options.resolvedInterests ?? []);

  return {
    ...payload,
    ad_sets: payload.ad_sets.map((adSet) => {
      const phase = normaliseNamePart(adSet.phase_label || adSet.name || 'Phase');
      return {
        ...adSet,
        name: truncateName(`${phase} | ${audienceModeLabel} | ${options.geoRadiusMiles}mi | ${interestSummary}`),
        ads: adSet.ads.map((ad, index) => ({
          ...ad,
          name: truncateName(`${phase} | ${normaliseNamePart(ad.angle || 'Creative angle')} | Var ${index + 1}`),
        })),
      };
    }),
  };
}

export function buildInterestSummary(
  audienceMode: AudienceMode,
  resolvedInterests: ResolvedMetaInterest[],
): string {
  if (audienceMode !== 'local_interests') return 'Local only';

  const names = resolvedInterests
    .map((interest) => normaliseNamePart(interest.name))
    .filter(Boolean);

  if (names.length === 0) return 'Local interests';
  if (names.length <= 2) return names.join(' + ');
  return `${names.slice(0, 2).join(' + ')} +${names.length - 2} more`;
}

function normaliseNamePart(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[|]/g, '-')
    .trim();
}

function truncateName(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117).trimEnd()}...` : value;
}
