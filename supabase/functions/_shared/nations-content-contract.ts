/** Bump when rugby feed, story, overlay or channel rendering rules change. */
export const NATIONS_TEMPLATE_VERSION = 'nations-screening-v3';
const ORIGIN = 'https://www.the-anchor.pub';
const PAGE = '/live-sport/nations-championship';

/** Only approved website destinations and campaign attribution survive generation. */
export function nationsContentLinks(fixtureId: string, date: string, supplied?: string | null) {
  const campaign = new URLSearchParams();
  if (supplied) {
    const parsed = new URL(supplied);
    if (parsed.origin !== ORIGIN || parsed.username || parsed.password || !['/book-table', PAGE].includes(parsed.pathname)) throw new Error('Unapproved screening booking destination');
    for (const [key, value] of parsed.searchParams) {
      if (/^utm_(source|medium|campaign|term|content|id)$/.test(key)) campaign.append(key, value);
      else if (!['fixture_id', 'date'].includes(key)) throw new Error('Unapproved screening booking parameter');
    }
  }
  const card = new URL(PAGE, ORIGIN);
  card.search = campaign.toString();
  card.hash = `fixture-${fixtureId}`;
  const booking = new URL('/book-table', ORIGIN);
  booking.search = campaign.toString();
  booking.searchParams.set('fixture_id', fixtureId);
  booking.searchParams.set('date', date);
  return { ctaUrl: card.href, linkInBioUrl: card.href, booking_url: booking.href };
}

export function nationsContentContractIssue(context: Record<string, unknown>, fixtureId: string, date: string, supplied?: string | null): string | null {
  if (context.screening_template_version !== NATIONS_TEMPLATE_VERSION) return 'Screening template changed. Review and regenerate.';
  try {
    const expected = nationsContentLinks(fixtureId, date, supplied);
    if (Object.entries(expected).some(([key, value]) => context[key] !== value)) return 'Screening booking destination changed. Review and regenerate.';
  } catch { return 'Screening booking destination is not approved. Review required.'; }
  return null;
}
