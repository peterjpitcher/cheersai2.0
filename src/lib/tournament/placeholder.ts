const PLACEHOLDER_PATTERN = /^[A-Z]{1,4}\d+$|^\d[A-Z]+$|^(FIFA|UEFA)\s+PO\s+/i;

export function isPlaceholderTeamName(name: string): boolean {
  return !name.trim() || PLACEHOLDER_PATTERN.test(name.trim())
    || /^(?:Europe|Rest of World)\s+\d+(?:st|nd|rd|th)$/i.test(name.trim())
    || /^(?:TBC|TBD|unknown|to be confirmed|winner\b|runner.up\b)/i.test(name.trim());
}

export function areBothTeamsConfirmed(teamA: string, teamB: string): boolean {
  return !isPlaceholderTeamName(teamA) && !isPlaceholderTeamName(teamB);
}
