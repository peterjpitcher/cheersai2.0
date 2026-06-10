// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FoodBookingSchedulePreview } from '@/features/campaigns/FoodBookingSchedulePreview';
import { DEFAULT_FOOD_SERVICE_HOURS } from '@/lib/campaigns/food-schedule';
import type { FoodAdWindow, FoodServiceHours } from '@/types/campaigns';

function window(overrides: Partial<FoodAdWindow> = {}): FoodAdWindow {
  return {
    serviceKey: 'sunday_roast',
    decisionStage: 'morning_commit',
    runDay: 'sunday',
    runDate: '2026-06-14',
    startsAtLocal: '08:30',
    endsAtLocal: '11:30',
    serviceDate: '2026-06-14',
    serviceDateOffsetDays: 0,
    budgetWeight: 30,
    copyIntent: 'Roasts served from 1pm today.',
    windowKey: 'sunday_roast_morning',
    enabled: true,
    ...overrides,
  };
}

const services: FoodServiceHours[] = [
  DEFAULT_FOOD_SERVICE_HOURS.weekday_dinner,
  DEFAULT_FOOD_SERVICE_HOURS.saturday_food,
  DEFAULT_FOOD_SERVICE_HOURS.sunday_roast,
];

describe('FoodBookingSchedulePreview', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders an empty state when there are no windows', () => {
    render(<FoodBookingSchedulePreview windows={[]} services={services} onToggle={vi.fn()} />);
    expect(screen.getByText(/no windows/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders a semantic table with one row per window showing local times, service, stage and weight', () => {
    render(
      <FoodBookingSchedulePreview
        windows={[
          window({ windowKey: 'sunday_roast_morning', startsAtLocal: '08:30', endsAtLocal: '11:30', budgetWeight: 30 }),
          window({
            windowKey: 'weekday_lunch_decision',
            serviceKey: 'weekday_dinner',
            decisionStage: 'lunch_decision',
            runDay: 'tuesday',
            runDate: '2026-06-09',
            startsAtLocal: '11:00',
            endsAtLocal: '13:30',
            budgetWeight: 55,
          }),
        ]}
        services={services}
        onToggle={vi.fn()}
      />,
    );

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    // Column headers use scope="col".
    const columnHeaders = within(table).getAllByRole('columnheader');
    expect(columnHeaders.length).toBeGreaterThan(0);
    columnHeaders.forEach((th) => expect(th).toHaveAttribute('scope', 'col'));

    // One body row per window.
    const rows = within(table).getAllByRole('row');
    // header row + 2 data rows
    expect(rows).toHaveLength(3);

    // Local start–end shown for each window.
    expect(within(table).getByText(/08:30/)).toBeInTheDocument();
    expect(within(table).getByText(/11:30/)).toBeInTheDocument();
    expect(within(table).getByText(/11:00/)).toBeInTheDocument();
    expect(within(table).getByText(/13:30/)).toBeInTheDocument();
    // Weight shown.
    expect(within(table).getByText(/55/)).toBeInTheDocument();
  });

  it('renders the toggle off for a disabled window', () => {
    render(
      <FoodBookingSchedulePreview
        windows={[window({ windowKey: 'weekday_last_minute', enabled: false })]}
        services={services}
        onToggle={vi.fn()}
      />,
    );
    const toggle = screen.getByRole('checkbox', { name: /weekday_last_minute/i });
    expect(toggle).not.toBeChecked();
  });

  it('calls onToggle(windowKey, next) when a toggle is operated', () => {
    const onToggle = vi.fn();
    render(
      <FoodBookingSchedulePreview
        windows={[window({ windowKey: 'sunday_roast_morning', enabled: false })]}
        services={services}
        onToggle={onToggle}
      />,
    );
    const toggle = screen.getByRole('checkbox', { name: /sunday_roast_morning/i });
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('sunday_roast_morning', true);
  });

  it('toggles are keyboard-operable (rendered as a real checkbox input)', () => {
    render(
      <FoodBookingSchedulePreview
        windows={[window({ windowKey: 'sunday_roast_morning' })]}
        services={services}
        onToggle={vi.fn()}
      />,
    );
    const toggle = screen.getByRole('checkbox', { name: /sunday_roast_morning/i });
    // Native checkbox inputs are inherently keyboard-focusable and Space-operable.
    expect(toggle.tagName).toBe('INPUT');
    expect(toggle).toHaveAttribute('type', 'checkbox');
  });

  it('shows a runs-late warning (with text, not colour alone) when a window ends after last orders', () => {
    // Sunday roast last orders default to 17:30; a window ending 18:00 runs late.
    render(
      <FoodBookingSchedulePreview
        windows={[window({ windowKey: 'sunday_roast_late', startsAtLocal: '11:30', endsAtLocal: '18:00' })]}
        services={services}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(/last orders/i)).toBeInTheDocument();
    // The warning carries an accessible role so it is not colour-only.
    expect(screen.getAllByRole('img', { hidden: true }).length).toBeGreaterThan(0);
  });

  it('does not show a runs-late warning when the window ends on or before last orders', () => {
    render(
      <FoodBookingSchedulePreview
        windows={[window({ windowKey: 'sunday_roast_morning', startsAtLocal: '08:30', endsAtLocal: '11:30' })]}
        services={services}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.queryByText(/last orders/i)).not.toBeInTheDocument();
  });

  it('shows a tracking-not-ready warning when conversionReady is false', () => {
    render(
      <FoodBookingSchedulePreview
        windows={[window()]}
        services={services}
        onToggle={vi.fn()}
        conversionReady={false}
      />,
    );
    expect(screen.getByText(/tracking/i)).toBeInTheDocument();
  });

  it('does not show a tracking warning when conversionReady is true (default)', () => {
    render(<FoodBookingSchedulePreview windows={[window()]} services={services} onToggle={vi.fn()} />);
    expect(screen.queryByText(/tracking/i)).not.toBeInTheDocument();
  });

  it('shows a budget-adequacy warning when budget per active window is below the threshold', () => {
    render(
      <FoodBookingSchedulePreview
        windows={[
          window({ windowKey: 'a', enabled: true }),
          window({ windowKey: 'b', enabled: true }),
          window({ windowKey: 'c', enabled: true }),
        ]}
        services={services}
        onToggle={vi.fn()}
        budgetAmount={6}
        budgetType="LIFETIME"
        minBudgetPerWindow={5}
      />,
    );
    expect(screen.getByText(/budget/i)).toBeInTheDocument();
  });

  it('does not show a budget warning when budget per active window meets the threshold', () => {
    render(
      <FoodBookingSchedulePreview
        windows={[window({ windowKey: 'a', enabled: true }), window({ windowKey: 'b', enabled: true })]}
        services={services}
        onToggle={vi.fn()}
        budgetAmount={100}
        budgetType="LIFETIME"
        minBudgetPerWindow={5}
      />,
    );
    expect(screen.queryByText(/below the recommended/i)).not.toBeInTheDocument();
  });

  it('counts only enabled windows for budget adequacy', () => {
    // 2 enabled windows, £20 lifetime => £10/window, above £5 threshold => no warning,
    // even though there are 4 windows total.
    render(
      <FoodBookingSchedulePreview
        windows={[
          window({ windowKey: 'a', enabled: true }),
          window({ windowKey: 'b', enabled: true }),
          window({ windowKey: 'c', enabled: false }),
          window({ windowKey: 'd', enabled: false }),
        ]}
        services={services}
        onToggle={vi.fn()}
        budgetAmount={20}
        budgetType="LIFETIME"
        minBudgetPerWindow={5}
      />,
    );
    expect(screen.queryByText(/below the recommended/i)).not.toBeInTheDocument();
  });
});
