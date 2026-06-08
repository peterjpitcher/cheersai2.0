// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { foodBookingFlag } = vi.hoisted(() => ({ foodBookingFlag: { value: true } }));

vi.mock('@/env', () => ({
  env: { server: {}, client: {} },
  featureFlags: {
    get foodBooking() {
      return foodBookingFlag.value;
    },
  },
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

// CampaignTree is only used in the AI review step; stub to keep this test focused on the brief.
vi.mock('./CampaignTree', () => ({
  CampaignTree: () => <div data-testid="campaign-tree" />,
}));

import { CampaignBriefForm } from './CampaignBriefForm';

function selectFoodBooking() {
  fireEvent.click(screen.getByRole('button', { name: /food booking/i }));
}

describe('CampaignBriefForm — food booking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    foodBookingFlag.value = true;
  });

  afterEach(() => {
    cleanup();
  });

  it('hides the Food Booking kind when the feature flag is off', () => {
    foodBookingFlag.value = false;
    render(<CampaignBriefForm mediaLibrary={[]} />);
    expect(screen.queryByRole('button', { name: /food booking/i })).not.toBeInTheDocument();
    // Event and Evergreen remain.
    expect(screen.getByRole('button', { name: /^event$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^evergreen$/i })).toBeInTheDocument();
  });

  it('shows the Food Booking kind when the flag is on and reveals the food sub-form', () => {
    render(<CampaignBriefForm mediaLibrary={[]} />);
    selectFoodBooking();

    // Service pickers prefilled from defaults (one enable toggle per service).
    expect(screen.getByRole('checkbox', { name: /enable weekday dinner/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /enable saturday food/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /enable sunday roast/i })).toBeChecked();
    // Prefilled service hours (weekday dinner default start 16:00).
    expect((screen.getByLabelText(/weekday dinner start/i) as HTMLInputElement).value).toBe('16:00');
    // Booking URL field.
    expect(screen.getByLabelText(/booking url/i)).toBeInTheDocument();
    // Weeks defaults to 2.
    const weeks = screen.getByLabelText(/weeks/i) as HTMLSelectElement;
    expect(weeks.value).toBe('2');
    // Day weighting choice present.
    expect(screen.getByLabelText(/day weighting/i)).toBeInTheDocument();
  });

  it('renders the schedule preview once a start date is set', () => {
    render(<CampaignBriefForm mediaLibrary={[]} />);
    selectFoodBooking();

    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-06-09' } });

    // The preview table appears (Tuesday start => weekday windows generated).
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('builds a valid createFoodBookingCampaign input on submit (incl. windowOverrides from toggles)', async () => {
    createFoodBookingCampaignMock.mockResolvedValue({ campaignId: 'camp-123' });
    render(<CampaignBriefForm mediaLibrary={[]} />);
    selectFoodBooking();

    fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: 'Roast push' } });
    fireEvent.change(screen.getByLabelText(/campaign brief/i), {
      target: { value: 'Fill tables for Sunday roast and weekday dinner.' },
    });
    fireEvent.change(screen.getByLabelText(/booking url/i), {
      target: { value: 'https://book.example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^budget$/i), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-06-09' } });

    // Toggle one default-off rescue window ON to produce a windowOverrides entry.
    const rescue = screen.getByRole('checkbox', { name: /weekday_last_minute/i });
    expect(rescue).not.toBeChecked();
    fireEvent.click(rescue);

    fireEvent.click(screen.getByRole('button', { name: /create campaign/i }));

    await waitFor(() => expect(createFoodBookingCampaignMock).toHaveBeenCalledTimes(1));

    const input = createFoodBookingCampaignMock.mock.calls[0][0];
    expect(input.promotionName).toBe('Roast push');
    expect(input.problemBrief).toContain('Sunday roast');
    expect(input.brief.bookingUrl).toBe('https://book.example.com');
    expect(input.brief.weeks).toBe(2);
    expect(input.brief.services.length).toBeGreaterThan(0);
    expect(input.budgetAmount).toBe(40);
    expect(input.startDate).toBe('2026-06-09');
    expect(input.windowOverrides).toMatchObject({ weekday_last_minute: true });
    expect(input.audienceMode).toBe('local_only');

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/campaigns/camp-123'));
  });

  it('disables submit while a booking URL is missing', () => {
    render(<CampaignBriefForm mediaLibrary={[]} />);
    selectFoodBooking();

    fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: 'Roast push' } });
    fireEvent.change(screen.getByLabelText(/campaign brief/i), { target: { value: 'Fill tables.' } });
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-06-09' } });

    const submit = screen.getByRole('button', { name: /create campaign/i });
    expect(submit).toBeDisabled();
  });

  it('keeps the event flow intact (event kind still uses Generate Campaign)', () => {
    render(<CampaignBriefForm mediaLibrary={[]} />);
    // Default kind is event.
    expect(screen.getByRole('button', { name: /generate campaign/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create campaign/i })).not.toBeInTheDocument();
  });
});
