// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Evergreen delivery schedule controls (tasks/SPEC-evergreen-delivery-schedule.md), modelled
// on campaign-brief-form.food.test.tsx.

vi.mock('@/env', () => ({
  env: { server: {}, client: {} },
  featureFlags: { foodBooking: true },
}));

const { pushMock, createFoodBookingCampaignMock, generateCampaignActionMock, saveAndPublishMock } =
  vi.hoisted(() => ({
    pushMock: vi.fn(),
    createFoodBookingCampaignMock: vi.fn(),
    generateCampaignActionMock: vi.fn(),
    saveAndPublishMock: vi.fn(),
  }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/components/providers/toast-provider', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

vi.mock('@/app/(app)/campaigns/actions', () => ({
  generateCampaignAction: (...args: unknown[]) => generateCampaignActionMock(...args),
  saveAndPublishCampaign: (...args: unknown[]) => saveAndPublishMock(...args),
  createFoodBookingCampaign: (...args: unknown[]) => createFoodBookingCampaignMock(...args),
}));

vi.mock('@/app/(app)/create/actions', () => ({
  listManagementEventOptions: vi.fn(),
  getManagementEventPrefill: vi.fn(),
}));

// CampaignTree is the copy editor on the review screen; stubbed to keep this test on the form.
vi.mock('./CampaignTree', () => ({
  CampaignTree: () => <div data-testid="campaign-tree" />,
}));

import { CampaignBriefForm } from './CampaignBriefForm';

const SCHEDULE_TOGGLE = /only deliver on chosen days and hours/i;

function selectKind(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function scheduleToggle() {
  return screen.getByRole('checkbox', { name: SCHEDULE_TOGGLE });
}

function fillEvergreenBrief() {
  selectKind(/^evergreen$/i);
  fireEvent.click(screen.getByRole('button', { name: /^local only$/i }));
  fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: 'Weekday Lunch' } });
  fireEvent.change(screen.getByLabelText(/campaign brief/i), {
    target: { value: 'Now serving lunch Tuesday to Friday, 12pm to 3pm.' },
  });
  fireEvent.change(screen.getByLabelText(/paid cta url/i), {
    target: { value: 'https://www.the-anchor.pub/lunch-and-dinner' },
  });
  fireEvent.change(screen.getByLabelText(/^budget$/i), { target: { value: '180' } });
  fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-09-15' } });
  fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: '2026-10-09' } });
}

