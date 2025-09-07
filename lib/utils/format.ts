export const LOCALE = 'en-GB'

export function formatDate(value: string | number | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(LOCALE, options ?? { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

export function formatTime(value: string | number | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(LOCALE, options ?? { hour: '2-digit', minute: '2-digit' }).format(date)
}

export function formatDateTime(value: string | number | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(LOCALE, options ?? { 
    year: 'numeric', month: 'short', day: 'numeric', 
    hour: '2-digit', minute: '2-digit' 
  }).format(date)
}

// Phone helpers (UK-first display). We store E.164 server-side, but never display +44.
export function formatUkPhoneDisplay(input: string): string {
  if (!input) return ''
  const raw = String(input).trim()
  // Strip non-digits except leading +
  const digits = raw.replace(/(?!^)[^0-9]/g, '')
  // If starts with +44 or 44, convert to national with leading 0
  let national = digits
  if (raw.startsWith('+44')) {
    national = '0' + digits.slice(2)
  } else if (raw.startsWith('44')) {
    national = '0' + digits.slice(2)
  } else if (raw.startsWith('+')) {
    // Other country code: just drop + for display
    national = digits
  }
  // Basic spacing heuristics; avoid showing +44 per requirement
  if (national.length === 11 && national.startsWith('07')) {
    // Mobile: 5-6 split (e.g., 07123 456789)
    return `${national.slice(0,5)} ${national.slice(5)}`
  }
  if (national.startsWith('020') && national.length === 11) {
    // London: 3 4 4 (020 7946 0958)
    return `${national.slice(0,3)} ${national.slice(3,7)} ${national.slice(7)}`
  }
  if (national.length === 11) {
    // Fallback: 4 3 4 (e.g., 0161 496 0000)
    return `${national.slice(0,4)} ${national.slice(4,7)} ${national.slice(7)}`
  }
  if (national.length === 10) {
    return `${national.slice(0,3)} ${national.slice(3,6)} ${national.slice(6)}`
  }
  return national
}

// For wa.me links and telephony actions; keep machine format without plus
export function toUkDialDigits(input: string): string {
  if (!input) return ''
  const raw = String(input).trim()
  const digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+44')) return '44' + digits.slice(2)
  if (raw.startsWith('44')) return digits
  // Assume national starts with 0
  if (digits.startsWith('0')) return '44' + digits.slice(1)
  return digits
}
