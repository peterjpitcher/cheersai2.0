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

