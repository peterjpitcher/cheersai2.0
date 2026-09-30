import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <span data-alt={alt} data-src={src} />,
}));

const { AuthAside, AuthCard, AuthMessage } = await import('@/components/auth/auth-card');

function render(node: React.JSX.Element): string {
  return renderToStaticMarkup(node);
}

describe('AuthCard (the service pages in the homepage look)', () => {
  it('draws the ink band, the homepage logo linking home, the card title as the one h1, and the footer', () => {
    const html = render(
      <AuthCard title="Reset your password" description="We'll email you a link.">
        <p>form</p>
      </AuthCard>,
    );
    expect(html).toContain('bg-ink');
    expect(html).toContain('site-grid');
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*><span data-alt="Cheers home" data-src="\/brand\/cheers-logo-horizontal-on-dark.png"/);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('>Reset your password</h1>');
    expect(html).toContain('<main id="main"');
    for (const [href, label] of [
      ['/terms', 'Terms of Service'],
      ['/privacy', 'Privacy Notice'],
      ['/help', 'Help'],
    ]) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(`>${label}</a>`);
    }
  });

  it('centres the card and its glow when there is no panel', () => {
    const html = render(
      <AuthCard title="Title" description="Description">
        <p>form</p>
      </AuthCard>,
    );
    expect(html).toContain('site-glow-centre');
    expect(html).not.toMatch(/class="site-glow /);
    expect(html).toContain('max-w-[440px]');
  });

  it('puts a panel beside the card from lg, hidden below it, with the homepage glow', () => {
    const html = render(
      <AuthCard title="Title" description="Description" aside={<p>panel words</p>}>
        <p>form</p>
      </AuthCard>,
    );
    expect(html).toMatch(/class="site-glow /);
    expect(html).not.toContain('site-glow-centre');
    expect(html).toContain('<div class="hidden lg:block"><p>panel words</p></div>');
  });

  it('widens the card on request', () => {
    const html = render(
      <AuthCard wide title="Invitations" description="Signed in">
        <p>list</p>
      </AuthCard>,
    );
    expect(html).toContain('max-w-[560px]');
  });
});

describe('AuthAside', () => {
  it('is not a heading, so the card title stays the page h1', () => {
    const html = render(
      <AuthAside eyebrow="Eyebrow" title="Big words" accent="in orange" intro="Intro" points={['One', 'Two']} note="Small print" />,
    );
    expect(html).not.toMatch(/<h[1-6]/);
    expect(html).toContain('<span class="block text-orange">in orange</span>');
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain('Small print');
  });
});

describe('AuthMessage', () => {
  it('announces errors as alerts and successes as status', () => {
    expect(render(<AuthMessage tone="error">No</AuthMessage>)).toContain('role="alert"');
    expect(render(<AuthMessage tone="success">Yes</AuthMessage>)).toContain('role="status"');
  });
});