function chooseLunchSchedule() {
  fireEvent.click(scheduleToggle());
  for (const day of ['Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
    fireEvent.click(screen.getByRole('checkbox', { name: day }));
  }
  fireEvent.change(screen.getByLabelText(/start hour/i), { target: { value: '9' } });
  fireEvent.change(screen.getByLabelText(/end hour/i), { target: { value: '14' } });
}

function generatedResult() {
  return {
    payload: {
      objective: 'OUTCOME_TRAFFIC',
      rationale: 'Launch weekday lunch.',
      campaign_name: 'Weekday Lunch',
      special_ad_category: 'NONE',
      ad_sets: [{
        name: 'Evergreen Test',
        phase_label: 'Evergreen Test',
        phase_start: '2026-09-15',
        phase_end: '2026-10-09',
        audience_description: 'Locals',
        targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
        placements: 'AUTO',
        optimisation_goal: 'LINK_CLICKS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        adset_media_asset_id: 'asset-1',
        ads: [{
          name: 'Burger lunch',
          headline: 'Lunch now served, Tue to Fri, 12 to 3',
          primary_text: 'Burgers from £11.',
          description: 'Book now',
          cta: 'BOOK_NOW',
          creative_brief: 'Burger on the table',
          angle: 'Launch',
        }],
      }],
    },
    destinationUrl: 'https://l.the-anchor.pub/ma-lunch',
    sourceSnapshot: { campaignKind: 'evergreen', shortCode: 'ma-lunch' },
    audienceInterestKeywords: [],
    resolvedInterests: [],
    interestResolutionWarning: null,
  };
}

describe('CampaignBriefForm: evergreen delivery schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('offers the schedule only for evergreen campaigns, off by default', () => {
    render(<CampaignBriefForm mediaLibrary={[]} />);

    // Event is the default kind.
    expect(screen.queryByRole('checkbox', { name: SCHEDULE_TOGGLE })).not.toBeInTheDocument();

    selectKind(/^evergreen$/i);
    expect(scheduleToggle()).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Monday' })).not.toBeInTheDocument();

    selectKind(/food booking/i);
    expect(screen.queryByRole('checkbox', { name: SCHEDULE_TOGGLE })).not.toBeInTheDocument();
  });

  it('shows seven day boxes, none ticked, and whole-hour selects when switched on', () => {
    render(<CampaignBriefForm mediaLibrary={[]} />);
    selectKind(/^evergreen$/i);
    fireEvent.click(scheduleToggle());

    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      expect(screen.getByRole('checkbox', { name: day })).not.toBeChecked();
    }
    const start = screen.getByLabelText(/start hour/i) as HTMLSelectElement;
    const end = screen.getByLabelText(/end hour/i) as HTMLSelectElement;
    expect(start.value).toBe('0');
    expect(end.value).toBe('24');
    expect(start.options).toHaveLength(24); // 00:00 to 23:00
    expect(end.options).toHaveLength(24); // 01:00 to midnight
    expect(Array.from(end.options).at(-1)?.textContent).toBe('midnight');
  });

  it('forces a total budget and disables Daily while the schedule is on', () => {
    render(<CampaignBriefForm mediaLibrary={[]} />);
    selectKind(/^evergreen$/i);
    fireEvent.click(screen.getByRole('button', { name: /^daily$/i }));
    expect(screen.getByRole('button', { name: /^daily$/i })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(scheduleToggle());

    expect(screen.getByRole('button', { name: /^total$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^daily$/i })).toBeDisabled();

    fireEvent.click(scheduleToggle());
    expect(screen.getByRole('button', { name: /^daily$/i })).toBeEnabled();
  });

  it('keeps Generate disabled until a delivery day is chosen, and says why', () => {
    render(<CampaignBriefForm mediaLibrary={[]} />);
    fillEvergreenBrief();
    expect(screen.getByRole('button', { name: /generate campaign/i })).toBeEnabled();

    fireEvent.click(scheduleToggle());

    expect(screen.getByRole('button', { name: /generate campaign/i })).toBeDisabled();
    expect(screen.getByText('Choose at least one delivery day.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Tuesday' }));
    expect(screen.getByRole('button', { name: /generate campaign/i })).toBeEnabled();
  });

  it('sends the schedule to generate and save, and shows it under Campaign checks', async () => {
    generateCampaignActionMock.mockResolvedValue(generatedResult());
    saveAndPublishMock.mockResolvedValue({ campaignId: 'camp-1' });
    render(<CampaignBriefForm mediaLibrary={[]} />);
    fillEvergreenBrief();
    chooseLunchSchedule();

    expect(screen.getByText('Ads will only show Tuesday to Friday, 09:00 to 14:00, UK time.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /generate campaign/i }));

    await waitFor(() => expect(generateCampaignActionMock).toHaveBeenCalledTimes(1));
    const lunch = { days: ['tuesday', 'wednesday', 'thursday', 'friday'], startHour: 9, endHour: 14 };
    expect(generateCampaignActionMock.mock.calls[0][0]).toMatchObject({
      campaignKind: 'evergreen',
      sourceType: 'custom_promotion',
      budgetType: 'LIFETIME',
      startDate: '2026-09-15',
      endDate: '2026-10-09',
      deliverySchedule: lunch,
    });

    // Review screen: the schedule sits under Campaign checks with the number of delivery days.
    expect(await screen.findByText(
      'Delivery: Tuesday to Friday, 09:00 to 14:00, UK time (16 delivery days in these dates)',
    )).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save & publish/i }));
    await waitFor(() => expect(saveAndPublishMock).toHaveBeenCalledTimes(1));
    expect(saveAndPublishMock.mock.calls[0][1]).toMatchObject({
      campaignKind: 'evergreen',
      budgetType: 'LIFETIME',
      deliverySchedule: lunch,
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/campaigns/camp-1'));
  });

  it('sends no schedule when the box is off', async () => {
    generateCampaignActionMock.mockResolvedValue(generatedResult());
    render(<CampaignBriefForm mediaLibrary={[]} />);
    fillEvergreenBrief();

    fireEvent.click(screen.getByRole('button', { name: /generate campaign/i }));

    await waitFor(() => expect(generateCampaignActionMock).toHaveBeenCalledTimes(1));
    expect(generateCampaignActionMock.mock.calls[0][0].deliverySchedule).toBeNull();
    await screen.findByText('AI rationale');
    expect(screen.queryByText(/^Delivery:/)).not.toBeInTheDocument();
  });

  it('clears the schedule when the campaign type changes', () => {
    render(<CampaignBriefForm mediaLibrary={[]} />);
    selectKind(/^evergreen$/i);
    chooseLunchSchedule();
    expect(screen.getByRole('checkbox', { name: 'Tuesday' })).toBeChecked();

    selectKind(/^event$/i);
    selectKind(/^evergreen$/i);

    expect(scheduleToggle()).not.toBeChecked();
    fireEvent.click(scheduleToggle());
    expect(screen.getByRole('checkbox', { name: 'Tuesday' })).not.toBeChecked();
    expect((screen.getByLabelText(/start hour/i) as HTMLSelectElement).value).toBe('0');
    expect((screen.getByLabelText(/end hour/i) as HTMLSelectElement).value).toBe('24');
  });
});
