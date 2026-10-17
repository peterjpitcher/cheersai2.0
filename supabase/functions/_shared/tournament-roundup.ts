/**
 * Which fixtures a tournament post covers (tasks/SPEC-rugby-match-posts.md part 2).
 *
 * A single-match post names its fixture in `tournament_fixture_id`. A match-day
 * round-up keeps that key for its lead fixture (the day's first game) and also
 * lists every game it covers in `roundup_fixture_ids`, with each game's content
 * revision at generation time in `roundup_revisions`. Shared by the app and the
 * publish worker so both read a round-up the same way.
 */

type Context = Record<string, unknown> | null | undefined;

function asContext(value: unknown): Context {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/** Every fixture id the post covers, lead first. Empty when the post is not a tournament post. */
export function coveredFixtureIds(promptContext: unknown): string[] {
  const context = asContext(promptContext);
  if (!context || context.source !== 'tournament') return [];
  const lead = typeof context.tournament_fixture_id === 'string' ? context.tournament_fixture_id : null;
  const roundup = Array.isArray(context.roundup_fixture_ids)
    ? context.roundup_fixture_ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  const ids = lead ? [lead, ...roundup.filter(id => id !== lead)] : roundup;
  return [...new Set(ids)];
}

export function coversFixture(promptContext: unknown, fixtureId: string): boolean {
  return coveredFixtureIds(promptContext).includes(fixtureId);
}

export function isRoundup(promptContext: unknown): boolean {
  return coveredFixtureIds(promptContext).length > 1;
}

/**
 * The content revision a covered fixture had when the post was generated, or
 * null when the post does not record one (which callers must treat as stale).
 */
export function expectedFixtureRevision(promptContext: unknown, fixtureId: string): number | null {
  const context = asContext(promptContext);
  if (!context) return null;
  const revisions = asContext(context.roundup_revisions);
  const fromRoundup = revisions?.[fixtureId];
  if (typeof fromRoundup === 'number') return fromRoundup;
  if (context.tournament_fixture_id === fixtureId && typeof context.screening_revision === 'number') return context.screening_revision;
  return null;
}
