'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  MousePointerClick,
  RefreshCw,
  Target,
  Trophy,
  Utensils,
  WandSparkles,
} from 'lucide-react';

import { featureFlags } from '@/env';
import {
  applyOptimisationRecommendationFormAction,
  runOptimiserFormAction,
  syncPerformanceFormAction,
} from '@/app/(app)/campaigns/actions';
import { Btn } from '@/components/ui/button';
import type {
  CampaignDashboardAttentionItem,
  CampaignDashboardDeliveryStatus,
  CampaignDashboardModel,
  DashboardAttentionSeverity,
} from '@/lib/campaigns/dashboard';
import {
  getPerformanceTone,
  sortAdsByPerformance,
  type PerformanceTone,
} from '@/lib/campaigns/performance-matrix';
import type {
  AdSet,
  CampaignPerformanceMetrics,
  OptimisationActionSummary,
} from '@/types/campaigns';
import { DeleteCampaignButton } from './DeleteCampaignButton';

interface CampaignDashboardProps {
  dashboard: CampaignDashboardModel;
}

type ActionTone = DashboardAttentionSeverity | 'success';

interface PrimaryAction {
  tone: ActionTone;
  title: string;
  detail: string;
  label: string;
  href?: string;
  form?: 'sync' | 'optimise';
}

interface WorkQueueItem {
  id: string;
  tone: DashboardAttentionSeverity;
  title: string;
  detail: string;
  campaignName?: string | null;
  href: string;
  actionLabel: string;
  createdAt?: Date;
}

const DELIVERY_STATUS_STYLES: Record<CampaignDashboardDeliveryStatus['kind'], { bg: string; fg: string }> = {
  draft: { bg: 'var(--c-status-draft-bg)', fg: 'var(--c-status-draft-fg)' },
  active: { bg: 'var(--c-status-posted-bg)', fg: 'var(--c-status-posted-fg)' },
  paused: { bg: 'var(--c-status-scheduled-bg)', fg: 'var(--c-status-scheduled-fg)' },
  attention: { bg: 'var(--c-orange-soft)', fg: 'var(--c-orange-hi)' },
  finished: { bg: 'var(--c-paper-2)', fg: 'var(--c-ink-3)' },
};

const TONE_STYLES: Record<ActionTone, { bg: string; fg: string; border: string }> = {
  critical: {
    bg: 'var(--c-claret-soft)',
    fg: 'var(--c-claret)',
    border: 'var(--c-claret-soft)',
  },
  warning: {
    bg: 'var(--c-orange-soft)',
    fg: 'var(--c-orange-hi)',
    border: 'var(--c-orange)',
  },
  info: {
    bg: 'var(--c-paper-2)',
    fg: 'var(--c-ink-2)',
    border: 'var(--c-line)',
  },
  success: {
    bg: 'var(--c-status-posted-bg)',
    fg: 'var(--c-status-posted-fg)',
    border: 'var(--c-status-posted-bg)',
  },
};

const SEVERITY_RANK: Record<DashboardAttentionSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function CampaignDashboard({ dashboard }: CampaignDashboardProps) {
  if (dashboard.campaigns.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-20 text-center"
        style={{
          borderRadius: 'var(--r-lg)',
          border: '2px dashed var(--c-line)',
        }}
      >
        <BarChart3 className="mb-3 h-8 w-8" style={{ color: 'var(--c-ink-3)' }} />
        <p className="text-lg font-semibold" style={{ color: 'var(--c-ink)' }}>
          No campaigns yet
        </p>
        <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-3)' }}>
          Create your first Meta paid media campaign to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SummaryMetrics dashboard={dashboard} />
      <CampaignScoreboard dashboard={dashboard} />
      <CommandCentre dashboard={dashboard} />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <ActionQueue dashboard={dashboard} />
        <PerformanceFocus dashboard={dashboard} />
      </section>

      <section className={featureFlags.foodBooking
        ? 'grid gap-5 xl:grid-cols-3'
        : 'grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]'}
      >
        <RecommendationsPanel actions={dashboard.optimisationActions} />
        <EventBookingInsightsPanel dashboard={dashboard} />
        {featureFlags.foodBooking ? <FoodBookingInsightsPanel dashboard={dashboard} /> : null}
      </section>

      <AdvancedPerformanceDetails dashboard={dashboard} />
      <OptimisationHistory actions={dashboard.optimisationActions} />
    </div>
  );
}

