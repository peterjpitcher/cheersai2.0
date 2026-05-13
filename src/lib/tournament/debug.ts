const DEBUG_MARKER = 'inline-font-2026-05-13';

const DEBUG_ENABLED =
  process.env.NODE_ENV === 'development' || process.env.TOURNAMENT_DEBUG === '1';

type DebugDetails = Record<string, unknown>;

export function redactId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

export function tournamentDebug(event: string, details?: DebugDetails): void {
  if (!DEBUG_ENABLED) return;
  console.info(`[tournament-debug:${DEBUG_MARKER}] ${event}`, details ?? {});
}

export function tournamentDebugError(
  event: string,
  error: unknown,
  details?: DebugDetails,
): void {
  if (!DEBUG_ENABLED) return;

  const serialisedError = error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    : { message: String(error) };

  console.error(`[tournament-debug:${DEBUG_MARKER}] ${event}`, {
    ...details,
    error: serialisedError,
  });
}
