import { NATIONS_TEMPLATE_VERSION } from '../../../supabase/functions/_shared/nations-content-contract';
import { describe, expect, it } from 'vitest';
import { buildTournamentContentPayload } from './generate';
import type { ScreenedFixture } from './screening-service';
const tournament = { id: 't', houseRulesText: 'Outdated all games claim', postTemplate: 'We open early', updatedAt: 'version-1' };
const fixture = { id: 'f', teamA: 'Italy', teamB: 'South Africa', kickOffAt: '2026-11-07T11:40:00Z', round: 'league_round' as const, groupName: null, bookingUrl: null };
const screened = { contentRevision: 2, screenLabel: 'Main screen', commentary: 'on', hours: { fingerprint: 'fp' }, screening: { openingLabel: 'Showing from 12:00; kick-off 11:40, start missed', foodPromotion: { kind: 'during_screening', message: 'Book a table for food and rugby. Kitchen service 12:00 to 19:00.' } } } as ScreenedFixture;
describe('rugby social copy from screening facts', () => {
  it.each(['feed','story'] as const)('includes food and honest opening for %s', placement => {
    const result = buildTournamentContentPayload({ tournament, fixture, screened, platform: 'facebook', placement, scheduledFor: new Date('2026-11-06T11:40:00Z') });
    const preview = placement === 'story' ? result.promptContext.screening_caption : result.body;
    expect(preview).toContain('start missed');
    expect(preview).toContain('Kitchen service 12:00 to 19:00');
    expect(result.body).not.toContain('open early');
    expect(result.promptContext.ctaUrl).toContain('#fixture-f');
    expect(result.promptContext.screening_template_version).toBe(NATIONS_TEMPLATE_VERSION);
    expect(result.promptContext.booking_url).toBe('https://www.the-anchor.pub/book-table?fixture_id=f&date=2026-11-07');
    expect(result.promptContext.screening_revision).toBe(2);
    expect(result.promptContext.screening_hours_fingerprint).toBe('fp');
  });
});

it('preserves campaign attribution on approved destinations', () => {
 const result = buildTournamentContentPayload({ tournament, fixture: { ...fixture, bookingUrl: 'https://www.the-anchor.pub/book-table?utm_source=facebook&utm_campaign=rugby' }, screened, platform: 'facebook', placement: 'feed', scheduledFor: new Date('2026-11-06T11:40:00Z') });
 expect(result.promptContext.ctaUrl).toBe('https://www.the-anchor.pub/live-sport/nations-championship?utm_source=facebook&utm_campaign=rugby#fixture-f');
 expect(result.promptContext.booking_url).toContain('utm_source=facebook&utm_campaign=rugby&fixture_id=f&date=2026-11-07');
});
it.each(['javascript:alert(1)', 'https://unapproved.example/book-table', 'https://www.the-anchor.pub/book-table?redirect=https://unapproved.example', 'https://user:password@www.the-anchor.pub/book-table'])('rejects unapproved generation links: %s', bookingUrl => {
 expect(() => buildTournamentContentPayload({ tournament, fixture: { ...fixture, bookingUrl }, screened, platform: 'facebook', placement: 'feed', scheduledFor: new Date('2026-11-06T11:40:00Z') })).toThrow();
});

it.each(['facebook', 'instagram'] as const)('keeps split kitchen details after final %s channel rules', platform => {
 const food = 'Book a table for food and rugby. Kitchen service 12:00 to 14:00 and 17:00 to 19:00.';
 const result = buildTournamentContentPayload({ tournament, fixture, screened: { ...screened, screening: { ...screened.screening, foodPromotion: { ...screened.screening.foodPromotion, message: food } } }, platform, placement: 'feed', scheduledFor: new Date('2026-11-06T11:40:00Z') });
 expect(result.body).toContain(food);
 expect(result.body).toContain(screened.screening.openingLabel);
});
it('blocks a feed if final channel shortening removes kitchen qualification', () => {
 expect(() => buildTournamentContentPayload({ tournament, fixture, screened: { ...screened, screening: { ...screened.screening, foodPromotion: { ...screened.screening.foodPromotion, message: 'Kitchen service '.repeat(90) } } }, platform: 'instagram', placement: 'feed', scheduledFor: new Date('2026-11-06T11:40:00Z') })).toThrow('shortened');
});
