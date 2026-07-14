/** Cap notification badge display at 99+ for large counts. */
export function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}
