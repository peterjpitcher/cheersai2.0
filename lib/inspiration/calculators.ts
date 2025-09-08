// Date calculators for UK movable feasts

function toISO(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDaysUTC(d: Date, days: number): Date {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  copy.setUTCDate(copy.getUTCDate() + days)
  return copy
}

export function easterSundayUTC(year: number): Date {
  // Anonymous Gregorian algorithm
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) // 3=Mar, 4=Apr
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

export function shroveTuesdayUTC(year: number): Date {
  // 47 days before Easter Sunday
  const easter = easterSundayUTC(year)
  return addDaysUTC(easter, -47)
}

export function mothersDayUKUTC(year: number): Date {
  // Mothering Sunday = 3 weeks before Easter Sunday
  const easter = easterSundayUTC(year)
  return addDaysUTC(easter, -21)
}

export function toISODate(d: Date): string { return toISO(d) }

