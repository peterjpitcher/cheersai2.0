'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, ArrowUpRight, BarChart3, CheckCircle2, MousePointerClick, RefreshCw, Target, Trophy } from 'lucide-react';

import { applyOptimisationRecommendationFormAction, runOptimiserFormAction, syncPerformanceFormAction } from '@/app/(app)/campaigns/actions';
import { Btn } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { CampaignDashboardModel, DashboardAttentionSeverity } from '@/lib/campaigns/dashboard';
import {
  getPerformanceTone,
  sortAdsByPerformance,
  type PerformanceTone,
} from '@/lib/campaigns/performance-matrix';
import type { AdSet, CampaignPerformanceMetrics, CampaignStatus, OptimisationActionSummary } from '@/types/campaigns';
import { DeleteCampaignButton } from './DeleteCampaignButton';

interface CampaignDashboardProps {
  dashboard: CampaignDashboardModel;
}

const STATUS_STYLES: Record<CampaignStatus, { bg: string; fg: string }> = {
  DRAFT: { bg: 'var(--c-status-draft-bg)', fg: 'var(--c-status-draft-fg)' },
  ACTIVE: { bg: 'var(--c-status-posted-bg)', fg: 'var(--c-status-posted-fg)' },
  PAUSED: { bg: 'var(--c-status-scheduled-bg)', fg: 'var(--c-status-scheduled-fg)' },
  ARCHIVED: { bg: 'var(--c-paper-2)', fg: 'var(--c-ink-3)' },
};

export function CampaignDashboard({ dashboard }: CampaignDashboardProps) {
  if (dashboard.campaigns.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-20 text-center"
        style={{
          borderRadius: 'var(--r-xl)',
          border: '2px dashed var(--c-line)',
        }}
      >
        <BarChart3 className="mb-3 h-8 w-8" style={{ color: 'var(--c-ink-3)' }} />
        <p className="text-lg font-semibold" style={{ color: 'var(--c-ink)' }}>No campaigns yet</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-3)' }}>
          Create your first Meta paid media campaign to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryTile label="Bookings" value={formatNumber(dashboard.totals.conversions)} detail={`${formatCurrency(dashboard.totals.costPerConversion)} cost/booking`} icon={<Trophy className="h-4 w-4" />} />
          <SummaryTile label="Spend" value={formatCurrency(dashboard.totals.spend)} detail={`${formatNumber(dashboard.totals.clicks)} link clicks`} icon={<MousePointerClick className="h-4 w-4" />} />
          <SummaryTile label="Reach" value={formatNumber(dashboard.totals.reach)} detail={`${formatNumber(dashboard.totals.impressions)} impressions`} icon={<Target className="h-4 w-4" />} />
          <SummaryTile label="Conversion rate" value={formatPercentage(dashboard.totals.conversionRate)} detail={`${formatPercentage(dashboard.totals.ctr)} CTR`} icon={<CheckCircle2 className="h-4 w-4" />} />
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={syncPerformanceFormAction}>
            <Btn type="submit" variant="outline" size="sm">
              <RefreshCw className="h-4 w-4" />
              Sync performance
            </Btn>
          </form>
          <form action={runOptimiserFormAction}>
            <Btn type="submit" variant="outline" size="sm">
              <Target className="h-4 w-4" />
              Run optimiser
            </Btn>
          </form>
        </div>
      </div>

      <NeedsAttention items={dashboard.attentionItems} />
      <EventBookingInsightsPanel dashboard={dashboard} />
      <BookingBlockersPanel actions={dashboard.optimisationActions} />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr),minmax(360px,0.48fr)]">
        <CampaignComparison dashboard={dashboard} />
        <BestAds dashboard={dashboard} />
      </section>

      <CampaignPerformanceGroups dashboard={dashboard} />
      <OptimisationHistory actions={dashboard.optimisationActions} />
    </div>
  );
}


function SummaryTile({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-4 p-4">
        <div>
          <p className="eyebrow">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: 'var(--c-ink)' }}>{value}</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--c-ink-3)' }}>{detail}</p>
        </div>
        <span
          className="p-2"
          style={{
            borderRadius: 'var(--r-md)',
            backgroundColor: 'var(--c-orange-soft)',
            color: 'var(--c-orange)',
          }}
        >
          {icon}
        </span>
      </div>
    </Card>
  );
}

