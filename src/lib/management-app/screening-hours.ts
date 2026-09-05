import { DateTime } from 'luxon';
import { z } from 'zod';
import { ManagementApiError, type ManagementApiConfig } from './client';

const instant = z.string().datetime({ offset: true });
export const serviceWindowSchema = z.object({ startAt: instant, endAt: instant })
  .refine(w => Date.parse(w.startAt) < Date.parse(w.endAt), 'Invalid service interval');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => DateTime.fromISO(value).isValid);
export const screeningDayHoursSchema = z.object({
  date: dateSchema,
  state: z.enum(['open', 'closed', 'unknown']),
  regularOpensAt: instant.nullable(),
  bar: serviceWindowSchema.nullable(),
  kitchen: z.array(serviceWindowSchema),
  kitchenState: z.enum(['known', 'unknown']),
  hasSpecialHours: z.boolean(),
  fingerprint: z.string().min(1),
}).refine(day => day.state !== 'open' || day.bar !== null, 'Open day requires bar hours');
export const screeningHoursResponseSchema = z.object({
  schemaVersion: z.literal(1), timezone: z.literal('Europe/London'), days: z.array(screeningDayHoursSchema),
});
export type ServiceWindow = z.infer<typeof serviceWindowSchema>;
export type ScreeningDayHours = z.infer<typeof screeningDayHoursSchema>;
export type ScreeningHoursResponse = z.infer<typeof screeningHoursResponseSchema>;

/** Explicit account-scoped configuration supports authenticated editors and server feeds alike. */
export async function fetchScreeningHours(dates: string[], config: ManagementApiConfig): Promise<ScreeningHoursResponse> {
  const requested = [...new Set(z.array(dateSchema).min(1).max(31).parse(dates))].sort();
  const base = new URL(config.baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || !config.apiKey.trim()) {
    throw new ManagementApiError('UNAUTHORIZED', 'Valid management connection required');
  }
  const url = new URL('/api/business/screening-hours', base);
  url.searchParams.set('dates', requested.join(','));
  const response = await fetch(url, {
    headers: { 'X-API-Key': config.apiKey }, cache: 'no-store',
    redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
  });
  if (!response.ok) throw new ManagementApiError('HTTP_ERROR', 'Opening times unavailable', response.status);
  const envelope = z.object({ success: z.literal(true), data: screeningHoursResponseSchema }).parse(await response.json());
  const received = envelope.data.days.map(day => day.date).sort();
  if (JSON.stringify(received) !== JSON.stringify(requested)) {
    throw new ManagementApiError('INVALID_RESPONSE', 'Opening times response omitted or duplicated dates');
  }
  return envelope.data;
}

export function unknownScreeningHours(date: string): ScreeningDayHours {
  return { date, state: 'unknown', regularOpensAt: null, bar: null, kitchen: [], kitchenState: 'unknown', hasSpecialHours: false, fingerprint: 'unknown' };
}
