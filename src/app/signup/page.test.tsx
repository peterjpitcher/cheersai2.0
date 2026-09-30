import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = {
  server: { VERCEL_ENV: 'production' },
  client: { NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAAAsitekey', NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' },
};
vi.mock('@/env', () => ({ env: mockEnv }));

const mockSwitch = vi.fn<() => Promise<'open' | 'closed' | 'enforcement_off' | 'unavailable'>>(async () => 'open');
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: () => mockSwitch() }));

const mockGetUser = vi.fn(async () => ({ data: { user: null as { id: string } | null } }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: mockGetUser } }) }));

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/app/signup/actions', () => ({ requestSignup: vi.fn(), reportTurnstileWidgetFailure: vi.fn() }));

const { default: SignupPage, metadata } = await import('@/app/signup/page');
const { TurnstileFailureNotice } = await import('@/app/signup/signup-form');

async function render(): Promise<string> {
  return renderToStaticMarkup(await SignupPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.server.VERCEL_ENV = 'production';
  mockEnv.client.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '0x4AAAAAAAsitekey';
  mockSwitch.mockResolvedValue('open');
  mockGetUser.mockResolvedValue({ data: { user: null } });
});

describe('/signup', () => {
  it('is never indexed', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('asks for the email only, with the Turnstile check, while the switch is on', async () => {
    const html = await render();
    expect(html).toContain('Start your free trial');
    expect(html).toContain('name="email"');
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain('name="name"');
    expect(html).toContain('Email me a link');
    expect(html).toContain('needs JavaScript');
    expect(html).not.toContain('preview deployment');
  });

  it('puts the homepage trial words beside the form, and only beside the form', async () => {
    const { CLOSING, whatYouNeed } = await import('@/content/homepage');
    const escape = (text: string): string => renderToStaticMarkup(<>{text}</>);
    const html = await render();
    expect(html).toContain(escape(CLOSING.trialHeading));
    for (const line of whatYouNeed()) expect(html).toContain(escape(line));

    mockSwitch.mockResolvedValue('closed');
    expect(await render()).not.toContain(escape(CLOSING.trialHeading));
  });

  it('shows "Talk to us" and no form while the switch is off, cannot be read or is on without billing enforcement', async () => {
    for (const state of ['closed', 'enforcement_off', 'unavailable'] as const) {
      mockSwitch.mockResolvedValue(state);
      const html = await render();
      expect(html, state).toContain('Sign-up is not open yet');
      expect(html, state).toContain('mailto:peter@orangejelly.co.uk');
      expect(html, state).toContain('https://wa.me/447990587315');
      expect(html, state).not.toContain('name="email"');
    }
  });

  it('shows the form on a Vercel Preview for review, with a notice that requests are refused', async () => {
    mockEnv.server.VERCEL_ENV = 'preview';
    mockSwitch.mockResolvedValue('closed');
    const html = await render();
    expect(html).toContain('name="email"');
    expect(html).toContain('preview deployment');
  });

  it('shows no form when the Turnstile site key is missing', async () => {
    mockEnv.client.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '';
    const html = await render();
    expect(html).toContain('Sign-up is not available right now');
    expect(html).not.toContain('name="email"');
  });

  it('tells the visitor when the security check cannot load, with our email address as the way through', () => {
    const html = renderToStaticMarkup(<TurnstileFailureNotice />);
    expect(html).toContain('The security check could not load');
    expect(html).toContain('peter@orangejelly.co.uk');
    expect(html).toContain('role="alert"');
  });

  it('sends someone already signed in to the planner', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    await expect(SignupPage()).rejects.toMatchObject({ url: '/planner' });
  });
});