function NeedsAttention({ items }: { items: CampaignDashboardModel['attentionItems'] }) {
  return (
    <section
      style={{
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ borderBottom: '1px solid var(--c-line)' }}
      >
        <AlertTriangle className="h-4 w-4" style={{ color: 'var(--c-orange)' }} />
        <h2 className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Needs attention</h2>
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{
            backgroundColor: items.length ? 'var(--c-orange-soft)' : 'var(--c-status-posted-bg)',
            color: items.length ? 'var(--c-orange-hi)' : 'var(--c-status-posted-fg)',
          }}
        >
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-5 text-sm" style={{ color: 'var(--c-ink-3)' }}>No urgent campaign issues found from the latest synced data.</p>
      ) : (
        <div style={{ borderColor: 'var(--c-line)' }} className="divide-y">
          {items.slice(0, 8).map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="flex items-start justify-between gap-4 px-4 py-3 transition-colors"
              style={{ '--hover-bg': 'var(--c-paper)' } as React.CSSProperties}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--c-paper)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={item.severity} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>{item.title}</span>
                  <span className="text-xs" style={{ color: 'var(--c-ink-3)' }}>{item.campaignName}</span>
                </div>
                <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-3)' }}>{item.detail}</p>
              </div>
              <ArrowUpRight className="mt-1 h-4 w-4 flex-shrink-0" style={{ color: 'var(--c-ink-3)' }} />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function SeverityBadge({ severity }: { severity: DashboardAttentionSeverity }) {
  const styles = severity === 'critical'
    ? { bg: 'var(--c-claret-soft)', fg: 'var(--c-claret)' }
    : severity === 'warning'
      ? { bg: 'var(--c-orange-soft)', fg: 'var(--c-orange-hi)' }
      : { bg: 'var(--c-paper-2)', fg: 'var(--c-ink-3)' };
  const label = severity === 'critical' ? 'Critical' : severity === 'warning' ? 'Warning' : 'Check';
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: styles.bg, color: styles.fg }}
    >
      {label}
    </span>
  );
}

function EventBookingInsightsPanel({ dashboard }: { dashboard: CampaignDashboardModel }) {
  const insights = dashboard.eventBookingInsights;

  return (
    <section
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
          <h2 className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Event booking insights</h2>
          <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
            First-party booking patterns used to guide future event campaign copy.
          </p>
        </div>
        <div className="text-right text-xs" style={{ color: 'var(--c-ink-3)' }}>
          <p><span className="font-semibold" style={{ color: 'var(--c-ink)' }}>{formatNumber(insights.totalBookings30d)}</span> bookings in 30 days</p>
          <p><span className="font-semibold" style={{ color: 'var(--c-ink)' }}>{formatNumber(insights.totalBookings90d)}</span> bookings in 90 days</p>
        </div>
      </div>
      {insights.totalBookings90d === 0 ? (
        <p className="px-4 py-5 text-sm" style={{ color: 'var(--c-ink-3)' }}>
          No first-party event booking conversions have been captured yet.
        </p>
      ) : (
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <InsightList title="Top categories" items={insights.topCategories90d} />
          <InsightList title="Top events" items={insights.topEvents90d} />
          <InsightList title="Top campaigns" items={insights.topCampaigns90d} />
        </div>
      )}
    </section>
  );
}

