/**
 * PublicPage (legal pages, Help Centre): the homepage's header and footer,
 * with the header's call to action behind its own Suspense boundary, so the
 * page never waits on the sign-up switch read.
 */
import { isValidElement, Suspense, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSelfServeSignupSwitch: vi.fn() }));
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: mocks.getSelfServeSignupSwitch }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span data-alt={alt} /> }));

const { PublicPage } = await import('@/features/marketing/public-page');
const { SiteHeader } = await import('@/features/marketing/site-header');

/** The first Suspense element in a tree. */
function findSuspense(node: ReactNode): ReactElement<{ fallback: ReactNode; children: ReactNode }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findSuspense(child);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === Suspense) return node as ReactElement<{ fallback: ReactNode; children: ReactNode }>;
  return findSuspense((node.props as { children?: ReactNode }).children);
}

/** Renders the header the Suspense boundary resolves to, as the server would once the switch is read. */
async function resolvedHeader(): Promise<string> {
  const boundary = findSuspense(PublicPage({ eyebrow: 'Legal', title: 'Terms', children: <p>Body</p> }));
  const child = boundary!.props.children as ReactElement<Record<string, unknown>>;
  const render = child.type as (props: Record<string, unknown>) => Promise<ReactElement>;
  return renderToStaticMarkup(await render(child.props));
}

beforeEach(() => vi.clearAllMocks());

describe('PublicPage', () => {
  it('never waits on the switch read: the header waits behind its own Suspense boundary, shown without a button', () => {
    mocks.getSelfServeSignupSwitch.mockReturnValue(new Promise(() => undefined));
    const page = PublicPage({ eyebrow: 'Legal', title: 'Terms of Service', children: <p>Body</p> });
    expect(mocks.getSelfServeSignupSwitch).not.toHaveBeenCalled();

    const boundary = findSuspense(page);
    expect(boundary).not.toBeNull();
    const fallback = boundary!.props.fallback as ReactElement<{ cta: unknown }>;
    expect(fallback.type).toBe(SiteHeader);
    expect(fallback.props.cta).toBeNull();
    const html = renderToStaticMarkup(fallback);
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('Start your free trial');
    expect(html).not.toContain('Talk to us');
  });

  it('shows the title as the page h1, the body and the site footer', () => {
    mocks.getSelfServeSignupSwitch.mockResolvedValue('closed');
    const html = renderToStaticMarkup(
      PublicPage({ eyebrow: 'Legal', title: 'Terms of Service', children: <p>The body</p> }),
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('>Terms of Service</h1>');
    expect(html).toContain('<main id="main">');
    expect(html).toContain('The body');
    expect(html).toContain('company number 10537179');
    expect(html).toContain('Built and maintained by <a href="https://www.orangejelly.co.uk/"');
  });

  it('offers the free trial in the header while sign-up is open', async () => {
    mocks.getSelfServeSignupSwitch.mockResolvedValue('open');
    const html = await resolvedHeader();
    expect(html).toContain('href="/signup"');
  });

  it.each(['closed', 'enforcement_off', 'unavailable'])('offers "Talk to us" in the header while the switch is %s', async (state) => {
    mocks.getSelfServeSignupSwitch.mockResolvedValue(state);
    const html = await resolvedHeader();
    expect(html).toContain('Talk to us');
    expect(html).not.toContain('href="/signup"');
  });
});
