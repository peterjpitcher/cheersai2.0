// Sentry disabled: no-op wrapper to keep call sites stable
export function captureException(_error?: unknown, _context?: Record<string, unknown>): void {
  void _error
  void _context
  // intentionally blank
}
