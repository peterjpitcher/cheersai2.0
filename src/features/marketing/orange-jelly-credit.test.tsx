import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { FALLBACK_CREDIT } from '@/lib/marketing/orange-jelly-credit';

// tests/setup.ts stands the fallback line in for the credit in page tests; these test the real one.
vi.unmock('@/features/marketing/orange-jelly-credit');

const mocks = vi.hoisted(() => ({ getOrangeJellyCredit: vi.fn() }));
vi.mock('@/lib/marketing/orange-jelly-credit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/marketing/orange-jelly-credit')>()),
  getOrangeJellyCredit: mocks.getOrangeJellyCredit,
}));

const { OrangeJellyCredit, OrangeJellyCreditLine } = await import('@/features/marketing/orange-jelly-credit');

describe('OrangeJellyCreditLine', () => {
  it('reads "Built and maintained by Orange Jelly", with only the name as the link and no rel', () => {
    const html = renderToStaticMarkup(
      <OrangeJellyCreditLine credit={FALLBACK_CREDIT} className="line" linkClassName="link" />,
    );
    expect(html).toBe(
      '<p class="line">Built and maintained by <a href="https://www.orangejelly.co.uk/" class="link">Orange Jelly</a></p>',
    );
    expect(html.replace(/<[^>]+>/g, '')).toBe('Built and maintained by Orange Jelly');
  });

  it('adds rel="nofollow" when the feed asks for it', () => {
    const html = renderToStaticMarkup(<OrangeJellyCreditLine credit={{ ...FALLBACK_CREDIT, rel: 'nofollow' }} />);
    expect(html).toContain('<a href="https://www.orangejelly.co.uk/" rel="nofollow">Orange Jelly</a>');
  });

  it('shows the link alone, with no stray space, when the prefix is empty', () => {
    const html = renderToStaticMarkup(<OrangeJellyCreditLine credit={{ ...FALLBACK_CREDIT, prefix: '' }} />);
    expect(html).toBe('<p><a href="https://www.orangejelly.co.uk/">Orange Jelly</a></p>');
  });
});

describe('OrangeJellyCredit', () => {
  it('renders the line the feed gives, with the styles it is passed', async () => {
    mocks.getOrangeJellyCredit.mockResolvedValue({
      prefix: 'Made by',
      label: 'Orange Jelly',
      href: 'https://www.orangejelly.co.uk/solutions/hospitality-websites',
    });
    const html = renderToStaticMarkup(await OrangeJellyCredit({ className: 'line', linkClassName: 'link' }));
    expect(html).toBe(
      '<p class="line">Made by <a href="https://www.orangejelly.co.uk/solutions/hospitality-websites" class="link">Orange Jelly</a></p>',
    );
  });
});
