// Lightweight Sentry wrapper so routes can safely call capture without hard deps

let Sentry: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Sentry = require('@sentry/nextjs');
} catch {
  Sentry = null;
}

export function captureException(error: unknown, context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }) {
  if (!Sentry || !process.env.SENTRY_DSN) return;
  try {
    if (context?.tags) {
      Sentry.setTags(context.tags);
    }
    if (context?.extra) {
      Sentry.setExtras(context.extra);
    }
    Sentry.captureException(error);
  } catch {
    // no-op
  }
}

