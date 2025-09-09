// Sentry disabled: no-op wrapper to keep call sites stable
export function captureException(_error: unknown, _context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }) {
  // intentionally blank
}
