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
import { RecurringControls } from './recurring-controls';

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

const STATUS_STYLES: Record<CampaignStatus, { bg: string; fg: string }> = {
  DRAFT: { bg: 'var(--c-status-draft-bg)', fg: 'var(--c-status-draft-fg)' },
  ACTIVE: { bg: 'var(--c-status-posted-bg)', fg: 'var(--c-status-posted-fg)' },
  PAUSED: { bg: 'var(--c-status-scheduled-bg)', fg: 'var(--c-status-scheduled-fg)' },
  ARCHIVED: { bg: 'var(--c-paper-2)', fg: 'var(--c-ink-3)' },
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
        <span
          className="inline-block rounded-full px-3 py-1 text-xs font-semibold"
          style={{ backgroundColor: statusStyle.bg, color: statusStyle.fg }}
        >
          {campaign.status.charAt(0) + campaign.status.slice(1).toLowerCase()}
        </span>
        <span className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
          {campaign.budgetType === 'DAILY'
            ? `£${campaign.budgetAmount}/day`
            : `£${campaign.budgetAmount} total`}
        </span>
        <span className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
          {campaign.startDate}
          {campaign.endDate ? ` – ${campaign.endDate}` : ' onwards'}
        </span>
        <span className="text-sm capitalize" style={{ color: 'var(--c-ink-3)' }}>
          {campaign.campaignKind}
        </span>
        <span className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
          {campaign.geoRadiusMiles} mi local
        </span>
        <span className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
          {campaign.audienceMode === 'local_interests' ? 'Local + interests' : 'Local only'}
        </span>
      </div>

      {['weekly', 'weekly_recurring', 'daily', 'monthly'].includes(campaign.campaignKind) && (
        <RecurringControls
          campaignId={campaign.id}
          campaignType={campaign.campaignType ?? campaign.campaignKind}
          status={campaign.status}
          autoConfirm={campaign.autoConfirm}
        />
      )}

      <PerformanceMatrix campaign={campaign} adSets={adSets} />
      <OptimisationHistory actions={optimisationActions} />

      {campaign.destinationUrl && (
        <p className="break-all text-xs" style={{ color: 'var(--c-ink-3)' }}>
          Paid CTA: {campaign.destinationUrl}
        </p>
      )}

      {campaign.audienceMode === 'local_interests' && campaign.resolvedInterests.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
          Interests: {campaign.resolvedInterests.map((interest) => interest.name).join(', ')}
        </p>
      )}

      {/* Publish error panel — shown when save succeeded but Meta publish failed */}
      {campaign.status === 'DRAFT' && campaign.publishError && (
        <div
          className="px-4 py-3"
          style={{
            borderRadius: 'var(--r-xl)',
            border: '1px solid var(--c-claret-soft)',
            backgroundColor: 'var(--c-claret-soft)',
          }}
        >
          <p className="eyebrow mb-1" style={{ color: 'var(--c-claret)' }}>
            Publishing failed
          </p>
          <p className="text-sm" style={{ color: 'var(--c-claret)' }}>{campaign.publishError}</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--c-claret)' }}>
            Your campaign has been saved. Use the &ldquo;Retry Publish&rdquo; button to try again.
          </p>
        </div>
      )}

      {hasNoCreatives && (
        <div
          className="px-4 py-3"
          style={{
            borderRadius: 'var(--r-xl)',
            border: '1px solid var(--c-orange)',
            backgroundColor: 'var(--c-orange-soft)',
          }}
        >
          <p className="eyebrow mb-1" style={{ color: 'var(--c-orange-hi)' }}>
            No images assigned
          </p>
          <p className="text-sm" style={{ color: 'var(--c-ink)' }}>
            All ads in this campaign are missing images. Publishing is blocked until images are assigned.
          </p>
        </div>
      )}

      {/* AI rationale */}
      {campaign.aiRationale && (
        <div
          className="px-4 py-3"
          style={{
            borderLeft: '3px solid var(--c-ink)',
            backgroundColor: 'var(--c-paper)',
            borderRadius: 'var(--r-sm)',
          }}
        >
          <p className="eyebrow mb-1">AI rationale</p>
          <p className="text-sm" style={{ color: 'var(--c-ink)' }}>{campaign.aiRationale}</p>
        </div>
      )}

      {/* Ad sets and ads */}
      <div className="space-y-4">
        {adSets.map((adSet) => {
          const adSetStatusStyle = STATUS_STYLES[adSet.status as CampaignStatus] ?? { bg: 'var(--c-paper-2)', fg: 'var(--c-ink-3)' };
          return (
            <details
              key={adSet.id}
              className="overflow-hidden"
              style={{
                borderRadius: 'var(--r-xl)',
                border: '1px solid var(--c-line)',
                backgroundColor: 'var(--c-card)',
              }}
              open
            >
              <summary
                className="flex cursor-pointer items-center justify-between px-4 py-3 transition-colors"
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--c-paper)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <div>
                  <span className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>{adSet.name}</span>
                  <span className="ml-2 text-xs" style={{ color: 'var(--c-ink-3)' }}>
                    {adSet.ads?.length ?? 0} ad{(adSet.ads?.length ?? 0) !== 1 ? 's' : ''}
                  </span>
                </div>
                <span
                  className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={{ backgroundColor: adSetStatusStyle.bg, color: adSetStatusStyle.fg }}
                >
                  {adSet.status.charAt(0) + adSet.status.slice(1).toLowerCase()}
                </span>
              </summary>

              <div style={{ borderColor: 'var(--c-line)' }} className="border-t divide-y">
                {adSet.ads?.map((ad) => (
                  <div key={ad.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium" style={{ color: 'var(--c-ink)' }}>{ad.name}</p>
                        <p className="mt-0.5 text-xs font-medium" style={{ color: 'var(--c-ink-3)' }}>{ad.headline}</p>
                        <p className="mt-0.5 text-xs line-clamp-2" style={{ color: 'var(--c-ink-3)' }}>
                          {ad.primaryText}
                        </p>
                      </div>
                      {!ad.mediaAssetId && !adSet.adsetMediaAssetId && (
                        <span
                          className="flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                          style={{ backgroundColor: 'var(--c-orange-soft)', color: 'var(--c-orange-hi)' }}
                        >
                          No creative
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {(!adSet.ads || adSet.ads.length === 0) && (
                  <div className="px-4 py-3">
                    <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>No ads in this ad set.</p>
                  </div>
                )}
              </div>
            </details>
          );
        })}

        {adSets.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>No ad sets found for this campaign.</p>
        )}
      </div>
    </div>
  );
}

function OptimisationHistory({ actions }: { actions: OptimisationActionSummary[] }) {
  if (actions.length === 0) return null;

  return (
    <div
      style={{
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--c-line)' }}>
        <p className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Optimisation history</p>
        <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>Review-first recommendations for this campaign.</p>
      </div>
      <div style={{ borderColor: 'var(--c-line)' }} className="divide-y">
        {actions.map((action) => (
          <div key={action.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{ backgroundColor: 'var(--c-paper-2)', color: 'var(--c-ink-3)' }}
              >
                {action.status}
              </span>
              <span className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>
                {detailActionLabel(action.actionType)}
              </span>
              <span className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
                {action.adName ?? 'Ad'} · {formatDateTime(action.appliedAt ?? action.createdAt)}
              </span>
            </div>
            <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-3)' }}>{action.reason}</p>
            <DetailRecommendationPreview action={action} />
            {action.error && <p className="mt-1 text-sm" style={{ color: 'var(--c-claret)' }}>{action.error}</p>}
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
    <div
      className="mt-3 px-3 py-2"
      style={{
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-paper)',
      }}
    >
      {current && (
        <>
          <p className="text-xs font-semibold" style={{ color: 'var(--c-ink-3)' }}>Current copy</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-3)' }}>{current.headline} - {current.primaryText}</p>
        </>
      )}
      <p className="text-xs font-semibold" style={{ color: 'var(--c-ink)' }}>Proposed replacement</p>
      <p className="mt-1 text-sm font-medium" style={{ color: 'var(--c-ink)' }}>{proposed.headline}</p>
      <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-3)' }}>{proposed.primaryText}</p>
      <p className="mt-1 text-xs" style={{ color: 'var(--c-ink-3)' }}>{proposed.description} · {proposed.cta}</p>
      {confidence !== null && (
        <p className="mt-1 text-xs" style={{ color: 'var(--c-ink-3)' }}>Confidence: {Math.round(confidence * 100)}%</p>
      )}
      {action.status === 'planned' && (
        <form action={applyOptimisationRecommendationFormAction} className="mt-2">
          <input type="hidden" name="actionId" value={action.id} />
          <button
            type="submit"
            className="px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--c-line)',
              backgroundColor: 'var(--c-card)',
              color: 'var(--c-ink)',
            }}
          >
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
    <div
      style={{
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <div
        className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
        style={{ borderBottom: '1px solid var(--c-line)' }}
      >
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Performance matrix</p>
          <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
            {campaign.metaCampaignId
              ? `Last synced: ${formatDateTime(campaign.lastSyncedAt)}`
              : 'Publish campaign before performance appears.'}
          </p>
        </div>
        {campaign.metaStatus && (
          <span
            className="rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ backgroundColor: 'var(--c-paper-2)', color: 'var(--c-ink-3)' }}
          >
            Meta: {campaign.metaStatus}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1280px] w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr
              className="text-left text-xs font-semibold uppercase tracking-wide"
              style={{ backgroundColor: 'var(--c-paper)', color: 'var(--c-ink-3)' }}
            >
              <th className="sticky left-0 z-20 min-w-[340px] px-4 py-3" style={{ borderBottom: '1px solid var(--c-line)', backgroundColor: 'var(--c-paper)' }}>Name</th>
              <th className="px-3 py-3" style={{ borderBottom: '1px solid var(--c-line)' }}>Type</th>
              <th className="px-3 py-3" style={{ borderBottom: '1px solid var(--c-line)' }}>Meta status</th>
              <th className="px-3 py-3 text-right" style={{ borderBottom: '1px solid var(--c-line)' }}>Reach</th>
              <th className="px-3 py-3 text-right" style={{ borderBottom: '1px solid var(--c-line)' }}>Impressions</th>
              <th className="px-3 py-3 text-right" style={{ borderBottom: '1px solid var(--c-line)' }}>Link clicks</th>
              <th className="px-3 py-3 text-right" style={{ borderBottom: '1px solid var(--c-line)' }}>Bookings</th>
              <th className="px-3 py-3 text-right" style={{ borderBottom: '1px solid var(--c-line)' }}>Cost/booking</th>
              <th className="px-3 py-3 text-right" style={{ borderBottom: '1px solid var(--c-line)' }}>Conv. rate</th>
              <th className="px-3 py-3 text-right" style={{ borderBottom: '1px solid var(--c-line)' }}>CTR</th>
              <th className="px-3 py-3 text-right" style={{ borderBottom: '1px solid var(--c-line)' }}>CPC</th>
              <th className="px-3 py-3 text-right" style={{ borderBottom: '1px solid var(--c-line)' }}>Spend</th>
              <th className="px-3 py-3" style={{ borderBottom: '1px solid var(--c-line)' }}>Last synced</th>
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
                <td colSpan={13} className="px-4 py-5 text-sm" style={{ color: 'var(--c-ink-3)' }}>
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
        <tr style={{ backgroundColor: 'var(--c-card)' }}>
          <td className="sticky left-0 z-10 px-8 py-3 text-sm" style={{ borderBottom: '1px solid var(--c-line)', backgroundColor: 'var(--c-card)', color: 'var(--c-ink-3)' }}>
            No ads in this ad set.
          </td>
          <td colSpan={12} className="px-3 py-3" style={{ borderBottom: '1px solid var(--c-line)' }} />
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

  const rowBg = isTopAd
    ? 'var(--c-status-posted-bg)'
    : variant === 'campaign'
      ? 'var(--c-paper)'
      : variant === 'adset'
        ? 'var(--c-paper)'
        : 'var(--c-card)';

  const stickyBg = isTopAd
    ? 'var(--c-status-posted-bg)'
    : variant === 'campaign'
      ? 'var(--c-paper)'
      : variant === 'adset'
        ? 'var(--c-paper)'
        : 'var(--c-card)';

  const fontWeight = (variant === 'campaign' || variant === 'adset') ? 600 : 400;

  return (
    <tr style={{ backgroundColor: rowBg, fontWeight }}>
      <td
        className="sticky left-0 z-10 px-4 py-3"
        style={{
          borderBottom: '1px solid var(--c-line)',
          backgroundColor: stickyBg,
          borderLeft: isTopAd ? '4px solid var(--c-status-posted-fg)' : '4px solid transparent',
        }}
      >
        <div className={variant === 'ad' ? 'pl-4' : ''}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate" style={{ color: 'var(--c-ink)' }}>{name}</span>
            {isTopAd && (
              <span
                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{ backgroundColor: 'var(--c-status-posted-bg)', color: 'var(--c-status-posted-fg)' }}
              >
                Top ad
              </span>
            )}
          </div>
          {secondaryText && (
            <p className="mt-0.5 truncate text-xs font-normal" style={{ color: 'var(--c-ink-3)' }}>{secondaryText}</p>
          )}
        </div>
      </td>
      <td className="px-3 py-3" style={{ borderBottom: '1px solid var(--c-line)' }}>
        <span className={typeBadgeClass(type)}>{type}</span>
      </td>
      <td className="px-3 py-3" style={{ borderBottom: '1px solid var(--c-line)', color: 'var(--c-ink-3)' }}>{metaStatus ?? '—'}</td>
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
      <td className="px-3 py-3 text-xs" style={{ borderBottom: '1px solid var(--c-line)', color: 'var(--c-ink-3)' }}>
        {formatDateTime(lastSyncedAt)}
      </td>
    </tr>
  );
}

function MetricTableCell({ value, tone = 'neutral' }: { value: string; tone?: PerformanceTone }) {
  return (
    <td className="px-3 py-3 text-right tabular-nums" style={{ borderBottom: '1px solid var(--c-line)' }}>
      <span className={`inline-flex min-w-16 justify-end rounded-md px-2 py-1 metric-${tone}`}>
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

function typeBadgeClass(type: 'Campaign' | 'Ad set' | 'Ad') {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold';
  // Use inline styles via className approach with CSS variables
  if (type === 'Campaign') return `${base} type-badge-campaign`;
  if (type === 'Ad set') return `${base} type-badge-adset`;
  return `${base} type-badge-ad`;
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
