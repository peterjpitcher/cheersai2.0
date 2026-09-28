import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Settings: the data-request line (decision P10) shows only to owners, and
// only while self-serve sign-up is on, so nothing changes before opening.
// Everything else on the page is stubbed out.

const mockSwitch = vi.fn<() => Promise<'open' | 'closed' | 'unavailable'>>(async () => 'open');
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: () => mockSwitch() }));

const mockAuth = vi.fn(async () => ({ features: { managementImport: false }, role: 'owner', supabase: {}, accountId: 'a1' }));
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: () => mockAuth() }));

vi.mock('@/components/layout/PageHeader', () => ({ PageHeader: () => null }));
vi.mock('@/features/settings/brand-voice-form', () => ({ BrandVoiceForm: () => null }));
vi.mock('@/features/settings/posting-defaults-form', () => ({ PostingDefaultsForm: () => null }));
vi.mock('@/features/settings/management-connection-form', () => ({ ManagementConnectionForm: () => null }));
vi.mock('@/features/settings/link-in-bio', () => ({ LinkInBioSettingsSection: () => null }));
vi.mock('@/features/settings/team-section', () => ({ TeamSection: () => null }));
vi.mock('@/features/settings/billing-section', () => ({ BillingSection: () => null }));
vi.mock('@/lib/link-in-bio/profile', () => ({ getLinkInBioProfileWithTiles: async () => ({ profile: null, tiles: [] }) }));
vi.mock('@/lib/library/data', () => ({ listMediaAssets: async () => [] }));
vi.mock('@/lib/management-app/data', () => ({ getManagementConnectionSummary: async () => null }));
vi.mock('@/lib/settings/data', () => ({ getOwnerSettings: async () => ({ brand: {}, posting: {} }) }));
vi.mock('@/app/(app)/settings/team-actions', () => ({ listTeam: async () => [], listTeamInvitations: async () => [] }));
vi.mock('@/lib/billing/overview', () => ({
  BILLING_TRIAL_DAYS: 14,
  billingPlanOptions: () => [],
  getBillingOverview: async () => ({ state: 'incomplete' }),
}));

const { default: SettingsPage } = await import('@/app/(app)/settings/page');

async function render(): Promise<string> {
  return renderToStaticMarkup(await SettingsPage({}));
}

const LINE = 'To close this venue or get a copy of your data, email';

beforeEach(() => {
  vi.clearAllMocks();
  mockSwitch.mockResolvedValue('open');
  mockAuth.mockResolvedValue({ features: { managementImport: false }, role: 'owner', supabase: {}, accountId: 'a1' });
});

describe('Settings: the data-request line (P10)', () => {
  it('tells an owner how to close the venue or get their data while sign-up is on', async () => {
    const html = await render();
    expect(html).toContain(LINE);
    expect(html).toContain('href="mailto:peter@orangejelly.co.uk"');
  });

  it('is not shown while the switch is off or cannot be read, so existing brands see no change', async () => {
    for (const state of ['closed', 'unavailable'] as const) {
      mockSwitch.mockResolvedValue(state);
      expect(await render(), state).not.toContain(LINE);
    }
  });

  it('is not shown to a member (owners handle closing and exports, D4)', async () => {
    mockAuth.mockResolvedValue({ features: { managementImport: false }, role: 'member', supabase: {}, accountId: 'a1' });
    expect(await render()).not.toContain(LINE);
  });
});
