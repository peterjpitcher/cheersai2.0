/**
 * Any caught value as an Error for `logger.error`, so the log keeps the detail
 * the owner is no longer shown (tasks/SPEC-plain-error-messages.md).
 *
 * A Supabase query returns its error as a plain object ({ message, code, ... }),
 * which `new Error(String(value))` would reduce to "[object Object]".
 *
 * Kept apart from `./index` so a test that mocks the logger still gets this.
 */
export function toLoggableError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string') {
    const { message, code } = value as { message: string; code?: unknown };
    return new Error(typeof code === 'string' && code ? `${message} (code ${code})` : message);
  }
  return new Error(String(value));
}
