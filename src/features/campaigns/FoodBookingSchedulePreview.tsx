'use client';

import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';

import { lastOrdersOrDefault } from '@/lib/campaigns/food-schedule';
import type { BudgetType, FoodAdWindow, FoodServiceHours, FoodServiceKey } from '@/types/campaigns';

/**
 * Default minimum recommended budget (in £) per active ad window. This is guidance for
 * spreading a single budget across many short windows — NOT a Meta-enforced minimum.
 * Callers can override via `minBudgetPerWindow`.
 */
export const DEFAULT_MIN_BUDGET_PER_WINDOW = 5;

const SERVICE_LABELS: Record<FoodServiceKey, string> = {
  weekday_dinner: 'Weekday dinner',
  saturday_food: 'Saturday food',
  sunday_roast: 'Sunday roast',
};

const DECISION_STAGE_LABELS: Record<FoodAdWindow['decisionStage'], string> = {
  planning: 'Planning',
  lunch_decision: 'Lunch decision',
  afternoon_commit: 'Afternoon commit',
  tomorrow: 'Tomorrow',
  morning_commit: 'Morning commit',
  last_tables: 'Last tables',
  last_minute: 'Last minute',
};

const RUN_DAY_LABELS: Record<FoodAdWindow['runDay'], string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

export interface FoodBookingSchedulePreviewProps {
  /** Windows derived from the brief via calculateFoodBookingPhases. */
  windows: FoodAdWindow[];
  /** Service hours used to compute each service's last-orders time for the runs-late check. */
  services: FoodServiceHours[];
  /** Lift toggle state to the parent: an entry feeds windowOverrides keyed by windowKey. */
  onToggle: (windowKey: string, next: boolean) => void;
  /** Whether Meta conversion tracking is ready. When false a warning is shown. Default true. */
  conversionReady?: boolean;
  /** Total campaign budget (£) used for the per-window budget-adequacy check. */
  budgetAmount?: number;
  /** Budget cadence; affects how the adequacy hint is phrased. */
  budgetType?: BudgetType;
  /** Minimum recommended budget (£) per active window. Defaults to DEFAULT_MIN_BUDGET_PER_WINDOW. */
  minBudgetPerWindow?: number;
}

function formatRunDate(runDate: string): string {
  // runDate is a London-local 'YYYY-MM-DD'; render day + short month without timezone drift.
  const [year, month, day] = runDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  const monthLabel = date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${day} ${monthLabel}`;
}

function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 px-3 py-2 text-xs"
      style={{
        borderRadius: 'var(--r-md)',
        border: '1px solid var(--c-claret-soft)',
        backgroundColor: 'var(--c-claret-soft)',
        color: 'var(--c-claret)',
      }}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function FoodBookingSchedulePreview({
  windows,
  services,
  onToggle,
  conversionReady = true,
  budgetAmount,
  budgetType,
  minBudgetPerWindow = DEFAULT_MIN_BUDGET_PER_WINDOW,
}: FoodBookingSchedulePreviewProps) {
  const lastOrdersByService = useMemo(() => {
    const map = new Map<FoodServiceKey, string>();
    for (const service of services) {
      map.set(service.serviceKey, lastOrdersOrDefault(service));
    }
    return map;
  }, [services]);

  const activeWindowCount = useMemo(
    () => windows.filter((window) => window.enabled).length,
    [windows],
  );

  const budgetPerWindow =
    typeof budgetAmount === 'number' && activeWindowCount > 0
      ? budgetAmount / activeWindowCount
      : null;

  const showBudgetWarning =
    budgetPerWindow !== null && budgetPerWindow < minBudgetPerWindow;

  if (windows.length === 0) {
    return (
      <div
        className="px-4 py-6 text-center text-sm"
        style={{
          borderRadius: 'var(--r-xl)',
          border: '1px dashed var(--c-line)',
          backgroundColor: 'var(--c-paper)',
          color: 'var(--c-ink-3)',
        }}
      >
        No windows generated yet. Pick at least one service and a start date to preview the schedule.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!conversionReady && (
        <WarningBanner>
          Conversion tracking is not ready. Set up your Meta pixel and booking conversion event in
          Connections before publishing, or these ads cannot optimise for bookings.
        </WarningBanner>
      )}

      {showBudgetWarning && (
        <WarningBanner>
          This {budgetType === 'DAILY' ? 'daily' : 'total'} budget is below the recommended £
          {minBudgetPerWindow} per active window ({activeWindowCount} active). Increase the budget or
          turn off some windows so each has enough spend to deliver.
        </WarningBanner>
      )}

      <div className="overflow-x-auto" style={{ borderRadius: 'var(--r-xl)', border: '1px solid var(--c-line)' }}>
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Food booking ad windows</caption>
          <thead>
            <tr style={{ backgroundColor: 'var(--c-paper)' }}>
              <th scope="col" className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--c-ink-3)' }}>
                Active
              </th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--c-ink-3)' }}>
                Service
              </th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--c-ink-3)' }}>
                Stage
              </th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--c-ink-3)' }}>
                When
              </th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--c-ink-3)' }}>
                Time
              </th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--c-ink-3)' }}>
                Weight
              </th>
            </tr>
          </thead>
          <tbody>
            {windows.map((window) => {
              const lastOrders = lastOrdersByService.get(window.serviceKey);
              const runsLate = lastOrders !== undefined && window.endsAtLocal > lastOrders;
              const serviceLabel = SERVICE_LABELS[window.serviceKey];

              return (
                <tr key={window.windowKey} style={{ borderTop: '1px solid var(--c-line)' }}>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      checked={window.enabled}
                      onChange={(event) => onToggle(window.windowKey, event.target.checked)}
                      aria-label={`Enable window ${window.windowKey}`}
                      className="h-4 w-4 cursor-pointer"
                      style={{ accentColor: 'var(--c-orange)' }}
                    />
                  </td>
                  <td className="px-3 py-2 align-top" style={{ color: 'var(--c-ink)' }}>
                    {serviceLabel}
                  </td>
                  <td className="px-3 py-2 align-top" style={{ color: 'var(--c-ink-2)' }}>
                    {DECISION_STAGE_LABELS[window.decisionStage]}
                  </td>
                  <td className="px-3 py-2 align-top whitespace-nowrap" style={{ color: 'var(--c-ink-2)' }}>
                    {RUN_DAY_LABELS[window.runDay]} {formatRunDate(window.runDate)}
                  </td>
                  <td className="px-3 py-2 align-top whitespace-nowrap" style={{ color: 'var(--c-ink)' }}>
                    {window.startsAtLocal}–{window.endsAtLocal}
                    {runsLate && (
                      <span
                        className="mt-1 flex items-center gap-1 text-xs"
                        style={{ color: 'var(--c-claret)' }}
                      >
                        <AlertTriangle className="h-3 w-3 flex-shrink-0" role="img" aria-label="Warning" />
                        Runs past last orders ({lastOrders})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top tabular-nums" style={{ color: 'var(--c-ink-2)' }}>
                    {window.budgetWeight}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