function CommandCentre({ dashboard }: { dashboard: CampaignDashboardModel }) {
  const action = getPrimaryAction(dashboard);
  const styles = TONE_STYLES[action.tone];

  return (
    <section
      className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto]"
      style={{
        borderRadius: 'var(--r-lg)',
        border: `1px solid ${styles.border}`,
        backgroundColor: 'var(--c-card)',
      }}
    >
      <div className="flex min-w-0 gap-3">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center"
          style={{
            borderRadius: 'var(--r-md)',
            backgroundColor: styles.bg,
            color: styles.fg,
          }}
        >
          {action.tone === 'success' ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            <AlertTriangle className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--c-ink-3)' }}>
            Next action
          </p>
          <h2 className="mt-1 text-xl font-semibold leading-tight" style={{ color: 'var(--c-ink)' }}>
            {action.title}
          </h2>
          <p className="mt-1 max-w-3xl text-sm" style={{ color: 'var(--c-ink-3)' }}>
            {action.detail}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <PrimaryActionButton action={action} />
        <form action={syncPerformanceFormAction}>
          <Btn type="submit" variant="outline" size="sm" icon={RefreshCw}>
            Sync
          </Btn>
        </form>
        <form action={runOptimiserFormAction}>
          <Btn type="submit" variant="outline" size="sm" icon={Target}>
            Optimise
          </Btn>
        </form>
      </div>
    </section>
  );
}

function PrimaryActionButton({ action }: { action: PrimaryAction }) {
  if (action.form === 'sync') {
    return (
      <form action={syncPerformanceFormAction}>
        <Btn type="submit" size="sm" icon={RefreshCw}>
          {action.label}
        </Btn>
      </form>
    );
  }

  if (action.form === 'optimise') {
    return (
      <form action={runOptimiserFormAction}>
        <Btn type="submit" size="sm" icon={WandSparkles}>
          {action.label}
        </Btn>
      </form>
    );
  }

  if (!action.href) return null;

  return (
    <Btn asChild size="sm">
      <Link href={action.href}>
        {action.label}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </Btn>
  );
}

function SummaryMetrics({ dashboard }: { dashboard: CampaignDashboardModel }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryMetric
        label="Bookings"
        value={formatNumber(dashboard.totals.conversions)}
        detail={formatBookingSourceDetail(dashboard.totals)}
        icon={<Trophy className="h-4 w-4" />}
      />
      <SummaryMetric
        label="Spend"
        value={formatCurrency(dashboard.totals.spend)}
        detail={`${formatNumber(dashboard.totals.clicks)} link clicks`}
        icon={<MousePointerClick className="h-4 w-4" />}
      />
      <SummaryMetric
        label="Reach"
        value={formatNumber(dashboard.totals.reach)}
        detail={`${formatNumber(dashboard.totals.impressions)} impressions`}
        icon={<Target className="h-4 w-4" />}
      />
      <SummaryMetric
        label="Campaign health"
        value={`${dashboard.totals.activeCampaigns} active`}
        detail={`${dashboard.totals.pausedCampaigns} paused, ${dashboard.totals.draftCampaigns} draft, ${dashboard.totals.finishedCampaigns} finished`}
        icon={<Activity className="h-4 w-4" />}
      />
    </section>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div
      className="flex min-h-28 items-center justify-between gap-4 p-4"
      style={{
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--c-ink-3)' }}>
          {label}
        </p>
        <p className="mt-1 truncate text-2xl font-semibold tabular-nums" style={{ color: 'var(--c-ink)' }}>
          {value}
        </p>
        <p className="mt-1 truncate text-xs" style={{ color: 'var(--c-ink-3)' }}>
          {detail}
        </p>
      </div>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center"
        style={{
          borderRadius: 'var(--r-md)',
          backgroundColor: 'var(--c-orange-soft)',
          color: 'var(--c-orange-hi)',
        }}
      >
        {icon}
      </span>
    </div>
  );
}

