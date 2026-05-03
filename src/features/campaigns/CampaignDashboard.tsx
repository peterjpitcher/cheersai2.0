import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, ArrowUpRight, BarChart3, CheckCircle2, MousePointerClick, RefreshCw, Target, Trophy } from 'lucide-react';

import { runCampaignDashboardOptimisation, syncCampaignDashboardPerformance } from '@/app/(app)/campaigns/actions';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

const STATUS_VARIANTS: Record<CampaignStatus, BadgeProps['variant']> = {
  DRAFT: 'muted',
  ACTIVE: 'success',
  PAUSED: 'warning',
  ARCHIVED: 'muted',
};

export function CampaignDashboard({ dashboard }: CampaignDashboardProps) {
  if (dashboard.campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-20 text-center">
        <BarChart3 className="mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-semibold text-foreground">No campaigns yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
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
            <Button type="submit" variant="outline" size="sm">
              <RefreshCw className="h-4 w-4" />
              Sync performance
            </Button>
          </form>
          <form action={runOptimiserFormAction}>
            <Button type="submit" variant="outline" size="sm">
              <Target className="h-4 w-4" />
              Run optimiser
            </Button>
          </form>
        </div>
      </div>

      <NeedsAttention items={dashboard.attentionItems} />
      <EventBookingInsightsPanel dashboard={dashboard} />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr),minmax(360px,0.48fr)]">
        <CampaignComparison dashboard={dashboard} />
        <BestAds dashboard={dashboard} />
      </section>

      <CampaignPerformanceGroups dashboard={dashboard} />
      <OptimisationHistory actions={dashboard.optimisationActions} />
    </div>
  );
}

async function syncPerformanceFormAction() {
  'use server';
  await syncCampaignDashboardPerformance();
}

async function runOptimiserFormAction() {
  'use server';
  await runCampaignDashboardOptimisation();
}

function SummaryTile({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <span className="rounded-md bg-primary/10 p-2 text-primary">{icon}</span>
      </CardContent>
    </Card>
  );
}

