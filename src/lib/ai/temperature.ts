/**
 * Temperature configuration per content-type x platform (AI-04).
 *
 * Lower temperatures produce more deterministic, factual copy (promotions, GBP).
 * Higher temperatures produce more creative, varied copy (stories, weekly recurring).
 */

export const TEMPERATURE_MAP: Record<string, Record<string, number>> = {
  instant_post: { facebook: 0.7, instagram: 0.7, gbp: 0.6 },
  story: { facebook: 0.8, instagram: 0.8, gbp: 0.6 },
  event: { facebook: 0.7, instagram: 0.7, gbp: 0.6 },
  promotion: { facebook: 0.6, instagram: 0.6, gbp: 0.6 },
  weekly_recurring: { facebook: 0.8, instagram: 0.8, gbp: 0.7 },
};

const DEFAULT_TEMPERATURE = 0.7;

/**
 * Returns the temperature for a given content type and optional platform.
 * Defaults to 0.7 if the combination is not found.
 */
export function getTemperature(contentType: string, platform?: string): number {
  const typeMap = TEMPERATURE_MAP[contentType];
  if (!typeMap) return DEFAULT_TEMPERATURE;
  if (!platform) {
    // Return average across platforms for the content type
    const values = Object.values(typeMap);
    if (!values.length) return DEFAULT_TEMPERATURE;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
  return typeMap[platform] ?? DEFAULT_TEMPERATURE;
}
