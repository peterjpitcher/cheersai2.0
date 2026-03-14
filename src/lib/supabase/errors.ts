export function isSchemaMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = (error as { code?: string }).code;
  return code === "PGRST205" || code === "42703" || code === "42P01";
}

/**
 * In production, logs a critical error before returning true so that
 * schema gaps are visible in server logs even when callers fall back to
 * empty data. In development the gap is silently swallowed as before.
 */
export function isSchemaMissingErrorWithWarning(error: unknown, context: string): boolean {
  const isMissing = isSchemaMissingError(error);
  if (isMissing && process.env.NODE_ENV === 'production') {
    console.error(`[schema-gap] Missing schema detected in ${context}. Check migrations.`, error);
  }
  return isMissing;
}
