/**
 * The sign-in page's "Don't have an account?" line follows the sign-up switch,
 * like the homepage's call to action, and the form never waits on the read.
 */
import { isValidElement, Suspense, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSelfServeSignupSwitch: vi.fn() }));
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: mocks.getSelfServeSignupSwitch }));
vi.mock('@/lib/auth/actions', () => ({ sendMagicLink: vi.fn(), signInWithPassword: vi.fn() }));

const { default: LoginPage } = await import('@/app/(auth)/login/page');
const { LoginForm } = await import('@/app/(auth)/login/login-form');
const { NoAccountLine } = await import('@/app/(auth)/login/no-account-line');

beforeEach(() => vi.clearAllMocks());

describe('the "Don\'t have an account?" line', () => {
  it('offers the free trial while sign-up is open', async () => {
    mocks.getSelfServeSignupSwitch.mockResolvedValue('open');
    const html = renderToStaticMarkup(await NoAccountLine());
    expect(html).toContain('href="/signup"');
    expect(html).toContain('Start your free trial');
    expect(html).not.toContain('mailto:');
  });

  it.each(['closed', 'enforcement_off', 'unavailable'])('offers an email to us while the switch is %s', async (state) => {
    mocks.getSelfServeSignupSwitch.mockResolvedValue(state);
    const html = renderToStaticMarkup(await NoAccountLine());
    expect(html).toContain('href="mailto:peter@orangejelly.co.uk"');
    expect(html).toContain('Contact support');
    expect(html).not.toContain('href="/signup"');
  });
});

/** The parent of every element in a tree, for finding where a component sits. */
function parentOf(tree: ReactNode, target: unknown): { type: unknown } | null {
  let found: { type: unknown } | null = null;
  const walk = (node: ReactNode, parent: { type: unknown } | null) => {
    if (Array.isArray(node)) return node.forEach((child) => walk(child, parent));
    if (!isValidElement(node)) return;
    if (node.type === target) found = parent;
    const props = node.props as { children?: ReactNode; noAccount?: ReactNode };
    walk(props.children, node as { type: unknown });
    walk(props.noAccount, node as { type: unknown });
  };
  walk(tree, null);
  return found;
}

describe('/login', () => {
  it('never waits on the switch read: only the line sits behind its own Suspense boundary', () => {
    mocks.getSelfServeSignupSwitch.mockReturnValue(new Promise(() => undefined));
    const page = LoginPage();
    expect(page.type).toBe(LoginForm);
    expect(mocks.getSelfServeSignupSwitch).not.toHaveBeenCalled();
    expect(parentOf(page, NoAccountLine)?.type).toBe(Suspense);
  });
});