function BookingBlockersPanel({ actions }: { actions: OptimisationActionSummary[] }) {
  const blockers = actions.filter((action) => action.actionType === 'tracking_issue').slice(0, 6);

  return (
    <section
      style={{
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--c-line)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Booking blockers</h2>
        <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>Tracking, booking-flow, and creative issues found before copy recommendations.</p>
      </div>
      {blockers.length === 0 ? (
        <p className="px-4 py-5 text-sm" style={{ color: 'var(--c-ink-3)' }}>No booking blockers have been recorded by the optimiser yet.</p>
      ) : (
        <div style={{ borderColor: 'var(--c-line)' }} className="divide-y">
          {blockers.map((action) => (
            <div key={action.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{
                    backgroundColor: action.severity === 'critical' ? 'var(--c-claret-soft)' : action.severity === 'warning' ? 'var(--c-orange-soft)' : 'var(--c-paper-2)',
                    color: action.severity === 'critical' ? 'var(--c-claret)' : action.severity === 'warning' ? 'var(--c-orange-hi)' : 'var(--c-ink-3)',
                  }}
                >
                  {action.severity}
                </span>
                <p className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>{action.campaignName ?? 'Campaign'}</p>
                <span className="text-xs" style={{ color: 'var(--c-ink-3)' }}>{formatDateTime(action.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-3)' }}>{action.reason}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function InsightList({ title, items }: { title: string; items: CampaignDashboardModel['eventBookingInsights']['topEvents90d'] }) {
  return (
    <div style={{ borderRadius: 'var(--r-lg)', border: '1px solid var(--c-line)' }}>
      <div
        className="px-3 py-2"
        style={{ borderBottom: '1px solid var(--c-line)', backgroundColor: 'var(--c-paper)' }}
      >
        <p className="eyebrow">{title}</p>
      </div>
      <div style={{ borderColor: 'var(--c-line)' }} className="divide-y">
        {items.slice(0, 4).map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 px-3 py-2">
            <p className="truncate text-sm font-medium" style={{ color: 'var(--c-ink)' }}>{item.name}</p>
            <p className="text-xs tabular-nums" style={{ color: 'var(--c-ink-3)' }}>
              {formatNumber(item.bookings)} / {formatNumber(item.tickets)} seats
            </p>
          </div>
        ))}
        {items.length === 0 && (
          <p className="px-3 py-3 text-sm" style={{ color: 'var(--c-ink-3)' }}>No data yet.</p>
        )}
      </div>
    </div>
  );
}

function CampaignComparison({ dashboard }: { dashboard: CampaignDashboardModel }) {
  return (
    <section
      style={{
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--c-line)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Campaign comparison</h2>
        <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>Sorted by booking volume, then cost per booking.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1180px] w-full text-sm">
          <thead>
            <tr
              className="text-xs font-semibold uppercase tracking-wide"
              style={{
                borderBottom: '1px solid var(--c-line)',
                backgroundColor: 'var(--c-paper)',
                color: 'var(--c-ink-3)',
              }}
            >
              <th className="px-4 py-3 text-left">Campaign</th>
              <th className="px-3 py-3 text-left">Status</th>
              <th className="px-3 py-3 text-left">Meta</th>
              <th className="px-3 py-3 text-right">Bookings</th>
              <th className="px-3 py-3 text-right">Cost/booking</th>
              <th className="px-3 py-3 text-right">Conv. rate</th>
              <th className="px-3 py-3 text-right">Spend</th>
              <th className="px-3 py-3 text-right">Clicks</th>
              <th className="px-3 py-3 text-right">CTR</th>
              <th className="px-3 py-3 text-right">CPC</th>
              <th className="px-3 py-3 text-right">Reach</th>
              <th className="px-3 py-3 text-right">Impressions</th>
              <th className="px-3 py-3 text-left">Last sync</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody style={{ borderColor: 'var(--c-line)' }} className="divide-y">
            {[...dashboard.campaigns].sort(comparePerformanceRows).map((campaign) => {
              const statusStyle = STATUS_STYLES[campaign.status];
              return (
                <tr
                  key={campaign.id}
                  className="transition-colors"
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--c-paper)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <td className="px-4 py-3">
                    <Link href={`/campaigns/${campaign.id}`} className="font-medium hover:underline" style={{ color: 'var(--c-ink)' }}>
                      {campaign.name}
                    </Link>
                    <p className="mt-0.5 text-xs capitalize" style={{ color: 'var(--c-ink-3)' }}>
                      {campaign.campaignKind} · {campaign.audienceMode === 'local_interests' ? 'Local + interests' : 'Local only'}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: statusStyle.bg, color: statusStyle.fg }}
                    >
                      {toTitleCase(campaign.status)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs" style={{ color: 'var(--c-ink-3)' }}>{campaign.metaStatus ?? 'Not synced'}</td>
                  <MetricCell value={formatNumber(campaign.performance.conversions)} tone={getPerformanceTone('conversions', campaign.performance.conversions, dashboard.campaigns.map((item) => item.performance))} />
                  <MetricCell value={formatCurrency(campaign.performance.costPerConversion)} tone={getPerformanceTone('costPerConversion', campaign.performance.costPerConversion, dashboard.campaigns.map((item) => item.performance))} />
                  <MetricCell value={formatPercentage(campaign.performance.conversionRate)} />
                  <MetricCell value={formatCurrency(campaign.performance.spend)} />
                  <MetricCell value={formatNumber(campaign.performance.clicks)} />
                  <MetricCell value={formatPercentage(campaign.performance.ctr)} />
                  <MetricCell value={formatCurrency(campaign.performance.cpc)} />
                  <MetricCell value={formatNumber(campaign.performance.reach)} />
                  <MetricCell value={formatNumber(campaign.performance.impressions)} />
                  <td className="px-3 py-3 text-xs" style={{ color: 'var(--c-ink-3)' }}>{formatDateTime(campaign.lastSyncedAt)}</td>
                  <td className="px-3 py-3 text-right"><DeleteCampaignButton campaignId={campaign.id} campaignName={campaign.name} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BestAds({ dashboard }: { dashboard: CampaignDashboardModel }) {
  return (
    <section
      style={{
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--c-line)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Best ads</h2>
        <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>Ranked by bookings, then cost per booking.</p>
      </div>
      {dashboard.bestAds.length === 0 ? (
        <p className="px-4 py-5 text-sm" style={{ color: 'var(--c-ink-3)' }}>No ad performance has synced yet.</p>
      ) : (
        <div style={{ borderColor: 'var(--c-line)' }} className="divide-y">
          {dashboard.bestAds.map((ad, index) => (
            <Link
              key={ad.id}
              href={`/campaigns/${ad.campaignId}`}
              className="block px-4 py-3 transition-colors"
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--c-paper)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{
                        backgroundColor: index === 0 ? 'var(--c-status-posted-bg)' : 'var(--c-paper-2)',
                        color: index === 0 ? 'var(--c-status-posted-fg)' : 'var(--c-ink-3)',
                      }}
                    >
                      #{index + 1}
                    </span>
                    <p className="truncate text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>{ad.name}</p>
                  </div>
                  <p className="mt-1 truncate text-xs" style={{ color: 'var(--c-ink-3)' }}>{ad.campaignName}</p>
                </div>
                <div className="text-right text-xs tabular-nums">
                  <p className="font-semibold" style={{ color: 'var(--c-ink)' }}>{formatNumber(ad.performance.conversions)} bookings</p>
                  <p style={{ color: 'var(--c-ink-3)' }}>{formatCurrency(ad.performance.costPerConversion)} CPA</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function CampaignPerformanceGroups({ dashboard }: { dashboard: CampaignDashboardModel }) {
  const activeCampaigns = dashboard.campaigns.filter((campaign) => campaign.status === 'ACTIVE');

  return (
    <section
      style={{
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--c-line)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Ad set and ad performance</h2>
        <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>Ad sets stay in campaign phase order. Ads are ranked inside each ad set.</p>
      </div>
      <div style={{ borderColor: 'var(--c-line)' }} className="divide-y">
        {activeCampaigns.map((campaign) => (
          <div key={campaign.id} className="px-4 py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <Link href={`/campaigns/${campaign.id}`} className="font-semibold hover:underline" style={{ color: 'var(--c-ink)' }}>
                {campaign.name}
              </Link>
              <span className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
                {formatNumber(campaign.performance.conversions)} bookings · {formatCurrency(campaign.performance.spend)} spend
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {campaign.adSets.map((adSet) => (
                <AdSetMiniMatrix key={adSet.id} adSet={adSet} />
              ))}
              {campaign.adSets.length === 0 && (
                <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>No ad sets found.</p>
              )}
            </div>
          </div>
        ))}
        {activeCampaigns.length === 0 && (
          <p className="px-4 py-5 text-sm" style={{ color: 'var(--c-ink-3)' }}>No active campaigns to compare yet.</p>
        )}
      </div>
    </section>
  );
}

function AdSetMiniMatrix({ adSet }: { adSet: AdSet }) {
  const sortedAds = sortAdsByPerformance(adSet.ads ?? []);
  const context = sortedAds.map((ad) => ad.performance);

  return (
    <div style={{ borderRadius: 'var(--r-lg)', border: '1px solid var(--c-line)' }}>
      <div
        className="px-3 py-2"
        style={{ borderBottom: '1px solid var(--c-line)', backgroundColor: 'var(--c-paper)' }}
      >
        <p className="truncate text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>{adSet.name}</p>
        <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
          {adSet.phaseStart ?? 'No start'} · {formatNumber(adSet.performance.conversions)} bookings · {formatCurrency(adSet.performance.spend)}
        </p>
      </div>
      <div style={{ borderColor: 'var(--c-line)' }} className="divide-y">
        {sortedAds.slice(0, 4).map((ad, index) => {
          const isTop = index === 0 && (ad.performance.conversions > 0 || ad.performance.clicks > 0);
          return (
            <div
              key={ad.id}
              className="grid grid-cols-[minmax(0,1fr),auto,auto] items-center gap-3 px-3 py-2"
              style={{
                borderLeft: isTop ? '4px solid var(--c-status-posted-fg)' : '4px solid transparent',
                backgroundColor: isTop ? 'var(--c-status-posted-bg)' : 'transparent',
              }}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" style={{ color: 'var(--c-ink)' }}>{ad.name}</p>
                <p className="truncate text-xs" style={{ color: 'var(--c-ink-3)' }}>{ad.headline}</p>
              </div>
              <span className={metricPill(getPerformanceTone('conversions', ad.performance.conversions, context))}>
                {formatNumber(ad.performance.conversions)}
              </span>
              <span className="text-xs tabular-nums" style={{ color: 'var(--c-ink-3)' }}>{formatCurrency(ad.performance.costPerConversion)}</span>
            </div>
          );
        })}
        {sortedAds.length === 0 && (
          <p className="px-3 py-3 text-sm" style={{ color: 'var(--c-ink-3)' }}>No ads in this ad set.</p>
        )}
      </div>
    </div>
  );
}

function OptimisationHistory({ actions }: { actions: OptimisationActionSummary[] }) {
  return (
    <section
      style={{
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--c-line)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Optimisation history</h2>
        <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>Review-first recommendations created after performance sync.</p>
      </div>
      {actions.length === 0 ? (
        <p className="px-4 py-5 text-sm" style={{ color: 'var(--c-ink-3)' }}>No optimisation recommendations yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[960px] w-full text-sm">
            <thead>
              <tr
                className="text-xs font-semibold uppercase tracking-wide"
                style={{
                  borderBottom: '1px solid var(--c-line)',
                  backgroundColor: 'var(--c-paper)',
                  color: 'var(--c-ink-3)',
                }}
              >
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-3 py-3 text-left">Campaign</th>
                <th className="px-3 py-3 text-left">Ad</th>
                <th className="px-3 py-3 text-left">Recommendation</th>
                <th className="px-3 py-3 text-left">Status</th>
                <th className="px-3 py-3 text-left">When</th>
              </tr>
            </thead>
            <tbody style={{ borderColor: 'var(--c-line)' }} className="divide-y">
              {actions.map((action) => (
                <tr key={action.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium" style={{ color: 'var(--c-ink)' }}>{actionLabel(action.actionType)}</p>
                    <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>{action.reason}</p>
                    {action.error && <p className="mt-1 text-xs" style={{ color: 'var(--c-claret)' }}>{action.error}</p>}
                  </td>
                  <td className="px-3 py-3" style={{ color: 'var(--c-ink-3)' }}>{action.campaignName ?? 'Campaign'}</td>
                  <td className="px-3 py-3" style={{ color: 'var(--c-ink-3)' }}>{action.adName ?? 'Ad'}</td>
                  <td className="px-3 py-3">
                    <RecommendationPreview action={action} />
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{
                        backgroundColor: action.status === 'applied' ? 'var(--c-status-posted-bg)' : action.status === 'failed' ? 'var(--c-claret-soft)' : 'var(--c-paper-2)',
                        color: action.status === 'applied' ? 'var(--c-status-posted-fg)' : action.status === 'failed' ? 'var(--c-claret)' : 'var(--c-ink-3)',
                      }}
                    >
                      {action.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs" style={{ color: 'var(--c-ink-3)' }}>{formatDateTime(action.appliedAt ?? action.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RecommendationPreview({ action }: { action: OptimisationActionSummary }) {
  const proposed = readProposedCopy(action.recommendationPayload);
  if (action.actionType !== 'copy_rewrite' || !proposed) {
    return <p className="max-w-sm text-xs" style={{ color: 'var(--c-ink-3)' }}>{readRecommendationCategory(action.recommendationPayload)}</p>;
  }
  const current = readCurrentCopy(action.recommendationPayload);
  const confidence = readConfidence(action.recommendationPayload);

  return (
    <div className="max-w-md space-y-2">
      {current && (
        <div
          className="px-3 py-2"
          style={{
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--c-line)',
            backgroundColor: 'var(--c-card)',
          }}
        >
          <p className="text-xs font-semibold" style={{ color: 'var(--c-ink-3)' }}>Current copy</p>
          <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--c-ink-3)' }}>{current.headline} - {current.primaryText}</p>
        </div>
      )}
      <div
        className="px-3 py-2"
        style={{
          borderRadius: 'var(--r-md)',
          border: '1px solid var(--c-line)',
          backgroundColor: 'var(--c-paper)',
        }}
      >
        <p className="text-xs font-semibold" style={{ color: 'var(--c-ink)' }}>Proposed: {proposed.headline}</p>
        <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--c-ink-3)' }}>{proposed.primaryText}</p>
        <p className="mt-1 text-xs" style={{ color: 'var(--c-ink-3)' }}>{proposed.description} · {proposed.cta}</p>
      </div>
      {confidence !== null && (
        <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>Confidence: {Math.round(confidence * 100)}%</p>
      )}
      {action.status === 'planned' && (
        <form action={applyOptimisationRecommendationFormAction}>
          <input type="hidden" name="actionId" value={action.id} />
          <Btn type="submit" variant="outline" size="sm">
            Approve replacement
          </Btn>
        </form>
      )}
      {action.replacementAdId && (
        <p className="text-xs" style={{ color: 'var(--c-status-posted-fg)' }}>Replacement ad created.</p>
      )}
    </div>
  );
}

function MetricCell({ value, tone = 'neutral' }: { value: string; tone?: PerformanceTone }) {
  return (
    <td className="px-3 py-3 text-right tabular-nums">
      <span className={metricPill(tone)}>{value}</span>
    </td>
  );
}

function comparePerformanceRows(left: { performance: CampaignPerformanceMetrics }, right: { performance: CampaignPerformanceMetrics }) {
  const sorted = sortAdsByPerformance([
    { id: 'left', performance: left.performance },
    { id: 'right', performance: right.performance },
  ]);
  return sorted[0]?.id === 'left' ? -1 : 1;
}

function metricPill(tone: PerformanceTone) {
  const base = 'inline-flex min-w-14 justify-end rounded-md px-2 py-1 text-xs tabular-nums';
  if (tone === 'best') return `${base} font-semibold` + ' metric-best';
  if (tone === 'good') return `${base}` + ' metric-good';
  if (tone === 'weak') return `${base}` + ' metric-weak';
  return `${base} metric-neutral`;
}

function actionLabel(actionType: OptimisationActionSummary['actionType']) {
  if (actionType === 'pause_ad') return 'Pause recommendation';
  if (actionType === 'tracking_issue') return 'Booking blocker';
  if (actionType === 'copy_rewrite') return 'Copy rewrite';
  return actionType;
}

function toTitleCase(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
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

function readRecommendationCategory(payload: Record<string, unknown>) {
  const category = typeof payload.category === 'string' ? payload.category.replace(/_/g, ' ') : '';
  return category || 'Review recommendation details.';
}
