/**
 * Convert a YYYY-MM-DD calendar date to the UTC ISO string representing
 * midnight in the Europe/London timezone on that date.
 *
 * During GMT  (UTC+0, late October → late March): midnight London = 00:00 UTC same calendar day.
 * During BST  (UTC+1, late March  → late October): midnight London = 23:00 UTC previous calendar day.
 */
export function toMidnightLondon(isoDate: string): string {
  // Start at UTC midnight for that calendar date.
  const utcMidnight = new Date(`${isoDate}T00:00:00Z`);

  // Ask Intl what hour London displays at UTC midnight.
  // In GMT: 00. In BST: 01.
  const londonHour = parseInt(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      hour12: false,
    }).format(utcMidnight),
    10,
  );

  // Step back by londonHour hours to reach the UTC instant that equals London midnight.
  const londonMidnight = new Date(utcMidnight.getTime() - londonHour * 60 * 60 * 1000);
  return londonMidnight.toISOString();
}
