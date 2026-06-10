// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AiCampaignPayload } from '@/types/campaigns';
import { CampaignTree } from './CampaignTree';

vi.mock('./AdPreview', () => ({
  AdPreview: () => <div data-testid="ad-preview" />,
}));

type PayloadAdSet = AiCampaignPayload['ad_sets'][number];

function ad(overrides: Partial<PayloadAdSet['ads'][number]> = {}): PayloadAdSet['ads'][number] {
  return {
    name: 'Variation 1',
    headline: 'Book a table',
    primary_text: 'Book a table for dinner tonight.',
    description: 'Reserve now',
    cta: 'BOOK_NOW',
    creative_brief: 'Warm dinner scene',
    angle: 'Convenience',
    ...overrides,
  };
}

function adSet(overrides: Partial<PayloadAdSet> = {}): PayloadAdSet {
  return {
    name: 'Ad set',
    phase_label: 'Booking push',
    phase_start: '2026-06-14',
    phase_end: null,
    audience_description: 'Local diners',
    targeting: {} as PayloadAdSet['targeting'],
    placements: 'AUTO',
    optimisation_goal: 'OFFSITE_CONVERSIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    ads: [ad()],
    ...overrides,
  };
}

function payload(adSets: PayloadAdSet[]): AiCampaignPayload {
  return {
    objective: 'OUTCOME_SALES',
    rationale: 'Drive bookings',
    campaign_name: 'Food booking campaign',
    special_ad_category: 'NONE',
    ad_sets: adSets,
  };
}

describe('CampaignTree — food metadata', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows service, decision stage and local times for a food ad set', () => {
    const foodAdSet = {
      ...adSet({ phase_label: 'sunday_roast_morning' }),
      // Food metadata carried on the payload ad set (snake_case, mirrors persistence).
      service_key: 'sunday_roast',
      decision_stage: 'morning_commit',
      ads_start_time: '08:30',
      ads_stop_time: '11:30',
    } as PayloadAdSet;

    render(<CampaignTree payload={payload([foodAdSet])} onChange={vi.fn()} mediaLibrary={[]} />);

    // Open the ad set's centre panel.
    fireEvent.click(screen.getByText('sunday_roast_morning'));

    expect(screen.getByText(/Sunday roast/i)).toBeInTheDocument();
    expect(screen.getByText(/Morning commit/i)).toBeInTheDocument();
    expect(screen.getByText(/08:30/)).toBeInTheDocument();
    expect(screen.getByText(/11:30/)).toBeInTheDocument();
  });

  it('renders a non-food ad set unchanged (phase window, no service row)', () => {
    const eventAdSet = adSet({
      name: 'Awareness',
      phase_label: 'Early Awareness',
      phase_start: '2026-06-01',
      phase_end: '2026-06-05',
    });

    render(<CampaignTree payload={payload([eventAdSet])} onChange={vi.fn()} mediaLibrary={[]} />);

    fireEvent.click(screen.getByText('Early Awareness'));

    // The existing phase window rendering is intact.
    expect(screen.getByText(/Phase window/i)).toBeInTheDocument();
    // No food-specific service row appears.
    expect(screen.queryByText(/^Service$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Decision stage/i)).not.toBeInTheDocument();
  });
});