function ActionQueue({ dashboard }: { dashboard: CampaignDashboardModel }) {
  const items = getWorkQueueItems(dashboard);

  return (
    <section
      style={{
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <SectionHeader
        title="Action queue"
        detail={items.length ? `${items.length} item${items.length === 1 ? '' : 's'} to review` : 'No urgent campaign issues'}
        icon={<AlertTriangle className="h-4 w-4" />}
      />

      {items.length === 0 ? (
        <div className="px-4 py-6">
          <p className="text-sm font-medium" style={{ color: 'var(--c-ink)' }}>
            Campaigns are clear from the latest synced data.
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-3)' }}>
            Keep performance fresh or run the optimiser when new spend has accumulated.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--c-line)]">
          {items.slice(0, 8).map((item) => (
            <ActionQueueRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function ActionQueueRow({ item }: { item: WorkQueueItem }) {
  return (
    <Link
      href={item.href}
      className="grid gap-3 px-4 py-3 transition hover:bg-[var(--c-paper)] md:grid-cols-[minmax(0,1fr),auto]"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={item.tone} />
          {item.campaignName && (
            <span className="truncate text-xs" style={{ color: 'var(--c-ink-3)' }}>
              {item.campaignName}
            </span>
          )}
          {item.createdAt && (
            <span className="text-xs" style={{ color: 'var(--c-ink-4)' }}>
              {formatDateTime(item.createdAt)}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>
          {item.title}
        </p>
        <p className="mt-1 line-clamp-2 text-sm" style={{ color: 'var(--c-ink-3)' }}>
          {item.detail}
        </p>
      </div>
      <span className="inline-flex items-center gap-1 self-center text-sm font-semibold" style={{ color: 'var(--c-orange-hi)' }}>
        {item.actionLabel}
        <ArrowUpRight className="h-4 w-4" />
      </span>
    </Link>
  );
}

function PerformanceFocus({ dashboard }: { dashboard: CampaignDashboardModel }) {
  const openCampaigns = dashboard.campaigns.filter((campaign) => !campaign.deliveryStatus.finished);
  const campaignContext = openCampaigns.length > 0 ? openCampaigns : dashboard.campaigns;
  const topCampaign = [...campaignContext].sort(compareCampaignPerformance)[0] ?? null;
  const bestAd = dashboard.bestAds[0] ?? null;
  const hasBookings = (dashboard.totals.blendedBookings ?? dashboard.totals.conversions) > 0;

  return (
    <section
      style={{
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <SectionHeader
        title="Performance focus"
        detail={hasBookings ? 'Use this to decide where to scale or copy learning from.' : 'Waiting for tracked bookings.'}
        icon={<Trophy className="h-4 w-4" />}
      />

      <div className="space-y-4 p-4">
        {topCampaign ? (
          <FocusBlock
            label="Top campaign"
            href={`/campaigns/${topCampaign.id}`}
            title={topCampaign.name}
            metrics={[
              ['Bookings', formatBookingMetric(topCampaign.performance)],
              ['Cost/booking', formatCostPerBooking(topCampaign.performance)],
              ['Spend', formatCurrency(topCampaign.performance.spend)],
            ]}
          />
        ) : null}

        {bestAd ? (
          <FocusBlock
            label="Best ad"
            href={`/campaigns/${bestAd.campaignId}`}
            title={bestAd.name}
            detail={bestAd.headline}
            metrics={[
              ['Bookings', formatNumber(bestAd.performance.conversions)],
              ['Cost/booking', formatCostPerBooking(bestAd.performance)],
              ['Campaign', bestAd.campaignName],
            ]}
          />
        ) : (
          <div className="rounded-md border border-dashed border-[var(--c-line)] px-3 py-4">
            <p className="text-sm font-medium" style={{ color: 'var(--c-ink)' }}>
              No ad-level winner yet
            </p>
            <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-3)' }}>
              Sync performance after ads have spent to surface a winning creative.
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <MiniStat label="30d bookings" value={formatNumber(dashboard.eventBookingInsights.totalBookings30d)} />
          <MiniStat label="90d bookings" value={formatNumber(dashboard.eventBookingInsights.totalBookings90d)} />
          <MiniStat label="90d value" value={formatCurrency(dashboard.eventBookingInsights.totalValue90d)} />
        </div>
      </div>
    </section>
  );
}

function FocusBlock({
  label,
  title,
  detail,
  href,
  metrics,
}: {
  label: string;
  title: string;
  detail?: string;
  href: string;
  metrics: Array<[string, string]>;
}) {
  return (
    <div className="rounded-md border border-[var(--c-line)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--c-ink-3)' }}>
            {label}
          </p>
          <Link href={href} className="mt-1 block truncate text-sm font-semibold hover:underline" style={{ color: 'var(--c-ink)' }}>
            {title}
          </Link>
          {detail && (
            <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--c-ink-3)' }}>
              {detail}
            </p>
          )}
        </div>
        <Link href={href} aria-label={`Open ${title}`} className="shrink-0 p-1" style={{ color: 'var(--c-ink-3)' }}>
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>

      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        {metrics.map(([metricLabel, value]) => (
          <div key={metricLabel}>
            <dt className="text-[11px]" style={{ color: 'var(--c-ink-3)' }}>
              {metricLabel}
            </dt>
            <dd className="truncate text-sm font-semibold tabular-nums" style={{ color: 'var(--c-ink)' }}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[var(--c-paper)] px-3 py-2">
      <p className="text-[11px]" style={{ color: 'var(--c-ink-3)' }}>
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold tabular-nums" style={{ color: 'var(--c-ink)' }}>
        {value}
      </p>
    </div>
  );
}

function CampaignScoreboard({ dashboard }: { dashboard: CampaignDashboardModel }) {
  const [showFinished, setShowFinished] = useState(false);
  const sortedCampaigns = [...dashboard.campaigns].sort(compareCampaignScoreboard);
  const openCampaigns = sortedCampaigns.filter((campaign) => !campaign.deliveryStatus.finished);
  const finishedCampaigns = sortedCampaigns.filter((campaign) => campaign.deliveryStatus.finished);
  const campaigns = showFinished ? sortedCampaigns : openCampaigns;
  const performanceContext = campaigns.map((campaign) => campaign.performance);

  return (
    <section
      style={{
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <SectionHeader
        title="Campaign scoreboard"
        detail="Active Meta campaigns first, sorted by bookings and cost efficiency."
        icon={<BarChart3 className="h-4 w-4" />}
        trailing={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
              {campaigns.length} of {sortedCampaigns.length}
            </span>
            {finishedCampaigns.length > 0 && (
              <Btn
                type="button"
                variant="outline"
                size="sm"
                icon={Archive}
                aria-pressed={showFinished}
                onClick={() => setShowFinished((value) => !value)}
              >
                {showFinished ? 'Hide finished' : `Show finished (${finishedCampaigns.length})`}
              </Btn>
            )}
          </div>
        }
      />

      {campaigns.length === 0 ? (
        <div className="px-4 py-8">
          <p className="text-sm font-medium" style={{ color: 'var(--c-ink)' }}>
            No active campaigns are running right now.
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-3)' }}>
            {finishedCampaigns.length > 0
              ? 'Use the finished campaign view to review past performance.'
              : 'Create or publish a campaign to start tracking Meta performance.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[920px] w-full text-sm">
            <thead>
              <tr
                className="text-xs font-semibold uppercase"
                style={{
                  borderBottom: '1px solid var(--c-line)',
                  backgroundColor: 'var(--c-paper)',
                  color: 'var(--c-ink-3)',
                }}
              >
                <th className="px-4 py-3 text-left">Campaign</th>
                <th className="px-3 py-3 text-left">Status</th>
                <th className="px-3 py-3 text-right">Bookings</th>
                <th className="px-3 py-3 text-right">Cost/booking</th>
                <th className="px-3 py-3 text-right">Spend</th>
                <th className="px-3 py-3 text-right">CTR</th>
                <th className="px-3 py-3 text-left">Last sync</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {campaigns.map((campaign) => {
                const topAd = campaign.topAd;

                return (
                  <tr key={campaign.id} className="transition hover:bg-[var(--c-paper)]">
                    <td className="px-4 py-3">
                      <Link href={`/campaigns/${campaign.id}`} className="font-semibold hover:underline" style={{ color: 'var(--c-ink)' }}>
                        {campaign.name}
                      </Link>
                      <p className="mt-0.5 truncate text-xs capitalize" style={{ color: 'var(--c-ink-3)' }}>
                        {campaign.campaignKind} - {campaign.audienceMode === 'local_interests' ? 'Local + interests' : 'Local only'}
                        {topAd ? ` - top ad: ${topAd.name}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <DeliveryStatusBadge status={campaign.deliveryStatus} />
                      <p className="mt-1 text-xs" style={{ color: 'var(--c-ink-3)' }}>
                        {campaign.deliveryStatus.detail}
                      </p>
                    </td>
                    <MetricCell
                      value={formatBookingMetric(campaign.performance)}
                      tone={getPerformanceTone('conversions', campaign.performance.conversions, performanceContext)}
                    />
                    <MetricCell
                      value={formatCostPerBooking(campaign.performance)}
                      tone={getPerformanceTone('costPerConversion', campaign.performance.costPerConversion, performanceContext)}
                    />
                    <MetricCell value={formatCurrency(campaign.performance.spend)} />
                    <MetricCell value={formatPercentage(campaign.performance.ctr)} />
                    <td className="px-3 py-3 text-xs" style={{ color: 'var(--c-ink-3)' }}>
                      {formatDateTime(campaign.lastSyncedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`/campaigns/${campaign.id}`} className="text-xs font-semibold hover:underline" style={{ color: 'var(--c-orange-hi)' }}>
                          Open
                        </Link>
                        <DeleteCampaignButton campaignId={campaign.id} campaignName={campaign.name} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RecommendationsPanel({ actions }: { actions: OptimisationActionSummary[] }) {
  const planned = actions.filter((action) => action.status === 'planned');
  const recent = planned.length ? planned : actions.slice(0, 4);

  return (
    <section
      id="optimisation-history"
      style={{
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <SectionHeader
        title="Optimisation recommendations"
        detail={
          planned.length
            ? `${planned.length} recommendation${planned.length === 1 ? '' : 's'} waiting for approval`
            : 'Latest optimiser output'
        }
        icon={<WandSparkles className="h-4 w-4" />}
      />

      {recent.length === 0 ? (
        <div className="px-4 py-6">
          <p className="text-sm font-medium" style={{ color: 'var(--c-ink)' }}>
            No recommendations yet.
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-3)' }}>
            Run the optimiser after performance data has synced.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--c-line)]">
          {recent.map((action) => (
            <RecommendationItem key={action.id} action={action} />
          ))}
        </div>
      )}
    </section>
  );
}

function RecommendationItem({ action }: { action: OptimisationActionSummary }) {
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{
            backgroundColor:
              action.status === 'applied'
                ? 'var(--c-status-posted-bg)'
                : action.status === 'failed'
                  ? 'var(--c-claret-soft)'
                  : 'var(--c-paper-2)',
            color:
              action.status === 'applied'
                ? 'var(--c-status-posted-fg)'
                : action.status === 'failed'
                  ? 'var(--c-claret)'
                  : 'var(--c-ink-3)',
          }}
        >
          {action.status}
        </span>
        <p className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>
          {actionLabel(action.actionType)}
        </p>
        <span className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
          {action.campaignName ?? 'Campaign'}
          {action.adName ? ` - ${action.adName}` : ''}
        </span>
      </div>
      <p className="mt-1 text-sm" style={{ color: 'var(--c-ink-3)' }}>
        {action.reason}
      </p>
      <RecommendationPreview action={action} />
      {action.error && (
        <p className="mt-2 text-sm" style={{ color: 'var(--c-claret)' }}>
          {action.error}
        </p>
      )}
    </div>
  );
}

function EventBookingInsightsPanel({ dashboard }: { dashboard: CampaignDashboardModel }) {
  const insights = dashboard.eventBookingInsights;

  return (
    <section
      style={{
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <SectionHeader
        title="Booking insight"
        detail="First-party booking patterns for future campaign copy."
        icon={<Clock3 className="h-4 w-4" />}
      />

      {insights.totalBookings90d === 0 ? (
        <p className="px-4 py-6 text-sm" style={{ color: 'var(--c-ink-3)' }}>
          No first-party event booking conversions have been captured yet.
        </p>
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat label="Bookings" value={formatNumber(insights.totalBookings90d)} />
            <MiniStat label="Seats" value={formatNumber(insights.totalTickets90d)} />
            <MiniStat label="Value" value={formatCurrency(insights.totalValue90d)} />
          </div>
          <InsightList title="Top categories" items={insights.topCategories90d} />
          <InsightList title="Top events" items={insights.topEvents90d} />
          <InsightList title="Top campaigns" items={insights.topCampaigns90d} />
        </div>
      )}
    </section>
  );
}

function FoodBookingInsightsPanel({ dashboard }: { dashboard: CampaignDashboardModel }) {
  const insights = dashboard.foodBookingInsights;

  return (
    <section
      style={{
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <SectionHeader
        title="Food booking insight"
        detail="Table bookings by service, decision stage, and ad window."
        icon={<Utensils className="h-4 w-4" />}
      />

      {insights.totalBookings90d === 0 ? (
        <p className="px-4 py-6 text-sm" style={{ color: 'var(--c-ink-3)' }}>
          No first-party table booking conversions have been captured yet.
        </p>
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <MiniStat label="Tables" value={formatNumber(insights.totalBookings90d)} />
            <MiniStat label="Value" value={formatCurrency(insights.totalValue90d)} />
            <MiniStat
              label="Cost/table"
              value={insights.costPerTableBooking === null
                ? 'No spend yet'
                : formatCurrency(insights.costPerTableBooking)}
            />
            <MiniStat label="Sunday roast" value={formatNumber(insights.sundayRoastBookings90d)} />
          </div>
          <InsightList title="Top services" items={insights.topServices90d} />
          <InsightList title="Decision stages" items={insights.topDecisionStages90d} />
          <InsightList title="Ad windows" items={insights.topWindows90d} />
        </div>
      )}
    </section>
  );
}

type InsightListItem = {
  key: string;
  name: string;
  bookings: number;
  tickets?: number | null;
  costPerBooking?: number | null;
};

function InsightList({
  title,
  items,
}: {
  title: string;
  items: InsightListItem[];
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase" style={{ color: 'var(--c-ink-3)' }}>
        {title}
      </p>
      <div className="divide-y divide-[var(--c-line)] rounded-md border border-[var(--c-line)]">
        {items.slice(0, 4).map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 px-3 py-2">
            <p className="truncate text-sm font-medium" style={{ color: 'var(--c-ink)' }}>
              {item.name}
            </p>
            <p className="shrink-0 text-xs tabular-nums" style={{ color: 'var(--c-ink-3)' }}>
              {formatInsightListMetric(item)}
            </p>
          </div>
        ))}
        {items.length === 0 && (
          <p className="px-3 py-3 text-sm" style={{ color: 'var(--c-ink-3)' }}>
            No data yet.
          </p>
        )}
      </div>
    </div>
  );
}

function formatInsightListMetric(item: InsightListItem) {
  if (typeof item.tickets === 'number') {
    return `${formatNumber(item.bookings)} / ${formatNumber(item.tickets)} seats`;
  }
  if (typeof item.costPerBooking === 'number') {
    return `${formatNumber(item.bookings)} / ${formatCurrency(item.costPerBooking)}`;
  }
  return `${formatNumber(item.bookings)} bookings`;
}

function AdvancedPerformanceDetails({ dashboard }: { dashboard: CampaignDashboardModel }) {
  const activeCampaigns = dashboard.campaigns.filter((campaign) => campaign.deliveryStatus.active);

  return (
    <details
      style={{
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>
            Ad set and ad performance
          </p>
          <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
            Detailed matrix for active campaigns.
          </p>
        </div>
        <span className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
          {activeCampaigns.length} active
        </span>
      </summary>

      <div className="divide-y divide-[var(--c-line)] border-t border-[var(--c-line)]">
        {activeCampaigns.map((campaign) => (
          <div key={campaign.id} className="px-4 py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <Link href={`/campaigns/${campaign.id}`} className="font-semibold hover:underline" style={{ color: 'var(--c-ink)' }}>
                {campaign.name}
              </Link>
              <span className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
                {formatNumber(campaign.performance.conversions)} bookings - {formatCurrency(campaign.performance.spend)} spend
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {campaign.adSets.map((adSet) => (
                <AdSetMiniMatrix key={adSet.id} adSet={adSet} />
              ))}
              {campaign.adSets.length === 0 && (
                <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
                  No ad sets found.
                </p>
              )}
            </div>
          </div>
        ))}
        {activeCampaigns.length === 0 && (
          <p className="px-4 py-5 text-sm" style={{ color: 'var(--c-ink-3)' }}>
            No active campaigns to compare yet.
          </p>
        )}
      </div>
    </details>
  );
}

function AdSetMiniMatrix({ adSet }: { adSet: AdSet }) {
  const sortedAds = sortAdsByPerformance(adSet.ads ?? []);
  const context = sortedAds.map((ad) => ad.performance);

  return (
    <div className="rounded-md border border-[var(--c-line)]">
      <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--c-line)', backgroundColor: 'var(--c-paper)' }}>
        <p className="truncate text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>
          {adSet.name}
        </p>
        <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
          {adSet.phaseStart ?? 'No start'} - {formatNumber(adSet.performance.conversions)} bookings - {formatCurrency(adSet.performance.spend)}
        </p>
      </div>
      <div className="divide-y divide-[var(--c-line)]">
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
                <p className="truncate text-sm font-medium" style={{ color: 'var(--c-ink)' }}>
                  {ad.name}
                </p>
                <p className="truncate text-xs" style={{ color: 'var(--c-ink-3)' }}>
                  {ad.headline}
                </p>
              </div>
              <span className={metricPill(getPerformanceTone('conversions', ad.performance.conversions, context))}>
                {formatNumber(ad.performance.conversions)}
              </span>
              <span className="text-xs tabular-nums" style={{ color: 'var(--c-ink-3)' }}>
                {formatCostPerBooking(ad.performance)}
              </span>
            </div>
          );
        })}
        {sortedAds.length === 0 && (
          <p className="px-3 py-3 text-sm" style={{ color: 'var(--c-ink-3)' }}>
            No ads in this ad set.
          </p>
        )}
      </div>
    </div>
  );
}

function OptimisationHistory({ actions }: { actions: OptimisationActionSummary[] }) {
  if (actions.length === 0) return null;

  return (
    <details
      style={{
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
      }}
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>
            Full optimiser history
          </p>
          <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
            All recommendation runs and applied changes.
          </p>
        </div>
        <span className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
          {actions.length} entries
        </span>
      </summary>
      <div className="overflow-x-auto border-t" style={{ borderColor: 'var(--c-line)' }}>
        <table className="min-w-[940px] w-full text-sm">
          <thead>
            <tr
              className="text-xs font-semibold uppercase"
              style={{
                borderBottom: '1px solid var(--c-line)',
                backgroundColor: 'var(--c-paper)',
                color: 'var(--c-ink-3)',
              }}
            >
              <th className="px-4 py-3 text-left">Action</th>
              <th className="px-3 py-3 text-left">Campaign</th>
              <th className="px-3 py-3 text-left">Ad</th>
              <th className="px-3 py-3 text-left">Status</th>
              <th className="px-3 py-3 text-left">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--c-line)]">
            {actions.map((action) => (
              <tr key={action.id}>
                <td className="px-4 py-3">
                  <p className="font-medium" style={{ color: 'var(--c-ink)' }}>
                    {actionLabel(action.actionType)}
                  </p>
                  <p className="line-clamp-2 text-xs" style={{ color: 'var(--c-ink-3)' }}>
                    {action.reason}
                  </p>
                  {action.error && (
                    <p className="mt-1 text-xs" style={{ color: 'var(--c-claret)' }}>
                      {action.error}
                    </p>
                  )}
                </td>
                <td className="px-3 py-3" style={{ color: 'var(--c-ink-3)' }}>
                  {action.campaignName ?? 'Campaign'}
                </td>
                <td className="px-3 py-3" style={{ color: 'var(--c-ink-3)' }}>
                  {action.adName ?? 'Ad'}
                </td>
                <td className="px-3 py-3">
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{
                      backgroundColor:
                        action.status === 'applied'
                          ? 'var(--c-status-posted-bg)'
                          : action.status === 'failed'
                            ? 'var(--c-claret-soft)'
                            : 'var(--c-paper-2)',
                      color:
                        action.status === 'applied'
                          ? 'var(--c-status-posted-fg)'
                          : action.status === 'failed'
                            ? 'var(--c-claret)'
                            : 'var(--c-ink-3)',
                    }}
                  >
                    {action.status}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs" style={{ color: 'var(--c-ink-3)' }}>
                  {formatDateTime(action.appliedAt ?? action.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function RecommendationPreview({ action }: { action: OptimisationActionSummary }) {
  const proposed = readProposedCopy(action.recommendationPayload);
  if (action.actionType !== 'copy_rewrite' || !proposed) {
    return (
      <p className="mt-2 max-w-sm text-xs" style={{ color: 'var(--c-ink-3)' }}>
        {readRecommendationCategory(action.recommendationPayload)}
      </p>
    );
  }

  const current = readCurrentCopy(action.recommendationPayload);
  const confidence = readConfidence(action.recommendationPayload);

  return (
    <div className="mt-3 max-w-2xl space-y-2">
      {current && (
        <div className="rounded-md border border-[var(--c-line)] px-3 py-2">
          <p className="text-xs font-semibold" style={{ color: 'var(--c-ink-3)' }}>
            Current copy
          </p>
          <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--c-ink-3)' }}>
            {current.headline} - {current.primaryText}
          </p>
        </div>
      )}
      <div className="rounded-md bg-[var(--c-paper)] px-3 py-2">
        <p className="text-xs font-semibold" style={{ color: 'var(--c-ink)' }}>
          Proposed: {proposed.headline}
        </p>
        <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--c-ink-3)' }}>
          {proposed.primaryText}
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--c-ink-3)' }}>
          {proposed.description} - {proposed.cta}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {confidence !== null && (
          <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
            Confidence: {Math.round(confidence * 100)}%
          </p>
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
          <p className="text-xs" style={{ color: 'var(--c-status-posted-fg)' }}>
            Replacement ad created.
          </p>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  detail,
  icon,
  trailing,
}: {
  title: string;
  detail?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div
      className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
      style={{ borderBottom: '1px solid var(--c-line)' }}
    >
      <div className="flex min-w-0 gap-2">
        {icon && (
          <span className="mt-0.5 shrink-0" style={{ color: 'var(--c-orange-hi)' }}>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>
            {title}
          </h2>
          {detail && (
            <p className="mt-0.5 text-xs" style={{ color: 'var(--c-ink-3)' }}>
              {detail}
            </p>
          )}
        </div>
      </div>
      {trailing}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: DashboardAttentionSeverity }) {
  const styles = TONE_STYLES[severity];
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

function DeliveryStatusBadge({ status }: { status: CampaignDashboardDeliveryStatus }) {
  const styles = DELIVERY_STATUS_STYLES[status.kind];

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: styles.bg, color: styles.fg }}
    >
      {status.label}
    </span>
  );
}

function MetricCell({ value, tone = 'neutral' }: { value: string; tone?: PerformanceTone }) {
  return (
    <td className="px-3 py-3 text-right tabular-nums">
      <span className={metricPill(tone)}>{value}</span>
    </td>
  );
}

function getPrimaryAction(dashboard: CampaignDashboardModel): PrimaryAction {
  const sortedAttention = sortAttentionItems(dashboard.attentionItems);
  const critical = sortedAttention.find((item) => item.severity === 'critical');
  if (critical) {
    return {
      tone: 'critical',
      title: critical.title,
      detail: `${critical.campaignName}: ${critical.detail}`,
      label: 'Open campaign',
      href: critical.href,
    };
  }

  const plannedRecommendation = dashboard.optimisationActions.find((action) => action.status === 'planned');
  if (plannedRecommendation) {
    return {
      tone: plannedRecommendation.severity === 'critical' ? 'critical' : plannedRecommendation.severity === 'warning' ? 'warning' : 'info',
      title: actionLabel(plannedRecommendation.actionType),
      detail: plannedRecommendation.reason,
      label: 'Review recommendation',
      href: '#optimisation-history',
    };
  }

  const staleSyncs = sortedAttention.filter((item) => item.id.endsWith(':stale-sync'));
  if (staleSyncs.length > 0) {
    return {
      tone: 'warning',
      title: 'Performance data is stale',
      detail: `${staleSyncs.length} active campaign${staleSyncs.length === 1 ? '' : 's'} need fresh Meta performance data before decisions are reliable.`,
      label: 'Sync performance',
      form: 'sync',
    };
  }

  const warning = sortedAttention.find((item) => item.severity === 'warning');
  if (warning) {
    return {
      tone: 'warning',
      title: warning.title,
      detail: `${warning.campaignName}: ${warning.detail}`,
      label: 'Open campaign',
      href: warning.href,
    };
  }

  const draft = dashboard.campaigns.find((campaign) => campaign.deliveryStatus.kind === 'draft');
  if (dashboard.totals.activeCampaigns === 0 && draft) {
    return {
      tone: 'info',
      title: 'No active campaigns',
      detail: 'Review the saved draft and publish when creative, budget, and destination are ready.',
      label: 'Review draft',
      href: `/campaigns/${draft.id}`,
    };
  }

  if (dashboard.totals.activeCampaigns > 0) {
    return {
      tone: 'success',
      title: 'Campaigns are running cleanly',
      detail: 'No urgent issues are showing. Run the optimiser after meaningful spend or new booking data.',
      label: 'Run optimiser',
      form: 'optimise',
    };
  }

  return {
    tone: 'info',
    title: 'Create the next campaign',
    detail: 'There are no live campaigns to manage right now.',
    label: 'New campaign',
    href: '/campaigns/new',
  };
}

function getWorkQueueItems(dashboard: CampaignDashboardModel): WorkQueueItem[] {
  const attentionItems: WorkQueueItem[] = sortAttentionItems(dashboard.attentionItems).map((item) => ({
    id: item.id,
    tone: item.severity,
    title: item.title,
    detail: item.detail,
    campaignName: item.campaignName,
    href: item.href,
    actionLabel: item.severity === 'critical' ? 'Fix now' : 'Review',
  }));

  const recommendations: WorkQueueItem[] = dashboard.optimisationActions
    .filter((action) => action.status === 'planned')
    .map((action) => {
      const tone: DashboardAttentionSeverity =
        action.severity === 'critical' || action.severity === 'warning'
          ? action.severity
          : 'info';

      return {
        id: `recommendation:${action.id}`,
        tone,
        title: actionLabel(action.actionType),
        detail: action.reason,
        campaignName: action.campaignName,
        href: '#optimisation-history',
        actionLabel: 'Approve',
        createdAt: action.createdAt,
      };
    });

  return [...attentionItems, ...recommendations].sort((left, right) => {
    const severityDelta = SEVERITY_RANK[left.tone] - SEVERITY_RANK[right.tone];
    if (severityDelta !== 0) return severityDelta;
    return (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0);
  });
}

function sortAttentionItems(items: CampaignDashboardAttentionItem[]) {
  return [...items].sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]);
}

function compareCampaignPerformance(
  left: CampaignDashboardModel['campaigns'][number],
  right: CampaignDashboardModel['campaigns'][number],
) {
  const conversionDelta = right.performance.conversions - left.performance.conversions;
  if (conversionDelta !== 0) return conversionDelta;

  const leftCost = comparableCostPerBooking(left.performance);
  const rightCost = comparableCostPerBooking(right.performance);
  if (leftCost !== rightCost) return leftCost - rightCost;

  const activeDelta = Number(right.deliveryStatus.active) - Number(left.deliveryStatus.active);
  if (activeDelta !== 0) return activeDelta;

  return right.performance.clicks - left.performance.clicks;
}

function compareCampaignScoreboard(
  left: CampaignDashboardModel['campaigns'][number],
  right: CampaignDashboardModel['campaigns'][number],
) {
  const priorityDelta = left.deliveryStatus.priority - right.deliveryStatus.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return compareCampaignPerformance(left, right);
}

function comparableCostPerBooking(performance: CampaignPerformanceMetrics) {
  return performance.conversions > 0 ? performance.costPerConversion : Number.POSITIVE_INFINITY;
}

function metricPill(tone: PerformanceTone) {
  const base = 'inline-flex min-w-14 justify-end rounded-md px-2 py-1 text-xs tabular-nums';
  if (tone === 'best') return `${base} font-semibold metric-best`;
  if (tone === 'good') return `${base} metric-good`;
  if (tone === 'weak') return `${base} metric-weak`;
  return `${base} metric-neutral`;
}

function actionLabel(actionType: OptimisationActionSummary['actionType']) {
  if (actionType === 'pause_ad') return 'Pause recommendation';
  if (actionType === 'tracking_issue') return 'Booking blocker';
  if (actionType === 'copy_rewrite') return 'Copy rewrite';
  return actionType;
}

function formatNumber(value: number) {
  return value.toLocaleString('en-GB');
}

function formatCurrency(value: number) {
  return `£${value.toFixed(2)}`;
}

function formatCostPerBooking(performance: CampaignPerformanceMetrics) {
  if (performance.conversions <= 0) return 'No bookings yet';
  return `${formatCurrency(performance.costPerConversion)} cost/booking`;
}

function formatBookingMetric(performance: CampaignPerformanceMetrics) {
  const blended = performance.blendedBookings ?? performance.conversions;
  const meta = performance.metaConversions ?? performance.conversions;
  const firstParty = performance.firstPartyBookings ?? 0;

  if (firstParty > meta) {
    return `${formatNumber(blended)} (${formatNumber(firstParty)} first-party)`;
  }

  return formatNumber(blended);
}

function formatBookingSourceDetail(performance: CampaignPerformanceMetrics) {
  const meta = performance.metaConversions ?? performance.conversions;
  const firstParty = performance.firstPartyBookings ?? 0;
  const base = formatCostPerBooking(performance);

  if (firstParty > 0 || meta !== performance.conversions) {
    return `${base} | Meta ${formatNumber(meta)} / first-party ${formatNumber(firstParty)}`;
  }

  return base;
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