function NeedsAttention({ items }: { items: CampaignDashboardModel['attentionItems'] }) {
  return (
    <section className="rounded-xl border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-foreground">Needs attention</h2>
        <Badge variant={items.length ? 'warning' : 'success'}>{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">No urgent campaign issues found from the latest synced data.</p>
      ) : (
        <div className="divide-y divide-border">
          {items.slice(0, 8).map((item) => (
            <Link key={item.id} href={item.href} className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-muted/30">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={severityVariant(item.severity)}>{severityLabel(item.severity)}</Badge>
                  <span className="text-sm font-semibold text-foreground">{item.title}</span>
                  <span className="text-xs text-muted-foreground">{item.campaignName}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
              </div>
              <ArrowUpRight className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function EventBookingInsightsPanel({ dashboard }: { dashboard: CampaignDashboardModel }) {
  const insights = dashboard.eventBookingInsights;

  return (
    <section className="rounded-xl border border-border bg-background">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Event booking insights</h2>
          <p className="text-xs text-muted-foreground">
            First-party booking patterns used to guide future event campaign copy.
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p><span className="font-semibold text-foreground">{formatNumber(insights.totalBookings30d)}</span> bookings in 30 days</p>
          <p><span className="font-semibold text-foreground">{formatNumber(insights.totalBookings90d)}</span> bookings in 90 days</p>
        </div>
      </div>
      {insights.totalBookings90d === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">
          No first-party event booking conversions have been captured yet.
        </p>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-3">
          <InsightList title="Top categories" items={insights.topCategories90d} />
          <InsightList title="Top events" items={insights.topEvents90d} />
          <InsightList title="Top campaigns" items={insights.topCampaigns90d} />
        </div>
      )}
    </section>
  );
}

function InsightList({ title, items }: { title: string; items: CampaignDashboardModel['eventBookingInsights']['topEvents90d'] }) {
  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border bg-muted/30 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      </div>
      <div className="divide-y divide-border">
        {items.slice(0, 4).map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 px-3 py-2">
            <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {formatNumber(item.bookings)} / {formatNumber(item.tickets)} seats
            </p>
          </div>
        ))}
        {items.length === 0 && (
          <p className="px-3 py-3 text-sm text-muted-foreground">No data yet.</p>
        )}
      </div>
    </div>
  );
}

function CampaignComparison({ dashboard }: { dashboard: CampaignDashboardModel }) {
  return (
    <section className="rounded-xl border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Campaign comparison</h2>
        <p className="text-xs text-muted-foreground">Sorted by booking volume, then cost per booking.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1180px] w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
          <tbody className="divide-y divide-border">
            {[...dashboard.campaigns].sort(comparePerformanceRows).map((campaign) => (
              <tr key={campaign.id} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <Link href={`/campaigns/${campaign.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                    {campaign.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted-foreground capitalize">
                    {campaign.campaignKind} · {campaign.audienceMode === 'local_interests' ? 'Local + interests' : 'Local only'}
                  </p>
                </td>
                <td className="px-3 py-3"><Badge variant={STATUS_VARIANTS[campaign.status]}>{toTitleCase(campaign.status)}</Badge></td>
                <td className="px-3 py-3 text-xs text-muted-foreground">{campaign.metaStatus ?? 'Not synced'}</td>
                <MetricCell value={formatNumber(campaign.performance.conversions)} tone={getPerformanceTone('conversions', campaign.performance.conversions, dashboard.campaigns.map((item) => item.performance))} />
                <MetricCell value={formatCurrency(campaign.performance.costPerConversion)} tone={getPerformanceTone('costPerConversion', campaign.performance.costPerConversion, dashboard.campaigns.map((item) => item.performance))} />
                <MetricCell value={formatPercentage(campaign.performance.conversionRate)} />
                <MetricCell value={formatCurrency(campaign.performance.spend)} />
                <MetricCell value={formatNumber(campaign.performance.clicks)} />
                <MetricCell value={formatPercentage(campaign.performance.ctr)} />
                <MetricCell value={formatCurrency(campaign.performance.cpc)} />
                <MetricCell value={formatNumber(campaign.performance.reach)} />
                <MetricCell value={formatNumber(campaign.performance.impressions)} />
                <td className="px-3 py-3 text-xs text-muted-foreground">{formatDateTime(campaign.lastSyncedAt)}</td>
                <td className="px-3 py-3 text-right"><DeleteCampaignButton campaignId={campaign.id} campaignName={campaign.name} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BestAds({ dashboard }: { dashboard: CampaignDashboardModel }) {
  return (
    <section className="rounded-xl border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Best ads</h2>
        <p className="text-xs text-muted-foreground">Ranked by bookings, then cost per booking.</p>
      </div>
      {dashboard.bestAds.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">No ad performance has synced yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {dashboard.bestAds.map((ad, index) => (
            <Link key={ad.id} href={`/campaigns/${ad.campaignId}`} className="block px-4 py-3 hover:bg-muted/30">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={index === 0 ? 'success' : 'muted'}>#{index + 1}</Badge>
                    <p className="truncate text-sm font-semibold text-foreground">{ad.name}</p>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{ad.campaignName}</p>
                </div>
                <div className="text-right text-xs tabular-nums">
                  <p className="font-semibold text-foreground">{formatNumber(ad.performance.conversions)} bookings</p>
                  <p className="text-muted-foreground">{formatCurrency(ad.performance.costPerConversion)} CPA</p>
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
    <section className="rounded-xl border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Ad set and ad performance</h2>
        <p className="text-xs text-muted-foreground">Ad sets stay in campaign phase order. Ads are ranked inside each ad set.</p>
      </div>
      <div className="divide-y divide-border">
        {activeCampaigns.map((campaign) => (
          <div key={campaign.id} className="px-4 py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <Link href={`/campaigns/${campaign.id}`} className="font-semibold text-foreground hover:text-primary hover:underline">
                {campaign.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {formatNumber(campaign.performance.conversions)} bookings · {formatCurrency(campaign.performance.spend)} spend
              </span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {campaign.adSets.map((adSet) => (
                <AdSetMiniMatrix key={adSet.id} adSet={adSet} />
              ))}
              {campaign.adSets.length === 0 && (
                <p className="text-sm text-muted-foreground">No ad sets found.</p>
              )}
            </div>
          </div>
        ))}
        {activeCampaigns.length === 0 && (
          <p className="px-4 py-5 text-sm text-muted-foreground">No active campaigns to compare yet.</p>
        )}
      </div>
    </section>
  );
}

function AdSetMiniMatrix({ adSet }: { adSet: AdSet }) {
  const sortedAds = sortAdsByPerformance(adSet.ads ?? []);
  const context = sortedAds.map((ad) => ad.performance);

  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border bg-muted/30 px-3 py-2">
        <p className="truncate text-sm font-semibold text-foreground">{adSet.name}</p>
        <p className="text-xs text-muted-foreground">
          {adSet.phaseStart ?? 'No start'} · {formatNumber(adSet.performance.conversions)} bookings · {formatCurrency(adSet.performance.spend)}
        </p>
      </div>
      <div className="divide-y divide-border">
        {sortedAds.slice(0, 4).map((ad, index) => (
          <div key={ad.id} className={`grid grid-cols-[minmax(0,1fr),auto,auto] items-center gap-3 px-3 py-2 ${index === 0 && (ad.performance.conversions > 0 || ad.performance.clicks > 0) ? 'border-l-4 border-l-emerald-400 bg-emerald-50/60' : 'border-l-4 border-l-transparent'}`}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{ad.name}</p>
              <p className="truncate text-xs text-muted-foreground">{ad.headline}</p>
            </div>
            <span className={metricPill(getPerformanceTone('conversions', ad.performance.conversions, context))}>
              {formatNumber(ad.performance.conversions)}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(ad.performance.costPerConversion)}</span>
          </div>
        ))}
        {sortedAds.length === 0 && (
          <p className="px-3 py-3 text-sm text-muted-foreground">No ads in this ad set.</p>
        )}
      </div>
    </div>
  );
}

function OptimisationHistory({ actions }: { actions: OptimisationActionSummary[] }) {
  return (
    <section className="rounded-xl border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Optimisation history</h2>
        <p className="text-xs text-muted-foreground">Automatic actions applied after performance sync.</p>
      </div>
      {actions.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">No automatic optimisation actions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-3 py-3 text-left">Campaign</th>
                <th className="px-3 py-3 text-left">Ad</th>
                <th className="px-3 py-3 text-left">Status</th>
                <th className="px-3 py-3 text-left">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {actions.map((action) => (
                <tr key={action.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{actionLabel(action.actionType)}</p>
                    <p className="text-xs text-muted-foreground">{action.reason}</p>
                    {action.error && <p className="mt-1 text-xs text-red-600">{action.error}</p>}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{action.campaignName ?? 'Campaign'}</td>
                  <td className="px-3 py-3 text-muted-foreground">{action.adName ?? 'Ad'}</td>
                  <td className="px-3 py-3"><Badge variant={action.status === 'applied' ? 'success' : action.status === 'failed' ? 'destructive' : 'muted'}>{action.status}</Badge></td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{formatDateTime(action.appliedAt ?? action.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
  if (tone === 'best') return `${base} bg-emerald-100 font-semibold text-emerald-800`;
  if (tone === 'good') return `${base} bg-emerald-50 text-emerald-700`;
  if (tone === 'weak') return `${base} bg-rose-50 text-rose-700`;
  return `${base} text-foreground`;
}

function severityVariant(severity: DashboardAttentionSeverity): BadgeProps['variant'] {
  if (severity === 'critical') return 'destructive';
  if (severity === 'warning') return 'warning';
  return 'info';
}

function severityLabel(severity: DashboardAttentionSeverity) {
  if (severity === 'critical') return 'Critical';
  if (severity === 'warning') return 'Warning';
  return 'Check';
}

function actionLabel(actionType: OptimisationActionSummary['actionType']) {
  if (actionType === 'pause_ad') return 'Paused ad';
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
