import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/layout/PageHeader';
import {
  getPerformanceTone,
  hasRankableAdPerformance,
  sortAdSetsByStartDate,
  sortAdsByPerformance,
  type PerformanceTone,
  type PerformanceToneMetric,
} from '@/lib/campaigns/performance-matrix';
import type { AdSet, Campaign, CampaignObjective, CampaignPerformanceMetrics, CampaignStatus, OptimisationActionSummary } from '@/types/campaigns';
import { CampaignActions } from '@/features/campaigns/CampaignActions';
import { applyOptimisationRecommendation, getCampaignOptimisationActions, getCampaignWithTree } from '../actions';

interface CampaignDetailPageProps {
  params: Promise<{ id: string }>;
}

const OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  OUTCOME_AWARENESS: 'Awareness',
  OUTCOME_TRAFFIC: 'Traffic',
  OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_LEADS: 'Leads',
  OUTCOME_SALES: 'Sales',
};

const STATUS_STYLES: Record<CampaignStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  PAUSED: 'bg-amber-100 text-amber-700',
  ARCHIVED: 'bg-secondary text-secondary-foreground',
};

export default async function CampaignDetailPage({ params }: CampaignDetailPageProps) {
  const { id } = await params;
  const [campaign, optimisationActions] = await Promise.all([
    getCampaignWithTree(id),
    getCampaignOptimisationActions(id),
  ]);

  if (!campaign) {
    notFound();
  }

  const objectiveLabel = OBJECTIVE_LABELS[campaign.objective];
  const statusStyle = STATUS_STYLES[campaign.status];
  const adSets = sortAdSetsByStartDate(campaign.adSets ?? []);
  const hasNoCreatives =
    campaign.status === 'DRAFT' &&
    adSets.length > 0 &&
    adSets.every((adSet) => {
      // An ad set with a shared image covers all its ads — not missing creative.
      if (adSet.adsetMediaAssetId) return false;
      const ads = adSet.ads ?? [];
      // An ad set with no ads defined has nothing to show a warning about.
      if (ads.length === 0) return false;
      return ads.every((ad) => !ad.mediaAssetId);
    });

  return (
    <div className="flex flex-col gap-6 font-sans">
      <PageHeader
        title={campaign.name}
        description={`${objectiveLabel} · ${campaign.status.charAt(0) + campaign.status.slice(1).toLowerCase()}`}
        action={
          <CampaignActions
            campaignId={campaign.id}
            status={campaign.status}
            publishError={campaign.publishError ?? null}
            hasMetaCampaign={Boolean(campaign.metaCampaignId)}
          />
        }
      />

      {/* Status badge */}
      <div className="flex items-center gap-3">
        <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${statusStyle}`}>
          {campaign.status.charAt(0) + campaign.status.slice(1).toLowerCase()}
        </span>
        <span className="text-sm text-muted-foreground">
          {campaign.budgetType === 'DAILY'
            ? `£${campaign.budgetAmount}/day`
            : `£${campaign.budgetAmount} total`}
        </span>
        <span className="text-sm text-muted-foreground">
          {campaign.startDate}
          {campaign.endDate ? ` – ${campaign.endDate}` : ' onwards'}
        </span>
        <span className="text-sm text-muted-foreground capitalize">
          {campaign.campaignKind}
        </span>
        <span className="text-sm text-muted-foreground">
          {campaign.geoRadiusMiles} mi local
        </span>
        <span className="text-sm text-muted-foreground">
          {campaign.audienceMode === 'local_interests' ? 'Local + interests' : 'Local only'}
        </span>
      </div>

      <PerformanceMatrix campaign={campaign} adSets={adSets} />
      <OptimisationHistory actions={optimisationActions} />

      {campaign.destinationUrl && (
        <p className="break-all text-xs text-muted-foreground">
          Paid CTA: {campaign.destinationUrl}
        </p>
      )}

      {campaign.audienceMode === 'local_interests' && campaign.resolvedInterests.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Interests: {campaign.resolvedInterests.map((interest) => interest.name).join(', ')}
        </p>
      )}

      {/* Publish error panel — shown when save succeeded but Meta publish failed */}
      {campaign.status === 'DRAFT' && campaign.publishError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">
            Publishing failed
          </p>
          <p className="text-sm text-red-800">{campaign.publishError}</p>
          <p className="mt-1 text-xs text-red-600">
            Your campaign has been saved. Use the &ldquo;Retry Publish&rdquo; button to try again.
          </p>
        </div>
      )}

      {hasNoCreatives && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">
            No images assigned
          </p>
          <p className="text-sm text-amber-800">
            All ads in this campaign are missing images. Publishing is blocked until images are assigned.
          </p>
        </div>
      )}

      {/* AI rationale */}
      {campaign.aiRationale && (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            AI rationale
          </p>
          <p className="text-sm text-foreground">{campaign.aiRationale}</p>
        </div>
      )}

      {/* Ad sets and ads */}
      <div className="space-y-4">
        {adSets.map((adSet) => (
          <details
            key={adSet.id}
            className="rounded-xl border border-border bg-background overflow-hidden"
            open
          >
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
              <div>
                <span className="text-sm font-semibold text-foreground">{adSet.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {adSet.ads?.length ?? 0} ad{(adSet.ads?.length ?? 0) !== 1 ? 's' : ''}
                </span>
              </div>
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[adSet.status as CampaignStatus] ?? 'bg-muted text-muted-foreground'}`}
              >
                {adSet.status.charAt(0) + adSet.status.slice(1).toLowerCase()}
              </span>
            </summary>

            <div className="border-t border-border divide-y divide-border">
              {adSet.ads?.map((ad) => (
                <div key={ad.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{ad.name}</p>
                      <p className="mt-0.5 text-xs font-medium text-muted-foreground">{ad.headline}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {ad.primaryText}
                      </p>
                    </div>
                    {!ad.mediaAssetId && !adSet.adsetMediaAssetId && (
                      <span className="flex-shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                        No creative
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {(!adSet.ads || adSet.ads.length === 0) && (
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">No ads in this ad set.</p>
                </div>
              )}
            </div>
          </details>
        ))}

        {adSets.length === 0 && (
          <p className="text-sm text-muted-foreground">No ad sets found for this campaign.</p>
        )}
      </div>
    </div>
  );
}

function OptimisationHistory({ actions }: { actions: OptimisationActionSummary[] }) {
  if (actions.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-semibold text-foreground">Optimisation history</p>
        <p className="text-xs text-muted-foreground">Review-first recommendations for this campaign.</p>
      </div>
      <div className="divide-y divide-border">
        {actions.map((action) => (
          <div key={action.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {action.status}
              </span>
              <span className="text-sm font-semibold text-foreground">
                {detailActionLabel(action.actionType)}
              </span>
              <span className="text-xs text-muted-foreground">
                {action.adName ?? 'Ad'} · {formatDateTime(action.appliedAt ?? action.createdAt)}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{action.reason}</p>
            <DetailRecommendationPreview action={action} />
            {action.error && <p className="mt-1 text-sm text-red-600">{action.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

async function applyOptimisationRecommendationFormAction(formData: FormData) {
  'use server';
  const actionId = String(formData.get('actionId') ?? '');
  if (actionId) {
    await applyOptimisationRecommendation(actionId);
  }
}

function DetailRecommendationPreview({ action }: { action: OptimisationActionSummary }) {
  const proposed = readProposedCopy(action.recommendationPayload);
  if (action.actionType !== 'copy_rewrite' || !proposed) return null;
  const current = readCurrentCopy(action.recommendationPayload);
  const confidence = readConfidence(action.recommendationPayload);

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
      {current && (
        <>
          <p className="text-xs font-semibold text-muted-foreground">Current copy</p>
          <p className="mt-1 text-sm text-muted-foreground">{current.headline} - {current.primaryText}</p>
        </>
      )}
      <p className="text-xs font-semibold text-foreground">Proposed replacement</p>
      <p className="mt-1 text-sm font-medium text-foreground">{proposed.headline}</p>
      <p className="mt-1 text-sm text-muted-foreground">{proposed.primaryText}</p>
      <p className="mt-1 text-xs text-muted-foreground">{proposed.description} · {proposed.cta}</p>
      {confidence !== null && (
        <p className="mt-1 text-xs text-muted-foreground">Confidence: {Math.round(confidence * 100)}%</p>
      )}
      {action.status === 'planned' && (
        <form action={applyOptimisationRecommendationFormAction} className="mt-2">
          <input type="hidden" name="actionId" value={action.id} />
          <button type="submit" className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-accent">
            Approve replacement
          </button>
        </form>
      )}
    </div>
  );
}

function readProposedCopy(payload: Record<string, unknown>) {
  const proposed = payload.proposed;
  if (!proposed || typeof proposed !== 'object') return null;
  const record = proposed as Record<string, unknown>;
  const headline = typeof record.headline === 'string' ? record.headline : '';
  const primaryText = typeof record.primaryText === 'string' ? record.primaryText : '';
  const description = typeof record.description === 'string' ? record.description : '';
  const cta = typeof record.cta === 'string' ? record.cta : 'BOOK_NOW';
  if (!headline || !primaryText) return null;
  return { headline, primaryText, description, cta };
}

function readCurrentCopy(payload: Record<string, unknown>) {
  const current = payload.current;
  if (!current || typeof current !== 'object') return null;
  const record = current as Record<string, unknown>;
  const headline = typeof record.headline === 'string' ? record.headline : '';
  const primaryText = typeof record.primaryText === 'string' ? record.primaryText : '';
  if (!headline && !primaryText) return null;
  return { headline, primaryText };
}

function readConfidence(payload: Record<string, unknown>) {
  return typeof payload.confidence === 'number' ? payload.confidence : null;
}

function detailActionLabel(actionType: OptimisationActionSummary['actionType']) {
  if (actionType === 'pause_ad') return 'Pause recommendation';
  if (actionType === 'tracking_issue') return 'Booking blocker';
  if (actionType === 'copy_rewrite') return 'Copy rewrite';
  return actionType;
}

function PerformanceMatrix({ campaign, adSets }: { campaign: Campaign; adSets: AdSet[] }) {
  const adSetPerformanceContext = adSets.map((adSet) => adSet.performance);

  return (
    <div className="rounded-xl border border-border bg-background">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Performance matrix</p>
          <p className="text-xs text-muted-foreground">
            {campaign.metaCampaignId
              ? `Last synced: ${formatDateTime(campaign.lastSyncedAt)}`
              : 'Publish campaign before performance appears.'}
          </p>
        </div>
        {campaign.metaStatus && (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            Meta: {campaign.metaStatus}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1280px] w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="sticky left-0 z-20 min-w-[340px] border-b border-border bg-muted px-4 py-3">Name</th>
              <th className="border-b border-border px-3 py-3">Type</th>
              <th className="border-b border-border px-3 py-3">Meta status</th>
              <th className="border-b border-border px-3 py-3 text-right">Reach</th>
              <th className="border-b border-border px-3 py-3 text-right">Impressions</th>
              <th className="border-b border-border px-3 py-3 text-right">Link clicks</th>
              <th className="border-b border-border px-3 py-3 text-right">Bookings</th>
              <th className="border-b border-border px-3 py-3 text-right">Cost/booking</th>
              <th className="border-b border-border px-3 py-3 text-right">Conv. rate</th>
              <th className="border-b border-border px-3 py-3 text-right">CTR</th>
              <th className="border-b border-border px-3 py-3 text-right">CPC</th>
              <th className="border-b border-border px-3 py-3 text-right">Spend</th>
              <th className="border-b border-border px-3 py-3">Last synced</th>
            </tr>
          </thead>
          <tbody>
            <PerformanceRow
              name={campaign.name}
              type="Campaign"
              metaStatus={campaign.metaStatus}
              performance={campaign.performance}
              lastSyncedAt={campaign.lastSyncedAt}
              variant="campaign"
            />

            {adSets.map((adSet) => (
              <PerformanceAdSetGroup
                key={adSet.id}
                adSet={adSet}
                adSetPerformanceContext={adSetPerformanceContext}
              />
            ))}

            {adSets.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-5 text-sm text-muted-foreground">
                  No ad sets found for this campaign.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PerformanceAdSetGroup({
  adSet,
  adSetPerformanceContext,
}: {
  adSet: AdSet;
  adSetPerformanceContext: CampaignPerformanceMetrics[];
}) {
  const sortedAds = sortAdsByPerformance(adSet.ads ?? []);
  const adPerformanceContext = sortedAds.map((ad) => ad.performance);
  const topAdId = hasRankableAdPerformance(sortedAds[0]) ? sortedAds[0]?.id : null;

  return (
    <>
      <PerformanceRow
        name={adSet.name}
        type="Ad set"
        metaStatus={adSet.metaStatus}
        performance={adSet.performance}
        lastSyncedAt={adSet.lastSyncedAt}
        variant="adset"
        toneContext={adSetPerformanceContext}
      />

      {sortedAds.map((ad) => (
        <PerformanceRow
          key={ad.id}
          name={ad.name}
          type="Ad"
          metaStatus={ad.metaStatus}
          performance={ad.performance}
          lastSyncedAt={ad.lastSyncedAt}
          variant="ad"
          toneContext={adPerformanceContext}
          isTopAd={ad.id === topAdId}
          secondaryText={ad.headline}
        />
      ))}

      {sortedAds.length === 0 && (
        <tr className="bg-background">
          <td className="sticky left-0 z-10 border-b border-border bg-background px-8 py-3 text-sm text-muted-foreground">
            No ads in this ad set.
          </td>
          <td colSpan={12} className="border-b border-border px-3 py-3" />
        </tr>
      )}
    </>
  );
}

function PerformanceRow({
  name,
  type,
  metaStatus,
  performance,
  toneContext,
  variant,
  isTopAd = false,
  secondaryText,
  lastSyncedAt,
}: {
  name: string;
  type: 'Campaign' | 'Ad set' | 'Ad';
  metaStatus: string | null;
  performance: CampaignPerformanceMetrics;
  toneContext?: CampaignPerformanceMetrics[];
  variant: 'campaign' | 'adset' | 'ad';
  isTopAd?: boolean;
  secondaryText?: string;
  lastSyncedAt: Date | null;
}) {
  const toneSource = toneContext ?? [];
  const rowClass = [
    variant === 'campaign' ? 'bg-slate-50/80 font-semibold' : '',
    variant === 'adset' ? 'bg-muted/20 font-semibold' : 'bg-background',
    isTopAd ? 'bg-emerald-50/80' : '',
  ].filter(Boolean).join(' ');
  const stickyBackground = isTopAd
    ? 'bg-emerald-50'
    : variant === 'campaign'
      ? 'bg-slate-50'
      : variant === 'adset'
        ? 'bg-muted'
        : 'bg-background';

  return (
    <tr className={rowClass}>
      <td className={`sticky left-0 z-10 border-b border-border ${stickyBackground} px-4 py-3 ${isTopAd ? 'border-l-4 border-l-emerald-400' : 'border-l-4 border-l-transparent'}`}>
        <div className={variant === 'ad' ? 'pl-4' : ''}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-foreground">{name}</span>
            {isTopAd && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                Top ad
              </span>
            )}
          </div>
          {secondaryText && (
            <p className="mt-0.5 truncate text-xs font-normal text-muted-foreground">{secondaryText}</p>
          )}
        </div>
      </td>
      <td className="border-b border-border px-3 py-3">
        <span className={typeBadgeClass(type)}>{type}</span>
      </td>
      <td className="border-b border-border px-3 py-3 text-muted-foreground">{metaStatus ?? '—'}</td>
      <MetricTableCell value={formatNumber(performance.reach)} />
      <MetricTableCell value={formatNumber(performance.impressions)} />
      <MetricTableCell
        value={formatNumber(performance.clicks)}
        tone={getTone('clicks', performance.clicks, toneSource)}
      />
      <MetricTableCell
        value={formatNumber(performance.conversions)}
        tone={getTone('conversions', performance.conversions, toneSource)}
      />
      <MetricTableCell
        value={formatCurrency(performance.costPerConversion)}
        tone={getTone('costPerConversion', performance.costPerConversion, toneSource)}
      />
      <MetricTableCell
        value={formatPercentage(performance.conversionRate)}
        tone={getTone('conversionRate', performance.conversionRate, toneSource)}
      />
      <MetricTableCell
        value={formatPercentage(performance.ctr)}
        tone={getTone('ctr', performance.ctr, toneSource)}
      />
      <MetricTableCell
        value={formatCurrency(performance.cpc)}
        tone={getTone('cpc', performance.cpc, toneSource)}
      />
      <MetricTableCell value={formatCurrency(performance.spend)} />
      <td className="border-b border-border px-3 py-3 text-xs text-muted-foreground">
        {formatDateTime(lastSyncedAt)}
      </td>
    </tr>
  );
}

function MetricTableCell({ value, tone = 'neutral' }: { value: string; tone?: PerformanceTone }) {
  return (
    <td className="border-b border-border px-3 py-3 text-right tabular-nums">
      <span className={`inline-flex min-w-16 justify-end rounded-md px-2 py-1 ${toneClass(tone)}`}>
        {value}
      </span>
    </td>
  );
}

function getTone(
  metric: PerformanceToneMetric,
  value: number,
  context: CampaignPerformanceMetrics[],
): PerformanceTone {
  return context.length > 1 ? getPerformanceTone(metric, value, context) : 'neutral';
}

function toneClass(tone: PerformanceTone) {
  switch (tone) {
    case 'best':
      return 'bg-emerald-100 font-semibold text-emerald-800';
    case 'good':
      return 'bg-emerald-50 text-emerald-700';
    case 'weak':
      return 'bg-rose-50 text-rose-700';
    default:
      return 'text-foreground';
  }
}

function typeBadgeClass(type: 'Campaign' | 'Ad set' | 'Ad') {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold';
  if (type === 'Campaign') return `${base} bg-slate-100 text-slate-700`;
  if (type === 'Ad set') return `${base} bg-blue-50 text-blue-700`;
  return `${base} bg-muted text-muted-foreground`;
}

function formatNumber(value: number) {
  return value.toLocaleString('en-GB');
}

function formatCurrency(value: number) {
  return `£${value.toFixed(2)}`;
}

function formatPercentage(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatDateTime(value: Date | null) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}
