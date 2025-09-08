export function getUserTimeZone(): string {
  try {
    // In browsers, prefer the user’s resolved IANA timezone
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz) return tz
    }
  } catch {}
  // Fallback to London if unavailable
  return 'Europe/London'
}

type DateInput = Date | string | number

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value)
}

export function formatTime(value: DateInput, tz?: string): string {
  const date = toDate(value)
  const timeZone = tz || getUserTimeZone()
  // en-GB with explicit 12-hour and lowercase am/pm
  return new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(date).toLowerCase()
}

export function formatDate(value: DateInput, tz?: string, opts?: Intl.DateTimeFormatOptions): string {
  const date = toDate(value)
  const timeZone = tz || getUserTimeZone()
  const options: Intl.DateTimeFormatOptions = opts ?? { year: 'numeric', month: 'short', day: '2-digit' }
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).format(date)
}

export function formatDateTime(value: DateInput, tz?: string, opts?: Intl.DateTimeFormatOptions): string {
  const date = toDate(value)
  const timeZone = tz || getUserTimeZone()
  const defaults: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }
  const options = { ...(opts || {}), timeZone }
  return new Intl.DateTimeFormat('en-GB', { ...defaults, ...options }).format(date).replace(/AM|PM/g, m => m.toLowerCase())
}

