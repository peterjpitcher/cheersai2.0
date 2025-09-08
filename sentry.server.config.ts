import * as Sentry from '@sentry/nextjs'
import { scrubSensitive } from '@/lib/scrub'

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    integrations: [],
    beforeSend(event) {
      try {
        return scrubSensitive(event)
      } catch {
        return event
      }
    },
  })
}
