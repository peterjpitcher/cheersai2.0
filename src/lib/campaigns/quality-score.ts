import type { AiCampaignPayload, AudienceMode, BudgetType, PaidCampaignKind } from '@/types/campaigns';

export type CampaignQualityIssueSeverity = 'critical' | 'warning' | 'info';
export type CampaignQualityStatus = 'ready' | 'needs_attention' | 'blocked';

export interface CampaignQualityIssue {
  code: string;
  severity: CampaignQualityIssueSeverity;
  message: string;
}

export interface CampaignQualitySnapshot {
  score: number;
  status: CampaignQualityStatus;
  issues: CampaignQualityIssue[];
}

export function buildCampaignQualitySnapshot(args: {
  campaignKind: PaidCampaignKind;
  destinationUrl: string | null | undefined;
  budgetAmount: number;
  budgetType: BudgetType;
  audienceMode: AudienceMode;
  conversionReady: boolean;
  capiReady?: boolean;
  adSets: AiCampaignPayload['ad_sets'];
}): CampaignQualitySnapshot {
  const issues: CampaignQualityIssue[] = [];
  const ads = args.adSets.flatMap((adSet) => adSet.ads);

  addIssueIf(issues, !args.destinationUrl, 'missing_destination', 'critical', 'Campaign needs a paid CTA URL.');
  addIssueIf(issues, !args.conversionReady && args.campaignKind === 'event', 'conversion_setup_missing', 'critical', 'Booking campaigns need Purchase conversion setup before publishing.');
  addIssueIf(issues, !args.capiReady, 'capi_not_ready', 'warning', 'Meta CAPI token is not configured, so consented server-side Purchase events will not forward.');
  addIssueIf(issues, args.budgetType === 'LIFETIME' && args.budgetAmount < 15, 'low_lifetime_budget', 'warning', 'Lifetime budgets below GBP 15 give Meta little room to optimise.');
  addIssueIf(issues, args.adSets.length === 0 || ads.length === 0, 'empty_campaign', 'critical', 'Campaign needs ad sets and ads.');
  addIssueIf(issues, ads.some((ad) => !ad.utm_content_key?.trim()), 'missing_ad_utm', 'critical', 'Every ad needs a unique utm_content key for ad-level booking attribution.');
  addIssueIf(issues, hasDuplicateUtmKeys(ads), 'duplicate_ad_utm', 'critical', 'Ad utm_content keys must be unique.');
  addIssueIf(issues, hasWeakCreativeDiversity(args.adSets), 'weak_creative_diversity', 'warning', 'Each ad set should contain at least three distinct creative formats.');
  addIssueIf(issues, args.audienceMode === 'local_interests' && args.adSets.length > 2, 'audience_fragmentation', 'info', 'Interest targeting across many phases can fragment a small local audience.');

  const score = Math.max(0, 100 - issues.reduce((sum, issue) => {
    if (issue.severity === 'critical') return sum + 35;
    if (issue.severity === 'warning') return sum + 12;
    return sum + 5;
  }, 0));

  return {
    score,
    status: issues.some((issue) => issue.severity === 'critical')
      ? 'blocked'
      : issues.some((issue) => issue.severity === 'warning')
        ? 'needs_attention'
        : 'ready',
    issues,
  };
}

export function buildAudienceStrategy(args: {
  audienceMode: AudienceMode;
  geoRadiusMiles: number;
  resolvedInterestCount: number;
  campaignKind: PaidCampaignKind;
  phases: Array<{ name: string; phase_label?: string | null; phase_start?: string | null; phase_end?: string | null }>;
}) {
  return {
    mode: args.audienceMode,
    geoRadiusMiles: args.geoRadiusMiles,
    localAudience: 'home_or_recent',
    interestLayer: args.audienceMode === 'local_interests'
      ? { enabled: true, resolvedInterestCount: args.resolvedInterestCount }
      : { enabled: false, resolvedInterestCount: 0 },
    retargeting: {
      recommended: args.campaignKind === 'event',
      note: 'Use booking-page visitors and engaged social users once account-level custom audiences are available.',
    },
    exclusions: {
      recommended: true,
      note: 'Exclude existing confirmed bookers from late-phase prospecting when audience integrations are available.',
    },
    phases: args.phases.map((phase) => ({
      name: phase.name,
      label: phase.phase_label ?? null,
      start: phase.phase_start ?? null,
      end: phase.phase_end ?? null,
    })),
  };
}

function addIssueIf(
  issues: CampaignQualityIssue[],
  condition: boolean,
  code: string,
  severity: CampaignQualityIssueSeverity,
  message: string,
) {
  if (condition) issues.push({ code, severity, message });
}

function hasDuplicateUtmKeys(ads: AiCampaignPayload['ad_sets'][number]['ads']) {
  const keys = ads
    .map((ad) => ad.utm_content_key?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  return new Set(keys).size !== keys.length;
}

function hasWeakCreativeDiversity(adSets: AiCampaignPayload['ad_sets']) {
  return adSets.some((adSet) => {
    const formats = new Set(adSet.ads.map((ad) => ad.creative_format?.trim()).filter(Boolean));
    return adSet.ads.length >= 3 && formats.size < 3;
  });
}
