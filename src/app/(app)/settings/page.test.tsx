import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Settings: the owner's "Download my data" and "Ask us to close this venue"
// (spec section 5, "Later (P10)", replacing P10's "email us" line) show only to
// owners, and only while self-serve sign-up is on, so nothing changes before
// opening. Everything else on the page is stubbed out.

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
vi.mock('@/app/(app)/settings/venue-data-actions', () => ({ requestVenueClosure: vi.fn() }));
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

const SECTION = 'Your data and closing this venue';
const OLD_LINE = 'To close this venue or get a copy of your data, email';

beforeEach(() => {
  vi.clearAllMocks();
  mockSwitch.mockResolvedValue('open');
  mockAuth.mockResolvedValue({ features: { managementImport: false }, role: 'owner', supabase: {}, accountId: 'a1' });
});

describe('Settings: the owner data section (spec section 5, Later (P10))', () => {
  it('offers an owner both actions while sign-up is on, in place of the "email us" line', async () => {
    const html = await render();
    expect(html).toContain(SECTION);
    expect(html).toContain('id="your-data"');
    expect(html).toContain('Download my data');
    expect(html).toContain('Ask us to close this venue');
    expect(html).toContain('3 times a day');
    expect(html).not.toContain(OLD_LINE);
  });

  it('is not shown while the switch is off or cannot be read, so existing brands see no change', async () => {
    for (const state of ['closed', 'unavailable'] as const) {
      mockSwitch.mockResolvedValue(state);
      const html = await render();
      expect(html, state).not.toContain(SECTION);
      expect(html, state).not.toContain('Download my data');
      expect(html, state).not.toContain('Ask us to close this venue');
    }
  });

  it('is not shown to a member (owners handle closing and exports, D4)', async () => {
    mockAuth.mockResolvedValue({ features: { managementImport: false }, role: 'member', supabase: {}, accountId: 'a1' });
    const html = await render();
    expect(html).not.toContain(SECTION);
    expect(html).not.toContain('Download my data');
  });
});
