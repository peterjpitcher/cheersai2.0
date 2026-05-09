const PLACEHOLDER_PATTERN = /^[A-Z]{1,4}\d+$|^\d[A-Z]+$|^(FIFA|UEFA)\s+PO\s+/i;

export function isPlaceholderTeamName(name: string): boolean {
  return PLACEHOLDER_PATTERN.test(name.trim());
}

export function areBothTeamsConfirmed(teamA: string, teamB: string): boolean {
  return !isPlaceholderTeamName(teamA) && !isPlaceholderTeamName(teamB);
}
